// Builds the store into ./dist. Run with: npm run build
// Reads store.json and products.json, writes every page, the feed files, and copies images.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, extname, basename } from "node:path";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { validate, merchJson, lookCss, FONTS } from "./lib.mjs";
import { indexPage, productPage, cartPage, thanksPage, shippingPage, notFoundPage, rss, sitemap } from "./templates.mjs";

const root = new URL("..", import.meta.url).pathname;
const read = (f) => JSON.parse(readFileSync(join(root, f), "utf8"));
const store = read("store.json");
const products = read("products.json");
const errs = validate(store, products);
if (errs.length) { console.error("products.json / store.json need fixing:\n- " + errs.join("\n- ")); process.exit(1); }

// The public address: from wrangler.jsonc's SITE_URL, or SITE_URL in the environment.
const wrangler = readFileSync(join(root, "wrangler.jsonc"), "utf8");
const siteUrl = (process.env.SITE_URL || wrangler.match(/"SITE_URL"\s*:\s*"([^"]+)"/)?.[1] || "http://localhost:8787").replace(/\/$/, "");
store.siteUrl = siteUrl;

const out = join(root, "dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const write = (rel, s) => { const f = join(out, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, s); };

// Images: a local path is copied; an http(s) URL is downloaded once into .cache/images and copied from there.
const cache = join(root, ".cache", "images"); mkdirSync(cache, { recursive: true });
async function localize(src) {
  if (!/^https?:\/\//.test(src)) {
    const f = join(root, src); if (!existsSync(f)) { console.warn(`missing image: ${src}`); return src; }
    mkdirSync(dirname(join(out, src)), { recursive: true }); copyFileSync(f, join(out, src)); return src;
  }
  const u = new URL(src); const ext = (extname(u.pathname) || ".jpg").toLowerCase().replace(/[^a-z0-9.]/g, "");
  const name = createHash("sha1").update(src).digest("hex").slice(0, 16) + ext; const cached = join(cache, name);
  if (!existsSync(cached)) {
    const res = await fetch(src); if (!res.ok) { console.warn(`could not fetch ${src}: ${res.status}`); return src; }
    writeFileSync(cached, Buffer.from(await res.arrayBuffer()));
  }
  mkdirSync(join(out, "images"), { recursive: true }); copyFileSync(cached, join(out, "images", name)); return `images/${name}`;
}
for (const p of products) p.images = await Promise.all((p.images ?? []).map(localize));

// Pages
write("index.html", indexPage(store, products));
for (const p of products) write(`products/${p.id}/index.html`, productPage(store, p, products));
write("cart/index.html", cartPage(store, products));
write("thanks/index.html", thanksPage(store, products));
write("shipping/index.html", shippingPage(store, products));
write("404.html", notFoundPage(store, products));

// Feeds and machine-readable files
write("merch.json", JSON.stringify(merchJson(store, products, siteUrl), null, 1));
write("feed.xml", rss(store, products));
write("sitemap.xml", sitemap(store, products));
write("robots.txt", `User-agent: *\nAllow: /\nDisallow: /cart/\nDisallow: /thanks/\nSitemap: ${siteUrl}/sitemap.xml\n`);
write("favicon.svg", existsSync(join(root, "brand/favicon.svg")) ? readFileSync(join(root, "brand/favicon.svg"), "utf8") : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="4" fill="${store.colors?.accent ?? "#2743d0"}"/><text x="16" y="22" font-family="Helvetica,Arial,sans-serif" font-weight="900" font-size="18" fill="#fff" text-anchor="middle">${(store.name || "M")[0].toUpperCase()}</text></svg>`);

// Redirects from the old store: redirects.txt, one "old-path new-path" per line. Product handles that match need no line: /products/<handle> already works.
const redirects = existsSync(join(root, "redirects.txt")) ? readFileSync(join(root, "redirects.txt"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => { const [a, b, c] = l.split(/\s+/); return `${a} ${b} ${c ?? 301}`; }) : [];
// Shopify-style paths without the trailing slash, and its collection pages, land on the right place.
redirects.push("/collections/all / 301", "/collections/* / 301", "/products/:id /products/:id/ 301", "/cart /cart/ 301");
write("_redirects", redirects.join("\n") + "\n");
write("_headers", `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Content-Security-Policy: default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'self' https:; frame-ancestors 'none'; base-uri 'self'\n/images/*\n  Cache-Control: public, max-age=31536000, immutable\n`);

// Styles and script. The look (colours, corners, heading case, a font) comes from store.json
// through lookCss(), which the Worker also applies at request time so a change in the admin shows
// without a rebuild. Appended, not prepended: in CSS the last declaration wins, so the band's values
// must come after the defaults. Anything YOU write in site.css still wins over these when you set
// "look": { "raw": true } in store.json. See BRAND.md, "what the build adds".
const look = store.look ?? {};
const hasFontsCss = existsSync(join(root, "public/fonts/fonts.css"));
if (look.font && !FONTS[look.font] && !hasFontsCss) console.warn(`store.json asks for the font "${look.font}", but public/fonts/fonts.css does not exist, so nothing declares it. Copy public/fonts/fonts.css.example to public/fonts/fonts.css and edit it. (See BRAND.md.)`);
const { head, tail } = lookCss(store, { hasFontsCss });
write("site.css", head + readFileSync(join(root, "src/site.css"), "utf8") + tail);
// The values site.js needs (currency, shipping table, which products are tickets) are written
// into every page by the templates, so the script itself is served as-is.
write("site.js", readFileSync(join(root, "src/site.js"), "utf8"));

// The admin's home-screen icon: iOS wants a real PNG, so write a plain square in the accent colour.
write("admin-icon.png", solidPng(192, store.colors?.accent ?? "#2743d0"));
function solidPng(size, hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([r, g, b]))]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// Anything in ./public is copied as-is (fonts, extra pages, a logo).
const pub = join(root, "public");
if (existsSync(pub)) (function cp(d, r) { for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) cp(f, join(r, n)); else { mkdirSync(join(out, r), { recursive: true }); copyFileSync(f, join(out, r, n)); } } })(pub, "");

console.log(`built ${products.length} products into dist/ for ${siteUrl}`);
