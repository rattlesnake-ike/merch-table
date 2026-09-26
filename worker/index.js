// The only server code in the store. Runs on Cloudflare Workers, in front of the static files.
// Routes: POST /api/checkout · GET /api/session · GET /api/stock · POST /api/restock · POST /api/webhook · GET /api/wants
import store from "../store.json" with { type: "json" };
import products from "../products.json" with { type: "json" };
import { isLive, variantAvailable, variantPrice, regionFor, fmtDate, validate } from "../src/lib.mjs";
import { handleAdmin } from "./admin.js";

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const bad = (error, status = 400, extra = {}) => json({ error, ...extra }, status);

/** The catalogue the store is actually selling: the band's live edits if any, else the built file. */
async function liveProducts(env) {
  if (!env.STOCK) return products;
  try {
    const raw = await env.STOCK.get("catalogue");
    if (!raw) return products;
    const edited = JSON.parse(raw);
    return Array.isArray(edited) && edited.length ? edited : products;
  } catch { return products; }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
        const live = await liveProducts(env);
        const save = async (next, who, what) => {
          const errs = validate(store, next);
          if (errs.length) return { ok: false, error: errs[0] };
          if (!env.STOCK) return { ok: false, error: "This store has no storage for live edits yet. Create a KV namespace called STOCK (the README says how), or edit products.json and push." };
          await env.STOCK.put("catalogue", JSON.stringify(next));
          const log = JSON.parse((await env.STOCK.get("editlog")) ?? "[]");
          log.unshift({ at: new Date().toISOString(), who, what });
          await env.STOCK.put("editlog", JSON.stringify(log.slice(0, 200)));
          return { ok: true };
        };
        return await handleAdmin(req, env, url, store, live, save, null);
      }
      // A page the band has edited is patched on the way out, so a save shows at once.
      if (env.STOCK && (url.pathname === "/" || /^\/products\/[^/]+\/?$/.test(url.pathname))) return await patchPage(req, env, url, await liveProducts(env));
      if (url.pathname === "/api/checkout" && req.method === "POST") return await checkout(req, env, url, await liveProducts(env));
      if (url.pathname === "/api/catalogue") return json({ products: await liveProducts(env) });
      if (url.pathname === "/api/session" && req.method === "GET") return await session(env, url);
      if (url.pathname === "/api/stock" && req.method === "GET") return await stock(env, url, await liveProducts(env));
      if (url.pathname === "/api/restock" && req.method === "POST") return await restock(req, env, await liveProducts(env));
      if (url.pathname === "/api/webhook" && req.method === "POST") return await webhook(req, env);
      if (url.pathname === "/api/wants" && req.method === "GET") return await wants(env, url);
      if (url.pathname === "/api/setup") return await setup(env, url);
      if (url.pathname === "/api/health") return json({ ok: true, products: products.length, stripe: !!env.STRIPE_SECRET_KEY, live: (env.STRIPE_SECRET_KEY || "").startsWith("sk_live_"), stock: !!env.STOCK });
      return bad("Not found", 404);
    } catch (e) {
      if (e instanceof StripeError) return bad(e.message, e.status);
      console.error(e);
      return bad("Something went wrong on our side. Try again in a moment.", 500);
    }
  },
};

