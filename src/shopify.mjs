// A Shopify product export (Products → Export → All products, Plain CSV) → the store's products.
// Shared by `npm run import` and the admin's import screen, so both read the file the same way.
// No dependencies; runs in Node and in the Worker.

export function parseCsv(s) {
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

export const slug = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const htmlToText = (html) => String(html ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim();

export function guessKind(type, title, tags) {
  const s = `${type} ${title} ${tags}`.toLowerCase();
  if (/\b(vinyl|lp|record|cassette|tape|cd|7"|12"|flexi)\b/.test(s)) return "music";
  if (/\b(tee|t-shirt|shirt|hoodie|hoody|sweatshirt|crewneck|long ?sleeve|jacket|hat|cap|beanie|shorts|socks|jersey)\b/.test(s)) return "apparel";
  if (/\b(poster|print|lithograph|screenprint|art)\b/.test(s)) return "prints";
  if (/\b(pin|patch|sticker|keychain|lanyard|button|magnet)\b/.test(s)) return "accessories";
  if (/\b(tote|bag|mug|candle|towel|blanket|puzzle|plush|koozie|slipmat)\b/.test(s)) return "unusual";
  return "other";
}

/**
 * The CSV text → { products, problems }. Handles stay as ids (so /products/<handle>/ matches the
 * old store), prices become whole cents, sizes become variants, sold-out and stock are read from
 * Shopify's inventory columns, and image URLs are kept as URLs for the caller to localise.
 * `existing` lets fields Shopify doesn't know (live_at, bundle, kind, published) survive a re-import.
 */
export function convertShopifyCsv(csv, existing = [], now = new Date()) {
  const rows = parseCsv(csv);
  const head = (rows.shift() ?? []).map((h) => h.trim());
  const problems = [];
  if (!head.includes("Handle") || !head.includes("Title")) return { products: [], problems: ["This doesn't look like a Shopify product export: no Handle and Title columns."] };
  const col = (r, n) => r[head.indexOf(n)] ?? "";
  const byHandle = new Map();
  for (const r of rows) {
    const handle = col(r, "Handle"); if (!handle) continue;
    let p = byHandle.get(handle);
    if (!p) {
      p = { id: slug(handle), title: col(r, "Title"), price: 0, kind: guessKind(col(r, "Type"), col(r, "Title"), col(r, "Tags")), description: htmlToText(col(r, "Body (HTML)")), images: [], variants: [] };
      if (col(r, "Published") === "false") p.hidden = true;
      byHandle.set(handle, p);
    }
    if (!p.title && col(r, "Title")) p.title = col(r, "Title");
    const img = col(r, "Image Src");
    if (img) { const u = img.includes("?") ? `${img}&width=1200` : `${img}?width=1200`; if (!p.images.includes(u)) p.images[Number(col(r, "Image Position") || p.images.length + 1) - 1] = u; }
    const ps = col(r, "Variant Price");
    if (ps) {
      const opts = ["Option1 Value", "Option2 Value", "Option3 Value"].map((o) => col(r, o)).filter((v) => v && v !== "Default Title");
      const title = opts.join(" / ") || "One size";
      const qty = col(r, "Variant Inventory Qty"); const policy = col(r, "Variant Inventory Policy");
      const v = { id: slug(title) || "one", title, available: policy === "continue" || qty === "" || Number(qty) > 0, price: Math.round(parseFloat(ps) * 100) };
      if (qty !== "" && policy !== "continue" && !Number.isNaN(Number(qty))) v.stock = Math.max(0, Number(qty));
      const cmp = col(r, "Variant Compare At Price"); if (cmp) p.compare_at = Math.round(parseFloat(cmp) * 100);
      if (!p.variants.some((x) => x.id === v.id)) p.variants.push(v);
    }
  }
  const products = [...byHandle.values()].map((p) => {
    p.images = p.images.filter(Boolean);
    const prices = p.variants.map((v) => v.price);
    p.price = prices.length ? Math.min(...prices) : 0;
    p.variants = p.variants.map((v) => (v.price === p.price ? (({ price: _p, ...rest }) => rest)(v) : v));
    if (p.compare_at && p.compare_at <= p.price) delete p.compare_at;
    const old = existing.find((x) => x.id === p.id);
    if (old) for (const k of ["live_at", "ship_date", "bundle", "kind", "published"]) if (old[k] != null) p[k] = old[k];
    if (!p.published) p.published = now.toISOString();
    if (!p.variants.length) problems.push(`${p.title}: no variants or price in the export`);
    if (!p.price) problems.push(`${p.title}: price is 0`);
    return p;
  });
  return { products, problems };
}
