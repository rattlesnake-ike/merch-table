import { listOrders, getOrder, markShipped, orderRows, trackingUrl, ticketByCode, backfillTicketIndex } from "./orders.js";
import { isTicket, ticketProducts, ticketsForOrder, verifyCode, admit, usedAt, showOver, headcount } from "./tickets.js";
/* The band's own admin: sign in by emailed link, edit products on a phone, save, done.
   No GitHub, no files, no terminal. Live edits go to KV and the Worker serves them
   over the built pages; the repo stays the backup, not the bottleneck. */

const enc = new TextEncoder();
const b64url = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0;
}

/** A token carries its own purpose. A sign-in link is NOT a session, and can never be replayed as one. */
export async function signToken(secret, payload, ttlSeconds) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds, jti: b64url(crypto.getRandomValues(new Uint8Array(9))) };
  const data = b64url(enc.encode(JSON.stringify(body)));
  return `${data}.${await hmac(secret, data)}`;
}
export async function verifyToken(secret, token, expectedPurpose) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [data, sig] = token.split(".");
  if (!sig || !timingSafeEqual(sig, await hmac(secret, data))) return null;
  let body; try { body = JSON.parse(new TextDecoder().decode(unb64url(data))); } catch { return null; }
  if (!body || body.exp < Math.floor(Date.now() / 1000)) return null;
  if (body.t !== expectedPurpose) return null;          // a link token can never act as a session
  return body;
}

const cookie = (req, name) => (req.headers.get("cookie") ?? "").split(";").map((c) => c.trim()).find((c) => c.startsWith(name + "="))?.slice(name.length + 1);

/** Who may sign in: the addresses in store.json's `owners`, nobody else. */
const owners = (store) => (store.owners ?? []).map((e) => String(e).trim().toLowerCase()).filter(Boolean);

export async function csrfToken(secret, session) { return (await hmac(secret, `csrf:${session.email}:${session.gen ?? 0}`)).slice(0, 24); }

export async function currentAdmin(req, env, store) {
  if (!env.SESSION_SECRET) return null;
  const tok = cookie(req, "mt_session");
  if (!tok) return null;
  const s = await verifyToken(env.SESSION_SECRET, tok, "session");
  if (!s) return null;
  if (!owners(store).includes(s.email)) return null;     // removed from owners = signed out everywhere
  if (env.STOCK && (await env.STOCK.get(`revoked:${s.email}:${s.gen ?? 0}`))) return null;
  return s;
}

/* ---------------- routes ---------------- */

/** A cross-site POST is refused outright. SameSite=Lax already blocks most of this;
    this does not depend on the browser getting that right. */
function sameOrigin(req, env, url) {
  if (req.method !== "POST") return true;
  const site = (env.SITE_URL || url.origin).replace(/\/$/, "");
  const origin = req.headers.get("origin");
  if (origin) return origin === site || origin === url.origin;
  const referer = req.headers.get("referer");
  if (referer) { try { const r = new URL(referer); return r.origin === new URL(site).origin || r.origin === url.origin; } catch { return false; } }
  return false;   // a form POST from a browser always sends one of the two
}

