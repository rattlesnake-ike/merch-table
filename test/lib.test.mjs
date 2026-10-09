import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate, merchJson, regionFor, variantAvailable, isLive } from "../src/lib.mjs";
const store = JSON.parse(readFileSync(new URL("../store.json", import.meta.url)));
const products = JSON.parse(readFileSync(new URL("../products.json", import.meta.url)));
test("the demo data validates", () => assert.deepEqual(validate(store, products), []));
test("validate catches a bad price", () => assert.ok(validate(store, [{ ...products[0], price: 25.5 }]).some((e) => /cents/.test(e))));
test("validate catches a country in two regions", () => assert.ok(validate({ ...store, shipping: [...store.shipping, { id: "x", name: "X", countries: ["US"], amount: 1 }] }, products).some((e) => /two shipping regions/.test(e))));
test("stock counts make a variant sold out", () => { assert.equal(variantAvailable({ stock: 3 }, 3), false); assert.equal(variantAvailable({ stock: 3 }, 2), true); assert.equal(variantAvailable({ available: false }, 0), false); });
test("drops are not live before their time", () => { assert.equal(isLive({ live_at: "2999-01-01T00:00:00Z" }), false); assert.equal(isLive({}), true); });
test("regions resolve by country", () => { assert.equal(regionFor(store, "US").id, "us"); assert.equal(regionFor(store, "GB").id, "row"); assert.equal(regionFor(store, "ZZ"), undefined); });
test("merch.json leaves out unreleased drops and carries every variant", () => {
  const m = merchJson(store, products, "https://x.test", new Date("2026-10-01T00:00:00Z"));
  assert.equal(m.version, 1); assert.ok(!m.items.some((i) => i.id === "lighthouse-long-sleeve"));
  const tee = m.items.find((i) => i.id === "dog-logo-tee"); assert.equal(tee.variants.length, 6); assert.equal(tee.variants.find((v) => v.id === "l").available, false); assert.equal(tee.price, "35.00"); assert.equal(tee.variants.find((v) => v.id === "2xl").price, "38.00");
});
test("hidden products stay out of merch.json", () => { const m = merchJson(store, [{ ...products[1], id: "secret", hidden: true }, products[1]], "https://x.test"); assert.equal(m.items.length, 1); });
