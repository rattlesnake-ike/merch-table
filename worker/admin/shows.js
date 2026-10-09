/* Shows: sell tickets to your own nights. Add one from your phone, see how it's selling, call it off
   and refund everyone with one press, and the door. */
import { adminNav, html, page, money, escapeHtml, currencySign, notice, field, text, saved } from "./ui.js";
import { saveProducts, soldCounts, sessionSecret } from "../live.js";
import { refundShow } from "../refunds.js";
import { listOrders, getOrder, ticketByCode, backfillTicketIndex } from "../orders.js";
import { ticketProducts, ticketsForOrder, verifyCode, admit, showOver, headcount, showStatus, showOff, allocationOf } from "../tickets.js";
import { parsePrice, uniqueId } from "./products.js";
import { slug } from "../../src/shopify.mjs";

export async function showsScreen(req, env, url, store, products, me, demo, tok, hint) {
  const path = url.pathname;
  const who = me.email || "admin";
  const hidden = `<input type="hidden" name="_t" value="${tok}">${me.byKey ? `<input type="hidden" name="key" value="${escapeHtml(me.byKey)}">` : ""}`;
  const checkTok = async (form) => demo || (String(form.get("_t") ?? "") === tok && tok !== "") || (me.byKey && String(form.get("key") ?? "") === me.byKey);
  const wrap = (body, title, back = null) => html(page(`${adminNav("/admin/shows", back, store)}<main>${body}</main>`, store, { title }));
  const bad = (t, d, back) => wrap(`<h1>${escapeHtml(t)}</h1><p>${escapeHtml(d)}</p><p><a href="${back}">Back</a></p>`, "Shows");
  const demoRefusal = (back) => wrap(`<h1>This is the demo</h1><p>On your own store this would have saved. <a href="${back}">Back</a></p>`, "Demo");
  const shows = ticketProducts(products);
  const sold = demo ? {} : await soldCounts(env, shows);

  /* --- a new show --- */
  if (path === "/admin/shows/new") {
    if (req.method === "POST") {
      if (demo) return demoRefusal("/admin/shows/new");
      const form = await req.formData();
      if (!(await checkTok(form))) return bad("That form had gone stale", "Open it again.", "/admin/shows/new");
      const r = readShowForm(form, null, products);
      if (r.error) return bad(r.error.title, r.error.detail, "/admin/shows/new");
      const w = await saveProducts(env, store, [r.product, ...products], who, `added the show ${r.product.show.title}`);
      if (!w.ok) return bad("Couldn't save", w.error, "/admin/shows/new");
      return saved(`/admin/shows/${encodeURIComponent(r.product.id)}?saved=1`, hint, w.fresh);
    }
    return wrap(`<header class="bar"><h1>Add a show</h1></header>
      ${demo ? notice("On your own store this puts tickets on sale: no ticketing company, no service fee, Stripe's card fee and nothing else. Here it can't save.") : ""}
      <form method="post" class="card">${hidden}${showFields(null, store)}<button type="submit">Put tickets on sale</button></form>`, "Add a show", { href: "/admin/shows", label: "Shows" });
  }

  /* --- one show --- */
  const m = path.match(/^\/admin\/shows\/([^/]+)(?:\/(off|move|on|refund))?$/);
  if (m) {
    const id = decodeURIComponent(m[1]); const action = m[2];
    const p = shows.find((x) => x.id === id);
    if (!p) return wrap(`<h1>Not found</h1><p><a href="/admin/shows">All shows</a></p>`, "Shows", { href: "/admin/shows", label: "Shows" });
    const back = `/admin/shows/${encodeURIComponent(id)}`;
    if (req.method === "POST") {
      if (demo) return demoRefusal(back);
      const form = await req.formData();
      if (!(await checkTok(form))) return bad("That form had gone stale", "Open it again.", back);
      if (action === "refund") {
        const r = await refundShow(env, p.id, products);
        return wrap(`<header class="bar"><h1>${escapeHtml(p.show.title ?? p.title)}</h1></header>
          <p><b>${r.refunded.length} refunded</b>, ${money(r.total, { ...store, currency: r.currency ?? store.currency })}.</p>
          ${r.failed.length ? notice(`<b>${r.failed.length} could not be refunded.</b> These need doing by hand in Stripe, and the person is owed either way:<br>${r.failed.map((x) => `${escapeHtml(x.email ?? x.order ?? "?")} — ${escapeHtml(x.why)}`).join("<br>")}`, "warn") : ""}
          ${r.skipped.length ? `<p class="fine">${r.skipped.length} skipped (${escapeHtml([...new Set(r.skipped.map((x) => x.why))].join(", "))}).</p>` : ""}
          <p class="fine">Now tell them. A refund without a message reads like a mistake.</p><p><a href="${back}">Back to the show</a></p>`, "Refunded", { href: "/admin/shows", label: "Shows" });
      }
      const next = structuredClone(p);
      if (action === "off") { next.show.cancelled = String(form.get("note") ?? "").trim().slice(0, 300) || true; delete next.show.moved_to; }
      else if (action === "move") { const to = String(form.get("moved_to") ?? "").trim().slice(0, 80); if (!to) return bad("Say where or when it moved to", "", back); next.show.moved_to = to; const note = String(form.get("note") ?? "").trim().slice(0, 300); if (note) next.show.moved_note = note; delete next.show.cancelled; }
      else if (action === "on") { delete next.show.cancelled; delete next.show.moved_to; delete next.show.moved_note; }
      else { const r = readShowForm(form, p, products); if (r.error) return bad(r.error.title, r.error.detail, back); Object.assign(next, r.product); }
      const w = await saveProducts(env, store, products.map((x) => (x.id === id ? next : x)), who, action === "off" ? `called off ${p.show.title ?? p.title}` : action === "move" ? `moved ${p.show.title ?? p.title}` : action === "on" ? `${p.show.title ?? p.title} is back on` : `edited the show ${p.show.title ?? p.title}`);
      if (!w.ok) return bad("Couldn't save", w.error, back);
      return saved(`${back}?saved=1`, hint, w.fresh);
    }
    const st = showStatus(p);
    const n = sold[`${p.id}:${p.variants[0]?.id}`] ?? 0;
    const alloc = allocationOf(p);
    const preview = demo ? { refunded: [], total: 0, failed: [] } : await refundShow(env, p.id, products, { dryRun: true }).catch((e) => ({ refunded: [], failed: [{ why: e.message }], total: 0 }));
    const owed = preview.refunded.length;
    return wrap(`<header class="bar"><h1>${escapeHtml(p.show.title ?? p.title)}</h1><a class="ghost" href="/products/${encodeURIComponent(p.id)}/" target="_blank" rel="noopener">On the store ↗</a></header>
      ${url.searchParams.get("saved") ? notice("Saved. It's live for you now, and for everyone within a minute.", "ok") : ""}
      ${st.state === "cancelled" ? notice(`<b>Called off.</b> Every ticket says so and nothing more can be sold. ${owed ? `<b>${owed} ${owed === 1 ? "person is" : "people are"} owed ${money(preview.total, store)}.</b>` : "Nobody is owed anything."}`, "warn") : st.state === "moved" ? notice(`<b>Moved to ${escapeHtml(st.to)}.</b> Every ticket says so and still works.`) : ""}
      <div class="cards"><div class="stat"><b>${n}</b><span>sold${alloc != null ? ` of ${alloc}` : ""}</span></div><div class="stat"><b>${money(n * (p.variants[0]?.price ?? p.price), store)}</b><span>taken</span></div>${p.show.room_capacity ? `<div class="stat"><b>${p.show.room_capacity}</b><span>the room holds</span></div>` : ""}</div>
      <form method="post" class="card">${hidden}${showFields(p, store)}<button type="submit">Save</button></form>
      ${st.state !== "cancelled" && owed ? "" : ""}
      ${st.state === "cancelled" && owed ? `<form method="post" action="${back}/refund" class="card" onsubmit="return confirm('Refund all ${owed}? This cannot be undone.')">${hidden}<b>Refund everyone</b><p class="fine" style="margin:6px 0 0">Only the tickets to this show, back to the card each person paid with. Anything else in the same order — a record, a shirt — is still coming and is not touched.</p>${preview.failed.length ? notice(`${preview.failed.length} cannot be refunded automatically: ${escapeHtml([...new Set(preview.failed.map((x) => x.why))].join("; "))}`, "warn") : ""}<button type="submit">Refund all ${owed}</button></form>` : ""}
      ${st.state === "on" ? `<details class="card"><summary><b>Something's changed</b></summary>
        <form method="post" action="${back}/move" class="bare">${hidden}${field("moved_to", "Moved to", text("moved_to", "", 'placeholder="Dec 5, same room"'), "a new date or a new room; tickets stay valid")}${field("note", "A line for the ticket", text("note", "", 'placeholder="Your ticket still works. Can\'t make it? Write and we\'ll refund you."'), "optional")}<button type="submit" class="small">It moved</button></form>
        <form method="post" action="${back}/off" class="bare" style="margin-top:14px" onsubmit="return confirm('Call off ${escapeHtml(p.show.title ?? p.title).replace(/'/g, "\\'")}? Nothing more can be sold; you refund everyone on the next screen.')">${hidden}${field("note", "A line for the ticket", text("note", "", 'placeholder="Refunds are on their way to the card you paid with."'), "optional")}<button type="submit" class="small btn danger">Call it off</button></form></details>` : `<form method="post" action="${back}/on" class="bare">${hidden}<button type="submit" class="small btn ghost">It's back on</button></form>`}
      <p class="fine"><a href="/admin/door">The door</a> · <a href="/tickets" target="_blank" rel="noopener">What a fan sees ↗</a></p>`, p.show.title ?? p.title, { href: "/admin/shows", label: "Shows" });
  }

  /* --- the list --- */
  const row = (p) => { const n = sold[`${p.id}:${p.variants[0]?.id}`] ?? 0; const st = showStatus(p); const alloc = allocationOf(p); return `<a class="row" href="/admin/shows/${encodeURIComponent(p.id)}"><span class="meta"><b>${escapeHtml(p.show.title ?? p.title)} ${showOver(p) ? `<span class="tag">past</span>` : st.state === "cancelled" ? `<span class="tag hot">called off</span>` : st.state === "moved" ? `<span class="tag new">moved</span>` : ""}</b><small>${escapeHtml(p.show.venue ?? "")}${p.show.city ? `, ${escapeHtml(p.show.city)}` : ""} · ${escapeHtml(p.show.date ?? "")}${p.show.time ? ` ${escapeHtml(p.show.time)}` : ""} · ${n} sold${alloc != null ? ` of ${alloc}` : ""}</small></span><span class="num mono">${money(p.variants[0]?.price ?? p.price, store)}</span><span class="go">›</span></a>`; };
  const upcoming = shows.filter((p) => !showOver(p)), past = shows.filter((p) => showOver(p));
  return wrap(`<header class="bar"><h1>Shows</h1></header>
    ${demo ? notice("Tickets to your own shows, sold here: no ticketing company, no service fee. The door is a phone with a web page open.") : ""}
    <div class="actions"><a class="btn" href="/admin/shows/new">Add a show</a><a class="btn ghost" href="/admin/door">The door</a></div>
    <div class="list">${upcoming.length ? upcoming.map(row).join("") : `<p class="empty">No shows on sale. Add one: a date, a room, a price, how many you may sell.</p>`}</div>
    ${past.length ? `<h2>Past</h2><div class="list">${past.map(row).join("")}</div>` : ""}
    <p class="fine">A ticket is a product with a date. Each one sold gets a code that opens the door once; the fan finds theirs at <a href="/tickets" target="_blank" rel="noopener">/tickets ↗</a> with the email they paid with.</p>`, "Shows");
}

function showFields(p, store) {
  const sh = p?.show ?? {};
  return `${field("title", "The show", text("title", sh.title ?? p?.title ?? "", 'required maxlength="120" placeholder="Harbor Lights release show"'))}
    <div class="two">${field("venue", "Room", text("venue", sh.venue ?? "", 'placeholder="The Broadway"'))}${field("city", "City", text("city", sh.city ?? "", 'placeholder="Brooklyn, NY"'))}</div>
    <div class="two">${field("date", "Date", `<input id="date" name="date" type="date" value="${escapeHtml(sh.date ?? "")}" required>`)}${field("time", "Starts", `<input id="time" name="time" type="time" value="${escapeHtml(sh.time ?? "")}">`)}</div>
    <div class="two">${field("doors", "Doors", text("doors", sh.doors ?? "", 'placeholder="8pm"'), "as written on the ticket")}${field("price", "Ticket price", `<div class="money"><span>${currencySign(store)}</span><input id="price" name="price" inputmode="decimal" value="${p ? ((p.variants[0]?.price ?? p.price) / 100).toFixed(2) : ""}" required placeholder="18"></div>`)}</div>
    <div class="two">${field("allocation", "You may sell", text("allocation", sh.allocation ?? sh.capacity ?? "", 'inputmode="numeric" placeholder="120"'), "the number the venue agreed")}${field("room_capacity", "The room holds", text("room_capacity", sh.room_capacity ?? "", 'inputmode="numeric" placeholder="250"'), "ask the venue")}</div>
    ${field("venue_contact", "Who at the venue gets your list", text("venue_contact", sh.venue_contact ?? "", 'placeholder="door@thebroadway.example"'), "send the sold names before doors; the door count is theirs to defend")}
    ${field("description", "On the page", `<textarea id="description" name="description" rows="3">${escapeHtml(p?.description ?? "")}</textarea>`, "optional")}
    <label class="sw"><input type="checkbox" name="hidden" ${p?.hidden ? "checked" : ""}><span>Hide from the store for now</span><small>the page exists, it just isn't listed</small></label>`;
}

export function readShowForm(form, existing, products) {
  const str = (k, max) => String(form.get(k) ?? "").trim().slice(0, max);
  const title = str("title", 120); if (!title) return { error: { title: "It needs a name", detail: "" } };
  const date = str("date", 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: { title: "Pick a date", detail: "" } };
  const cents = parsePrice(form.get("price")); if (cents === null) return { error: { title: "That price didn't look right", detail: "Use a plain number, like 18." } };
  const num = (k) => { const v = str(k, 6); return /^\d{1,6}$/.test(v) ? Number(v) : null; };
  const alloc = num("allocation"), room = num("room_capacity");
  const time = str("time", 5);
  const show = { ...(existing?.show ?? {}), title, venue: str("venue", 80), city: str("city", 80), date, ...(time ? { time } : {}), ...(str("doors", 20) ? { doors: str("doors", 20) } : {}), ...(alloc != null ? { allocation: alloc } : {}), ...(room != null ? { room_capacity: room } : {}), ...(str("venue_contact", 120) ? { venue_contact: str("venue_contact", 120) } : {}) };
  if (alloc == null) delete show.allocation; if (room == null) delete show.room_capacity;
  const variant = { ...(existing?.variants?.[0] ?? { id: "advance", title: "Advance" }), available: true, ...(alloc != null ? { stock: alloc } : {}) };
  if (alloc == null) delete variant.stock;
  const product = existing ? structuredClone(existing) : { id: uniqueId(slug(`${title}-${str("city", 80) || date}`) || "show", products), kind: products.some((p) => p.kind === "shows") || true ? "shows" : "other", images: [], published: new Date().toISOString() };
  Object.assign(product, { title: `${title}${show.city ? ` — ${show.city}` : ""}`, price: cents, description: str("description", 2000), show, variants: [variant], hidden: form.get("hidden") === "on" ? true : undefined });
  return { product };
}

/** The door. Someone types a code, and gets a green yes or a red no. Nothing else.
    Built for one hand, bad light, and a queue of people waiting. */
export async function doorScreen(req, env, url, store, products, me, demo, tok) {
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
    .top{display:flex;justify-content:space-between;gap:12px;font-size:.9rem;margin:0 0 10px}
  </style>`;
  const pg = (body, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Door</title>${css}</head><body><main><p class="top"><a href="/admin/shows">← Shows</a><a href="/admin">Admin</a></p>${body}</main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });

  const form = async (msg = "") => {
    // How many are in the room. A fire marshal asks for this number, and a settlement starts
    // from it, so it is counted from the check-ins rather than kept as a tally that can drift.
    const counts = demo ? [] : await headcount(env, products).catch(() => []);
    const countLine = counts.length ? `<p class="count">${counts.map((c) => `<span><b>${c.inRoom}</b> in the room${typeof c.allocation === "number" ? ` of ${c.allocation}` : ""} · ${escapeHtml(c.title)}</span>`).join("")}</p>` : "";
    return `<h1>Door</h1>
    ${shows.length ? `<p class="sub">${shows.map((p) => escapeHtml(p.show.title ?? p.title)).join(" · ")}</p>` : `<p class="sub">No upcoming shows in the store.</p>`}
    ${countLine}${msg}
    <form method="post"><input type="hidden" name="_t" value="${demo ? "" : tok}">
      <input name="code" required autofocus autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-1234" aria-label="Ticket code" inputmode="latin">
      <button type="submit">Check in</button></form>`;
  };
  if (req.method !== "POST") return pg(await form());
  const f = await req.formData();
  if (!demo && String(f.get("_t") ?? "") !== tok) return pg(await form(`<div class="warn"><p class="big">Reload the page</p><p>It had been open too long.</p></div>`), 403);
  const code = String(f.get("code") ?? "");
  if (demo) return pg(await form(`<div class="warn"><p class="big">Demo</p><p>A real door would check that code against the tickets sold.</p></div>`));
  let hit = await ticketByCode(env, code);
  if (!hit) { await backfillTicketIndex(env, products); hit = await ticketByCode(env, code); }
  const secret = (await sessionSecret(env)) ?? "unset";
  const candidates = hit ? [await getOrder(env, hit.order)].filter(Boolean) : await listOrders(env, 1000);
  for (const o of candidates) {
    for (const t of await ticketsForOrder(env, o, products)) {
      if (!(await verifyCode(secret, o.id, t.seq, code))) continue;
      const show = t.product.show;
      const whoIs = escapeHtml(o.name ?? o.email ?? "");
      const what = escapeHtml(show.title ?? t.product.title);
      if (showOff(t.product)) return pg(await form(`<div class="no"><p class="big">Show called off</p><p>${what} · ${whoIs}</p></div>`));
      const r = await admit(env, o.id, t.seq);
      if (r.already) return pg(await form(`<div class="no"><p class="big">Already used</p><p>${what} · ${whoIs}</p><p class="fine">Checked in at ${new Date(r.at).toLocaleTimeString(store.locale ?? "en-US")}. If that wasn't them, ask for ID or send them to whoever runs the show.</p></div>`));
      if (!r.ok) return pg(await form(`<div class="warn"><p class="big">Can't check in</p><p>${escapeHtml(r.reason ?? "")}</p></div>`));
      return pg(await form(`<div class="yes"><p class="big">Let them in</p><p>${what} · ${whoIs}</p></div>`));
    }
  }
  return pg(await form(`<div class="no"><p class="big">Not a ticket</p><p class="fine">No ticket with that code. Check for a typo, or look them up by email in <a href="/admin/orders">Orders</a>.</p></div>`));
}