export async function handleAdmin(req, env, url, store, products, saveProducts, saveStore) {
  const path = url.pathname;
  const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
  const html = (body, status = 200, headers = {}) => new Response(page(body), { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", ...headers } });

  if (!sameOrigin(req, env, url)) return new Response("Refused: that request didn't come from this store.", { status: 403, headers: { "content-type": "text/plain" } });

  // DEMO_ADMIN=1 lets anyone look around the admin without signing in. Saves are refused.
  // Never set this on a real store: it shows your product list to the public.
  if (env.DEMO_ADMIN === "1") {
    if (req.method === "POST") return html(`<h1>This is the demo</h1><p>Nothing can be changed here. On your own store this would have saved and gone live at once.</p><p><a href="/admin">Back to the products</a></p>`, 200);
    return await screens(req, env, url, store, products, { email: "you@yourband.com", gen: 0 }, true);
  }
  if (!env.SESSION_SECRET) return html(`<h1>Almost there</h1><p>To turn the admin on, add a setting called <code>SESSION_SECRET</code> with any long random string, and list who may sign in under <code>owners</code> in <code>store.json</code>.</p><p><a href="/api/setup">Check the rest of the setup</a></p>`, 503);
  if (!owners(store).length) return html(`<h1>Nobody can sign in yet</h1><p>Add the band's email addresses to <code>owners</code> in <code>store.json</code>, then push. Only those addresses can ever sign in.</p>`, 503);

  // --- ask for a sign-in link
  if (path === "/admin/link" && req.method === "POST") {
    const form = await req.formData();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const rate = await bump(env, `rl:link:${email}`, 300);
    // Always answer the same way: never reveal whether an address is an owner.
    if (owners(store).includes(email) && rate <= 5) {
      const token = await signToken(env.SESSION_SECRET, { t: "link", email }, 15 * 60);
      const link = `${(env.SITE_URL || url.origin).replace(/\/$/, "")}/admin/in?t=${token}`;
      await sendLink(env, store, email, link);
    }
    return html(`<h1>Check your email</h1><p>If <b>${escapeHtml(email)}</b> can sign in to this store, a link is on its way. It works once and expires in fifteen minutes.</p>`);
  }

  // --- click the link: exchange it for a session
  if (path === "/admin/in") {
    const t = url.searchParams.get("t") ?? "";
    const claim = await verifyToken(env.SESSION_SECRET, t, "link");
    if (!claim || !owners(store).includes(claim.email)) return html(`<h1>That link didn't work</h1><p>It may have expired, or already been used. <a href="/admin">Ask for a new one</a>.</p>`, 400);
    if (env.STOCK) {
      const used = await env.STOCK.get(`used:${claim.jti}`);
      if (used) return html(`<h1>That link was already used</h1><p>Links work once. <a href="/admin">Ask for a new one</a>.</p>`, 400);
      await env.STOCK.put(`used:${claim.jti}`, "1", { expirationTtl: 3600 });
    }
    const session = await signToken(env.SESSION_SECRET, { t: "session", email: claim.email, gen: 0 }, 14 * 24 * 3600);
    return new Response("", { status: 302, headers: { location: "/admin", "set-cookie": `mt_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${14 * 24 * 3600}`, "cache-control": "no-store" } });
  }

  if (path === "/admin/out") {
    return new Response("", { status: 302, headers: { location: "/admin", "set-cookie": "mt_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" } });
  }

  const me = await currentAdmin(req, env, store);

  // --- signed out: the sign-in form
  if (!me) {
    if (path !== "/admin") return new Response("", { status: 302, headers: { location: "/admin" } });
    return html(`<h1>${escapeHtml(store.name)}</h1><p class="sub">Sign in to edit the store. We'll email you a link; there's no password.</p>
      <form method="post" action="/admin/link"><label for="email">Your email</label><input id="email" name="email" type="email" required autocomplete="email" autofocus><button type="submit">Email me a link</button></form>
      <p class="fine">Only the addresses listed as owners of this store can sign in.</p>`);
  }

  return await screens(req, env, url, store, products, me, false, saveProducts);
}

async function screens(req, env, url, store, products, me, demo, saveProducts) {
  const path = url.pathname;
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const html = (body, status = 200) => new Response(page(body), { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });

  if (path === "/admin/orders" || path.startsWith("/admin/orders/")) return await ordersScreen(req, env, url, store, me, demo);
  if (path === "/admin/door" || path.startsWith("/admin/door/")) return await doorScreen(req, env, url, store, products, me, demo);

  if (path === "/admin" && req.method === "GET") {
    const rows = products.map((p) => {
      const sizes = p.variants.map((v) => `<span class="${v.available === false ? "out" : "in"}">${escapeHtml(v.title)}</span>`).join(" ");
      return `<a class="row" href="/admin/p/${encodeURIComponent(p.id)}">
        <span class="thumb">${p.images?.[0] ? `<img src="/${escapeHtml(p.images[0])}" alt="" loading="lazy">` : ""}</span>
        <span class="meta"><b>${escapeHtml(p.title)}</b><small>${money(p.price, store)} · ${sizes}</small></span><span class="go">›</span></a>`;
    }).join("");
    return html(`<header class="bar"><h1>${escapeHtml(store.name)}</h1>${demo ? "" : `<a class="ghost" href="/admin/out">Sign out</a>`}</header>
      ${demo ? `<p class="demo">You're looking at the admin of a made-up band's store. Everything works except saving. <a href="https://github.com/rattlesnake-ike/merch-table">This is the store</a>.</p>` : ""}
      <p class="sub">Tap a product to change its price, mark a size sold out, or hide it. Changes go live straight away.</p>
      <div class="list">${rows}</div>
      <p class="fine"><a href="/admin/orders">Orders</a> · <a href="/admin/door">Door</a> · <a href="/">See the store</a> · <a href="/api/setup">Setup check</a> · ${demo ? "a look around: nothing here can be changed" : `signed in as ${escapeHtml(me.email)}`}</p>`);
  }

  if (path.startsWith("/admin/p/")) {
    const id = decodeURIComponent(path.slice("/admin/p/".length));
    const p = products.find((x) => x.id === id);
    if (!p) return html(`<h1>Not found</h1><p><a href="/admin">Back</a></p>`, 404);

    if (req.method === "POST") {
      const form = await req.formData();
      if (!timingSafeEqual(String(form.get("_t") ?? ""), await csrfToken(env.SESSION_SECRET, me))) return html(`<h1>That form had gone stale</h1><p>Open the product again and make the change once more. <a href="/admin/p/${encodeURIComponent(id)}">Back</a></p>`, 403);
      const next = structuredClone(p);
      const cents = parsePrice(form.get("price"));
      if (cents === null) return html(`<h1>That price didn&rsquo;t look right</h1><p>Use a plain number, like <b>25</b> or <b>25.00</b>, and no more than ${money(MAX_PRICE, store)}. <a href="/admin/p/${encodeURIComponent(id)}">Back</a></p>`, 400);
      next.price = cents;
      next.title = String(form.get("title") ?? p.title).slice(0, 200) || p.title;
      next.description = String(form.get("description") ?? "").slice(0, 4000);
      next.hidden = form.get("hidden") === "on" ? true : undefined;
      const shipDate = String(form.get("ship_date") ?? "").trim();
      next.ship_date = /^\d{4}-\d{2}-\d{2}$/.test(shipDate) ? shipDate : undefined;
      next.variants = p.variants.map((v) => ({ ...v, available: form.get(`v_${v.id}`) === "on" }));
      const changed = await saveProducts(products.map((x) => (x.id === id ? next : x)), me.email, describe(p, next, store));
      if (!changed.ok) return html(`<h1>Couldn't save</h1><p>${escapeHtml(changed.error)}</p><p><a href="/admin/p/${encodeURIComponent(id)}">Back</a></p>`, 500);
      return new Response("", { status: 302, headers: { location: `/admin?saved=${encodeURIComponent(p.title)}` } });
    }

    const sizes = p.variants.map((v) => `<label class="sw" data-sz><input type="checkbox" name="v_${escapeHtml(v.id)}" ${v.available === false ? "" : "checked"}><span>${escapeHtml(v.title)}</span><small data-state>${v.available === false ? "sold out" : "in stock"}</small></label>`).join("");
    return html(`<header class="bar"><a class="ghost" href="/admin">‹ All products</a></header>
      <form method="post"><input type="hidden" name="_t" value="${await csrfToken(env.SESSION_SECRET, me)}">
        ${p.images?.[0] ? `<img class="hero" src="/${escapeHtml(p.images[0])}" alt="">` : ""}
        <label for="title">Name</label><input id="title" name="title" value="${escapeHtml(p.title)}" required>
        <label for="price">Price</label><div class="money"><span>${store.currency === "usd" ? "$" : store.currency.toUpperCase()}</span><input id="price" name="price" inputmode="decimal" value="${(p.price / 100).toFixed(2)}" required></div>
        <label>Sizes <small>untick to mark sold out</small></label><div class="sizes">${sizes}</div>
        <label for="ship_date">Pre-order ship date <small>leave empty if it's in stock</small></label><input id="ship_date" name="ship_date" type="date" value="${escapeHtml(p.ship_date ?? "")}">
        <label for="description">Description</label><textarea id="description" name="description" rows="5">${escapeHtml(p.description ?? "")}</textarea>
        <label class="sw"><input type="checkbox" name="hidden" ${p.hidden ? "checked" : ""}><span>Hide from the store</span><small>the page stays, it just isn't listed</small></label>
        <button type="submit">Save</button>
        <p class="fine"><a href="/products/${encodeURIComponent(p.id)}/">See this on the store</a></p>
      </form>`);
  }

  return html(`<h1>Not found</h1><p><a href="/admin">Back</a></p>`, 404);
}

export const MAX_PRICE = 100000 * 100;   // $100,000: a typo guard, not a limit anyone will meet
/** Read a typed price. Returns whole cents, or null if it isn't a sane positive amount.
    Checks what was TYPED: stripping characters first turns "-5" into 5 and a typo into a live price. */
export function parsePrice(raw) {
  const s = String(raw ?? "").trim().replace(/[$\u00a3\u20ac\u00a5]/g, "").replace(/,/g, "").trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;      // no minus, no exponent, no spaces, at most 2 decimals
  const cents = Math.round(Number(s) * 100);
  if (!Number.isFinite(cents) || cents <= 0 || cents > MAX_PRICE) return null;
  return cents;
}

/** The door. Someone types a code, and gets a green yes or a red no. Nothing else.
    Built for one hand, bad light, and a queue of people waiting. */
async function doorScreen(req, env, url, store, products, me, demo) {
  const shows = ticketProducts(products).filter((p) => !showOver(p));
  const css = `<style>
    body{background:#141416;color:#fff;font:16px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;margin:0;padding:18px}
    main{max-width:28rem;margin:0 auto}
    h1{font-size:1.3rem;margin:.2rem 0 .6rem}
    .sub,.fine{color:#aaa}
    input,button,select{font:inherit;width:100%;padding:16px;border-radius:10px;border:1.5px solid #555;background:#1e1e22;color:#fff;margin:8px 0}
    input[name=code]{font-family:ui-monospace,Menlo,monospace;font-size:2rem;text-align:center;letter-spacing:.1em;text-transform:uppercase}
    button{background:#fff;color:#141416;font-weight:800;border-color:#fff;cursor:pointer;font-size:1.1rem}
    .yes,.no,.warn{border-radius:12px;padding:22px;text-align:center;margin:12px 0}
    .yes{background:#1b5e20;border:2px solid #4caf50}
    .no{background:#5f1a17;border:2px solid #e57373}
    .warn{background:#5d4a12;border:2px solid #e6c34a}
    .big{font-size:2rem;font-weight:800;margin:0 0 .3rem}
    a{color:#9ab6ff}
    .count{display:flex;gap:14px;flex-wrap:wrap;margin:10px 0;color:#aaa;font-size:.9rem}
  </style>`;
  const page = (body, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Door</title>${css}</head><body><main>${body}</main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });

  const form = async (msg = "") => {
    // How many are in the room. A fire marshal asks for this number, and a settlement starts
    // from it, so it is counted from the check-ins rather than kept as a tally that can drift.
    const counts = demo ? [] : await headcount(env, products).catch(() => []);
    const countLine = counts.length
      ? `<p class="count">${counts.map((c) => `<span><b>${c.inRoom}</b> in the room${typeof c.capacity === "number" ? ` of ${c.capacity}` : ""} · ${escapeHtml(c.title)}</span>`).join("")}</p>`
      : "";
    return `<h1>Door</h1>
    ${shows.length ? `<p class="sub">${shows.map((p) => escapeHtml(p.show.title ?? p.title)).join(" · ")}</p>` : `<p class="sub">No upcoming shows in the store.</p>`}
    ${countLine}
    ${msg}
    <form method="post"><input type="hidden" name="_t" value="${demo ? "" : await csrfToken(env.SESSION_SECRET, me)}">
      <input name="code" required autofocus autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-1234" aria-label="Ticket code" inputmode="latin">
      <button type="submit">Check in</button></form>
    <p class="fine"><a href="/admin">Products</a> · <a href="/admin/orders">Orders</a></p>`;
  };

  if (req.method !== "POST") return page(await form());

  const f = await req.formData();
  if (!demo && !timingSafeEqual(String(f.get("_t") ?? ""), await csrfToken(env.SESSION_SECRET, me))) return page(await form(`<div class="warn"><p class="big">Reload the page</p><p>It had been open too long.</p></div>`), 403);
  const code = String(f.get("code") ?? "");
  if (demo) return page(await form(`<div class="warn"><p class="big">Demo</p><p>A real door would check that code against the tickets sold.</p></div>`));

  // Find the one ticket this code belongs to. The index makes that a single read; the walk
  // below is the fallback for a store whose orders predate the index. A door queue cannot wait
  // on hundreds of sequential reads per scan.
  let hit = await ticketByCode(env, code);
  if (!hit) {
    // First scan on a store whose orders predate the index, or after the catalogue changed:
    // build it once, then try again. Costs one slow scan, never a second one.
    await backfillTicketIndex(env, products);
    hit = await ticketByCode(env, code);
  }
  const candidates = hit ? [await getOrder(env, hit.order)].filter(Boolean) : await listOrders(env, 1000);
  for (const o of candidates) {
    for (const t of await ticketsForOrder(env, o, products)) {
      if (!(await verifyCode(env.SESSION_SECRET ?? "unset", o.id, t.seq, code))) continue;
      const show = t.product.show;
      const who = escapeHtml(o.name ?? o.email ?? "");
      const what = escapeHtml(show.title ?? t.product.title);
      const r = await admit(env, o.id, t.seq);
      if (r.already) return page(await form(`<div class="no"><p class="big">Already used</p><p>${what} · ${who}</p><p class="fine">Checked in at ${new Date(r.at).toLocaleTimeString(store.locale ?? "en-US")}. If that wasn't them, ask for ID or send them to whoever runs the show.</p></div>`));
      if (!r.ok) return page(await form(`<div class="warn"><p class="big">Can't check in</p><p>${escapeHtml(r.reason ?? "")}</p></div>`));
      return page(await form(`<div class="yes"><p class="big">Let them in</p><p>${what} · ${who}</p></div>`));
    }
  }
  return page(await form(`<div class="no"><p class="big">Not a ticket</p><p class="fine">No ticket with that code. Check for a typo, or look them up by email in <a href="/admin/orders">Orders</a>.</p></div>`));
}

/** The band's order list, and the one box that protects them: tracking. */
async function ordersScreen(req, env, url, store, me, demo) {
  const html = (body, status = 200) => new Response(page(body), { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
  const id = url.pathname.startsWith("/admin/orders/") ? decodeURIComponent(url.pathname.slice("/admin/orders/".length)) : null;

  if (req.method === "POST") {
    if (demo) return html(`<h1>This is the demo</h1><p>On your own store this would have saved. <a href="/admin/orders">Back</a></p>`);
    const form = await req.formData();
    if (!timingSafeEqual(String(form.get("_t") ?? ""), await csrfToken(env.SESSION_SECRET, me))) return html(`<h1>That form had gone stale</h1><p><a href="/admin/orders">Open it again</a>.</p>`, 403);
    await markShipped(env, String(form.get("id") ?? ""), { carrier: form.get("carrier"), tracking: form.get("tracking"), note: form.get("note") });
    return new Response("", { status: 302, headers: { location: "/admin/orders?saved=1" } });
  }

  if (id) {
    const o = await getOrder(env, id);
    if (!o) return html(`<h1>Not found</h1><p><a href="/admin/orders">Back to orders</a></p>`, 404);
    return html(`<header class="bar"><a class="ghost" href="/admin/orders">&lsaquo; Orders</a></header>${disputePack(o, store)}`);
  }

  const orders = demo ? [] : await listOrders(env, 200);
  const toPack = orders.filter((o) => o.status !== "shipped");
  const tok = demo ? "" : await csrfToken(env.SESSION_SECRET, me);
  const row = (o) => {
    const t = trackingUrl(o.carrier, o.tracking);
    return `<div class="row" style="display:block">
      <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><b style="flex:1;min-width:12rem">${escapeHtml(o.goods || o.items)}</b><span class="mono">${new Intl.NumberFormat(store.locale ?? "en-US", { style: "currency", currency: (o.currency ?? "usd").toUpperCase() }).format((o.total ?? 0) / 100)}</span></div>
      <small>${escapeHtml(o.name ?? "")} · ${escapeHtml(o.email ?? "")} · ${new Date(o.at).toLocaleDateString(store.locale ?? "en-US", { day: "numeric", month: "short" })}${Number(o.orderNo) > 1 ? ` · their order ${escapeHtml(o.orderNo)}` : ""}</small>
      ${o.ship?.address ? `<br><small>${escapeHtml([o.ship.address.line1, o.ship.address.line2, o.ship.address.city, o.ship.address.state, o.ship.address.postal_code, o.ship.address.country].filter(Boolean).join(", "))}</small>` : ""}
      ${o.status === "shipped"
        ? `<p class="fine" style="margin:8px 0 0">Shipped ${new Date(o.shippedAt).toLocaleDateString(store.locale ?? "en-US", { day: "numeric", month: "short" })}${o.tracking ? ` · ${t ? `<a href="${t}" rel="noopener">${escapeHtml(o.carrier || "track")} ${escapeHtml(o.tracking)}</a>` : escapeHtml(o.tracking)}` : ""} · <a href="/admin/orders/${encodeURIComponent(o.id)}">If this is ever disputed</a></p>`
        : `<form method="post" style="margin-top:10px;padding:0;border:0;background:none"><input type="hidden" name="_t" value="${tok}"><input type="hidden" name="id" value="${escapeHtml(o.id)}">
           <div style="display:flex;gap:8px;flex-wrap:wrap"><input name="carrier" placeholder="USPS" list="carriers" style="flex:0 0 7rem"><input name="tracking" placeholder="Tracking number" style="flex:1;min-width:10rem"><button type="submit" style="width:auto;margin:0;padding:10px 16px">Shipped</button></div></form>`}
    </div>`;
  };
  return html(`<header class="bar"><h1>Orders</h1><a class="ghost" href="/admin">Products</a></header>
    ${demo ? `<p class="demo">A real store lists its orders here, with a box to put the tracking number in. There are none on the demo.</p>` : ""}
    ${url.searchParams.get("saved") ? `<p class="demo" style="background:#e8f5e9;border-color:#a5c8a9">Marked shipped. That tracking number is the best protection you have if this is ever disputed.</p>` : ""}
    <datalist id="carriers"><option>USPS</option><option>UPS</option><option>FedEx</option><option>DHL</option><option>Royal Mail</option></datalist>
    ${orders.length ? `<p class="sub">${toPack.length} to pack${orders.length - toPack.length ? `, ${orders.length - toPack.length} shipped` : ""}. Put the tracking number in when you post it: it is what answers a bank if a buyer ever says it never arrived.</p><div class="list">${orders.map(row).join("")}</div>` : demo ? "" : `<p class="sub">No orders yet. They appear here the moment someone pays.</p><p class="fine">Orders only arrive here if Stripe can reach your store: set the webhook (README step 6.4). Without it the store still sells, but this list stays empty.</p>`}
    <p class="fine"><a href="/orders">What a buyer sees</a> · <a href="/admin">Products</a></p>`);
}

/** Everything a bank asks for, in the order Stripe's form asks for it, ready to paste. */
function disputePack(o, store) {
  const t = trackingUrl(o.carrier, o.tracking);
  const line = (k, v) => v ? `<tr><td><b>${escapeHtml(k)}</b></td><td>${v}</td></tr>` : "";
  return `<h1 style="font-size:1.5rem">If this order is disputed</h1>
  <p class="sub">A dispute gives you a few days to answer. Paste these into Stripe's form, field by field. Most of it exists only because the store wrote it down when the order was placed.</p>
  <div class="tbl"><table><tbody>
    ${line("Product description", escapeHtml(o.goods || o.items))}
    ${line("Order date", new Date(o.at).toUTCString())}
    ${line("Amount", new Intl.NumberFormat(store.locale ?? "en-US", { style: "currency", currency: (o.currency ?? "usd").toUpperCase() }).format((o.total ?? 0) / 100))}
    ${line("Customer name", escapeHtml(o.name ?? ""))}
    ${line("Customer email", escapeHtml(o.email ?? ""))}
    ${line("Shipping address", o.ship?.address ? escapeHtml([o.ship.address.line1, o.ship.address.line2, o.ship.address.city, o.ship.address.state, o.ship.address.postal_code, o.ship.address.country].filter(Boolean).join(", ")) : "")}
    ${line("Shipping carrier", escapeHtml(o.carrier ?? ""))}
    ${line("Tracking number", escapeHtml(o.tracking ?? ""))}
    ${line("Shipping date", o.shippedAt ? new Date(o.shippedAt).toUTCString() : "")}
    ${line("Country the order came from", escapeHtml(o.ipCountry ?? ""))}
    ${line("Earlier orders from this buyer", Number(o.orderNo) > 1 ? `${escapeHtml(o.orderNo)} orders in total. Visa's Compelling Evidence rule lets two earlier undisputed orders from the same buyer overturn a fraud claim — search this list for the same email or address and include them.` : "")}
    ${line("Refund policy", `Shown at checkout and at ${escapeHtml(store.siteUrl ?? "")}/shipping/`)}
  </tbody></table></div>
  ${o.tracking ? `<p class="demo" style="background:#e8f5e9;border-color:#a5c8a9"><b>You have tracking.</b> That is the single strongest piece of evidence for &ldquo;it never arrived&rdquo;. ${t ? `Screenshot the delivery confirmation at <a href="${t}" rel="noopener">the carrier's page</a> and attach it as a file.` : "Screenshot the carrier's delivery confirmation and attach it."}</p>` : `<p class="demo"><b>No tracking on this order.</b> If you have a receipt from the post office, photograph it. Without proof of delivery a &ldquo;never arrived&rdquo; claim is very hard to answer, which is why it is worth adding tracking to everything.</p>`}
  <p class="fine">Before you fight it, consider writing to the buyer: a refund or a replacement usually costs less than a lost dispute, and a withdrawn dispute costs nothing. Banks never read links, so attach files rather than pointing at pages.</p>`;
}

function describe(before, after, store) {
  const bits = [];
  if (before.price !== after.price) bits.push(`price ${money(before.price, store)} → ${money(after.price, store)}`);
  if (before.title !== after.title) bits.push(`renamed`);
  const flip = after.variants.filter((v) => (before.variants.find((b) => b.id === v.id)?.available !== false) !== (v.available !== false));
  for (const v of flip) bits.push(`${v.title} ${v.available ? "back in stock" : "sold out"}`);
  if (!!before.hidden !== !!after.hidden) bits.push(after.hidden ? "hidden" : "shown");
  if ((before.ship_date ?? "") !== (after.ship_date ?? "")) bits.push(after.ship_date ? `pre-order ${after.ship_date}` : "no longer a pre-order");
  return bits.join(", ") || "edited";
}

const money = (c, store) => new Intl.NumberFormat(store.locale ?? "en-US", { style: "currency", currency: (store.currency ?? "usd").toUpperCase() }).format(c / 100);
export const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function bump(env, key, ttl) {
  if (!env.STOCK) return 0;
  const n = Number((await env.STOCK.get(key)) ?? 0) + 1;
  await env.STOCK.put(key, String(n), { expirationTtl: ttl });
  return n;
}

async function sendLink(env, store, email, link) {
  const from = env.MAIL_FROM || `store@${(env.SITE_URL || "").replace(/^https?:\/\//, "").split("/")[0]}`;
  const text = `Here's your link to edit ${store.name}:\n\n${link}\n\nIt works once and expires in fifteen minutes. If you didn't ask for it, ignore this email and nothing happens.`;
  if (env.RESEND_API_KEY) {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from, to: email, subject: `Sign in to ${store.name}`, text }) });
    if (!r.ok) console.error("resend", r.status, await r.text());
    return;
  }
  console.log("ADMIN SIGN-IN LINK (no mail service configured):", link);
}

function page(body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Store admin</title><style>
:root{--ink:#141416;--paper:#fff;--soft:#f4f3ef;--line:#d9d7d0;--accent:#2743d0}
*{box-sizing:border-box}
body{font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;margin:0;background:var(--soft);color:var(--ink);padding:16px;padding-bottom:64px}
main,form,.list{max-width:34rem;margin:0 auto}
h1{font-size:1.5rem;margin:.2rem 0}
.bar{display:flex;align-items:center;gap:12px;max-width:34rem;margin:0 auto 12px}
.bar h1{flex:1}
.sub{max-width:34rem;margin:0 auto 18px;color:#555}
.fine{max-width:34rem;margin:18px auto;font-size:.85rem;color:#666}
a{color:var(--accent)}
.ghost{font-size:.9rem;text-decoration:none}
.list{display:grid;gap:10px}
.row{display:flex;gap:12px;align-items:center;padding:10px;background:var(--paper);border:1px solid var(--line);border-radius:10px;text-decoration:none;color:inherit}
.thumb{width:56px;height:56px;flex:none;background:var(--soft);border-radius:6px;overflow:hidden}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.meta{flex:1;min-width:0;display:grid}
.meta small{color:#666;font-size:.85rem}
.meta .out{text-decoration:line-through;color:#999}
.go{color:#999;font-size:1.4rem}
form{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:16px}
label{display:block;font-weight:600;margin:16px 0 6px}
label small{font-weight:400;color:#666}
input,textarea{width:100%;font:inherit;padding:12px;border:1.5px solid var(--line);border-radius:8px;background:var(--paper)}
input:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
.money{display:flex;align-items:center;gap:8px}
.money span{font-weight:700;font-size:1.1rem}
.sizes{display:grid;gap:8px}
.sw{display:grid;grid-template-columns:24px 1fr;align-items:center;gap:6px 12px;margin:0;padding:14px;border:1.5px solid var(--line);border-radius:8px;font-weight:500}
.sw input{width:24px;height:24px;flex:none;accent-color:var(--accent);grid-row:1}
.sw span{grid-column:2}
.sw small{grid-column:2;color:#666;font-weight:400;font-size:.85rem;line-height:1.35}
.demo{max-width:34rem;margin:0 auto 14px;padding:12px 14px;background:#fff7e6;border:1px solid #e8c37a;border-radius:8px;font-size:.92rem}
.sizes .sw{grid-template-columns:24px 1fr auto}
.sizes .sw small{grid-column:3;grid-row:1;text-align:right}
form > .sw{margin-top:18px}
.hero{width:100%;max-width:220px;border-radius:8px;display:block;margin:0 auto}
button{width:100%;margin-top:22px;padding:15px;font:inherit;font-weight:700;background:var(--ink);color:#fff;border:0;border-radius:8px;cursor:pointer}
.sizes .sw:not(:has(input:checked)) span{text-decoration:line-through;color:#999}
</style></head><body><main>${body}</main>
<script>
document.querySelectorAll("[data-sz] input").forEach((i)=>i.addEventListener("change",()=>{
  const s=i.closest("[data-sz]").querySelector("[data-state]"); if(s) s.textContent=i.checked?"in stock":"sold out";
}));
</script></body></html>`;
}
