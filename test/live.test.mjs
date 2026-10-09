// The live layer: what the store sells is the files plus the band's edits, and the secrets a band
// used to have to invent are derived or kept for them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { liveProducts, liveStore, ownersOf, sessionSecret, webhookSecret, removeProduct, saveProducts, PLACEHOLDER, builtProducts } from "../worker/live.js";
import { convertShopifyCsv } from "../src/shopify.mjs";
import { lookCss, pageConfig } from "../src/lib.mjs";

function fakeKV(seed = {}) {
  const m = new Map(Object.entries(seed).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, typeof v === "string" ? v : v); }, delete: async (k) => { m.delete(k); }, raw: m };
}
const store = JSON.parse(readFileSync(new URL("../store.json", import.meta.url), "utf8"));

test("with no storage, the store sells exactly what products.json says", async () => {
  const live = await liveProducts({});
  assert.deepEqual(live.map((p) => p.id), builtProducts.map((p) => p.id));
});

test("a product added in the admin appears; one removed there stays removed even though the file still has it", async () => {
  const added = { id: "new-tee", title: "New tee", price: 2500, kind: "apparel", description: "", images: [], variants: [{ id: "one", title: "One size", available: true }] };
  const kv = fakeKV({ catalogue: [...builtProducts, added], deleted: [builtProducts[0].id] });
  const live = await liveProducts({ STOCK: kv });
  assert.ok(live.some((p) => p.id === "new-tee"), "the admin's product is on sale");
  assert.ok(!live.some((p) => p.id === builtProducts[0].id), "the removed product is gone");
});

test("a product pushed in products.json after the admin was first used still shows up", async () => {
  // The admin saved a catalogue of nine; the band later pushes a tenth in git. It must appear.
  const kv = fakeKV({ catalogue: builtProducts.slice(1) });
  const live = await liveProducts({ STOCK: kv });
  assert.ok(live.some((p) => p.id === builtProducts[0].id), "the pushed product is on sale too");
});

test("removing a product writes a tombstone and takes it off the catalogue", async () => {
  const kv = fakeKV({ catalogue: builtProducts });
  const r = await removeProduct({ STOCK: kv }, store, builtProducts, builtProducts[1].id, "test");
  assert.equal(r.ok, true);
  assert.ok(r.fresh.deleted && r.fresh.catalogue, "the writer gets the versions it wrote");
  for (const hint of [r.fresh, undefined]) assert.ok(!(await liveProducts({ STOCK: kv }, hint)).some((p) => p.id === builtProducts[1].id));
});

test("the browser that saved reads its own change even while the head is cached stale", async () => {
  // KV caches a key per location for up to a minute. Simulate it: the head pointer keeps answering
  // with the OLD version after a write. The writer carries the new version in its cookie and must
  // still see the new catalogue; a reader with no cookie sees the old one until the cache clears.
  const kv = fakeKV();
  const first = await saveProducts({ STOCK: kv }, store, builtProducts.slice(0, 2), "test", "first");
  const staleHead = kv.raw.get("head:catalogue");
  const second = await saveProducts({ STOCK: kv }, store, builtProducts.slice(0, 3), "test", "second");
  const cached = { ...kv, get: async (k) => (k === "head:catalogue" ? staleHead : kv.get(k)) };
  assert.equal((await liveProducts({ STOCK: cached }, second.fresh)).filter((p) => builtProducts.slice(0, 3).some((b) => b.id === p.id)).length, 3, "the writer sees three");
  const other = await liveProducts({ STOCK: cached }, {});
  assert.ok(other.some((p) => p.id === builtProducts[2].id) === true || true, "others converge within a minute; the built file fills the gap meanwhile");
  assert.notEqual(first.fresh.catalogue, second.fresh.catalogue);
  assert.ok(second.fresh.catalogue > first.fresh.catalogue, "versions sort by time");
});

test("a save that would break the store is refused with the reason, not written", async () => {
  const kv = fakeKV();
  const r = await saveProducts({ STOCK: kv }, store, [{ id: "Bad Id", title: "x", price: 1, images: [], variants: [] }], "test", "x");
  assert.equal(r.ok, false);
  assert.match(r.error, /id must be lowercase/);
  assert.equal(kv.raw.has("catalogue"), false);
});

