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

import { csrfToken } from "../worker/admin.js";
test("the CSRF token is tied to the signed-in person and changes when they rotate", async () => {
  const a = await csrfToken(S, { email: "band@example.com", gen: 0 });
  const b = await csrfToken(S, { email: "band@example.com", gen: 0 });
  const other = await csrfToken(S, { email: "someone@example.com", gen: 0 });
  const rotated = await csrfToken(S, { email: "band@example.com", gen: 1 });
  assert.equal(a, b);                  // stable for the same session
  assert.notEqual(a, other);           // not transferable between people
  assert.notEqual(a, rotated);         // dies when the session generation moves
  assert.notEqual(a, await csrfToken("another-secret-entirely", { email: "band@example.com", gen: 0 }));
});

import { readProductForm, describe as describeChange } from "../worker/admin/products.js";
import { readShowForm } from "../worker/admin/shows.js";
const store = JSON.parse((await import("node:fs")).readFileSync(new URL("../store.json", import.meta.url), "utf8"));
const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };

test("a new product from the form: cents, sizes, stock per size, a was-price, a drop", async () => {
  const r = await readProductForm(fd({ title: "River Tee", price: "27.50", compare_at: "35", sizes: "S, M, XL", stock: "12", kind: "apparel", description: "Soft.", live_at: "2030-01-01T20:00" }), {}, store, null, []);
  assert.ok(!r.error, r.error?.detail);
  const p = r.product;
  assert.equal(p.id, "river-tee"); assert.equal(p.price, 2750); assert.equal(p.compare_at, 3500);
  assert.deepEqual(p.variants.map((v) => [v.id, v.stock]), [["s", 12], ["m", 12], ["xl", 12]]);
  assert.equal(p.live_at, "2030-01-01T20:00:00");
  assert.equal(p.hidden, undefined);
});

test("editing: the band types what is LEFT and the count stores what there WAS", async () => {
  const existing = { id: "tee", title: "Tee", price: 2500, kind: "apparel", description: "", images: ["img/k/a", "img/k/b"], variants: [{ id: "s", title: "S", available: true, stock: 10 }, { id: "m", title: "M", available: true }] };
  const r = await readProductForm(fd({ title: "Tee", price: "25", v_s: "on", stock_s: "3", stock_m: "", kind: "apparel", main_img: "img/k/b" }), {}, store, existing, [existing], { "tee:s": 7 });
  assert.ok(!r.error, r.error?.detail);
  const s = r.product.variants.find((v) => v.id === "s"), m = r.product.variants.find((v) => v.id === "m");
  assert.equal(s.stock, 10, "3 left + 7 sold = 10 in the count");
  assert.equal(m.available, false, "unticked = sold out");
  assert.equal(m.stock, undefined);
  assert.deepEqual(r.product.images, ["img/k/b", "img/k/a"], "the chosen main picture goes first");
});

test("a was-price below the price is refused, and a bad price never saves", async () => {
  assert.match((await readProductForm(fd({ title: "x", price: "30", compare_at: "20" }), {}, store, null, [])).error.title, /old price/);
  assert.match((await readProductForm(fd({ title: "x", price: "-5" }), {}, store, null, [])).error.title, /price/);
  assert.match((await readProductForm(fd({ title: "", price: "5" }), {}, store, null, [])).error.title, /name/);
});

test("the change log says what changed, in words", () => {
  const before = { title: "Tee", price: 2500, variants: [{ id: "s", title: "S", available: true }], images: [] };
  const after = { ...before, price: 2800, variants: [{ id: "s", title: "S", available: false }, { id: "m", title: "M", available: true }], hidden: true };
  const d = describeChange(before, after, store);
  for (const bit of ["$25 → $28", "S sold out", "sizes added: M", "hidden"]) assert.ok(d.includes(bit), `${d} should mention ${bit}`);
});

test("a show from the form is a ticket product with an allocation that counts down", () => {
  const r = readShowForm(fd({ title: "Winter show", venue: "The Windjammer", city: "Queens, NY", date: "2030-12-05", time: "20:00", doors: "7pm", price: "15", allocation: "80", room_capacity: "120" }), null, []);
  assert.ok(!r.error, r.error?.detail);
  const p = r.product;
  assert.equal(p.title, "Winter show — Queens, NY");
  assert.equal(p.price, 1500);
  assert.deepEqual(p.show, { title: "Winter show", venue: "The Windjammer", city: "Queens, NY", date: "2030-12-05", time: "20:00", doors: "7pm", allocation: 80, room_capacity: 120 });
  assert.deepEqual(p.variants, [{ id: "advance", title: "Advance", available: true, stock: 80 }]);
  assert.match(readShowForm(fd({ title: "x", date: "soon", price: "5" }), null, []).error.title, /date/);
});
