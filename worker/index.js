// The only server code in the store. Runs on Cloudflare Workers, in front of the static files.
// It renders every page from store.json + products.json + the band's live edits, and answers:
// POST /api/checkout · GET /api/session · GET /api/stock · POST /api/restock · POST /api/webhook · GET /api/wants · /api/setup
// plus /admin (the band), /orders (a buyer's lookup), /tickets (a fan's tickets) and /img (uploaded pictures).
import { isLive, variantAvailable, variantPrice, regionFor, fmtDate, merchJson, lookCss } from "../src/lib.mjs";
import { indexPage, productPage, cartPage, thanksPage, shippingPage, notFoundPage, rss, sitemap } from "../src/templates.mjs";
import { handleAdmin, currentAdmin, timingSafeEqual } from "./admin.js";
import { recordOrder, ordersForEmail, orderRows } from "./orders.js";
import { paymentUri, qrSvg, COINS } from "./coins.js";
import { isTicket, ticketsForOrder, ticketHtml, usedAt, showOver, showOff } from "./tickets.js";
import { liveProducts, liveStore, siteOf, serveImage, webhookSecret, sessionSecret, builtProducts, freshHint } from "./live.js";
import { stripe, keyProblem, form, StripeError } from "./stripe.js";
import { setupChecks } from "./setup.js";
export { stripe, keyProblem, form, StripeError };

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const bad = (error, status = 400, extra = {}) => json({ error, ...extra }, status);
const html = (body, status = 200, headers = {}) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", ...headers } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      // A product or section address without its slash gets one, so old links and typed ones both land.
      if (/^\/(products\/[^/]+|cart|thanks|shipping)$/.test(url.pathname)) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
      if (url.pathname.startsWith("/img/")) return (await serveImage(env, url)) ?? bad("Not found", 404);
      // Deliberately says nothing about the band's Stripe account: this is world-readable.
      if (url.pathname === "/api/health") return json({ ok: true, products: builtProducts.filter((p) => !p.hidden).length });
      if (url.pathname === "/api/webhook" && req.method === "POST") return await webhook(req, env);

      // The browser that just saved something carries the version it wrote, so it reads its own change.
      const hint = freshHint(req);
      const store = await liveStore(env, hint);
      const products = await liveProducts(env, hint);
      store.siteUrl = siteOf(env, url);

      if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) return await handleAdmin(req, env, url, store, products, hint);

      // The pages, rendered from what is on sale right now.
      if (url.pathname === "/") return html(indexPage(store, products));
      const onProduct = url.pathname.match(/^\/products\/([^/]+)\/$/);
      if (onProduct) {
        const p = products.find((x) => x.id === decodeURIComponent(onProduct[1]));
        return p ? html(productPage(store, p, products)) : html(notFoundPage(store, products), 404);
      }
      if (url.pathname === "/cart/") return html(cartPage(store, products));
      if (url.pathname === "/thanks/") return html(thanksPage(store, products));
      if (url.pathname === "/shipping/") return html(shippingPage(store, products));
      if (url.pathname === "/site.css") return await styles(req, env, store);
      if (url.pathname === "/merch.json") return new Response(JSON.stringify(merchJson(store, products, store.siteUrl), null, 1), { headers: { "content-type": "application/json", "cache-control": "public, max-age=600" } });
      if (url.pathname === "/feed.xml") return new Response(rss(store, products), { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=600" } });
      if (url.pathname === "/sitemap.xml") return new Response(sitemap(store, products), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
      if (url.pathname === "/robots.txt") return new Response(`User-agent: *\nAllow: /\nDisallow: /cart/\nDisallow: /thanks/\nDisallow: /admin\nSitemap: ${store.siteUrl}/sitemap.xml\n`, { headers: { "content-type": "text/plain", "cache-control": "public, max-age=3600" } });

      if (url.pathname === "/api/checkout" && req.method === "POST") return await checkout(req, env, url, store, products);
      // Paying the band directly, no processor. Only exists if the band put an address in
      // store.json; otherwise the route is simply not there.
      if (url.pathname === "/api/coin" && req.method === "POST") return await coinRequest(req, env, url, store, products);
      if (url.pathname === "/orders" || url.pathname === "/orders/") return await lookup(req, env, url, store);
      if (url.pathname.startsWith("/tickets")) return await ticketsPage(req, env, url, store, products);
      if (url.pathname === "/api/catalogue") return json({ products: products.filter((p) => !p.hidden && isLive(p)) });
      if (url.pathname === "/api/session" && req.method === "GET") return await session(env, url);
      if (url.pathname === "/api/stock" && req.method === "GET") return await stock(env, url, products);
      if (url.pathname === "/api/restock" && req.method === "POST") return await restock(req, env, products);
      if (url.pathname === "/api/wants" && req.method === "GET") return await wants(env, url);
      if (url.pathname === "/api/setup") return await setup(req, env, url, store);
      if (url.pathname.startsWith("/api/")) return bad("Not found", 404);
      // Everything else is a static file: images, the script, fonts, anything in ./public.
      const asset = await env.ASSETS.fetch(req);
      if (asset.status === 404 && (asset.headers.get("content-type") ?? "").includes("text/html")) return html(notFoundPage(store, products), 404);
      return asset;
    } catch (e) {
      if (e instanceof StripeError) return bad(e.message, e.status);
      console.error(e);
      return bad("Something went wrong on our side. Try again in a moment.", 500);
    }
  },
};

