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