/* ---------- Serve a built page with the band's live edits patched in ---------- */
async function patchPage(req, env, url, live) {
  const res = await env.ASSETS.fetch(req);
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) return res;
  let html = await res.text();
  const fmt = (c) => new Intl.NumberFormat(store.locale ?? "en-US", { style: "currency", currency: store.currency.toUpperCase(), minimumFractionDigits: c % 100 === 0 ? 0 : 2 }).format(c / 100);
  const onProduct = url.pathname.match(/^\/products\/([^/]+)\/?$/);

  if (onProduct) {
    const id = decodeURIComponent(onProduct[1]);
    const p = live.find((x) => x.id === id); const built = products.find((x) => x.id === id);
    if (p && built) {
      if (p.title !== built.title) html = html.split(escapeHtmlLite(built.title)).join(escapeHtmlLite(p.title));
      if (p.price !== built.price) {
        html = html.split(`data-price="${built.price}"`).join(`data-price="${p.price}"`);
        html = html.split(`<span data-price-display>${fmt(built.price)}</span>`).join(`<span data-price-display>${fmt(p.price)}</span>`);
        for (const v of built.variants) { const bp = v.price ?? built.price, np = (p.variants.find((x) => x.id === v.id) ?? {}).price ?? p.price; if (bp !== np) html = html.split(`data-variant="${v.id}" data-price="${bp}"`).join(`data-variant="${v.id}" data-price="${np}"`); }
      }
      if ((p.description ?? "") !== (built.description ?? "") && built.description) {
        const rebuilt = (p.description ?? "").split(/\n\n+/).map((x) => `<p>${escapeHtmlLite(x).replace(/\n/g, "<br>")}</p>`).join("");
        const oldBlock = built.description.split(/\n\n+/).map((x) => `<p>${escapeHtmlLite(x).replace(/\n/g, "<br>")}</p>`).join("");
        html = html.split(oldBlock).join(rebuilt);
      }
    }
  } else {
    // Front page: rebuild each card's price line from the live data, and drop a hidden card.
    const cardPrice = (p) => {
      const lows = p.variants.map((v) => v.price ?? p.price);
      const lo = Math.min(...lows), hi = Math.max(...lows);
      return lo === hi ? fmt(lo) : `from ${fmt(lo)}`;
    };
    for (const p of live) {
      const built = products.find((x) => x.id === p.id); if (!built) continue;
      const before = cardPrice(built), after = cardPrice(p);
      if (before !== after) {
        const re = new RegExp(`(href="/products/${escapeRe(p.id)}/"[\\s\\S]{0,400}?<span class="price">)${escapeRe(before)}(</span>)`);
        html = html.replace(re, (_m, a, b) => a + after + b);
      }
      if (p.title !== built.title) html = html.replace(new RegExp(`(href="/products/${escapeRe(p.id)}/"[\\s\\S]{0,300}?<span class="t">)${escapeRe(escapeHtmlLite(built.title))}(</span>)`), (_m, a, b) => a + escapeHtmlLite(p.title) + b);
      const soldOutNow = !p.variants.some((v) => v.available !== false);
      if (soldOutNow && built.variants.some((v) => v.available !== false)) {
        html = html.replace(new RegExp(`<a class="card"( [^>]*)?href="/products/${escapeRe(p.id)}/"`), (_m, a) => `<a class="card sold"${a ?? " "}href="/products/${p.id}/"`);
        html = html.replace(new RegExp(`(href="/products/${escapeRe(p.id)}/"[\\s\\S]{0,400}?<span class="price">[^<]*</span>)(</span>)`), (_m, a, b) => `${a}<span class="flag">Sold out</span>${b}`);
      }
      if (p.hidden && !built.hidden) html = html.replace(new RegExp(`<a class="card[^"]*"[^>]*href="/products/${escapeRe(p.id)}/"[\\s\\S]*?</a>`), "");
    }
  }

  // The front-end already asks /api/stock for sold-out sizes; tell it the edited ones too.
  if (onProduct) {
    const p = live.find((x) => x.id === decodeURIComponent(onProduct[1]));
    if (p) {
      const gone = p.variants.filter((v) => v.available === false).map((v) => v.id);
      html = html.replace("</head>", `<script>window.__soldOut=${JSON.stringify(gone)};window.__hidden=${p.hidden ? "true" : "false"}</script></head>`);
    }
  }
  return new Response(html, { status: res.status, headers: { ...Object.fromEntries(res.headers), "cache-control": "no-store" } });
}