/* ---------- /site.css : the built stylesheet with the band's live look appended ---------- */
async function styles(req, env, store) {
  const res = await env.ASSETS.fetch(new Request(new URL("/site.css", req.url), { method: "GET" }));
  const base = res.ok ? await res.text() : "";
  const { tail } = lookCss(store);
  return new Response(base + tail, { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=300" } });
}

/* ---------- /orders : a buyer finding their own order ----------
   Email only. It proves nothing on its own, so this shows only what a receipt would have
   shown them anyway, and never an address or a phone number. The point is that a confused
   buyer reaches the band instead of their bank. */
async function lookup(req, env, url, store) {
  const page = (body, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Your order · ${escapeHtmlLite(store.name)}</title><link rel="stylesheet" href="/site.css"></head><body><div class="top"><a class="wm" href="/">${escapeHtmlLite(store.name)}</a></div><main class="prose" style="padding:0 20px">${body}</main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });

  const help = `<p>Can't find it, or something's wrong with the order? Write to <a href="mailto:${escapeHtmlLite(store.email ?? "")}">${escapeHtmlLite(store.email ?? "the band")}</a> and a person will answer. Please do that before asking your bank: we can fix it, and a bank dispute takes months and costs us both.</p>`;

  if (req.method !== "POST") return page(`<h1>Your order</h1><p class="lede">Type the email you paid with and we'll show you where it is.</p><form method="post" class="restock"><div><input type="email" name="email" required placeholder="you@example.com" autocomplete="email" aria-label="Your email"><button class="btn" type="submit">Find it</button></div></form>${help}`);

  if (Number(req.headers.get("content-length") ?? 0) > 2048) return page(`<h1>Try again</h1>`, 413);
  const form = await req.formData();
  const email = String(form.get("email") ?? "");
  const orders = await ordersForEmail(env, email);
  if (!orders.length) return page(`<h1>Nothing under that address</h1><p class="lede">We can't find an order for <b>${escapeHtmlLite(email)}</b>. It may have been placed with a different email, or the payment may not have gone through.</p>${help}`);
  return page(`<h1>Your order${orders.length > 1 ? "s" : ""}</h1><div class="tbl"><table><thead><tr><th>What</th><th class="num">Paid</th><th>Where it is</th></tr></thead><tbody>${orderRows(orders, store, { forBand: false })}</tbody></table></div>${help}`);
}

/* ---------- /tickets : the fan's tickets, kept on their phone ---------- */
async function ticketsPage(req, env, url, store, live) {
  const css = `<style>
  body{font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;margin:0;background:#141416;color:#fff;padding:18px}
  main{max-width:30rem;margin:0 auto}
  h1{font-size:1.4rem;margin:.2rem 0 1rem}
  .tkt{background:#fff;color:#141416;border-radius:14px;padding:20px;margin:0 0 16px;text-align:center}
  .tkt.changed{border:3px solid #b3261e}
  .tkt .off,.tkt .moved{border-radius:10px;padding:12px;margin:0 0 14px;text-align:left;font-size:.95rem;line-height:1.45}
  .tkt .off{background:#fde7e5;color:#5f1a17}
  .tkt .moved{background:#fff4d6;color:#5b4708}
  .tkt .who{font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;margin:0;color:#666}
  .tkt h2{font-size:1.3rem;margin:.3rem 0}
  .tkt .where,.tkt .when{margin:.2rem 0;font-size:.95rem}
  .tkt .when{font-weight:600}
  .tkt .code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:2.4rem;letter-spacing:.12em;margin:.6rem 0 .2rem;font-weight:700}
  .tkt .holder{margin:0;color:#666;font-size:.9rem}
  .tkt.used{opacity:.55}
  .tkt .stamp{margin:.5rem 0 0;color:#b3261e;font-weight:700;text-transform:uppercase;font-size:.8rem;letter-spacing:.06em}
  form input,form button{font:inherit;padding:12px;border-radius:8px;border:1.5px solid #555;background:#1e1e22;color:#fff;width:100%;margin:6px 0}
  form button{background:#fff;color:#141416;font-weight:700;border-color:#fff;cursor:pointer}
  .fine{color:#aaa;font-size:.88rem}
  a{color:#9ab6ff}
  </style>`;
  const page = (body, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Tickets · ${escapeHtmlLite(store.name)}</title>${css}</head><body><main>${body}</main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });

  if (req.method !== "POST") return page(`<h1>Your tickets</h1><p class="fine">Type the email you bought them with. Save this page to your phone before you leave for the show, so you have it if there's no signal at the door.</p><form method="post"><input type="email" name="email" required placeholder="you@example.com" autocomplete="email" aria-label="Your email"><button type="submit">Show my tickets</button></form>`);

  if (Number(req.headers.get("content-length") ?? 0) > 2048) return page(`<h1>Try again</h1>`, 413);
  const form = await req.formData();
  const orders = await ordersForEmail(env, form.get("email"));
  const out = [];
  for (const o of orders) for (const t of await ticketsForOrder(env, o, live)) out.push({ t, o, used: await usedAt(env, o.id, t.seq) });
  if (!out.length) return page(`<h1>No tickets under that address</h1><p class="fine">They may have been bought with a different email. Write to <a href="mailto:${escapeHtmlLite(store.email ?? "")}">${escapeHtmlLite(store.email ?? "the band")}</a> and a person will sort it out.</p>`);
  return page(`<h1>Your ticket${out.length > 1 ? "s" : ""}</h1>${out.map(({ t, o, used }) => ticketHtml(t, o, store, used)).join("")}<p class="fine">Show the code at the door. Each one works once.</p>`);
}