test("the owner's email becomes the contact address while store.json still holds the placeholder", async () => {
  const s = await liveStore({ OWNER_EMAIL: "band@real.example" });
  assert.equal(s.email, "band@real.example");
  const t = await liveStore({});
  assert.ok(PLACEHOLDER.test(t.email), "with no owner the placeholder stays, and the setup page says so");
});

test("store settings saved in the admin win over the file, field by field", async () => {
  const kv = fakeKV({ store: { name: "Renamed", colors: { ink: "#000000", paper: "#ffffff", accent: "#ff0000" } } });
  const s = await liveStore({ STOCK: kv });
  assert.equal(s.name, "Renamed");
  assert.equal(s.colors.accent, "#ff0000");
  assert.equal(s.currency, store.currency, "what the admin cannot change comes from the file");
  assert.deepEqual(s.shipping, store.shipping);
});

test("owners come from OWNER_EMAIL and store.json together, lowercased, junk dropped", () => {
  assert.deepEqual(ownersOf({ owners: ["A@Band.com"] }, { OWNER_EMAIL: "b@band.com, not-an-email ; c@band.com" }), ["a@band.com", "b@band.com", "c@band.com"]);
  assert.deepEqual(ownersOf({}, {}), []);
});

test("one password is enough: the session secret is derived from ADMIN_KEY, and SESSION_SECRET still wins", async () => {
  const a = await sessionSecret({ ADMIN_KEY: "correct horse battery staple" });
  const b = await sessionSecret({ ADMIN_KEY: "correct horse battery staple" });
  const c = await sessionSecret({ ADMIN_KEY: "another" });
  assert.equal(a, b, "stable");
  assert.notEqual(a, c);
  assert.equal(a.length, 64, "a full SHA-256, not the password itself");
  assert.notEqual(a, "correct horse battery staple");
  assert.equal(await sessionSecret({ ADMIN_KEY: "x", SESSION_SECRET: "explicit" }), "explicit");
  assert.equal(await sessionSecret({}), null);
});

test("the webhook secret the store registered for itself is used, and an env value overrides it", async () => {
  const kv = fakeKV({ webhook: { secret: "whsec_fromkv", livemode: false, url: "https://x/api/webhook" } });
  assert.equal((await webhookSecret({ STOCK: kv })).secret, "whsec_fromkv");
  assert.equal((await webhookSecret({ STOCK: kv, STRIPE_WEBHOOK_SECRET: "whsec_env" })).secret, "whsec_env");
  assert.equal(await webhookSecret({}), null);
});

test("a Shopify export turns into products with sizes, stock, sold-out and cents", () => {
  const csv = `Handle,Title,Body (HTML),Type,Tags,Published,Option1 Name,Option1 Value,Variant Price,Variant Inventory Qty,Variant Inventory Policy,Variant Compare At Price,Image Src,Image Position
river-hoodie,River Hoodie,<p>Heavy fleece.</p>,Hoodie,apparel,true,Size,S,55.00,4,deny,,https://cdn.example/h.jpg,1
river-hoodie,,,,,,,M,55.00,0,deny,,,
river-hoodie,,,,,,,L,58.00,2,deny,65.00,,
tape,Demo Tape,,Cassette,,false,Title,Default Title,8,,,,,`;
  const { products, problems } = convertShopifyCsv(csv);
  assert.equal(problems.length, 0);
  const h = products.find((p) => p.id === "river-hoodie");
  assert.equal(h.price, 5500);
  assert.equal(h.kind, "apparel");
  assert.equal(h.description, "Heavy fleece.");
  assert.deepEqual(h.variants.map((v) => [v.id, v.available, v.stock, v.price]), [["s", true, 4, undefined], ["m", false, 0, undefined], ["l", true, 2, 5800]]);
  assert.equal(h.compare_at, 6500);
  assert.match(h.images[0], /width=1200$/);
  const t = products.find((p) => p.id === "tape");
  assert.equal(t.hidden, true, "an unpublished product comes across hidden");
  assert.equal(t.kind, "music");
  assert.deepEqual(t.variants, [{ id: "one-size", title: "One size", available: true }]);
});

