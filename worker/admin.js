import { listOrders, getOrder, markShipped, trackingUrl, ticketByCode, backfillTicketIndex } from "./orders.js";
import { refundShow } from "./refunds.js";
import { ticketProducts, ticketsForOrder, verifyCode, admit, showOver, headcount, showStatus, showOff } from "./tickets.js";
import { ownersOf, sessionSecret, saveProducts, saveStore, removeProduct, putImage, rememberRemoteImage, IMAGE_TYPES, MAX_IMAGE_BYTES, siteOf, PLACEHOLDER, webhookSecret, freshCookie, saveStripeKey, withStripeKey, removeSamples, sampleIds } from "./live.js";
import { setupChecks, connectOrders } from "./setup.js";
import { convertShopifyCsv, slug } from "../src/shopify.mjs";
import { FONTS } from "../src/lib.mjs";
import { keyProblem, stripe } from "./stripe.js";
/* The band's own admin: sign in with the admin password (or an emailed link), add a product with a
   photo from your phone, change a price, mark a size sold out, save, done. No GitHub, no files, no
   terminal. Live edits go to KV and the Worker renders the pages from them; the repo stays the
   backup, not the bottleneck. */

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

/**
 * A token tying this form to this session.
 *
 * Returns "" when there is nothing to sign with — a demo, or a store whose secret is not set
 * yet. It used to throw, which took down the whole product page with a 500 instead of
 * degrading. A page a band cannot open is worse than a form without a token on a store that
 * cannot save anything anyway; the POST side checks `demo` before trusting what comes back.
 */
export async function csrfToken(secret, session) {
  if (!secret || !session?.email && session?.via !== "key") return "";
  return (await hmac(secret, `csrf:${session.email ?? ""}:${session.gen ?? 0}`)).slice(0, 24);
}

/** Who is signed in: an owner by email, or whoever typed the admin password. */
export async function currentAdmin(req, env, store) {
  const sec = await sessionSecret(env);
  if (!sec) return null;
  const tok = cookie(req, "mt_session");
  if (!tok) return null;
  const s = await verifyToken(sec, tok, "session");
  if (!s) return null;
  if (s.via !== "key" && !ownersOf(store, env).includes(s.email)) return null;     // removed from owners = signed out everywhere
  if (env.STOCK && (await env.STOCK.get(`revoked:${s.email}:${s.gen ?? 0}`))) return null;
  return s;
}

/* ---------------- routes ---------------- */

/** A cross-site POST is refused outright. SameSite=Lax already blocks most of this;
    this does not depend on the browser getting that right. */
function sameOrigin(req, env, url) {
  if (req.method !== "POST") return true;
  const site = siteOf(env, url);
  const origin = req.headers.get("origin");
  if (origin) return origin === site || origin === url.origin;
  const referer = req.headers.get("referer");
  if (referer) { try { const r = new URL(referer); return r.origin === new URL(site).origin || r.origin === url.origin; } catch { return false; } }
  return false;   // a form POST from a browser always sends one of the two
}

const sessionCookie = (token, maxAge) => `mt_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const SESSION_DAYS = 30;

export async function handleAdmin(req, env, url, store, products, hint = {}) {
  const path = url.pathname;
  const html = (body, status = 200, headers = {}) => new Response(page(body), { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", ...headers } });

  if (!sameOrigin(req, env, url)) return new Response("Refused: that request didn't come from this store.", { status: 403, headers: { "content-type": "text/plain" } });

  // DEMO_ADMIN=1 lets anyone look around the admin without signing in. Saves are refused.
  // Never set this on a real store: it shows your product list to the public.
  if (env.DEMO_ADMIN === "1") {
    if (req.method === "POST") return html(`<h1>This is the demo</h1><p>Nothing can be changed here. On your own store this would have saved and gone live at once.</p><p><a href="/admin">Back to the products</a></p>`, 200);
    return await screens(req, env, url, store, products, { email: "you@yourband.com", gen: 0 }, true, hint);
  }
  const sec = await sessionSecret(env);
  if (!sec) return html(`<h1>Almost there</h1><p>To turn the admin on, add a setting called <code>ADMIN_KEY</code> (the password for this admin) in Cloudflare: your store → <b>Settings → Variables and Secrets</b>. Any long string you make up.</p><p>Then come back here and type it.</p>`, 503);
  const owners = ownersOf(store, env);

  // --- ask for a sign-in link by email (only reaches anyone when a mail service is set)
  if (path === "/admin/link" && req.method === "POST") {
    const form = await req.formData();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const rate = await bump(env, `rl:link:${email}`, 300);
    // Always answer the same way: never reveal whether an address is an owner.
    if (owners.includes(email) && rate <= 5) {
      const token = await signToken(sec, { t: "link", email }, 15 * 60);
      await sendLink(env, store, email, `${siteOf(env, url)}/admin/in?t=${token}`);
    }
    return html(`<h1>Check your email</h1><p>If <b>${escapeHtml(email)}</b> can sign in to this store, a link is on its way. It works once and expires in fifteen minutes.</p><p class="fine">No email? <a href="/admin">Sign in with the admin password instead.</a></p>`);
  }

  // --- click the link: exchange it for a session
  if (path === "/admin/in") {
    const t = url.searchParams.get("t") ?? "";
    const claim = await verifyToken(sec, t, "link");
    if (!claim || !owners.includes(claim.email)) return html(`<h1>That link didn't work</h1><p>It may have expired, or already been used. <a href="/admin">Ask for a new one</a>.</p>`, 400);
    if (env.STOCK) {
      const used = await env.STOCK.get(`used:${claim.jti}`);
      if (used) return html(`<h1>That link was already used</h1><p>Links work once. <a href="/admin">Ask for a new one</a>.</p>`, 400);
      await env.STOCK.put(`used:${claim.jti}`, "1", { expirationTtl: 3600 });
    }
    const session = await signToken(sec, { t: "session", email: claim.email, gen: 0 }, SESSION_DAYS * 24 * 3600);
    return new Response("", { status: 302, headers: { location: "/admin", "set-cookie": sessionCookie(session, SESSION_DAYS * 24 * 3600), "cache-control": "no-store" } });
  }

  // --- type the admin password: the way in that always works
  if (path === "/admin/key" && req.method === "POST") {
    const form = await req.formData();
    const typed = String(form.get("key") ?? "");
    const who = req.headers.get("cf-connecting-ip") ?? "unknown";
    const tries = await bump(env, `rl:key:${await shortHash(who)}`, 3600);
    if (tries > 10) return html(`<h1>Too many tries</h1><p>Wait an hour and try again.</p>`, 429);
    if (!env.ADMIN_KEY || !timingSafeEqual(typed, env.ADMIN_KEY)) return html(`<h1>That wasn't it</h1><p>The admin password is the <code>ADMIN_KEY</code> you gave Cloudflare when you deployed. Forgotten it? Cloudflare → your store → <b>Settings → Variables and Secrets</b> → edit <code>ADMIN_KEY</code> and set a new one; it takes effect at once.</p><p><a href="/admin">Try again</a></p>`, 401);
    const session = await signToken(sec, { t: "session", email: owners[0] ?? "", via: "key", gen: 0 }, SESSION_DAYS * 24 * 3600);
    // A store with no Stripe key yet opens on Setup, where the key is pasted; nothing else makes sense first.
    return new Response("", { status: 302, headers: { location: keyProblem(env.STRIPE_SECRET_KEY) ? "/admin/setup" : "/admin", "set-cookie": sessionCookie(session, SESSION_DAYS * 24 * 3600), "cache-control": "no-store" } });
  }

  if (path === "/admin/out") {
    return new Response("", { status: 302, headers: { location: "/admin", "set-cookie": "mt_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" } });
  }

  let me = await currentAdmin(req, env, store);

  // The setup check is also reachable with ?key=, as /api/setup always was, so a band can read it
  // before they have ever signed in.
  if (!me && ["/admin/setup", "/admin/connect", "/admin/stripe-key", "/admin/contact", "/admin/samples"].includes(path)) {
    const key = url.searchParams.get("key") ?? (req.method === "POST" ? String((await req.clone().formData()).get("key") ?? "") : "");
    if (env.ADMIN_KEY && timingSafeEqual(key, env.ADMIN_KEY)) me = { email: owners[0] ?? "", via: "key", gen: 0, byKey: key };
  }

  // --- signed out: the sign-in form
  if (!me) {
    if (path !== "/admin") return new Response("", { status: 302, headers: { location: "/admin" } });
    const mail = env.RESEND_API_KEY && owners.length;
    return html(`<h1>${escapeHtml(store.name)}</h1><p class="sub">Sign in to run the store.</p>
      <form method="post" action="/admin/key"><label for="key">Admin password</label><input id="key" name="key" type="password" required autocomplete="current-password" autofocus><button type="submit">Sign in</button>
      <p class="fine">The <code>ADMIN_KEY</code> you gave Cloudflare when you deployed. You stay signed in on this device for ${SESSION_DAYS} days.</p></form>
      ${mail ? `<form method="post" action="/admin/link" style="margin-top:14px"><label for="email">Or get a link by email</label><input id="email" name="email" type="email" required autocomplete="email"><button type="submit">Email me a link</button><p class="fine">Only the owners of this store can sign in that way.</p></form>` : ""}`);
  }

  return await screens(req, env, url, store, products, me, false, hint);
}

