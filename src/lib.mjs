// Shared helpers: used by the build (Node) and the Worker (Cloudflare). No dependencies.

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Money in the store's currency, from an integer amount in the smallest unit (cents). */
export function money(cents, currency = "usd", locale = "en-US") {
  return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

export function fmtDate(iso, locale = "en-US") {
  const d = new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso);
  return d.toLocaleDateString(locale, { month: "long", day: "numeric", year: "numeric", timeZone: iso.length === 10 ? "UTC" : undefined });
}

/** A variant's price: its own, else the product's. */
export const variantPrice = (p, v) => (v && v.price != null ? v.price : p.price);

/** Is the product on sale yet? (drops) */
export const isLive = (p, now = Date.now()) => !p.live_at || new Date(p.live_at).getTime() <= now;

/** Is anything in stock? A numeric stock of 0 or an explicit available:false means sold out. */
export function variantAvailable(v, sold = 0) {
  if (v.available === false) return false;
  if (typeof v.stock === "number") return v.stock - sold > 0;
  return true;
}

/** Find the shipping region for a country code. */
export const regionFor = (store, country) => store.shipping.find((r) => r.countries.includes(country));

/** Every country the store ships to. */
export const allCountries = (store) => [...new Set(store.shipping.flatMap((r) => r.countries))];

/** The merch.json feed: a plain description of the table any reader can use. */
export function merchJson(store, products, siteUrl, now = new Date()) {
  return {
    version: 1,
    store: { name: store.name, url: siteUrl, bands: [store.name] },
    items: products.filter((p) => isLive(p, now.getTime())).map((p) => ({
      id: p.id,
      title: p.title,
      url: `${siteUrl}/products/${p.id}/`,
      price: (p.price / 100).toFixed(2),
      currency: store.currency.toUpperCase(),
      kind: p.kind ?? "other",
      available: p.variants.some((v) => variantAvailable(v)),
      variants: p.variants.map((v) => ({ id: v.id, title: v.title, available: variantAvailable(v), ...(v.price != null ? { price: (v.price / 100).toFixed(2) } : {}) })),
      image: p.images?.[0] ? `${siteUrl}/${p.images[0]}` : undefined,
      published: p.published,
      ...(p.ship_date ? { ships: p.ship_date } : {}),
    })),
    updated: now.toISOString(),
  };
}

/** Validate store.json and products.json; returns a list of problems (empty = fine). */
export function validate(store, products) {
  const errs = [];
  const need = (c, m) => { if (!c) errs.push(m); };
  need(store && typeof store.name === "string" && store.name, "store.json: name is required");
  need(/^[a-z]{3}$/.test(store?.currency ?? ""), "store.json: currency must be a three-letter code in lowercase, like usd");
  need(Array.isArray(store?.shipping) && store.shipping.length, "store.json: at least one shipping region");
  for (const r of store?.shipping ?? []) {
    need(r.id && r.name && Array.isArray(r.countries) && r.countries.length, `store.json: shipping region ${r.id ?? "?"} needs id, name and countries`);
    need(Number.isInteger(r.amount) && r.amount >= 0, `store.json: shipping ${r.id}: amount must be a whole number of cents`);
    for (const c of r.countries ?? []) need(/^[A-Z]{2}$/.test(c), `store.json: shipping ${r.id}: country ${c} must be a two-letter code`);
  }
  const seenCountry = new Set();
  for (const r of store?.shipping ?? []) for (const c of r.countries ?? []) { need(!seenCountry.has(c), `store.json: country ${c} is in two shipping regions`); seenCountry.add(c); }
  need(Array.isArray(products), "products.json must be a list");
  const ids = new Set();
  for (const p of products ?? []) {
    need(/^[a-z0-9-]+$/.test(p.id ?? ""), `product ${p.id ?? p.title}: id must be lowercase letters, digits and dashes (it becomes the URL)`);
    need(!ids.has(p.id), `product ${p.id}: duplicate id`); ids.add(p.id);
    need(p.title, `product ${p.id}: title is required`);
    need(Number.isInteger(p.price) && p.price > 0, `product ${p.id}: price must be a whole number of cents, like 2500 for $25`);
    need(Array.isArray(p.variants) && p.variants.length, `product ${p.id}: at least one variant (use {"id":"one","title":"One size"} if there are none)`);
    const vids = new Set();
    for (const v of p.variants ?? []) {
      need(/^[a-z0-9-]+$/.test(v.id ?? ""), `product ${p.id}: variant id "${v.id}" must be lowercase letters, digits and dashes`);
      need(!vids.has(v.id), `product ${p.id}: duplicate variant ${v.id}`); vids.add(v.id);
      need(v.title, `product ${p.id}: variant ${v.id} needs a title`);
      if (v.price != null) need(Number.isInteger(v.price) && v.price > 0, `product ${p.id}: variant ${v.id} price must be whole cents`);
      if (v.stock != null) need(Number.isInteger(v.stock) && v.stock >= 0, `product ${p.id}: variant ${v.id} stock must be a whole number`);
    }
    need(Array.isArray(p.images), `product ${p.id}: images must be a list (it can be empty)`);
    if (p.ship_date) need(/^\d{4}-\d{2}-\d{2}$/.test(p.ship_date), `product ${p.id}: ship_date must look like 2026-11-13`);
    if (p.live_at) need(!Number.isNaN(new Date(p.live_at).getTime()), `product ${p.id}: live_at must be a date and time, like 2026-11-13T20:00:00-05:00`);
    if (p.compare_at != null) need(Number.isInteger(p.compare_at) && p.compare_at > p.price, `product ${p.id}: compare_at must be higher than price`);
    if (p.bundle) for (const b of p.bundle) need(products.some((q) => q.id === b.product), `product ${p.id}: bundle part ${b.product} is not a product`);
  }
  return errs;
}
