// Checks store.json and products.json before a build or deploy. npm run check
import { readFileSync, existsSync } from "node:fs";
import { validate } from "../src/lib.mjs";
const store = JSON.parse(readFileSync("store.json", "utf8"));
const products = JSON.parse(readFileSync("products.json", "utf8"));
const errs = validate(store, products);
for (const p of products) for (const i of p.images ?? []) if (!/^https?:/.test(i) && !existsSync(i)) errs.push(`product ${p.id}: image file ${i} is missing`);
if (errs.length) { console.error("Fix these first:\n- " + errs.join("\n- ")); process.exit(1); }
// Warnings: not wrong enough to stop a build, but a fan hits every one of them.
// A placeholder address is the worst kind of bug here — the buyer writes, nobody reads it,
// and they go to their bank instead. It is the demo's own value, so it ships unless changed.
const warn = [];
const placeholder = /(^|@)(example\.(com|org|net)|yourband|changeme)/i;
if (!store.email || placeholder.test(store.email)) warn.push(`store.json "email" is still ${store.email ? `"${store.email}"` : "empty"}. A buyer with a problem writes here; if nobody reads it they go to their bank instead. Put a real address you check.`);
if (store.homepage && placeholder.test(store.homepage)) warn.push(`store.json "homepage" is still a placeholder (${store.homepage}).`);
for (const p of products) {
  const sh = p.show;
  if (!sh) continue;
  if (typeof (sh.allocation ?? sh.capacity) !== "number") warn.push(`show "${sh.title ?? p.title}" has no allocation, so it will sell without a limit. Set show.allocation to the number the venue agreed you may sell.`);
  if (typeof sh.room_capacity !== "number") warn.push(`show "${sh.title ?? p.title}" has no room_capacity. Ask the venue what the room holds, and how your sold names reach their door list.`);
}
if (warn.length) console.warn("Worth fixing before anyone buys:\n- " + warn.join("\n- ") + "\n");

const live = products.filter((p) => !p.live_at || new Date(p.live_at) <= new Date()).length;
console.log(`ok: ${products.length} products (${live} on sale now, ${products.length - live} waiting to drop), ${store.shipping.length} shipping regions, currency ${store.currency.toUpperCase()}`);
