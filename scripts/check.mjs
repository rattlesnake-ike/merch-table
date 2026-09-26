// Checks store.json and products.json before a build or deploy. npm run check
import { readFileSync, existsSync } from "node:fs";
import { validate } from "../src/lib.mjs";
const store = JSON.parse(readFileSync("store.json", "utf8"));
const products = JSON.parse(readFileSync("products.json", "utf8"));
const errs = validate(store, products);
for (const p of products) for (const i of p.images ?? []) if (!/^https?:/.test(i) && !existsSync(i)) errs.push(`product ${p.id}: image file ${i} is missing`);
if (errs.length) { console.error("Fix these first:\n- " + errs.join("\n- ")); process.exit(1); }
const live = products.filter((p) => !p.live_at || new Date(p.live_at) <= new Date()).length;
console.log(`ok: ${products.length} products (${live} on sale now, ${products.length - live} waiting to drop), ${store.shipping.length} shipping regions, currency ${store.currency.toUpperCase()}`);
