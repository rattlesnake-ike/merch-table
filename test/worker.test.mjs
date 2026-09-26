import { test } from "node:test";
import assert from "node:assert/strict";
import { form } from "../worker/index.js";
test("Stripe form encoding nests arrays and objects the way the API expects", () => {
  const q = form({ mode: "payment", line_items: [{ quantity: 2, price_data: { currency: "usd", unit_amount: 2500, product_data: { name: "Tee — M", metadata: { product: "tee" } } } }], shipping_address_collection: { allowed_countries: ["US", "CA"] }, allow_promotion_codes: true });
  assert.equal(q.get("mode"), "payment");
  assert.equal(q.get("line_items[0][quantity]"), "2");
  assert.equal(q.get("line_items[0][price_data][unit_amount]"), "2500");
  assert.equal(q.get("line_items[0][price_data][product_data][name]"), "Tee — M");
  assert.equal(q.get("line_items[0][price_data][product_data][metadata][product]"), "tee");
  assert.equal(q.get("shipping_address_collection[allowed_countries][0]"), "US");
  assert.equal(q.get("shipping_address_collection[allowed_countries][1]"), "CA");
  assert.equal(q.get("allow_promotion_codes"), "true");
});

import { keyProblem } from "../worker/index.js";
// The samples are assembled at runtime: a literal that looks like a key trips secret scanners.
const sample = (prefix) => prefix + "_" + "x".repeat(40);
test("a publishable key is named as the mistake, not reported as 'wrong key'", () => {
  assert.match(keyProblem(sample("pk_test")), /PUBLISHABLE/);
  assert.match(keyProblem(sample("whsec")), /webhook signing secret/);
  assert.match(keyProblem(sample("rk_test")), /restricted/);
  assert.match(keyProblem(""), /no Stripe key/);
  assert.match(keyProblem("sk_test_short"), /cut short/);
  assert.match(keyProblem("hello there"), /doesn't look like/);
  assert.equal(keyProblem(sample("sk_test")), null);
  assert.equal(keyProblem(sample("sk_live")), null);
});
