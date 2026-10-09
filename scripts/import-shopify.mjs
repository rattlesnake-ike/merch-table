// Turns a Shopify product export into products.json.
//   npm run import -- exports/products_export_1.csv
// Shopify admin > Products > Export > "All products" + "Plain CSV file". Put the file in ./exports/.
// Images stay as Shopify CDN URLs in products.json; the build downloads them once and serves them from your site.
// Existing products.json entries with the same id keep any fields Shopify doesn't know (live_at, bundle, stock).
// The same conversion runs in the store's admin (Setup → Import), where no file or terminal is needed.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { convertShopifyCsv } from "../src/shopify.mjs";

const file = process.argv[2];
if (!file) { console.error("usage: npm run import -- exports/products_export_1.csv"); process.exit(1); }
const existing = existsSync("products.json") ? JSON.parse(readFileSync("products.json", "utf8")) : [];
const { products, problems } = convertShopifyCsv(readFileSync(file, "utf8"), existing);
if (!products.length) { console.error(problems.join("\n") || "Nothing in that file."); process.exit(1); }
writeFileSync("products.json", JSON.stringify(products, null, 2) + "\n");
if (problems.length) console.warn("Worth a look:\n- " + problems.join("\n- "));
console.log(`wrote ${products.length} products to products.json (${products.reduce((a, p) => a + p.variants.length, 0)} variants). Now: npm run check`);