/* ---------- GET /api/setup : the old address of the setup check. It lives in the admin now. ---------- */
async function setup(req, env, url, store) {
  // The setup page names the band's Stripe account and says whether real money is switched
  // on, so it is for the band, not the public: an owner session or the admin key.
  const key = url.searchParams.get("key") ?? "";
  const byKey = !!env.ADMIN_KEY && timingSafeEqual(key, env.ADMIN_KEY);
  const bySession = env.DEMO_ADMIN === "1" || (await currentAdmin(req, env, store).catch(() => null));
  if (!byKey && !bySession) return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Store setup</title><body style="font:16px/1.5 ui-sans-serif,system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1 style="font-size:1.4rem">This page is for whoever runs the store</h1><p>Sign in at <a href="/admin">/admin</a> and open Setup there, or add <code>?key=</code> and your admin password to this address.</p>`, { status: 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  if (url.searchParams.get("format") === "json") { const r = await setupChecks(env, url, store); return json({ ready: r.ready, checks: r.checks.map(({ name, ok, detail }) => ({ name, ok, detail })) }); }
  return Response.redirect(`${url.origin}/admin/setup${byKey && !bySession ? `?key=${encodeURIComponent(key)}` : ""}`, 302);
}

/* ---------- Paying the band's own wallet, if they set one up ---------- */

