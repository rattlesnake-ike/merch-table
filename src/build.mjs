// Builds the store into ./dist. Run with: npm run build
// Reads store.json and products.json, writes every page, the feed files, and copies images.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, extname, basename } from "node:path";
import { createHash } from "node:crypto";
import { validate, merchJson } from "./lib.mjs";
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
write("cart/index.html", cartPage(store));
write("thanks/index.html", thanksPage(store));
write("shipping/index.html", shippingPage(store));
write("404.html", notFoundPage(store));

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

// Styles and script, with the store's colours and shipping table written in.
// The look: colours, corners, heading case, and a font, all from store.json.
const look = store.look ?? {};
const FONTS = {
  system: `ui-sans-serif,system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif`,
  grotesk: `"Helvetica Neue",Helvetica,Arial,"Liberation Sans",sans-serif`,
  serif: `ui-serif,Georgia,"Times New Roman",serif`,
  slab: `"Rockwell","Courier Bold",Georgia,serif`,
  mono: `ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`,
  rounded: `ui-rounded,"SF Pro Rounded","Hiragino Maru Gothic ProN",system-ui,sans-serif`,
};
const face = FONTS[look.font] ?? (look.font ? `${look.font},${FONTS.system}` : FONTS.system);
const radius = look.corners === "round" ? "10px" : look.corners === "soft" ? "4px" : "0px";
const headingCase = look.headings === "normal" ? "none" : look.headings === "small-caps" ? "lowercase" : "uppercase";
// Appended, not prepended: in CSS the last declaration wins, so the band's values must come after the defaults.
let css = readFileSync(join(root, "src/site.css"), "utf8");
// Appended last, so it wins over the stylesheet's defaults. Anything YOU write in site.css
// after this point in the cascade still wins over these, because this block is inserted
// BEFORE your own additions below. See BRAND.md, "what the build adds".
css += `\n/* the band's look, from store.json */\n:root{--ink:${store.colors?.ink ?? "#141416"};--paper:${store.colors?.paper ?? "#f3f1ea"};--accent:${store.colors?.accent ?? "#2743d0"};--radius:${radius};--display:${face};--body:${face}}\n`;
// These two lines are a convenience for bands who only want the settings. If you are
// restyling properly, set "look": { "raw": true } in store.json and they are not added,
// so nothing of yours gets overridden.
if (!look.raw) css += `h1,h2,h3{text-transform:${headingCase}}\n.card,.btn,input,select,textarea,.restock,.sz{border-radius:var(--radius)}\n`;
if (look.font && !FONTS[look.font]) {
  if (existsSync(join(root, "public/fonts/fonts.css"))) css = `/* your face, declared in public/fonts/fonts.css */\n@import "/fonts/fonts.css";\n` + css;
  else console.warn(`store.json asks for the font "${look.font}", but public/fonts/fonts.css does not exist, so nothing declares it. Copy public/fonts/fonts.css.example to public/fonts/fonts.css and edit it. (See BRAND.md.)`);
}
write("site.css", css);
const js = `window.__store=${JSON.stringify({ currency: store.currency.toUpperCase(), locale: store.locale ?? "en-US" })};window.__shipping=${JSON.stringify(store.shipping.map(({ id, name, countries, amount, free_over, estimate }) => ({ id, name, countries, amount, free_over, estimate })))};\n` + readFileSync(join(root, "src/site.js"), "utf8");
write("site.js", js);

// Anything in ./public is copied as-is (fonts, extra pages, a logo).
const pub = join(root, "public");
if (existsSync(pub)) (function cp(d, r) { for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) cp(f, join(r, n)); else { mkdirSync(join(out, r), { recursive: true }); copyFileSync(f, join(out, r, n)); } } })(pub, "");

console.log(`built ${products.length} products into dist/ for ${siteUrl}`);
