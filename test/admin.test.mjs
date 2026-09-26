import { test } from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken, timingSafeEqual } from "../worker/admin.js";
const S = "a-long-random-testing-secret-value";

test("a sign-in link can never be replayed as a session", async () => {
  const link = await signToken(S, { t: "link", email: "band@example.com" }, 900);
  assert.equal(await verifyToken(S, link, "session"), null);           // the important one
  assert.ok(await verifyToken(S, link, "link"));
});
test("a token signed with another secret is rejected", async () => {
  const t = await signToken(S, { t: "session", email: "band@example.com" }, 900);
  assert.equal(await verifyToken("a-different-secret-entirely", t, "session"), null);
});
test("an expired token is rejected", async () => {
  const t = await signToken(S, { t: "session", email: "band@example.com" }, -1);
  assert.equal(await verifyToken(S, t, "session"), null);
});
test("a tampered payload is rejected", async () => {
  const t = await signToken(S, { t: "session", email: "band@example.com" }, 900);
  const [data, sig] = t.split(".");
  const evil = Buffer.from(JSON.stringify({ t: "session", email: "attacker@example.com", exp: 9e9 })).toString("base64url");
  assert.equal(await verifyToken(S, `${evil}.${sig}`, "session"), null);
});
test("garbage in, null out", async () => {
  for (const bad of ["", "x", "a.b", null, undefined, 42, "....", "a.".repeat(50)]) assert.equal(await verifyToken(S, bad, "session"), null);
});
test("each link is unique, so one can be burned without burning others", async () => {
  const a = await verifyToken(S, await signToken(S, { t: "link", email: "b@e.com" }, 900), "link");
  const b = await verifyToken(S, await signToken(S, { t: "link", email: "b@e.com" }, 900), "link");
  assert.notEqual(a.jti, b.jti);
});
test("constant-time compare behaves", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "ab"), false);
  assert.equal(timingSafeEqual(null, null), false);
});

import { parsePrice, MAX_PRICE } from "../worker/admin.js";
test("a typed price is read as typed: a minus sign is a mistake, not a positive number", () => {
  assert.equal(parsePrice("-5"), null);          // used to save as $5.00
  assert.equal(parsePrice("- 5"), null);
  assert.equal(parsePrice("−5"), null);          // unicode minus
  assert.equal(parsePrice("1e3"), null);
  assert.equal(parsePrice("25.999"), null);
  assert.equal(parsePrice("2 5"), null);
  assert.equal(parsePrice(""), null);
  assert.equal(parsePrice("abc"), null);
  assert.equal(parsePrice("0"), null);
  assert.equal(parsePrice("0.00"), null);
  assert.equal(parsePrice(String(MAX_PRICE / 100 + 1)), null);
});
test("ordinary prices read correctly, including pasted currency symbols", () => {
  assert.equal(parsePrice("25"), 2500);
  assert.equal(parsePrice("25.00"), 2500);
  assert.equal(parsePrice("25.5"), 2550);
  assert.equal(parsePrice("$32"), 3200);
  assert.equal(parsePrice(" 1,250.75 "), 125075);
  assert.equal(parsePrice("0.99"), 99);
});