/**
 * Price the cart the same way checkout does, then hand back an address, an exact amount and a
 * QR code. The band confirms the money arrived; nothing here watches a chain, and the store
 * says so to the fan rather than implying it is tracking anything.
 */
async function coinRequest(req, env, url, store, products) {
  const wallets = store.wallets ?? {};
  const body = await req.json().catch(() => null);
  const coin = String(body?.coin ?? "");
  const address = wallets[coin];
  if (!address) return bad("This band doesn't take that one.", 404);
  if (!body || !Array.isArray(body.items) || !body.items.length) return bad("The cart is empty.");

  // Same server-side pricing as a card order: the browser never says what anything costs.
  let cents = 0;
  for (const it of body.items.slice(0, 50)) {
    const p = products.find((x) => x.id === it.product);
    const v = p?.variants.find((x) => x.id === it.variant);
    if (!p || !v || p.hidden || !isLive(p)) return bad("Something in the cart isn't on the table any more.");
    if (isTicket(p) && (showOver(p) || showOff(p))) return bad(`${p.show.title ?? p.title} isn't on sale.`);
    cents += variantPrice(p, v) * Math.max(1, Math.min(10, Number(it.qty) || 1));
  }
  if (!cents) return bad("The cart is empty.");

  // What the coin is worth, from a public price feed. If it can't be reached we refuse rather
  // than invent a rate — asking a fan for the wrong amount of money is worse than no option.
  const rate = await coinRate(coin, store.currency ?? "usd");
  if (!rate) return bad("Couldn't get a price for that right now. Try a card, or try again in a minute.", 503);

  const amount = Number((cents / 100 / rate).toFixed(COINS[coin].decimals));
  const uri = paymentUri(coin, address, amount);
  if (!uri) return bad("Couldn't build that payment request.", 500);

  return json({
    coin, label: COINS[coin].label, unit: COINS[coin].unit,
    address, amount, uri, qr: qrSvg(uri, 260),
    fiat: (cents / 100).toFixed(2), currency: (store.currency ?? "usd").toUpperCase(),
    // Said plainly, because a fan needs to know this is not instant.
    note: `Send exactly ${amount} ${COINS[coin].unit}. ${store.name} confirms it by hand once it lands, usually within a day. The price is held at today's rate for this order.`,
    email: store.email ?? null,
  });
}

/** A public price, with no account and no key. Refuses rather than guesses. */
async function coinRate(coin, currency) {
  const ids = { btc: "bitcoin", ada: "cardano", eth: "ethereum" };
  const id = ids[coin];
  if (!id) return null;
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=${encodeURIComponent(currency)}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json();
    const v = j?.[id]?.[currency];
    return typeof v === "number" && v > 0 ? v : null;
  } catch { return null; }
}

/* ---------- Stock (optional KV). sold:<product>:<variant> = number sold so far. ---------- */
const soldKey = (p, v) => `sold:${p}:${v}`;
async function soldCount(env, p, v) { if (!env.STOCK) return 0; return Number((await env.STOCK.get(soldKey(p, v))) ?? 0); }