/* ---------- GET /api/setup : is this store actually ready to take money? ---------- */
async function setup(env, url) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const k = env.STRIPE_SECRET_KEY;
  const problem = keyProblem(k);
  add("Stripe key", !problem, problem ? problem : `Looks right (${k.startsWith("sk_live_") ? "LIVE mode: real cards will be charged" : "test mode: use card 4242 4242 4242 4242"}).`);
  if (!problem) {
    try {
      const acct = await stripe(env, "GET", "/account");
      add("Stripe account", true, `Connected to ${acct.business_profile?.name || acct.email || acct.id}. Charges ${acct.charges_enabled ? "are enabled" : "are NOT enabled yet \u2014 finish activating the account in Stripe"}.`);
      add("Payouts", !!acct.payouts_enabled, acct.payouts_enabled ? "Stripe can pay you out." : "Add your bank details in Stripe before going live.");
    } catch (e) { add("Stripe account", false, e.message); }
  }
  add("Site address", !!env.SITE_URL, env.SITE_URL ? `Fans return to ${env.SITE_URL} after paying. This must be the address they actually use.` : "SITE_URL is not set, so Stripe may send fans to the wrong place after paying.");
  add("Stock counting", !!env.STOCK, env.STOCK ? "On: sold-out sizes update themselves as orders come in." : "Off (optional). Sizes are sold out only when you mark them so. To turn it on, create a KV namespace called STOCK.");
  add("Order webhook", !!env.STRIPE_WEBHOOK_SECRET, env.STRIPE_WEBHOOK_SECRET ? "Set: Stripe tells the store when an order is paid." : "Not set (optional). Only needed for stock counting.");
  add("Back-in-stock list", !!env.ADMIN_KEY, env.ADMIN_KEY ? "You can download it from /api/wants?key=\u2026" : "ADMIN_KEY is not set, so the list can't be downloaded.");
  const ready = checks.filter((c) => ["Stripe key", "Stripe account", "Site address"].includes(c.name)).every((c) => c.ok);
  if (url.searchParams.get("format") === "json") return json({ ready, checks });
  const rows = checks.map((c) => `<tr><td>${c.ok ? "\u2713" : "\u2717"}</td><td><b>${c.name}</b></td><td>${c.detail}</td></tr>`).join("");
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Store setup</title><style>body{font:16px/1.5 ui-sans-serif,system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#141416}h1{font-size:1.6rem}table{border-collapse:collapse;width:100%}td{padding:.6rem .5rem;border-bottom:1px solid #ddd;vertical-align:top}td:first-child{font-size:1.2rem;width:1.6rem}.r{padding:1rem;background:${ready ? "#e8f5e9" : "#fff3e0"};border:1px solid #ccc;margin:1rem 0}</style><h1>Store setup</h1><div class="r"><b>${ready ? "Ready to take orders." : "Not ready yet \u2014 see below."}</b></div><table>${rows}</table><p style="color:#666">This page is only useful to you. It shows no customer data and no keys. Nobody is told you looked.</p>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/* ---------- Stripe, by plain HTTPS. No SDK to install or update. ---------- */
export function form(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" ? form(x, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === "object") form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}
export function keyProblem(k) {
  if (!k) return "the store has no Stripe key yet. Put your Stripe SECRET key (it starts with sk_test_ or sk_live_) in the STRIPE_SECRET_KEY setting.";
  if (k.startsWith("pk_")) return "the PUBLISHABLE key was pasted instead of the secret one. In Stripe go to Developers \u2192 API keys, click Reveal on the Secret key, and copy the value starting sk_test_ or sk_live_ into STRIPE_SECRET_KEY.";
  if (k.startsWith("rk_")) return "a restricted key was used. It needs permission to write Checkout Sessions, or use the full secret key (sk_test_ or sk_live_).";
  if (k.startsWith("whsec_")) return "the webhook signing secret was pasted into STRIPE_SECRET_KEY. The secret key starts with sk_test_ or sk_live_; whsec_ belongs in STRIPE_WEBHOOK_SECRET.";
  if (!k.startsWith("sk_")) return "that doesn't look like a Stripe secret key. It should start with sk_test_ or sk_live_.";
  if (k.length < 40) return "the secret key looks cut short, as if the paste was incomplete. Copy the whole value from Stripe.";
  return null;
}

async function stripe(env, method, path, body) {
  const problem = keyProblem(env.STRIPE_SECRET_KEY);
  if (problem) throw new StripeError(`Checkout isn't connected yet: ${problem}`, 503);
  const res = await fetch(`https://api.stripe.com/v1${path}`, { method, headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded", "stripe-version": "2025-08-27.basil" }, body: body ? form(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("stripe", res.status, JSON.stringify(j.error ?? j));
    if (res.status === 401) throw new StripeError("Checkout isn't connected yet: Stripe rejected this key. Copy the Secret key again from Stripe \u2192 Developers \u2192 API keys (click Reveal), and make sure you're looking at the same account and the same test/live mode as the store. Check it at /api/setup.", 503);
    throw new StripeError("The payment page couldn't be opened. Try again in a moment.", 502);
  }
  return j;
}
class StripeError extends Error { constructor(m, status) { super(m); this.status = status; } }

/* ---------- Stock (optional KV). sold:<product>:<variant> = number sold so far. ---------- */
const soldKey = (p, v) => `sold:${p}:${v}`;
async function soldCount(env, p, v) { if (!env.STOCK) return 0; return Number((await env.STOCK.get(soldKey(p, v))) ?? 0); }

/* ---------- POST /api/checkout ---------- */
async function checkout(req, env, url, products) {
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.items) || !body.items.length) return bad("The cart is empty.");
  if (body.items.length > 50) return bad("That's too many lines for one order. Split it in two.");
  const region = regionFor(store, String(body.country || ""));
  if (!region) return bad("We don't ship there yet. Write to us and we'll see what we can do.");
  const now = Date.now();
  const lines = []; const soldOut = []; const meta = []; let subtotal = 0; let shipDate = null;
  for (const it of body.items) {
    const p = products.find((x) => x.id === it.product); const v = p?.variants.find((x) => x.id === it.variant);
    if (!p || !v) return bad("Something in the cart isn't on the table any more. Remove it and try again.");
    const qty = Math.max(1, Math.min(10, Number(it.qty) || 1));
    if (!isLive(p, now)) return bad(`${p.title} isn't on sale yet.`);
    const sold = await soldCount(env, p.id, v.id);
    if (!variantAvailable(v, sold) || (typeof v.stock === "number" && v.stock - sold < qty)) { soldOut.push({ product: p.id, variant: v.id, title: `${p.title}${p.variants.length > 1 ? ` (${v.title})` : ""}` }); continue; }
    const price = variantPrice(p, v); subtotal += price * qty;
    if (p.ship_date && (!shipDate || p.ship_date > shipDate)) shipDate = p.ship_date;
    const name = p.variants.length > 1 ? `${p.title} — ${v.title}` : p.title;
    lines.push({ quantity: qty, adjustable_quantity: { enabled: true, minimum: 1, maximum: 10 }, price_data: { currency: store.currency, unit_amount: price, product_data: { name, ...(p.ship_date ? { description: `Pre-order: ships ${fmtDate(p.ship_date, store.locale)}` } : {}), ...(p.images?.[0] && /^https?:/.test(p.images[0]) ? { images: [p.images[0]] } : p.images?.[0] ? { images: [`${env.SITE_URL}/${p.images[0]}`] } : {}), metadata: { product: p.id, variant: v.id } } } });
    meta.push(`${p.id}:${v.id}:${qty}`);
  }
  if (soldOut.length) return bad(`Sold out while it sat in the cart: ${soldOut.map((s) => s.title).join(", ")}. It's been taken out; the rest is still there.`, 409, { soldOut });
  const free = region.free_over && subtotal >= region.free_over;
  const site = (env.SITE_URL || url.origin).replace(/\/$/, "");
  const s = await stripe(env, "POST", "/checkout/sessions", {
    mode: "payment",
    line_items: lines,
    success_url: `${site}/thanks/?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/cart/`,
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    shipping_address_collection: { allowed_countries: region.countries },
    shipping_options: [{ shipping_rate_data: { type: "fixed_amount", display_name: free ? `${region.name}: free shipping` : region.name, fixed_amount: { amount: free ? 0 : region.amount, currency: store.currency }, ...(region.estimate ? { metadata: { estimate: region.estimate } } : {}) } }],
    ...(store.phone_at_checkout ? { phone_number_collection: { enabled: true } } : {}),
    ...(store.tax?.automatic ? { automatic_tax: { enabled: true } } : {}),
    ...(shipDate ? { custom_text: { submit: { message: `Pre-order: your order ships ${fmtDate(shipDate, store.locale)}.` } } } : {}),
    payment_intent_data: { description: `${store.name} order`, metadata: { items: meta.join(",") } },
    metadata: { items: meta.join(","), region: region.id },
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
  const b = await req.json().catch(() => null);
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
  if (!env.STRIPE_WEBHOOK_SECRET) return bad("Webhook secret not set.", 503);
  const sig = req.headers.get("stripe-signature") ?? "";
  const t = sig.match(/(?:^|,)t=(\d+)/)?.[1]; const v1s = [...sig.matchAll(/(?:^|,)v1=([a-f0-9]+)/g)].map((m) => m[1]);
  if (!t || !v1s.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return bad("Bad signature.", 400);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!v1s.some((v) => timingSafeEqual(v, mac))) return bad("Bad signature.", 400);
  const products = await liveProducts(env);
  const ev = JSON.parse(raw);
  if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
    const s = ev.data.object;
    if (s.payment_status === "paid" && env.STOCK) {
      const done = await env.STOCK.get(`order:${s.id}`); // idempotent: Stripe retries
      if (!done) {
        for (const part of String(s.metadata?.items ?? "").split(",").filter(Boolean)) {
          const [p, v, q] = part.split(":");
          const prod = products.find((x) => x.id === p); const variant = prod?.variants.find((x) => x.id === v);
          const targets = prod?.bundle ? prod.bundle.map((b) => [b.product, b.variant === "*" ? v : b.variant]) : [[p, v]];
          if (typeof variant?.stock === "number") targets.push([p, v]);
          for (const [tp, tv] of targets) { const k = soldKey(tp, tv); await env.STOCK.put(k, String(Number((await env.STOCK.get(k)) ?? 0) + Number(q || 1))); }
        }
        await env.STOCK.put(`order:${s.id}`, "1", { expirationTtl: 60 * 60 * 24 * 30 });
      }
    }
  }
  return json({ received: true });
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escapeHtmlLite = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0;
}