async function screens(req, env, url, store, products, me, demo, hint = {}) {
  const path = url.pathname;
  const html = (body, status = 200) => new Response(page(body), { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
  const sec = demo ? null : await sessionSecret(env);
  const tok = demo ? "" : await csrfToken(sec, me);
  const who = me.email || "admin";
  const checkTok = async (form) => demo || timingSafeEqual(String(form.get("_t") ?? ""), tok) || (me.byKey && timingSafeEqual(String(form.get("key") ?? ""), me.byKey));
  const stale = (back) => html(`<h1>That form had gone stale</h1><p>Open it again and make the change once more. <a href="${back}">Back</a></p>`, 403);
  const demoRefusal = (back) => html(`<h1>This is the demo</h1><p>On your own store this would have saved and gone live at once. <a href="${back}">Back</a></p>`);
  // After a write, the redirect carries the versions just written, so this browser reads them at once.
  const saved = (location, fresh) => new Response("", { status: 302, headers: { location, "set-cookie": freshCookie({ ...hint, ...(fresh ?? {}) }), "cache-control": "no-store" } });
  const kinds = [...(store.sections ?? []).map((s) => [s.kind, s.title]), ...(store.sections?.some((s) => s.kind === "other") ? [] : [["other", "Everything else"]])];

  if (path === "/admin/orders" || path.startsWith("/admin/orders/")) return await ordersScreen(req, env, url, store, me, demo, tok, hint);
  if (path === "/admin/door" || path.startsWith("/admin/door/")) return await doorScreen(req, env, url, store, products, me, demo, tok);
  if (path === "/admin/show") return await showScreen(req, env, url, store, products, me, demo, tok);

  /* --- the list --- */
  if (path === "/admin" && req.method === "GET") {
    const rows = products.map((p) => {
      const sizes = p.variants.map((v) => `<span class="${v.available === false ? "out" : "in"}">${escapeHtml(v.title)}</span>`).join(" ");
      return `<a class="row" href="/admin/p/${encodeURIComponent(p.id)}">
        <span class="thumb">${p.images?.[0] ? `<img src="${imgSrc(p.images[0])}" alt="" loading="lazy">` : ""}</span>
        <span class="meta"><b>${escapeHtml(p.title)}</b><small>${money(p.price, store)} · ${sizes}${p.hidden ? " · hidden" : ""}</small></span><span class="go">›</span></a>`;
    }).join("");
    const todo = demo ? 0 : await quickTodo(env, store, hint);
    const savedMsg = url.searchParams.get("saved");
    return html(`${adminNav("/admin")}<header class="bar"><h1>${escapeHtml(store.name)}</h1>${demo ? "" : `<a class="ghost" href="/admin/out">Sign out</a>`}</header>
      ${demo ? `<p class="demo">You're looking at the admin of a made-up band's store. Everything works except saving. <a href="https://github.com/rattlesnake-ike/merch-table">This is the store</a>.</p>` : ""}
      ${savedMsg ? `<p class="demo ok">Saved: ${escapeHtml(savedMsg)}. It's live for you now, and for everyone within a minute.</p>` : ""}
      ${todo ? `<p class="demo"><b>Setup isn't finished.</b> At least ${todo} thing${todo > 1 ? "s" : ""} to do before the store can take money: <a href="/admin/setup">see what</a>.</p>` : ""}
      ${!demo && sampleIds(products).length ? `<form method="post" action="/admin/samples" class="inline"><input type="hidden" name="_t" value="${tok}">${me.byKey ? `<input type="hidden" name="key" value="${escapeHtml(me.byKey)}">` : ""}<p class="demo" style="margin:0"><b>${sampleIds(products).length} made-up products</b> from the template are still on the table. Your own stay. <button type="submit" class="small">Remove the sample products</button></p></form>` : ""}
      <p class="sub">Tap a product to change its price, mark a size sold out, swap its photo or take it off the table. Changes go live straight away.</p>
      <p class="actions"><a class="btn" href="/admin/new">Add a product</a><a class="ghost" href="/admin/import">Import from Shopify</a></p>
      <div class="list">${rows || `<p class="sub">Nothing on the table yet. Add your first product above.</p>`}</div>
      <p class="fine"><a href="/admin/setup">Setup</a> · <a href="/admin/store">Store settings</a> · ${demo ? "a look around: nothing here can be changed" : `signed in as ${escapeHtml(who)}`}</p>`);
  }

  /* --- a new product --- */
  if (path === "/admin/new") {
    if (req.method === "POST") {
      if (demo) return demoRefusal("/admin/new");
      if (Number(req.headers.get("content-length") ?? 0) > 40 * 1024 * 1024) return html(`<h1>Those photos are too big</h1><p>Try fewer at a time. <a href="/admin/new">Back</a></p>`, 413);
      const form = await req.formData();
      if (!(await checkTok(form))) return stale("/admin/new");
      const r = await readProductForm(form, env, store, null, products);
      if (r.error) return html(`<h1>${escapeHtml(r.error.title)}</h1><p>${escapeHtml(r.error.detail)}</p><p><a href="/admin/new">Back</a></p>`, 400);
      const w = await saveProducts(env, store, [...products, r.product], who, `added ${r.product.title}`);
      if (!w.ok) return html(`<h1>Couldn't save</h1><p>${escapeHtml(w.error)}</p><p><a href="/admin/new">Back</a></p>`, 500);
      return saved(`/admin?saved=${encodeURIComponent(r.product.title)}`, w.fresh);
    }
    return html(`${adminNav("/admin", { href: "/admin", label: "All products" })}<header class="bar"><h1>Add a product</h1></header>
      ${demo ? `<p class="demo">On your own store this form adds a product, photo and all, from your phone. Here it can't save.</p>` : ""}
      <form method="post" enctype="multipart/form-data"><input type="hidden" name="_t" value="${tok}">${me.byKey ? `<input type="hidden" name="key" value="${escapeHtml(me.byKey)}">` : ""}
        <label for="title">Name</label><input id="title" name="title" required maxlength="200" placeholder="Dog logo tee" autofocus>
        <label for="price">Price</label><div class="money"><span>${currencySign(store)}</span><input id="price" name="price" inputmode="decimal" required placeholder="25"></div>
        <label for="sizes">Sizes <small>separated by commas; leave empty if there's one size</small></label><input id="sizes" name="sizes" placeholder="S, M, L, XL, 2XL" autocapitalize="characters">
        <label for="stock">How many of each size <small>optional; empty means no count</small></label><input id="stock" name="stock" inputmode="numeric" placeholder="">
        <label for="kind">Section</label><select id="kind" name="kind">${kinds.map(([k, t]) => `<option value="${escapeHtml(k)}"${k === "apparel" ? " selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select>
        <label for="photos">Photos <small>from your camera roll; the first one is the main picture</small></label><input id="photos" name="photos" type="file" accept="image/*" multiple>
        <label for="description">Description</label><textarea id="description" name="description" rows="5" placeholder="Heavyweight cotton, printed by hand. Runs true to size."></textarea>
        <label for="ship_date">Pre-order ship date <small>leave empty if it's in stock</small></label><input id="ship_date" name="ship_date" type="date">
        <label class="sw"><input type="checkbox" name="hidden"><span>Keep it off the store for now</span><small>the page exists, it just isn't listed; untick when you're ready</small></label>
        <button type="submit">Put it on the table</button>
      </form>`);
  }

  /* --- one product --- */
  if (path.startsWith("/admin/p/")) {
    const rest = path.slice("/admin/p/".length);
    const [idRaw, action] = rest.split("/");
    const id = decodeURIComponent(idRaw);
    const p = products.find((x) => x.id === id);
    if (!p) return html(`${adminNav("/admin", { href: "/admin", label: "All products" })}<h1>Not found</h1>`, 404);
    const back = `/admin/p/${encodeURIComponent(id)}`;

    if (action === "delete" && req.method === "POST") {
      if (demo) return demoRefusal(back);
      const form = await req.formData();
      if (!(await checkTok(form))) return stale(back);
      const r = await removeProduct(env, store, products, id, who, hint);
      if (!r.ok) return html(`<h1>Couldn't remove it</h1><p>${escapeHtml(r.error)}</p><p><a href="${back}">Back</a></p>`, 500);
      return saved(`/admin?saved=${encodeURIComponent(`${p.title} removed`)}`, r.fresh);
    }

    if (req.method === "POST") {
      if (demo) return demoRefusal(back);
      if (Number(req.headers.get("content-length") ?? 0) > 40 * 1024 * 1024) return html(`<h1>Those photos are too big</h1><p>Try fewer at a time. <a href="${back}">Back</a></p>`, 413);
      const form = await req.formData();
      if (!(await checkTok(form))) return stale(back);
      const r = await readProductForm(form, env, store, p, products);
      if (r.error) return html(`<h1>${escapeHtml(r.error.title)}</h1><p>${escapeHtml(r.error.detail)}</p><p><a href="${back}">Back</a></p>`, 400);
      const changed = await saveProducts(env, store, products.map((x) => (x.id === id ? r.product : x)), who, describe(p, r.product, store));
      if (!changed.ok) return html(`<h1>Couldn't save</h1><p>${escapeHtml(changed.error)}</p><p><a href="${back}">Back</a></p>`, 500);
      return saved(`/admin?saved=${encodeURIComponent(p.title)}`, changed.fresh);
    }

    const sizes = p.variants.map((v) => `<label class="sw" data-sz><input type="checkbox" name="v_${escapeHtml(v.id)}" ${v.available === false ? "" : "checked"}><span>${escapeHtml(v.title)}${v.price != null && v.price !== p.price ? ` <small>${money(v.price, store)}</small>` : ""}</span><small data-state>${v.available === false ? "sold out" : "in stock"}</small></label>`).join("");
    const pics = (p.images ?? []).map((src, i) => `<label class="pic"><img src="${imgSrc(src)}" alt=""><span><input type="checkbox" name="rm_img" value="${escapeHtml(src)}"> remove${i === 0 ? " <small>(main picture)</small>" : ""}</span></label>`).join("");
    return html(`${adminNav("/admin", { href: "/admin", label: "All products" })}<header class="bar"><h1>${escapeHtml(p.title)}</h1></header>
      <form method="post" enctype="multipart/form-data"><input type="hidden" name="_t" value="${tok}">${me.byKey ? `<input type="hidden" name="key" value="${escapeHtml(me.byKey)}">` : ""}
        ${pics ? `<div class="pics">${pics}</div>` : ""}
        <label for="photos">${pics ? "Add photos" : "Photos"} <small>from your camera roll</small></label><input id="photos" name="photos" type="file" accept="image/*" multiple>
        <label for="title">Name</label><input id="title" name="title" value="${escapeHtml(p.title)}" required maxlength="200">
        <label for="price">Price</label><div class="money"><span>${currencySign(store)}</span><input id="price" name="price" inputmode="decimal" value="${(p.price / 100).toFixed(2)}" required></div>
        <label>Sizes <small>untick to mark sold out</small></label><div class="sizes">${sizes}</div>
        <label for="sizes">Add sizes <small>separated by commas</small></label><input id="sizes" name="sizes" placeholder="3XL" autocapitalize="characters">
        <label for="kind">Section</label><select id="kind" name="kind">${kinds.map(([k, t]) => `<option value="${escapeHtml(k)}"${k === (p.kind ?? "other") ? " selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select>
        <label for="ship_date">Pre-order ship date <small>leave empty if it's in stock</small></label><input id="ship_date" name="ship_date" type="date" value="${escapeHtml(p.ship_date ?? "")}">
        <label for="description">Description</label><textarea id="description" name="description" rows="5">${escapeHtml(p.description ?? "")}</textarea>
        <label class="sw"><input type="checkbox" name="hidden" ${p.hidden ? "checked" : ""}><span>Hide from the store</span><small>the page stays, it just isn't listed</small></label>
        <button type="submit">Save</button>
        <p class="fine"><a href="/products/${encodeURIComponent(p.id)}/">See this on the store</a></p>
      </form>
      <form method="post" action="${back}/delete" class="danger" onsubmit="return confirm('Take ${escapeHtml(p.title).replace(/'/g, "\\'")} off the table for good?')"><input type="hidden" name="_t" value="${tok}">${me.byKey ? `<input type="hidden" name="key" value="${escapeHtml(me.byKey)}">` : ""}<button type="submit" class="ghostbtn">Remove this product</button><p class="fine">Sold out for now? Untick its sizes above instead, so fans can ask to hear when it's back.</p></form>`);
  }

  /* --- store settings --- */
  if (path === "/admin/store") {
    if (req.method === "POST") {
      if (demo) return demoRefusal("/admin/store");
      const form = await req.formData();
      if (!(await checkTok(form))) return stale("/admin/store");
      const str = (k, max) => String(form.get(k) ?? "").trim().slice(0, max);
      const color = (k, fallback) => { const v = str(k, 9); return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback; };
      const email = str("email", 200);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return html(`<h1>That email didn't look right</h1><p><a href="/admin/store">Back</a></p>`, 400);
      let homepage = str("homepage", 300);
      if (homepage && !/^https?:\/\//i.test(homepage)) homepage = `https://${homepage}`;
      const font = str("font", 60);
      const patch = {
        name: str("name", 80) || store.name,
        tagline: str("tagline", 200),
        description: str("description", 400),
        email,
        homepage,
        colors: { ink: color("ink", store.colors?.ink ?? "#141416"), paper: color("paper", store.colors?.paper ?? "#f3f1ea"), accent: color("accent", store.colors?.accent ?? "#2743d0") },
        look: { ...(store.look ?? {}), corners: ["square", "soft", "round"].includes(str("corners", 10)) ? str("corners", 10) : "square", headings: ["uppercase", "normal"].includes(str("headings", 10)) ? str("headings", 10) : "uppercase", font: font in FONTS ? font : (store.look?.font ?? "system") },
        returns: str("returns", 600),
      };
      const r = await saveStore(env, patch, who, hint);
      if (!r.ok) return html(`<h1>Couldn't save</h1><p>${escapeHtml(r.error)}</p><p><a href="/admin/store">Back</a></p>`, 500);
      return saved(`/admin?saved=${encodeURIComponent("store settings")}`, r.fresh);
    }
    const look = store.look ?? {}; const c = store.colors ?? {};
    const customFont = look.font && !FONTS[look.font];
    return html(`${adminNav("/admin/store")}<header class="bar"><h1>Store settings</h1></header>
      ${demo ? `<p class="demo">On your own store this is where the name, the contact address and the colours live. Here it can't save.</p>` : ""}
      <form method="post"><input type="hidden" name="_t" value="${tok}">${me.byKey ? `<input type="hidden" name="key" value="${escapeHtml(me.byKey)}">` : ""}
        <label for="name">Band or store name</label><input id="name" name="name" value="${escapeHtml(store.name)}" required maxlength="80">
        <label for="tagline">One line under the name <small>optional</small></label><input id="tagline" name="tagline" value="${escapeHtml(store.tagline ?? "")}" maxlength="200">
        <label for="email">Contact email <small>on every page and receipt; a person must read it</small></label><input id="email" name="email" type="email" value="${escapeHtml(store.email && !PLACEHOLDER.test(store.email) ? store.email : "")}" placeholder="you@yourband.com">
        <label for="homepage">Your website <small>optional</small></label><input id="homepage" name="homepage" value="${escapeHtml(store.homepage ?? "")}" placeholder="https://yourband.com">
        <label>Colours <small>pick them out of your artwork</small></label>
        <div class="colors"><label>Text <input type="color" name="ink" value="${escapeHtml(c.ink ?? "#141416")}"></label><label>Background <input type="color" name="paper" value="${escapeHtml(c.paper ?? "#f3f1ea")}"></label><label>Accent <input type="color" name="accent" value="${escapeHtml(c.accent ?? "#2743d0")}"></label></div>
        <label for="font">Type</label><select id="font" name="font">${Object.keys(FONTS).map((f) => `<option value="${f}"${(look.font ?? "system") === f ? " selected" : ""}>${f[0].toUpperCase() + f.slice(1)}</option>`).join("")}${customFont ? `<option value="${escapeHtml(look.font)}" selected>${escapeHtml(look.font)} (your own, from the files)</option>` : ""}</select>
        <label for="corners">Corners</label><select id="corners" name="corners">${["square", "soft", "round"].map((o) => `<option value="${o}"${(look.corners ?? "square") === o ? " selected" : ""}>${o[0].toUpperCase() + o.slice(1)}</option>`).join("")}</select>
        <label for="headings">Headings</label><select id="headings" name="headings"><option value="uppercase"${(look.headings ?? "uppercase") !== "normal" ? " selected" : ""}>UPPERCASE</option><option value="normal"${look.headings === "normal" ? " selected" : ""}>As written</option></select>
        <label for="description">About the store <small>one or two sentences, for search engines</small></label><textarea id="description" name="description" rows="2" maxlength="400">${escapeHtml(store.description ?? "")}</textarea>
        <label for="returns">Your returns line <small>shown on the shipping page</small></label><textarea id="returns" name="returns" rows="3" maxlength="600">${escapeHtml(store.returns ?? "")}</textarea>
        <button type="submit">Save</button>
        <p class="fine">Shipping prices, the currency and the sections are in <code>store.json</code> in your repository; change them there, or ask a coding agent to.</p>
      </form>`);
  }

  /* --- setup: is this store ready to take money? --- */
  if (path === "/admin/stripe-key" && req.method === "POST") {
    if (demo) return demoRefusal("/admin/setup");
    const form = await req.formData();
    if (!(await checkTok(form))) return stale("/admin/setup");
    const key = String(form.get("stripe_key") ?? "").trim();
    const problem = keyProblem(key);
    if (problem) return html(`<h1>That key didn't look right</h1><p>${escapeHtml(problem[0].toUpperCase() + problem.slice(1))}</p><p><a href="/admin/setup">Back</a></p>`, 400);
    // Checked against Stripe before it is kept, so a wrong paste is caught here and not at a fan's checkout.
    try { await stripe({ ...env, STRIPE_SECRET_KEY: key }, "GET", "/account"); }
    catch (e) { return html(`<h1>Stripe didn't accept that key</h1><p>${escapeHtml(e.message)}</p><p><a href="/admin/setup">Back</a></p>`, 400); }
    const r = await saveStripeKey(env, key);
    if (!r.ok) return html(`<h1>Couldn't keep the key</h1><p>${escapeHtml(r.error)}</p><p><a href="/admin/setup">Back</a></p>`, 500);
    return saved(`/admin/setup?keyset=${key.startsWith("sk_live_") ? "live" : "test"}${me.byKey ? `&key=${encodeURIComponent(me.byKey)}` : ""}`, r.fresh);
  }
  if (path === "/admin/contact" && req.method === "POST") {
    if (demo) return demoRefusal("/admin/setup");
    const form = await req.formData();
    if (!(await checkTok(form))) return stale("/admin/setup");
    const email = String(form.get("email") ?? "").trim().slice(0, 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return html(`<h1>That email didn't look right</h1><p><a href="/admin/setup">Back</a></p>`, 400);
    const r = await saveStore(env, { email }, who, hint);
    if (!r.ok) return html(`<h1>Couldn't save</h1><p>${escapeHtml(r.error)}</p><p><a href="/admin/setup">Back</a></p>`, 500);
    return saved(`/admin/setup${me.byKey ? `?key=${encodeURIComponent(me.byKey)}` : ""}`, r.fresh);
  }
  if (path === "/admin/samples" && req.method === "POST") {
    if (demo) return demoRefusal("/admin");
    const form = await req.formData();
    if (!(await checkTok(form))) return stale("/admin");
    const r = await removeSamples(env, store, products, who, hint);
    if (!r.ok) return html(`<h1>Couldn't remove them</h1><p>${escapeHtml(r.error)}</p><p><a href="/admin">Back</a></p>`, 500);
    return saved(`/admin?saved=${encodeURIComponent("the sample products removed")}`, r.fresh);
  }
  if (path === "/admin/connect" && req.method === "POST") {
    if (demo) return demoRefusal("/admin/setup");
    const form = await req.formData();
    if (!(await checkTok(form))) return stale("/admin/setup");
    try {
      const r = await connectOrders(env, url);
      if (!r.ok) return html(`<h1>Couldn't connect orders</h1><p>${escapeHtml(r.error)}</p><p><a href="/admin/setup">Back</a></p>`, 500);
      return saved(`/admin/setup?connected=${r.livemode ? "live" : "test"}${me.byKey ? `&key=${encodeURIComponent(me.byKey)}` : ""}`, r.fresh);
    } catch (e) {
      return html(`<h1>Couldn't connect orders</h1><p>${escapeHtml(e.message)}</p><p><a href="/admin/setup">Back</a></p>`, 502);
    }
  }
  if (path === "/admin/setup") {
    const r = demo ? demoChecks(store) : await setupChecks(env, url, store, hint, { fix: true, products });
    const keyQ = me.byKey ? `?key=${encodeURIComponent(me.byKey)}` : "";
    const hidden = `<input type="hidden" name="_t" value="${tok}">${me.byKey ? `<input type="hidden" name="key" value="${escapeHtml(me.byKey)}">` : ""}`;
    const formFor = (c) => {
      if (c.form === "key") return c.keyEnv ? `<p class="fine">Set in Cloudflare (Settings → Variables and Secrets). To change it, change it there.</p>` : `<form method="post" action="/admin/stripe-key">${hidden}<label for="stripe_key" class="tight">${c.ok ? "Swap it: paste the live key when you're ready" : "Your Stripe secret key"}</label><input id="stripe_key" name="stripe_key" type="password" autocomplete="off" spellcheck="false" placeholder="sk_test_…" required><button type="submit" class="small">${c.ok ? "Use this key" : "Save the key"}</button></form>`;
      if (c.form === "contact" && !c.ok) return `<form method="post" action="/admin/contact">${hidden}<label for="contact_email" class="tight">Contact email</label><input id="contact_email" name="email" type="email" autocomplete="email" placeholder="you@yourband.com" required><button type="submit" class="small">Save</button></form>`;
      if (c.action?.post) return `<form method="post" action="${c.action.post}">${hidden}<button type="submit" class="small">${escapeHtml(c.action.label)}</button></form>`;
      if (c.action?.href) return `<a class="btn small" href="${c.action.href}${keyQ}">${escapeHtml(c.action.label)}</a>`;
      return "";
    };
    const rows = r.checks.map((c) => `<div class="chk ${c.ok === null ? "info" : c.ok ? "ok" : "todo"}"><span class="mark">${c.ok === null ? "·" : c.ok ? "✓" : "✗"}</span><div><b>${escapeHtml(c.name)}</b><p>${escapeHtml(c.detail)}</p>${demo ? "" : formFor(c)}</div></div>`).join("");
    const keyset = url.searchParams.get("keyset");
    const connected = url.searchParams.get("connected") || (r.connected?.ok ? (r.connected.livemode ? "live" : "test") : null);
    return html(`${adminNav("/admin/setup")}<header class="bar"><h1>Setup</h1></header>
      ${demo ? `<p class="demo">On your own store each line here checks something real, and the forms do the fix. This is a picture of a store that is nearly ready.</p>` : ""}
      ${keyset ? `<p class="demo ok">Stripe ${keyset} key saved. Checked with Stripe: it works.</p>` : ""}
      ${connected ? `<p class="demo ok">Orders connected (${connected} mode). Stripe will tell this store the moment someone pays.</p>` : ""}
      <p class="demo ${r.ready ? "ok" : ""}"><b>${r.ready ? "Ready to take orders." : `${r.todo} thing${r.todo === 1 ? "" : "s"} to do before the store can take money.`}</b>${r.ready && !demo ? ` <a href="/admin">Put your products in.</a>` : ""}</p>
      <div class="checks">${rows}</div>
      <p class="fine">Only whoever runs this store can open this page. It shows no customer data and no keys.</p>`);
  }

  /* --- import from a Shopify export --- */
  if (path === "/admin/import") {
    if (req.method === "POST") {
      if (demo) return demoRefusal("/admin/import");
      if (Number(req.headers.get("content-length") ?? 0) > 20 * 1024 * 1024) return html(`<h1>That file is too big</h1><p><a href="/admin/import">Back</a></p>`, 413);
      const form = await req.formData();
      if (!(await checkTok(form))) return stale("/admin/import");
      const f = form.get("csv");
      if (!f || typeof f === "string") return html(`<h1>No file</h1><p>Choose the .csv Shopify gave you. <a href="/admin/import">Back</a></p>`, 400);
      const { products: incoming, problems } = convertShopifyCsv(await f.text(), products);
      if (!incoming.length) return html(`<h1>Nothing in that file</h1><p>${escapeHtml(problems[0] ?? "No products were found.")}</p><p><a href="/admin/import">Back</a></p>`, 400);
      const replace = form.get("replace") === "on";
      const next = [...products]; let added = 0, replaced = 0, kept = 0;
      for (const p of incoming) {
        p.images = await Promise.all((p.images ?? []).map((u) => rememberRemoteImage(env, u)));
        const i = next.findIndex((x) => x.id === p.id);
        if (i === -1) { next.push(p); added++; }
        else if (replace) { next[i] = p; replaced++; }
        else kept++;
      }
      const w = await saveProducts(env, store, next, who, `imported ${added} from Shopify${replaced ? `, replaced ${replaced}` : ""}`);
      if (!w.ok) return html(`<h1>Couldn't save</h1><p>${escapeHtml(w.error)}</p><p><a href="/admin/import">Back</a></p>`, 500);
      return new Response(page(`${adminNav("/admin", { href: "/admin", label: "All products" })}<h1>Imported</h1><p><b>${added}</b> product${added === 1 ? "" : "s"} added${replaced ? `, <b>${replaced}</b> replaced` : ""}${kept ? `, <b>${kept}</b> already here and left alone` : ""}. Pictures are fetched from Shopify the first time anyone looks and kept here from then on.</p>${problems.length ? `<p class="demo">Worth a look:<br>${problems.map(escapeHtml).join("<br>")}</p>` : ""}<p><a class="btn" href="/admin">See the products</a></p>`), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "set-cookie": freshCookie({ ...hint, ...w.fresh }) } });
    }
    return html(`${adminNav("/admin", { href: "/admin", label: "All products" })}<header class="bar"><h1>Import from Shopify</h1></header>
      <p class="sub">In your Shopify admin: <b>Products → Export → All products → Plain CSV file</b>. Shopify emails it to you; save it, then choose it here. Names, prices, sizes, sold-out sizes, stock counts, descriptions and pictures all come across, and every product keeps its old address, so links to <code>/products/&lt;name&gt;</code> still work.</p>
      ${demo ? `<p class="demo">On your own store the file is read right here and the products appear at once. Here it can't save.</p>` : ""}
      <form method="post" enctype="multipart/form-data"><input type="hidden" name="_t" value="${tok}">${me.byKey ? `<input type="hidden" name="key" value="${escapeHtml(me.byKey)}">` : ""}
        <label for="csv">The export</label><input id="csv" name="csv" type="file" accept=".csv,text/csv" required>
        <label class="sw"><input type="checkbox" name="replace"><span>Replace products that are already here</span><small>off: anything with the same address is left as it is</small></label>
        <button type="submit">Import</button>
      </form>`);
  }

  return html(`<h1>Not found</h1><p><a href="/admin">Back</a></p>`, 404);
}

/* ---------- reading a product form, for a new product or an existing one ---------- */
async function readProductForm(form, env, store, existing, products) {
  const title = String(form.get("title") ?? "").trim().slice(0, 200);
  if (!title) return { error: { title: "It needs a name", detail: "Give the product a name fans will recognise." } };
  const cents = parsePrice(form.get("price"));
  if (cents === null) return { error: { title: "That price didn't look right", detail: `Use a plain number, like 25 or 25.00, and no more than ${money(MAX_PRICE, store)}.` } };
  const next = existing ? structuredClone(existing) : { id: uniqueId(slug(title) || "item", products), title, price: cents, kind: "other", description: "", images: [], variants: [], published: new Date().toISOString() };
  next.title = title; next.price = cents;
  next.description = String(form.get("description") ?? "").slice(0, 4000);
  const kind = String(form.get("kind") ?? next.kind ?? "other");
  if (/^[a-z0-9-]{1,30}$/.test(kind)) next.kind = kind;
  next.hidden = form.get("hidden") === "on" ? true : undefined;
  const shipDate = String(form.get("ship_date") ?? "").trim();
  next.ship_date = /^\d{4}-\d{2}-\d{2}$/.test(shipDate) ? shipDate : undefined;

  // Sizes: existing ones keep their id and become sold out when unticked; new ones are added.
  if (existing) next.variants = existing.variants.map((v) => ({ ...v, available: form.get(`v_${v.id}`) === "on" }));
  const stockRaw = String(form.get("stock") ?? "").trim();
  const stock = /^\d{1,6}$/.test(stockRaw) ? Number(stockRaw) : null;
  for (const t of String(form.get("sizes") ?? "").split(/[,\n;]+/).map((s) => s.trim().slice(0, 40)).filter(Boolean)) {
    const id = slug(t) || `v${next.variants.length + 1}`;
    if (next.variants.some((v) => v.id === id)) continue;
    next.variants.push({ id, title: t, available: true, ...(stock !== null ? { stock } : {}) });
  }
  if (!next.variants.length) next.variants = [{ id: "one", title: "One size", available: true, ...(stock !== null ? { stock } : {}) }];

  // Pictures: remove the ticked ones, add the uploaded ones.
  const rm = new Set(form.getAll("rm_img").map(String));
  next.images = (next.images ?? []).filter((i) => !rm.has(i));
  for (const f of form.getAll("photos")) {
    if (!f || typeof f === "string" || !f.size) continue;
    if (f.size > MAX_IMAGE_BYTES) return { error: { title: "A photo is too big", detail: `${f.name || "One of them"} is over ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB. Most phones shrink it for you; try again, or send yourself a smaller copy.` } };
    const type = IMAGE_TYPES[f.type] ? f.type : null;
    if (!type) return { error: { title: "That isn't a picture we can show", detail: `${f.name || "The file"} is ${f.type || "an unknown type"}. JPEG, PNG, WebP, GIF or AVIF, please.` } };
    const path = await putImage(env, await f.arrayBuffer(), type);
    if (!path) return { error: { title: "Couldn't keep that photo", detail: "This store has no storage yet (a KV namespace called STOCK). The README says how to add one." } };
    next.images.push(path);
  }
  return { product: next };
}

function uniqueId(base, products) {
  let id = base, n = 2;
  while (products.some((p) => p.id === id)) id = `${base}-${n++}`;
  return id;
}

/** Image paths in products.json are relative to the site root; make them a URL the admin can show. */
const imgSrc = (src) => (/^https?:/.test(src) ? src : `/${src}`);
const currencySign = (store) => (store.currency === "usd" ? "$" : store.currency === "gbp" ? "£" : store.currency === "eur" ? "€" : store.currency.toUpperCase());

/** The three things that stop a store taking money, checked without calling anyone. */
async function quickTodo(env, store, hint) {
  let n = 0;
  if (keyProblem(env.STRIPE_SECRET_KEY)) n++;
  if (!(await webhookSecret(env, hint))) n++;
  if (!store.email || PLACEHOLDER.test(store.email)) n++;
  return n;
}

/** What the demo's setup page shows: a store nearly ready, so the shape of the page is clear. */
function demoChecks(store) {
  return { ready: false, todo: 1, checks: [
    { key: "key", name: "Stripe key", ok: true, detail: "A test key, set here. Try the store with card 4242 4242 4242 4242, any future date, any CVC. Nothing is charged. On your own store you paste the key into this row and it is checked with Stripe on the spot." },
    { key: "account", name: "Stripe account", ok: true, detail: `Connected to ${store.name}.` },
    { key: "payouts", name: "Payouts", ok: false, detail: "Add your bank details in Stripe before going live. Until then money would sit in Stripe." },
    { key: "orders", name: "Orders", ok: true, detail: "Stripe tells this store when an order is paid. The store connected itself the moment the key was in." },
    { key: "owners", name: "Who can sign in", ok: true, detail: "you@yourband.com, or anyone with the admin password." },
    { key: "contact", name: "Contact address", ok: true, detail: `${store.email} is on every page and receipt.` },
    { key: "domain", name: "Your own address", ok: null, detail: "The store answers at merch-table-demo.isaac-holze.workers.dev. When you own a domain: Cloudflare → Workers & Pages → this store → Settings → Domains & Routes → Add → Custom domain." },
    { key: "wallets", name: "Apple Pay, Google Pay, Link", ok: true, detail: "On. Fans can pay with a tap." },
    { key: "live", name: "Real money", ok: null, detail: "Not yet: the key is a test key. When a test order has worked end to end, paste the live key into the Stripe key row above. The store reconnects itself." },
  ] };
}

export const MAX_PRICE = 100000 * 100;   // $100,000: a typo guard, not a limit anyone will meet
/** Read a typed price. Returns whole cents, or null if it isn't a sane positive amount.
    Checks what was TYPED: stripping characters first turns "-5" into 5 and a typo into a live price. */
export function parsePrice(raw) {
  const s = String(raw ?? "").trim().replace(/[$£€¥]/g, "").replace(/,/g, "").trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;      // no minus, no exponent, no spaces, at most 2 decimals
  const cents = Math.round(Number(s) * 100);
  if (!Number.isFinite(cents) || cents <= 0 || cents > MAX_PRICE) return null;
  return cents;
}

/** The door. Someone types a code, and gets a green yes or a red no. Nothing else.
    Built for one hand, bad light, and a queue of people waiting. */
async function doorScreen(req, env, url, store, products, me, demo, tok) {
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
    .anav{display:flex;flex-wrap:wrap;gap:10px 14px;margin:0 0 16px;font-size:.95rem}
    .anav .back{flex-basis:100%}
    .anav .out{color:#aaa;font-size:.85rem;margin-left:auto}
    .anav .tabs{display:flex;gap:14px;flex-wrap:wrap;flex:1}
  </style>`;
  const page = (body, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Door</title>${css}</head><body><main>${body}</main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });

  const form = async (msg = "") => {
    // How many are in the room. A fire marshal asks for this number, and a settlement starts
    // from it, so it is counted from the check-ins rather than kept as a tally that can drift.
    const counts = demo ? [] : await headcount(env, products).catch(() => []);
    const countLine = counts.length
      ? `<p class="count">${counts.map((c) => `<span><b>${c.inRoom}</b> in the room${typeof c.capacity === "number" ? ` of ${c.capacity}` : ""} · ${escapeHtml(c.title)}</span>`).join("")}</p>`
      : "";
    return `${adminNav("/admin/door")}<h1>Door</h1>
    ${shows.length ? `<p class="sub">${shows.map((p) => escapeHtml(p.show.title ?? p.title)).join(" · ")}</p>` : `<p class="sub">No upcoming shows in the store.</p>`}
    ${countLine}
    ${msg}
    <form method="post"><input type="hidden" name="_t" value="${demo ? "" : tok}">
      <input name="code" required autofocus autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-1234" aria-label="Ticket code" inputmode="latin">
      <button type="submit">Check in</button></form>
    `;
  };

  if (req.method !== "POST") return page(await form());

  const f = await req.formData();
  if (!demo && !timingSafeEqual(String(f.get("_t") ?? ""), tok)) return page(await form(`<div class="warn"><p class="big">Reload the page</p><p>It had been open too long.</p></div>`), 403);
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
  const secret = (await sessionSecret(env)) ?? "unset";
  const candidates = hit ? [await getOrder(env, hit.order)].filter(Boolean) : await listOrders(env, 1000);
  for (const o of candidates) {
    for (const t of await ticketsForOrder(env, o, products)) {
      if (!(await verifyCode(secret, o.id, t.seq, code))) continue;
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
async function ordersScreen(req, env, url, store, me, demo, tok, hint = {}) {
  const html = (body, status = 200) => new Response(page(body), { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
  const id = url.pathname.startsWith("/admin/orders/") ? decodeURIComponent(url.pathname.slice("/admin/orders/".length)) : null;

  if (req.method === "POST") {
    if (demo) return html(`<h1>This is the demo</h1><p>On your own store this would have saved. <a href="/admin/orders">Back</a></p>`);
    const form = await req.formData();
    if (!demo && !timingSafeEqual(String(form.get("_t") ?? ""), tok)) return html(`<h1>That form had gone stale</h1><p><a href="/admin/orders">Open it again</a>.</p>`, 403);
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
  const connected = demo ? true : !!(await webhookSecret(env, hint));
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
  return html(`${adminNav("/admin/orders")}<header class="bar"><h1>Orders</h1></header>
    ${demo ? `<p class="demo">A real store lists its orders here, with a box to put the tracking number in. There are none on the demo.</p>` : ""}
    ${url.searchParams.get("saved") ? `<p class="demo ok">Marked shipped. That tracking number is the best protection you have if this is ever disputed.</p>` : ""}
    <datalist id="carriers"><option>USPS</option><option>UPS</option><option>FedEx</option><option>DHL</option><option>Royal Mail</option></datalist>
    ${orders.length ? `<p class="sub">${toPack.length} to pack${orders.length - toPack.length ? `, ${orders.length - toPack.length} shipped` : ""}. Put the tracking number in when you post it: it is what answers a bank if a buyer ever says it never arrived.</p><div class="list">${orders.map(row).join("")}</div>` : demo ? "" : `<p class="sub">No orders yet. They appear here the moment someone pays.</p>${connected ? "" : `<p class="demo">Orders only arrive here once Stripe can reach your store. <a href="/admin/setup">Press Connect orders in Setup</a>; it takes a second.</p>`}`}
    <p class="fine"><a href="/orders">What a buyer sees</a></p>`);
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
  ${o.tracking ? `<p class="demo ok"><b>You have tracking.</b> That is the single strongest piece of evidence for &ldquo;it never arrived&rdquo;. ${t ? `Screenshot the delivery confirmation at <a href="${t}" rel="noopener">the carrier's page</a> and attach it as a file.` : "Screenshot the carrier's delivery confirmation and attach it."}</p>` : `<p class="demo"><b>No tracking on this order.</b> If you have a receipt from the post office, photograph it. Without proof of delivery a &ldquo;never arrived&rdquo; claim is very hard to answer, which is why it is worth adding tracking to everything.</p>`}
  <p class="fine">Before you fight it, consider writing to the buyer: a refund or a replacement usually costs less than a lost dispute, and a withdrawn dispute costs nothing. Banks never read links, so attach files rather than pointing at pages.</p>`;
}

function describe(before, after, store) {
  const bits = [];
  if (before.price !== after.price) bits.push(`price ${money(before.price, store)} → ${money(after.price, store)}`);
  if (before.title !== after.title) bits.push(`renamed`);
  const flip = after.variants.filter((v) => (before.variants.find((b) => b.id === v.id)?.available !== false) !== (v.available !== false));
  for (const v of flip) bits.push(`${v.title} ${v.available ? "back in stock" : "sold out"}`);
  const added = after.variants.filter((v) => !before.variants.some((b) => b.id === v.id));
  if (added.length) bits.push(`sizes added: ${added.map((v) => v.title).join(", ")}`);
  if (!!before.hidden !== !!after.hidden) bits.push(after.hidden ? "hidden" : "shown");
  if ((before.ship_date ?? "") !== (after.ship_date ?? "")) bits.push(after.ship_date ? `pre-order ${after.ship_date}` : "no longer a pre-order");
  if ((before.images ?? []).join() !== (after.images ?? []).join()) bits.push("photos changed");
  if ((before.kind ?? "other") !== (after.kind ?? "other")) bits.push(`moved to ${after.kind}`);
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

async function shortHash(s) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendLink(env, store, email, link) {
  const host = (() => { try { return new URL(link).hostname; } catch { return "store"; } })();
  const from = env.MAIL_FROM || `store@${host}`;
  const text = `Here's your link to edit ${store.name}:\n\n${link}\n\nIt works once and expires in fifteen minutes. If you didn't ask for it, ignore this email and nothing happens.`;
  if (env.RESEND_API_KEY) {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from, to: email, subject: `Sign in to ${store.name}`, text }) });
    if (!r.ok) console.error("resend", r.status, await r.text());
    return;
  }
  console.log("ADMIN SIGN-IN LINK (no mail service configured):", link);
}

/**
 * One nav on every admin screen, so it behaves like an admin and not like a pile of pages.
 * `here` marks the current section; `back` is an explicit way out of a detail screen, because
 * a phone's back gesture is not something to rely on after a form post.
 */
export function adminNav(here = "", back = null) {
  const tabs = [["/admin", "Products"], ["/admin/orders", "Orders"], ["/admin/show", "Shows"], ["/admin/door", "Door"], ["/admin/store", "Store"], ["/admin/setup", "Setup"]];
  const links = tabs.map(([href, label]) =>
    `<a href="${href}"${href === here ? ' aria-current="page" class="on"' : ""}>${label}</a>`).join("");
  return `<nav class="anav">${back ? `<a class="back" href="${back.href}">&larr; ${escapeHtml(back.label)}</a>` : ""}<div class="tabs">${links}</div><a class="out" href="/">See the store &rarr;</a></nav>`;
}

function page(body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Store admin</title><style>
:root{--ink:#141416;--paper:#fff;--soft:#f4f3ef;--line:#d9d7d0;--accent:#2743d0}
*{box-sizing:border-box}
body{font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;margin:0;background:var(--soft);color:var(--ink);padding:16px;padding-bottom:64px}
main,form,.list,.checks,.actions{max-width:34rem;margin:0 auto}
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
.anav{max-width:34rem;margin:0 auto 16px;display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;padding:10px 12px;background:var(--paper);border:1px solid var(--line);border-radius:10px}
.anav .tabs{display:flex;gap:14px;flex:1;flex-wrap:wrap}
.anav a{text-decoration:none;font-size:.95rem}
.anav .on{font-weight:700;color:var(--ink);text-decoration:underline;text-underline-offset:4px}
.anav .back{flex-basis:100%;font-weight:600}
.anav .out{color:#666;font-size:.85rem}
.actions{display:flex;gap:14px;align-items:center;margin:0 auto 14px}
.btn{display:inline-block;padding:12px 18px;background:var(--ink);color:#fff;border-radius:8px;text-decoration:none;font-weight:700}
.btn.small,button.small{display:inline-block;width:auto;padding:9px 14px;margin:8px 0 0;font-size:.95rem}
form{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:16px}
label{display:block;font-weight:600;margin:16px 0 6px}
label small{font-weight:400;color:#666}
input,textarea,select{width:100%;font:inherit;padding:12px;border:1.5px solid var(--line);border-radius:8px;background:var(--paper)}
input:focus,textarea:focus,select:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
input[type=file]{padding:10px;background:var(--soft)}
input[type=color]{width:52px;height:40px;padding:2px;border-radius:8px}
.colors{display:flex;gap:18px;flex-wrap:wrap}
.colors label{display:grid;gap:4px;margin:0;font-weight:500;font-size:.9rem}
.money{display:flex;align-items:center;gap:8px}
.money span{font-weight:700;font-size:1.1rem}
.sizes{display:grid;gap:8px}
.sw{display:grid;grid-template-columns:24px 1fr;align-items:center;gap:6px 12px;margin:0;padding:14px;border:1.5px solid var(--line);border-radius:8px;font-weight:500}
.sw input{width:24px;height:24px;flex:none;accent-color:var(--accent);grid-row:1}
.sw span{grid-column:2}
.sw small{grid-column:2;color:#666;font-weight:400;font-size:.85rem;line-height:1.35}
.demo{max-width:34rem;margin:0 auto 14px;padding:12px 14px;background:#fff7e6;border:1px solid #e8c37a;border-radius:8px;font-size:.92rem}
.demo.ok{background:#e8f5e9;border-color:#a5c8a9}
.sizes .sw{grid-template-columns:24px 1fr auto}
.sizes .sw small{grid-column:3;grid-row:1;text-align:right}
form > .sw{margin-top:18px}
.pics{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px}
.pic{display:grid;gap:6px;margin:0;font-weight:400;font-size:.85rem}
.pic img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;border:1px solid var(--line);background:var(--soft)}
.pic input{width:16px;height:16px;vertical-align:-2px}
button{width:100%;margin-top:22px;padding:15px;font:inherit;font-weight:700;background:var(--ink);color:#fff;border:0;border-radius:8px;cursor:pointer}
.danger{margin-top:14px;background:none;border-style:dashed}
.ghostbtn{background:none;color:#8a1f1f;border:1.5px solid #c9a0a0;margin-top:0}
.checks{display:grid;gap:10px}
.chk{display:grid;grid-template-columns:1.6rem 1fr;gap:10px;padding:12px 14px;background:var(--paper);border:1px solid var(--line);border-radius:10px}
.chk .mark{font-size:1.2rem;line-height:1.3}
.chk.ok .mark{color:#2e7d32}.chk.todo .mark{color:#b3261e}.chk.info .mark{color:#999}
.chk p{margin:2px 0 0;color:#444;font-size:.95rem}
.chk form{padding:0;border:0;background:none}
.chk label.tight{margin:10px 0 4px;font-size:.95rem}
.chk input{padding:10px}
form.inline{padding:0;border:0;background:none;max-width:34rem;margin:0 auto 14px}
form.inline button.small{margin:8px 0 0}
.sizes .sw:not(:has(input:checked)) span{text-decoration:line-through;color:#999}
.tbl{overflow-x:auto}.tbl table{border-collapse:collapse;width:100%;font-size:.95rem}.tbl td{padding:8px 10px 8px 0;border-bottom:1px solid var(--line);vertical-align:top}
</style></head><body><main>${body}</main>
<script>
document.querySelectorAll("[data-sz] input").forEach((i)=>i.addEventListener("change",()=>{
  const s=i.closest("[data-sz]").querySelector("[data-state]"); if(s) s.textContent=i.checked?"in stock":"sold out";
}));
// Phone photos are 3 to 8 MB. Shrink them to 1600px before upload, so the store stays fast and the
// upload takes a second: the browser does it, nothing leaves the phone until it is small.
document.querySelectorAll('input[type=file][accept^="image"]').forEach((inp)=>inp.addEventListener("change",async()=>{
  if(!window.createImageBitmap||!window.DataTransfer) return;
  const out=new DataTransfer();
  for(const f of inp.files){
    if(!/^image\\/(jpeg|png|webp|heic|heif)/.test(f.type)||f.size<350000){ out.items.add(f); continue; }
    try{
      const bmp=await createImageBitmap(f); const max=1600; const k=Math.min(1,max/Math.max(bmp.width,bmp.height));
      const c=document.createElement("canvas"); c.width=Math.round(bmp.width*k); c.height=Math.round(bmp.height*k);
      c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);
      const blob=await new Promise((r)=>c.toBlob(r,"image/jpeg",0.86));
      out.items.add(new File([blob],(f.name||"photo").replace(/\\.[^.]+$/,"")+".jpg",{type:"image/jpeg"}));
    }catch{ out.items.add(f); }
  }
  inp.files=out.files;
}));
</script></body></html>`;
}


/**
 * A show that was called off, and the money owed back.
 *
 * "Be straight with people about refunds" is on the public page; this is the part that makes it
 * true. The band marks the night off in products.json, opens this, sees exactly who is owed what,
 * and presses one button. Nobody has to chase anyone.
 */
async function showScreen(req, env, url, store, products, me, demo, tok) {
  const html = (body, status = 200) => new Response(page(body), { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
  const shows = ticketProducts(products);
  const id = url.searchParams.get("show") ?? "";
  const p = shows.find((x) => x.id === id);

  if (!p) {
    return html(`${adminNav("/admin/show")}<h1>Shows</h1>${shows.length
      ? `<ul class="pl">${shows.map((x) => `<li><a href="/admin/show?show=${encodeURIComponent(x.id)}">${escapeHtml(x.show.title ?? x.title)}</a><span class="d"></span><span class="sz">${escapeHtml(x.show.date ?? "")}${showOff(x) ? " · called off" : ""}</span></li>`).join("")}</ul>`
      : `<p>No shows in this store yet. A show is a product with a <code>show</code> block in <code>products.json</code>; the README has one to copy.</p>`}`);
  }

  const st = showStatus(p);
  const preview = await refundShow(env, p.id, products, { dryRun: true }).catch((e) => ({ refunded: [], skipped: [], failed: [{ why: e.message }], total: 0 }));

  if (req.method === "POST") {
    const f = await req.formData();
    if (!demo && !timingSafeEqual(String(f.get("_t") ?? ""), tok)) return html(`<div class="warn"><p>Reload the page: it had been open too long.</p></div>`, 403);
    if (demo) return html(`<h1>${escapeHtml(p.show.title ?? p.title)}</h1><div class="warn"><p>A look around: nothing here can be changed.</p></div><p class="fine"><a href="/admin/show?show=${encodeURIComponent(p.id)}">Back</a></p>`);
    const r = await refundShow(env, p.id, products);
    return html(`<h1>${escapeHtml(p.show.title ?? p.title)}</h1>
      <p><b>${r.refunded.length} refunded</b>, ${(r.total / 100).toFixed(2)} ${escapeHtml((r.currency ?? store.currency ?? "").toUpperCase())}.</p>
      ${r.failed.length ? `<div class="warn"><p><b>${r.failed.length} could not be refunded.</b> These need doing by hand in Stripe, and the person is owed either way:</p><ul>${r.failed.map((x) => `<li>${escapeHtml(x.email ?? x.order ?? "?")} — ${escapeHtml(x.why)}</li>`).join("")}</ul></div>` : ""}
      ${r.skipped.length ? `<p class="fine">${r.skipped.length} skipped (${escapeHtml([...new Set(r.skipped.map((x) => x.why))].join(", "))}).</p>` : ""}
      <p class="fine">Now tell them. A refund without a message reads like a mistake.</p>
      <p class="fine"><a href="/admin/show?show=${encodeURIComponent(p.id)}">Back to the show</a> · <a href="/admin/orders">Orders</a></p>`);
  }

  const owed = preview.refunded.length;
  return html(`${adminNav("/admin/show", { href: "/admin/show", label: "All shows" })}<h1>${escapeHtml(p.show.title ?? p.title)}</h1>
    <p class="sub">${escapeHtml(p.show.venue ?? "")}${p.show.city ? `, ${escapeHtml(p.show.city)}` : ""} · ${escapeHtml(p.show.date ?? "")}${st.state === "cancelled" ? " · called off" : st.state === "moved" ? ` · moved to ${escapeHtml(st.to)}` : ""}</p>
    ${st.state === "on"
      ? `<div class="warn"><p><b>This show is still on.</b> To call it off, set <code>"cancelled": true</code> inside its <code>show</code> block in <code>products.json</code> and deploy. Every ticket for the night will say so, and it stops being buyable straight away. Then come back here to refund.</p></div>`
      : `<p>${owed ? `<b>${owed} ${owed === 1 ? "person is" : "people are"} owed ${(preview.total / 100).toFixed(2)} ${escapeHtml((preview.currency ?? store.currency ?? "").toUpperCase())}.</b>` : "<b>Nobody is owed anything for this show.</b>"}</p>`}
    ${preview.refunded.length ? `<ul class="pl">${preview.refunded.map((x) => `<li>${escapeHtml(x.email ?? x.order)}<span class="d"></span><span class="pr">${(x.cents / 100).toFixed(2)}</span></li>`).join("")}</ul>` : ""}
    ${preview.failed.length ? `<div class="warn"><p>${preview.failed.length} cannot be refunded automatically: ${escapeHtml([...new Set(preview.failed.map((x) => x.why))].join("; "))}</p></div>` : ""}
    ${st.state !== "on" && owed ? `<form method="post"><input type="hidden" name="_t" value="${demo ? "" : tok}"><button type="submit">Refund all ${owed}</button></form><p class="fine">Refunds only the tickets to this show. Anything else in the same order — a record, a shirt — is still coming and is not touched.</p>` : ""}
    <p class="fine"><a href="/admin/show">All shows</a> · <a href="/admin/door">Door</a> · <a href="/admin">Products</a></p>`);
}