/* ---------- POST /api/checkout ---------- */
async function checkout(req, env, url, store, products) {
  if (Number(req.headers.get("content-length") ?? 0) > 64 * 1024) return bad("That cart is too big to be real.", 413);
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.items) || !body.items.length) return bad("The cart is empty.");
  if (body.items.length > 50) return bad("That's too many lines for one order. Split it in two.");
  const region = regionFor(store, String(body.country || ""));
  if (!region) return bad("We don't ship there yet. Write to us and we'll see what we can do.");
  const now = Date.now();
  const site = store.siteUrl ?? siteOf(env, url);
  const lines = []; const soldOut = []; const meta = []; let subtotal = 0; let shipDate = null;
  for (const it of body.items) {
    const p = products.find((x) => x.id === it.product); const v = p?.variants.find((x) => x.id === it.variant);
    if (!p || !v) return bad("Something in the cart isn't on the table any more. Remove it and try again.");
    const qty = Math.max(1, Math.min(10, Number(it.qty) || 1));
    if (!isLive(p, now)) return bad(`${p.title} isn't on sale yet.`);
    // Hidden means not for sale. The page stays reachable on purpose, but a product id is
    // easy to find, and an unannounced record must not be buyable before the band says so.
    if (p.hidden) return bad("Something in the cart isn't on the table any more. Remove it and try again.");
    if (isTicket(p) && showOver(p, now)) return bad(`${p.show.title ?? p.title} has already happened.`);
    // Selling a ticket to a show that has been called off takes money for nothing. Refuse it here,
    // server-side, so no stale page or cached cart can put a fan through checkout for a dead night.
    if (isTicket(p) && showOff(p)) return bad(`${p.show.title ?? p.title} was called off, so it can't be bought.`);
    const sold = await soldCount(env, p.id, v.id);
    if (!variantAvailable(v, sold) || (typeof v.stock === "number" && v.stock - sold < qty)) { soldOut.push({ product: p.id, variant: v.id, title: `${p.title}${p.variants.length > 1 ? ` (${v.title})` : ""}` }); continue; }
    const price = variantPrice(p, v); subtotal += price * qty;
    if (p.ship_date && (!shipDate || p.ship_date > shipDate)) shipDate = p.ship_date;
    const name = p.variants.length > 1 ? `${p.title} — ${v.title}` : p.title;
    const image = p.images?.[0] ? (/^https?:/.test(p.images[0]) ? p.images[0] : `${site}/${p.images[0]}`) : null;
    lines.push({ quantity: qty, adjustable_quantity: { enabled: true, minimum: 1, maximum: 10 }, price_data: { currency: store.currency, unit_amount: price, product_data: { name, ...(p.ship_date ? { description: `Pre-order: ships ${fmtDate(p.ship_date, store.locale)}` } : {}), ...(image ? { images: [image] } : {}), metadata: { product: p.id, variant: v.id } } } });
    meta.push(`${p.id}:${v.id}:${qty}`);
  }
  if (soldOut.length) return bad(`Sold out while it sat in the cart: ${soldOut.map((s) => s.title).join(", ")}. It's been taken out; the rest is still there.`, 409, { soldOut });
  const free = region.free_over && subtotal >= region.free_over;
  // A ticket is collected at a door, not posted. A cart of nothing but tickets must not ask
  // for a shipping address or quote "3 to 7 business days" — that reads as a mistake to a fan
  // and makes the band look like they do not know what they are selling.
  const allTickets = body.items.every((it) => {
    const p = products.find((x) => x.id === it.product);
    return p && isTicket(p);
  });

  // A short, stable key for the buyer's network, so repeat customers can be recognised without
  // the store keeping anyone's IP. Two orders from the same person share it; it identifies nobody.
  const ip = req.headers.get("cf-connecting-ip") ?? "";
  const buyerKey = ip ? await shortHash(`${ip}|${(await sessionSecret(env)) ?? site}`) : "";
  const orderIndex = env.STOCK && buyerKey ? Number((await env.STOCK.get(`buyer:${buyerKey}`)) ?? 0) + 1 : 0;
  if (env.STOCK && buyerKey) await env.STOCK.put(`buyer:${buyerKey}`, String(orderIndex), { expirationTtl: 400 * 24 * 3600 });
  const evidence = {
    buyer: buyerKey,
    order_no: String(orderIndex),
    ordered_at: new Date(now).toISOString(),
    ip_country: req.headers.get("cf-ipcountry") ?? "",
    goods: lines.map((l) => l.price_data.product_data.name).join("; ").slice(0, 480),
    terms: `${site}/shipping/`,
    ...(shipDate ? { ships: shipDate } : {}),
  };
  const s = await stripe(env, "POST", "/checkout/sessions", {
    mode: "payment",
    line_items: lines,
    success_url: `${site}/thanks/?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/cart/`,
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    ...(allTickets ? {} : {
      shipping_address_collection: { allowed_countries: region.countries },
      shipping_options: [{ shipping_rate_data: { type: "fixed_amount", display_name: free ? `${region.name}: free shipping` : region.name, fixed_amount: { amount: free ? 0 : region.amount, currency: store.currency }, ...(region.estimate ? { metadata: { estimate: region.estimate } } : {}) } }],
    }),
    ...(store.phone_at_checkout ? { phone_number_collection: { enabled: true } } : {}),
    ...(store.tax?.automatic ? { automatic_tax: { enabled: true } } : {}),
    // What a bank wants to see if this is ever disputed. Written now because none of it can be
    // reconstructed months later: a product description, the terms the buyer was shown, and
    // the network the order came from. Visa's Compelling Evidence 3.0 also needs two earlier
    // undisputed orders sharing two of {IP, shipping address, device, account} — so the IP and
    // a buyer key go on every order, and `orderIndex` lets the band find the earlier ones.
    payment_intent_data: {
      description: `${store.name} order`,
      metadata: { items: meta.join(","), ...evidence },
      ...(store.statement_descriptor ? { statement_descriptor_suffix: String(store.statement_descriptor).slice(0, 22) } : {}),
    },
    metadata: { items: meta.join(","), region: region.id, ...evidence },
    ...(store.terms_url || store.email ? { custom_text: {
      ...(shipDate ? { submit: { message: `Pre-order: your order ships ${fmtDate(shipDate, store.locale)}.` } } : {}),
      terms_of_service_acceptance: { message: `By ordering you agree to our [shipping and returns terms](${site}/shipping/). Questions about an order: ${store.email ?? "the address on the store"}.` },
    }, consent_collection: { terms_of_service: "required" } } : {}),
    expires_at: Math.floor(now / 1000) + 60 * 60,
  });
  return json({ url: s.url });
}

