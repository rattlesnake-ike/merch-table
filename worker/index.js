// The only server code in the store. Runs on Cloudflare Workers, in front of the static files.
// Routes: POST /api/checkout · GET /api/session · GET /api/stock · POST /api/restock · POST /api/webhook · GET /api/wants
import store from "../store.json" with { type: "json" };
import products from "../products.json" with { type: "json" };
import { isLive, variantAvailable, variantPrice, regionFor, fmtDate } from "../src/lib.mjs";

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const bad = (error, status = 400, extra = {}) => json({ error, ...extra }, status);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/api/checkout" && req.method === "POST") return await checkout(req, env, url);
      if (url.pathname === "/api/session" && req.method === "GET") return await session(env, url);
      if (url.pathname === "/api/stock" && req.method === "GET") return await stock(env, url);
      if (url.pathname === "/api/restock" && req.method === "POST") return await restock(req, env);
      if (url.pathname === "/api/webhook" && req.method === "POST") return await webhook(req, env);
      if (url.pathname === "/api/wants" && req.method === "GET") return await wants(env, url);
      if (url.pathname === "/api/health") return json({ ok: true, products: products.length, stripe: !!env.STRIPE_SECRET_KEY, live: (env.STRIPE_SECRET_KEY || "").startsWith("sk_live_"), stock: !!env.STOCK });
      return bad("Not found", 404);
    } catch (e) {
      if (e instanceof StripeError) return bad(e.message, e.status);
      console.error(e);
      return bad("Something went wrong on our side. Try again in a moment.", 500);
    }
  },
};

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
async function stripe(env, method, path, body) {
  if (!env.STRIPE_SECRET_KEY) throw new StripeError("Checkout isn't connected yet: the store has no Stripe key.", 503);
  const res = await fetch(`https://api.stripe.com/v1${path}`, { method, headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded", "stripe-version": "2025-08-27.basil" }, body: body ? form(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { console.error("stripe", res.status, JSON.stringify(j.error ?? j)); throw new StripeError(j.error?.type === "invalid_request_error" && /api key/i.test(j.error?.message ?? "") ? "Checkout isn't connected yet: the Stripe key is wrong." : "The payment page couldn't be opened. Try again in a moment.", 502); }
  return j;
}
class StripeError extends Error { constructor(m, status) { super(m); this.status = status; } }

/* ---------- Stock (optional KV). sold:<product>:<variant> = number sold so far. ---------- */
const soldKey = (p, v) => `sold:${p}:${v}`;
async function soldCount(env, p, v) { if (!env.STOCK) return 0; return Number((await env.STOCK.get(soldKey(p, v))) ?? 0); }

/* ---------- POST /api/checkout ---------- */
async function checkout(req, env, url) {
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
async function stock(env, url) {
  const p = products.find((x) => x.id === url.searchParams.get("product"));
  if (!p) return bad("No such product.", 404);
  if (!env.STOCK) return json({ soldOut: [] }, 200);
  const soldOut = [];
  for (const v of p.variants) if (typeof v.stock === "number" && !variantAvailable(v, await soldCount(env, p.id, v.id))) soldOut.push(v.id);
  return json({ soldOut });
}

/* ---------- POST /api/restock : a fan wants a word if a size comes back ---------- */
async function restock(req, env) {
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

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0;
}
