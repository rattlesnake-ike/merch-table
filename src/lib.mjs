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

/** A store's own section kinds, folded to the six kinds fan tools read. */
export const MERCH_KINDS = { hats: "apparel", shirts: "apparel", tickets: "other", shows: "other", dog: "unusual", home: "unusual", bits: "accessories", posters: "prints" };

/** The merch.json feed: a plain description of the table any reader can use. */
export function merchJson(store, products, siteUrl, now = new Date()) {
  return {
    version: 1,
    store: { name: store.name, url: siteUrl, bands: [store.name] },
    items: products.filter((p) => !p.hidden && isLive(p, now.getTime())).map((p) => ({
      id: p.id,
      title: p.title,
      url: `${siteUrl}/products/${p.id}/`,
      price: (p.price / 100).toFixed(2),
      currency: store.currency.toUpperCase(),
      kind: MERCH_KINDS[p.kind] ?? (["music", "apparel", "prints", "accessories", "unusual", "other"].includes(p.kind) ? p.kind : "other"),
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
  for (const sec of store?.sections ?? []) need(sec && typeof sec.kind === "string" && /^[a-z0-9-]{1,30}$/.test(sec.kind) && typeof sec.title === "string" && sec.title, "store.json: each section needs a kind (lowercase, like apparel) and a title");
  for (const l of store?.links ?? []) need(l && typeof l.label === "string" && l.label && typeof l.url === "string" && /^(https?:\/\/|\/)/.test(l.url), "store.json: each header link needs a label and a url");
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
    if (p.show) { need(/^\d{4}-\d{2}-\d{2}$/.test(p.show.date ?? ""), `product ${p.id}: show.date must look like 2026-11-13`); if (p.show.time) need(/^\d{2}:\d{2}$/.test(p.show.time), `product ${p.id}: show.time must look like 20:00`); }
    if (p.bundle) for (const b of p.bundle) need(products.some((q) => q.id === b.product), `product ${p.id}: bundle part ${b.product} is not a product`);
  }
  return errs;
}

/* ---------- The band's look, shared by the build and the Worker ---------- */
export const FONTS = {
  system: `ui-sans-serif,system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif`,
  grotesk: `"Helvetica Neue",Helvetica,Arial,"Liberation Sans",sans-serif`,
  serif: `ui-serif,Georgia,"Times New Roman",serif`,
  slab: `"Rockwell","Courier Bold",Georgia,serif`,
  mono: `ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`,
  rounded: `ui-rounded,"SF Pro Rounded","Hiragino Maru Gothic ProN",system-ui,sans-serif`,
};
const safeColor = (c, fallback) => (/^#[0-9a-fA-F]{3,8}$/.test(String(c ?? "")) ? c : fallback);
/**
 * What gets added to site.css from store.json: `head` goes before the stylesheet (an @import for a
 * custom face), `tail` after it (colours, corners, heading case). In CSS the last declaration wins,
 * so the band's values must come after the defaults. A band restyling properly sets look.raw and
 * only the custom properties are added.
 */
export function lookCss(store, { hasFontsCss = false } = {}) {
  const look = store.look ?? {};
  const face = FONTS[look.font] ?? (look.font ? `${String(look.font).replace(/[^\w\s"'-]/g, "")},${FONTS.system}` : FONTS.system);
  const radius = look.corners === "round" ? "10px" : look.corners === "soft" ? "4px" : "0px";
  const headingCase = look.headings === "normal" ? "none" : look.headings === "small-caps" ? "lowercase" : "uppercase";
  const c = store.colors ?? {};
  let tail = `\n/* the band's look, from store.json */\n:root{--ink:${safeColor(c.ink, "#141416")};--paper:${safeColor(c.paper, "#f3f1ea")};--accent:${safeColor(c.accent, "#2743d0")};--radius:${radius};--display:${face};--body:${face}}\n`;
  if (!look.raw) tail += `h1,h2,h3{text-transform:${headingCase}}\n.card,.btn,input,select,textarea,.restock,.sz{border-radius:var(--radius)}\n`;
  const head = look.font && !FONTS[look.font] && hasFontsCss ? `/* your face, declared in public/fonts/fonts.css */\n@import "/fonts/fonts.css";\n` : "";
  return { head, tail };
}

/** The few values site.js needs from the data, written into every page so a live edit reaches the cart. */
export function pageConfig(store, products = []) {
  const cfg = { currency: store.currency.toUpperCase(), locale: store.locale ?? "en-US" };
  const shipping = store.shipping.map(({ id, name, countries, amount, free_over, estimate }) => ({ id, name, countries, amount, free_over, estimate }));
  const tickets = products.filter((p) => p.show?.date).map((p) => p.id);
  return `<script>window.__store=${JSON.stringify(cfg)};window.__shipping=${JSON.stringify(shipping)};window.__tickets=${JSON.stringify(tickets)};</script>`;
}
