/* Orders: the list with the one box that protects the band (tracking), one order with the packing
   slip and a refund button, the dispute pack, and a CSV. */
import { adminNav, html, page, money, escapeHtml, when, notice, saved } from "./ui.js";
import { listOrders, getOrder, markShipped, trackingUrl } from "../orders.js";
import { webhookSecret } from "../live.js";
import { stripe } from "../stripe.js";
import { demoOrders } from "./home.js";

const addr = (o) => (o.ship?.address ? [o.ship.address.line1, o.ship.address.line2, o.ship.address.city, o.ship.address.state, o.ship.address.postal_code, o.ship.address.country].filter(Boolean) : []);
const lines = (o, products) => String(o.items ?? "").split(",").filter(Boolean).map((part) => { const [pid, vid, qty] = part.split(":"); const p = products.find((x) => x.id === pid); const v = p?.variants.find((x) => x.id === vid); return { title: p?.title ?? pid, variant: v && p.variants.length > 1 ? v.title : "", qty: Number(qty) || 1, p }; });

export async function ordersScreen(req, env, url, store, products, me, demo, tok, hint) {
  const path = url.pathname;
  const hidden = `<input type="hidden" name="_t" value="${tok}">${me.byKey ? `<input type="hidden" name="key" value="${escapeHtml(me.byKey)}">` : ""}`;
  const checkTok = async (form) => demo || (String(form.get("_t") ?? "") === tok && tok !== "") || (me.byKey && String(form.get("key") ?? "") === me.byKey);
  const wrap = (body, title, back = null) => html(page(`${adminNav("/admin/orders", back, store)}<main>${body}</main>`, store, { title }));
  const id = path.startsWith("/admin/orders/") ? decodeURIComponent(path.slice("/admin/orders/".length).split("/")[0]) : null;
  const action = id ? path.slice("/admin/orders/".length).split("/")[1] : null;
  const all = demo ? demoOrders(store) : await listOrders(env, 500);

  if (path === "/admin/orders.csv") {
    const rows = [["id", "date", "status", "total", "currency", "name", "email", "phone", "address", "items", "carrier", "tracking", "shipped"]];
    for (const o of all) rows.push([o.id, o.at, o.status, ((o.total ?? 0) / 100).toFixed(2), o.currency, o.name, o.email, o.phone, addr(o).join(", "), o.goods || o.items, o.carrier, o.tracking, o.shippedAt].map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`));
    return new Response(rows.map((r) => r.join(",")).join("\n") + "\n", { headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=orders.csv", "cache-control": "no-store" } });
  }

  if (req.method === "POST") {
    if (demo) return wrap(`<h1>This is the demo</h1><p>On your own store this would have saved. <a href="/admin/orders">Back</a></p>`, "Demo");
    const form = await req.formData();
    if (!(await checkTok(form))) return html(page(`${adminNav("/admin/orders", null, store)}<main><h1>That form had gone stale</h1><p><a href="/admin/orders">Open it again</a>.</p></main>`, store), 403);
    if (action === "refund") {
      const o = await getOrder(env, id);
      if (!o) return wrap(`<h1>Not found</h1>`, "Orders");
      if (!o.payment) return wrap(`<h1>Can't refund from here</h1><p>This order has no payment on file. Refund it in Stripe → Payments.</p><p><a href="/admin/orders/${encodeURIComponent(id)}">Back</a></p>`, "Refund");
      try {
        const r = await stripe(env, "POST", "/refunds", { payment_intent: o.payment, metadata: { order: o.id, by: me.email || "admin" } });
        o.status = "refunded"; o.refundedAt = new Date().toISOString(); o.refund = r.id;
        await env.STOCK.put(`order:${o.id}`, JSON.stringify(o));
        return saved(`/admin/orders/${encodeURIComponent(id)}?refunded=1`, hint, {});
      } catch (e) { return wrap(`<h1>Stripe wouldn't refund it</h1><p>${escapeHtml(e.message)}</p><p>Try it in Stripe → Payments, where the reason shows. <a href="/admin/orders/${encodeURIComponent(id)}">Back</a></p>`, "Refund"); }
    }
    await markShipped(env, String(form.get("id") ?? id ?? ""), { carrier: form.get("carrier"), tracking: form.get("tracking"), note: form.get("note") });
    return saved(id ? `/admin/orders/${encodeURIComponent(id)}?saved=1` : "/admin/orders?saved=1", hint, {});
  }

  /* --- one order --- */
  if (id) {
    const o = demo ? all.find((x) => x.id === id) : await getOrder(env, id);
    if (!o) return wrap(`<h1>Not found</h1><p><a href="/admin/orders">Back to orders</a></p>`, "Orders", { href: "/admin/orders", label: "Orders" });
    const items = lines(o, products);
    if (action === "slip") return html(slip(o, items, store), 200);
    if (action === "dispute") return wrap(disputePack(o, store), "Dispute", { href: `/admin/orders/${encodeURIComponent(id)}`, label: "The order" });
    const t = trackingUrl(o.carrier, o.tracking);
    const status = o.status === "refunded" ? `<span class="tag hot">refunded</span>` : o.status === "shipped" ? `<span class="tag ok">shipped</span>` : `<span class="tag new">to pack</span>`;
    return wrap(`<header class="bar"><h1>${escapeHtml(o.name || o.email || "Order")} ${status}</h1></header>
      ${url.searchParams.get("saved") ? notice("Marked shipped. That tracking number is the best protection you have if this is ever disputed.", "ok") : ""}
      ${url.searchParams.get("refunded") ? notice("Refunded in full. Stripe returns the money to the card in a few working days. Tell them; a refund without a message reads like a mistake.", "ok") : ""}
      <div class="card">
        <ul class="pl">${items.map((l) => `<li><span>${escapeHtml(l.title)}${l.variant ? ` · ${escapeHtml(l.variant)}` : ""}</span><span class="d"></span><span class="num">× ${l.qty}</span></li>`).join("")}<li><span><b>Paid</b></span><span class="d"></span><span class="num"><b>${money(o.total, store)}</b></span></li></ul>
        <p class="fine" style="margin:12px 0 0">${when(o.at, store, { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" })}${o.orderNo && Number(o.orderNo) > 1 ? ` · their order ${escapeHtml(o.orderNo)} from this buyer` : ""}${o.shipsOn ? ` · pre-order, ships ${escapeHtml(o.shipsOn)}` : ""}</p>
        <p style="margin:12px 0 0">${escapeHtml(o.name ?? "")}<br><a href="mailto:${escapeHtml(o.email ?? "")}">${escapeHtml(o.email ?? "")}</a>${o.phone ? `<br>${escapeHtml(o.phone)}` : ""}</p>
        ${addr(o).length ? `<p style="margin:10px 0 0">${addr(o).map(escapeHtml).join("<br>")}</p>` : `<p class="fine">Nothing to post: tickets only.</p>`}
      </div>
      ${o.status === "shipped" ? `<div class="card"><b>Shipped</b> ${when(o.shippedAt, store)}${o.tracking ? ` · ${t ? `<a href="${t}" rel="noopener" target="_blank">${escapeHtml(o.carrier || "track")} ${escapeHtml(o.tracking)} ↗</a>` : `${escapeHtml(o.carrier ?? "")} ${escapeHtml(o.tracking)}`}` : ""}</div>` : o.status === "refunded" ? "" : `
      <form method="post" class="card">${hidden}<input type="hidden" name="id" value="${escapeHtml(o.id)}">
        <b>Mark it shipped</b>
        <div class="two"><div><label for="carrier">Carrier</label><input id="carrier" name="carrier" list="carriers" placeholder="USPS"></div><div><label for="tracking">Tracking number</label><input id="tracking" name="tracking" placeholder="9400 1118 …" autocomplete="off"></div></div>
        <datalist id="carriers"><option>USPS</option><option>UPS</option><option>FedEx</option><option>DHL</option><option>Royal Mail</option></datalist>
        <button type="submit">Shipped</button>
        <p class="fine" style="margin:10px 0 0">Put the tracking number in when you post it: it is what answers a bank if a buyer ever says it never arrived.</p></form>`}
      <div class="actions"><a class="btn ghost" href="/admin/orders/${encodeURIComponent(o.id)}/slip" target="_blank">Packing slip</a><a class="btn ghost" href="/admin/orders/${encodeURIComponent(o.id)}/dispute">If this is ever disputed</a></div>
      ${o.status !== "refunded" && !demo ? `<form method="post" action="/admin/orders/${encodeURIComponent(o.id)}/refund" class="danger" onsubmit="return confirm('Refund ${money(o.total, store).replace(/'/g, "")} to ${escapeHtml(o.name || o.email || "the buyer").replace(/'/g, "\\'")}? This cannot be undone.')">${hidden}<button type="submit">Refund in full</button><p class="fine" style="margin:10px 0 0">The whole order, back to the card they paid with. A partial refund is done in Stripe → Payments.</p></form>` : ""}
    `, "Order", { href: "/admin/orders", label: "Orders" });
  }

  /* --- the list --- */
  const show = url.searchParams.get("show") ?? "pack";
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  let list = all;
  if (show === "pack") list = list.filter((o) => o.status !== "shipped" && o.status !== "refunded");
  if (show === "shipped") list = list.filter((o) => o.status === "shipped");
  if (q) list = list.filter((o) => `${o.name ?? ""} ${o.email ?? ""} ${o.goods ?? ""} ${o.tracking ?? ""}`.toLowerCase().includes(q));
  const connected = demo ? true : !!(await webhookSecret(env, hint));
  const row = (o) => `<a class="row" href="/admin/orders/${encodeURIComponent(o.id)}"><span class="meta"><b>${escapeHtml(o.goods || o.items)}</b><small>${escapeHtml(o.name ?? "")} · ${escapeHtml(o.email ?? "")} · ${when(o.at, store)}${o.status === "shipped" ? ` · shipped${o.tracking ? ", " + escapeHtml(o.carrier || "") + " " + escapeHtml(o.tracking) : ""}` : o.status === "refunded" ? " · refunded" : o.shipsOn ? ` · pre-order, ships ${escapeHtml(o.shipsOn)}` : ""}</small></span><span class="num mono">${money(o.total, store)}</span><span class="go">›</span></a>`;
  const toPack = all.filter((o) => o.status !== "shipped" && o.status !== "refunded").length;
  return wrap(`<header class="bar"><h1>Orders</h1></header>
    ${demo ? notice("A few pretend orders, so you can see the list, an order, the packing slip and the dispute pack. There is nothing to save.") : ""}
    ${url.searchParams.get("saved") ? notice("Marked shipped.", "ok") : ""}
    <div class="filters"><a href="/admin/orders" class="${show === "pack" ? "on" : ""}">To pack${toPack ? ` (${toPack})` : ""}</a><a href="/admin/orders?show=shipped" class="${show === "shipped" ? "on" : ""}">Shipped</a><a href="/admin/orders?show=all" class="${show === "all" ? "on" : ""}">All</a></div>
    <form method="get" class="search bare"><input type="hidden" name="show" value="${escapeHtml(show)}"><input name="q" value="${escapeHtml(q)}" placeholder="Name, email, item or tracking" aria-label="Search orders"><button type="submit" class="small">Find</button></form>
    <div class="list">${list.length ? list.map(row).join("") : `<p class="empty">${q ? "Nothing matches." : show === "pack" ? "Nothing to pack." : "No orders yet."}${!all.length && !connected ? ` Orders only arrive once Stripe can reach your store: <a href="/admin/setup">open Setup</a>.` : ""}</p>`}</div>
    <p class="fine">${all.length ? `<a href="/admin/orders.csv">Download every order as CSV</a> · ` : ""}<a href="/orders" target="_blank" rel="noopener">What a buyer sees ↗</a></p>`, "Orders");
}

/** A packing slip: what goes in the box, who it goes to, in a page that prints on one sheet. */
function slip(o, items, store) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Packing slip</title><style>body{font:15px/1.5 ui-sans-serif,system-ui,sans-serif;max-width:36rem;margin:2rem auto;padding:0 1rem;color:#141416}h1{font-size:1.5rem;margin:0}table{width:100%;border-collapse:collapse;margin:1rem 0}td,th{text-align:left;padding:6px 0;border-bottom:1px solid #ddd}td.n{text-align:right}.addr{font-size:1.1rem;margin:1rem 0}.fine{color:#666;font-size:.9rem}@media print{button{display:none}}</style></head><body>
  <h1>${escapeHtml(store.name)}</h1><p class="fine">${escapeHtml(store.email ?? "")}${store.homepage ? ` · ${escapeHtml(store.homepage)}` : ""}</p>
  <p class="addr"><b>${escapeHtml(o.name ?? "")}</b><br>${addr(o).map(escapeHtml).join("<br>")}</p>
  <table><thead><tr><th>Item</th><th class="n">Qty</th></tr></thead><tbody>${items.map((l) => `<tr><td>${escapeHtml(l.title)}${l.variant ? ` · ${escapeHtml(l.variant)}` : ""}</td><td class="n">${l.qty}</td></tr>`).join("")}</tbody></table>
  <p class="fine">Order ${escapeHtml(o.id)} · ${new Date(o.at).toLocaleDateString(store.locale ?? "en-US", { day: "numeric", month: "long", year: "numeric" })} · paid ${money(o.total, store)}</p>
  <p>Thanks for buying straight from us. Wrong size or a problem? Write to ${escapeHtml(store.email ?? "us")} and a person answers.</p>
  <button onclick="print()">Print</button></body></html>`;
}

/** Everything a bank asks for, in the order Stripe's form asks for it, ready to paste. */
export function disputePack(o, store) {
  const t = trackingUrl(o.carrier, o.tracking);
  const line = (k, v) => v ? `<tr><td><b>${escapeHtml(k)}</b></td><td>${v}</td></tr>` : "";
  return `<h1 style="font-size:1.4rem">If this order is disputed</h1>
  <p class="sub">A dispute gives you a few days to answer. Paste these into Stripe's form, field by field. Most of it exists only because the store wrote it down when the order was placed.</p>
  <div class="card tbl"><table><tbody>
    ${line("Product description", escapeHtml(o.goods || o.items))}
    ${line("Order date", new Date(o.at).toUTCString())}
    ${line("Amount", money(o.total, store))}
    ${line("Customer name", escapeHtml(o.name ?? ""))}
    ${line("Customer email", escapeHtml(o.email ?? ""))}
    ${line("Shipping address", escapeHtml(addr(o).join(", ")))}
    ${line("Shipping carrier", escapeHtml(o.carrier ?? ""))}
    ${line("Tracking number", escapeHtml(o.tracking ?? ""))}
    ${line("Shipping date", o.shippedAt ? new Date(o.shippedAt).toUTCString() : "")}
    ${line("Country the order came from", escapeHtml(o.ipCountry ?? ""))}
    ${line("Earlier orders from this buyer", Number(o.orderNo) > 1 ? `${escapeHtml(o.orderNo)} orders in total. Visa's Compelling Evidence rule lets two earlier undisputed orders from the same buyer overturn a fraud claim — search the list for the same email or address and include them.` : "")}
    ${line("Refund policy", `Shown at checkout and at ${escapeHtml(store.siteUrl ?? "")}/shipping/`)}
  </tbody></table></div>
  ${o.tracking ? notice(`<b>You have tracking.</b> That is the single strongest piece of evidence for &ldquo;it never arrived&rdquo;. ${t ? `Screenshot the delivery confirmation at <a href="${t}" rel="noopener" target="_blank">the carrier's page</a> and attach it as a file.` : "Screenshot the carrier's delivery confirmation and attach it."}`, "ok") : notice(`<b>No tracking on this order.</b> If you have a receipt from the post office, photograph it. Without proof of delivery a &ldquo;never arrived&rdquo; claim is very hard to answer, which is why it is worth adding tracking to everything.`)}
  <p class="fine">Before you fight it, consider writing to the buyer: a refund or a replacement usually costs less than a lost dispute, and a withdrawn dispute costs nothing. Banks never read links, so attach files rather than pointing at pages.</p>`;
}