/* ---------- GET /api/session?id= : what the fan sees on the thank-you page ---------- */
async function session(env, url) {
  const id = url.searchParams.get("id") || "";
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return bad("No such order.", 404);
  const s = await stripe(env, "GET", `/checkout/sessions/${id}?expand[]=line_items`);
  const items = (s.line_items?.data ?? []).map((l) => ({ description: l.description, quantity: l.quantity, amount: l.amount_total }));
  return json({ paid: s.payment_status === "paid", email: s.customer_details?.email ?? null, items, shipping: s.shipping_cost?.amount_total ?? null, total: s.amount_total });
}

/* ---------- GET /api/stock?product= : which variants the count says are gone ---------- */
async function stock(env, url, products) {
  const p = products.find((x) => x.id === url.searchParams.get("product"));
  if (!p) return bad("No such product.", 404);
  if (!env.STOCK) return json({ soldOut: [] }, 200);
  const soldOut = [];
  for (const v of p.variants) if (typeof v.stock === "number" && !variantAvailable(v, await soldCount(env, p.id, v.id))) soldOut.push(v.id);
  return json({ soldOut });
}

/* ---------- POST /api/restock : a fan wants a word if a size comes back ---------- */
async function restock(req, env, products) {
  if (Number(req.headers.get("content-length") ?? 0) > 4096) return bad("Too long.", 413);
  const b = await req.json().catch(() => null);
  if (env.STOCK) {
    const who = req.headers.get("cf-connecting-ip") ?? "unknown";
    const k = `rl:restock:${await shortHash(who)}`;
    const n = Number((await env.STOCK.get(k)) ?? 0) + 1;
    await env.STOCK.put(k, String(n), { expirationTtl: 3600 });
    if (n > 10) return bad("That's a lot of requests from one place. Try again later.", 429);
  }
  const email = String(b?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return bad("That doesn't look like an email address.");
  const p = products.find((x) => x.id === b?.product); if (!p) return bad("No such product.", 404);
  const v = p.variants.find((x) => x.id === b?.variant) ?? null;
  if (!env.STOCK) { console.log("restock request (no KV to keep it):", email, p.id, v?.id); return json({ ok: true }); }
  const key = `want:${p.id}:${v?.id ?? "*"}`;
  const list = JSON.parse((await env.STOCK.get(key)) ?? "[]");
  if (!list.some((x) => x.email === email)) list.push({ email, at: new Date().toISOString() });
  await env.STOCK.put(key, JSON.stringify(list.slice(-2000)));
  return json({ ok: true });
}

/* ---------- GET /api/wants?key=ADMIN_KEY : download the back-in-stock list as CSV ---------- */
async function wants(env, url) {
  if (!env.ADMIN_KEY || !timingSafeEqual(url.searchParams.get("key") ?? "", env.ADMIN_KEY)) return bad("No.", 401);
  if (!env.STOCK) return new Response("product,variant,email,at\n", { headers: { "content-type": "text/csv" } });
  const rows = ["product,variant,email,at"];
  let cursor;
  do { const l = await env.STOCK.list({ prefix: "want:", cursor }); for (const k of l.keys) { const [, p, v] = k.name.split(":"); for (const w of JSON.parse((await env.STOCK.get(k.name)) ?? "[]")) rows.push(`${p},${v},${w.email},${w.at}`); } cursor = l.list_complete ? null : l.cursor; } while (cursor);
  return new Response(rows.join("\n") + "\n", { headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=back-in-stock.csv" } });
}

/* ---------- POST /api/webhook : Stripe tells us an order was paid; we count it against stock ---------- */
async function webhook(req, env) {
  const raw = await req.text();
  const w = await webhookSecret(env);
  if (!w) return bad("Orders aren't connected yet: press Connect orders in the admin's Setup.", 503);
  const sig = req.headers.get("stripe-signature") ?? "";
  const t = sig.match(/(?:^|,)t=(\d+)/)?.[1]; const v1s = [...sig.matchAll(/(?:^|,)v1=([a-f0-9]+)/g)].map((m) => m[1]);
  if (!t || !v1s.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return bad("Bad signature.", 400);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(w.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!v1s.some((v) => timingSafeEqual(v, mac))) return bad("Bad signature.", 400);
  const products = await liveProducts(env);
  const ev = JSON.parse(raw);
  if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
    const s = ev.data.object;
    // Keep the order before anything else: this is the band's only record outside Stripe,
    // and it is what answers "where is my thing" without either side guessing.
    if (s.payment_status === "paid") await recordOrder(env, await stripe(env, "GET", `/checkout/sessions/${s.id}`).catch(() => s));
    if (s.payment_status === "paid" && env.STOCK) {
      const done = await env.STOCK.get(`order:${s.id}`); // idempotent: Stripe retries
      if (!done) {
        for (const part of String(s.metadata?.items ?? "").split(",").filter(Boolean)) {
          const [p, v, q] = part.split(":");
          const prod = products.find((x) => x.id === p); const variant = prod?.variants.find((x) => x.id === v);
          // A bundle takes stock off each of its parts, AND off the bundle itself when the
          // bundle counts its own stock. A plain product is counted once: pushing [p, v]
          // again here made every sale count twice, so a run of 500 sold out at 250.
          const targets = prod?.bundle ? prod.bundle.map((b) => [b.product, b.variant === "*" ? v : b.variant]) : [[p, v]];
          if (prod?.bundle && typeof variant?.stock === "number") targets.push([p, v]);
          for (const [tp, tv] of targets) { const k = soldKey(tp, tv); await env.STOCK.put(k, String(Number((await env.STOCK.get(k)) ?? 0) + Number(q || 1))); }
        }
        await env.STOCK.put(`order:${s.id}`, "1", { expirationTtl: 60 * 60 * 24 * 30 });
      }
    }
  }
  return json({ received: true });
}

const escapeHtmlLite = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** A short, one-way hash: a rate-limit bucket should not store anyone's address. */
async function shortHash(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
