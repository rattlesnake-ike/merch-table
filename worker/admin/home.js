/* Home: what needs the band today, in one screen. Orders to pack, money this month, what sold out,
   what is running low, what changed. Every number links to the place it is fixed. */
import { adminNav, html, page, money, escapeHtml, when, imgSrc, notice } from "./ui.js";
import { listOrders } from "../orders.js";
import { soldCounts, recentChanges, sampleIds, webhookSecret, PLACEHOLDER } from "../live.js";
import { keyProblem } from "../stripe.js";
import { variantAvailable } from "../../src/lib.mjs";

export async function homeScreen(req, env, url, store, products, me, demo, tok, hint) {
  const orders = demo ? demoOrders(store) : await listOrders(env, 300);
  const now = Date.now();
  const toPack = orders.filter((o) => o.status !== "shipped" && o.status !== "refunded" && o.paid !== false);
  const d30 = orders.filter((o) => now - new Date(o.at).getTime() < 30 * 864e5 && o.status !== "refunded");
  const d7 = d30.filter((o) => now - new Date(o.at).getTime() < 7 * 864e5);
  const revenue30 = d30.reduce((a, o) => a + (o.total ?? 0), 0);
  const sold = demo ? {} : await soldCounts(env, products);
  const low = [], gone = [];
  for (const p of products) {
    if (p.hidden) continue;
    for (const v of p.variants) {
      const n = sold[`${p.id}:${v.id}`] ?? 0;
      if (!variantAvailable(v, n)) gone.push({ p, v });
      else if (typeof v.stock === "number" && v.stock - n <= 3) low.push({ p, v, left: v.stock - n });
    }
  }
  const changes = demo ? [] : await recentChanges(env, 8);
  const todo = demo ? 0 : (keyProblem(env.STRIPE_SECRET_KEY) ? 1 : 0) + ((await webhookSecret(env, hint)) ? 0 : 1) + (!store.email || PLACEHOLDER.test(store.email) ? 1 : 0);
  const samples = sampleIds(products).length;
  const keyQ = me.byKey ? `?key=${encodeURIComponent(me.byKey)}` : "";
  const hidden = `<input type="hidden" name="_t" value="${tok}">${me.byKey ? `<input type="hidden" name="key" value="${escapeHtml(me.byKey)}">` : ""}`;
  const savedMsg = url.searchParams.get("saved");

  const packRow = (o) => `<a class="row" href="/admin/orders/${encodeURIComponent(o.id)}"><span class="meta"><b>${escapeHtml(o.goods || o.items)}</b><small>${escapeHtml(o.name ?? o.email ?? "")} · ${when(o.at, store)}${o.shipsOn ? ` · pre-order, ships ${escapeHtml(o.shipsOn)}` : ""}</small></span><span class="num mono">${money(o.total, store)}</span><span class="go">›</span></a>`;
  const stockRow = ({ p, v, left }) => `<a class="row" href="/admin/p/${encodeURIComponent(p.id)}"><span class="thumb">${p.images?.[0] ? `<img src="${imgSrc(p.images[0])}" alt="" loading="lazy">` : ""}</span><span class="meta"><b>${escapeHtml(p.title)}</b><small>${escapeHtml(v.title)}${left != null ? ` · ${left} left` : " · sold out"}</small></span><span class="go">›</span></a>`;

  return html(page(`${adminNav("/admin", null, store)}<main>
    <header class="bar"><h1>${escapeHtml(store.name)}</h1>${demo ? "" : `<a class="ghost" href="/admin/out">Sign out</a>`}</header>
    ${demo ? notice(`You're looking at the admin of a made-up band's store. Everything works except saving. <a href="https://github.com/rattlesnake-ike/merch-table">This is the store</a>.`) : ""}
    ${savedMsg ? notice(`Saved: ${escapeHtml(savedMsg)}. It's live for you now, and for everyone within a minute.`, "ok") : ""}
    ${todo ? notice(`<b>Setup isn't finished.</b> At least ${todo} thing${todo > 1 ? "s" : ""} to do before the store can take money: <a href="/admin/setup${keyQ}">see what</a>.`) : ""}
    ${!demo && samples ? `<form method="post" action="/admin/samples" class="inline">${hidden}${notice(`<b>${samples} made-up products</b> from the template are still on the table. Your own stay. <button type="submit" class="small">Remove the sample products</button>`)}</form>` : ""}
    <div class="cards">
      <a class="stat" href="/admin/orders"><b>${toPack.length}</b><span>to pack</span></a>
      <a class="stat" href="/admin/orders?show=all"><b>${d7.length}</b><span>orders, 7 days</span></a>
      <a class="stat" href="/admin/orders?show=all"><b>${money(revenue30, store)}</b><span>30 days</span></a>
      <a class="stat" href="/admin/products"><b>${products.filter((p) => !p.hidden).length}</b><span>on the table</span></a>
    </div>
    <div class="actions"><a class="btn" href="/admin/new">Add a product</a><a class="btn ghost" href="/admin/shows/new">Add a show</a><a class="btn ghost" href="/admin/import">Import</a></div>
    ${toPack.length ? `<h2>To pack</h2><div class="list">${toPack.slice(0, 6).map(packRow).join("")}</div>${toPack.length > 6 ? `<p class="fine"><a href="/admin/orders">All ${toPack.length} to pack</a></p>` : ""}` : `<h2>Orders</h2><p class="empty">Nothing to pack. ${orders.length ? "All caught up." : "Orders appear here the moment someone pays."}</p>`}
    ${gone.length || low.length ? `<h2>Stock</h2><div class="list">${[...low.map(stockRow), ...gone.slice(0, 8).map(({ p, v }) => stockRow({ p, v, left: null }))].join("")}</div>` : ""}
    ${changes.length ? `<h2>Recent changes</h2><ul class="log">${changes.map((c) => `<li>${escapeHtml(c.what)}<small>${escapeHtml(c.who)} · ${when(c.at, store, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</small></li>`).join("")}</ul>` : ""}
    <p class="fine">${demo ? "A look around: nothing here can be changed." : `Signed in as ${escapeHtml(me.email || "admin")}.`} Add this page to your phone's home screen and it opens like an app.</p>
  </main>`, store, { title: "Home" }));
}

/** A few pretend orders so the demo's home screen shows what the band would see. */
export function demoOrders(store) {
  const d = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  return [
    { id: "demo1", at: d(3), paid: true, total: 5300, currency: store.currency, email: "ana@example.com", name: "Ana Reyes", goods: "Dog logo tee — M; Harbor Lights cassette", items: "dog-logo-tee:m:1,harbor-lights-cassette:one:1", status: "to pack", ship: { address: { line1: "41-20 Skillman Ave", city: "Sunnyside", state: "NY", postal_code: "11104", country: "US" } } },
    { id: "demo2", at: d(26), paid: true, total: 2800, currency: store.currency, email: "tom@example.com", name: "Tom Okafor", goods: "Harbor Lights LP (sea-glass green)", items: "harbor-lights-lp:green:1", shipsOn: "2026-11-13", status: "to pack", ship: { address: { line1: "12 Rue Oberkampf", city: "Paris", postal_code: "75011", country: "FR" } } },
    { id: "demo3", at: d(70), paid: true, total: 4800, currency: store.currency, email: "lee@example.com", name: "Lee Park", goods: "Harbor Lights bundle: LP + tee — L", items: "harbor-lights-bundle:tee-l:1", status: "shipped", shippedAt: d(40), carrier: "USPS", tracking: "9400111899223197428490", ship: { address: { line1: "77 Ocean Pkwy", city: "Brooklyn", state: "NY", postal_code: "11218", country: "US" } } },
  ];
}