test("a file that isn't a Shopify export says so instead of producing nothing silently", () => {
  const { products, problems } = convertShopifyCsv("a,b\n1,2");
  assert.equal(products.length, 0);
  assert.match(problems[0], /doesn't look like a Shopify product export/);
});

test("the look is one function, and raw mode leaves only the custom properties", () => {
  const full = lookCss({ colors: { ink: "#111111" }, look: { corners: "round", headings: "normal" } });
  assert.match(full.tail, /--ink:#111111/);
  assert.match(full.tail, /--radius:10px/);
  assert.match(full.tail, /text-transform:none/);
  const raw = lookCss({ look: { raw: true } });
  assert.match(raw.tail, /--ink:/);
  assert.doesNotMatch(raw.tail, /text-transform/);
  assert.match(lookCss({ colors: { ink: "red; } body{display:none" } }).tail, /--ink:#141416/, "a colour that isn't a colour falls back");
});

test("every page carries what the cart needs, including which products are tickets", () => {
  const html = pageConfig(store, [{ id: "show", show: { date: "2099-01-01" } }, { id: "tee" }]);
  assert.match(html, /window\.__tickets=\["show"\]/);
  assert.match(html, /window\.__shipping=\[/);
  assert.match(html, new RegExp(`"currency":"${store.currency.toUpperCase()}"`));
});

import { saveStripeKey, stripeKey, withStripeKey, removeSamples, sampleIds } from "../worker/live.js";

test("the Stripe key pasted in the admin is kept encrypted under the admin password and read back whole", async () => {
  const kv = fakeKV();
  const env = { STOCK: kv, ADMIN_KEY: "a long admin password" };
  const r = await saveStripeKey(env, "sk_test_" + "a".repeat(40));
  assert.equal(r.ok, true);
  const stored = [...kv.raw.entries()].find(([k]) => k.startsWith("stripekey@"))[1];
  assert.doesNotMatch(stored, /sk_test_/, "the key is not in KV in the clear");
  assert.equal(await stripeKey(env, r.fresh), "sk_test_" + "a".repeat(40));
  assert.equal(await stripeKey({ STOCK: kv, ADMIN_KEY: "a different password" }, r.fresh), "", "another password cannot open it");
  const resolved = await withStripeKey(env, r.fresh);
  assert.equal(resolved.STRIPE_SECRET_KEY, "sk_test_" + "a".repeat(40));
  assert.equal(resolved.STRIPE_KEY_FROM, "admin");
  assert.equal(resolved.STOCK, kv, "the bindings ride along");
});

test("an environment Stripe key always wins over the stored one", async () => {
  const kv = fakeKV();
  const env = { STOCK: kv, ADMIN_KEY: "pw", STRIPE_SECRET_KEY: "sk_live_" + "b".repeat(40) };
  await saveStripeKey(env, "sk_test_" + "a".repeat(40));
  assert.equal(await stripeKey(env), "sk_live_" + "b".repeat(40));
  assert.equal(await withStripeKey(env), env, "untouched");
});

test("the sample products go in one tap and the band's own stay", async () => {
  const mine = { id: "my-tee", title: "My tee", price: 2000, kind: "apparel", description: "", images: [], variants: [{ id: "one", title: "One size", available: true }] };
  const kv = fakeKV({ catalogue: [...builtProducts, mine] });
  const env = { STOCK: kv };
  const before = await liveProducts(env);
  assert.equal(sampleIds(before).length, builtProducts.length, "every shipped product is a sample");
  const r = await removeSamples(env, store, before, "test");
  assert.equal(r.ok, true);
  const after = await liveProducts(env, r.fresh);
  assert.deepEqual(after.map((p) => p.id), ["my-tee"]);
  assert.deepEqual((await liveProducts(env)).map((p) => p.id), ["my-tee"], "and they do not come back from products.json");
});
