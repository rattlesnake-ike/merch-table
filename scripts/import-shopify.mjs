// Turns a Shopify product export into products.json.
//   npm run import -- exports/products_export_1.csv
// Shopify admin > Products > Export > "All products" + "Plain CSV file". Put the file in ./exports/.
// Images stay as Shopify CDN URLs in products.json; the build downloads them once and serves them from your site.
// Existing products.json entries with the same id keep any fields Shopify doesn't know (live_at, bundle, stock).
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const file = process.argv[2];
if (!file) { console.error("usage: npm run import -- exports/products_export_1.csv"); process.exit(1); }
const rows = parseCsv(readFileSync(file, "utf8"));
const head = rows.shift().map((h) => h.trim());
const col = (r, name) => r[head.indexOf(name)] ?? "";
const existing = existsSync("products.json") ? JSON.parse(readFileSync("products.json", "utf8")) : [];

const byHandle = new Map();
for (const r of rows) {
  const handle = col(r, "Handle"); if (!handle) continue;
  let p = byHandle.get(handle);
  if (!p) {
    p = { id: slug(handle), title: col(r, "Title"), price: 0, kind: guessKind(col(r, "Type"), col(r, "Title"), col(r, "Tags")), description: text(col(r, "Body (HTML)")), images: [], variants: [], published: col(r, "Published") === "true" ? new Date().toISOString() : undefined, hidden: col(r, "Published") === "false" || undefined };
    byHandle.set(handle, p);
  }
  if (!p.title && col(r, "Title")) p.title = col(r, "Title");
  const img = col(r, "Image Src"); if (img) { const u = img.includes("?") ? `${img}&width=1200` : `${img}?width=1200`; if (!p.images.includes(u)) p.images[Number(col(r, "Image Position") || p.images.length + 1) - 1] = u; }
  const priceStr = col(r, "Variant Price");
  if (priceStr) {
    const opts = ["Option1 Value", "Option2 Value", "Option3 Value"].map((o) => col(r, o)).filter((v) => v && v !== "Default Title");
    const title = opts.join(" / ") || "One size";
    const price = Math.round(parseFloat(priceStr) * 100);
    const qty = col(r, "Variant Inventory Qty"); const policy = col(r, "Variant Inventory Policy");
    const v = { id: slug(title) || "one", title, available: policy === "continue" || qty === "" || Number(qty) > 0 };
    if (qty !== "" && policy !== "continue" && !Number.isNaN(Number(qty))) v.stock = Math.max(0, Number(qty));
    if (col(r, "Variant Compare At Price")) p.compare_at = Math.round(parseFloat(col(r, "Variant Compare At Price")) * 100);
    p.variants.push({ ...v, price });
  }
}
const products = [...byHandle.values()].map((p) => {
  p.images = p.images.filter(Boolean);
  const prices = p.variants.map((v) => v.price);
  p.price = prices.length ? Math.min(...prices) : 0;
  p.variants = p.variants.map((v) => (v.price === p.price ? (({ price, ...rest }) => rest)(v) : v));
  if (p.compare_at && p.compare_at <= p.price) delete p.compare_at;
  const old = existing.find((x) => x.id === p.id);
  if (old) for (const k of ["live_at", "ship_date", "bundle", "kind", "published"]) if (old[k] != null) p[k] = old[k];
  if (!p.published) p.published = new Date().toISOString();
  return p;
});
writeFileSync("products.json", JSON.stringify(products, null, 2) + "\n");
console.log(`wrote ${products.length} products to products.json (${products.reduce((a, p) => a + p.variants.length, 0)} variants). Now: npm run check`);

function parseCsv(s) {
  const out = []; let row = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((x) => x !== ""));
}
function slug(s) { return String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function text(html) { return String(html).replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim(); }
function guessKind(type, title, tags) {
  const s = `${type} ${title} ${tags}`.toLowerCase();
  if (/\b(vinyl|lp|record|cassette|tape|cd|7"|12"|flexi)\b/.test(s)) return "music";
  if (/\b(tee|t-shirt|shirt|hoodie|hoody|sweatshirt|crewneck|long ?sleeve|jacket|hat|cap|beanie|shorts|socks|jersey)\b/.test(s)) return "apparel";
  if (/\b(poster|print|lithograph|screenprint|art)\b/.test(s)) return "prints";
  if (/\b(pin|patch|sticker|keychain|lanyard|button|magnet)\b/.test(s)) return "accessories";
  if (/\b(tote|bag|mug|candle|towel|blanket|puzzle|plush|koozie|slipmat)\b/.test(s)) return "unusual";
  return "other";
}
