// Each of these is a bug that shipped once. The test is the reason it cannot ship again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const worker = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
const site = readFileSync(new URL("../src/site.js", import.meta.url), "utf8");

test("a hidden product cannot be bought, only un-listed", () => {
  const body = worker.slice(worker.indexOf("async function checkout"), worker.indexOf("async function session"));
  assert.match(body, /if \(p\.hidden\) return bad\(/, "checkout must refuse a hidden product");
  assert.ok(body.indexOf("p.hidden") < body.indexOf("stripe(env"), "the refusal must come before Stripe is called");
});

test("a plain sale counts against stock once, not twice", () => {
  // The bug: `targets.push([p, v])` ran for every product, after the base case already added it,
  // so a run of 500 sold out at 250.
  assert.match(worker, /if \(prod\?\.bundle && typeof variant\?\.stock === "number"\) targets\.push/);
  assert.doesNotMatch(worker, /\n\s*if \(typeof variant\?\.stock === "number"\) targets\.push/);
});

test("the public catalogue hides what the store hides", () => {
  assert.match(worker, /api\/catalogue.*filter\(\(p\) => !p\.hidden && isLive\(p\)\)/s);
});

test("nothing world-readable names the band's Stripe account", () => {
  const health = worker.slice(worker.indexOf('url.pathname === "/api/health"'), worker.indexOf('url.pathname === "/api/health"') + 260);
  for (const leak of ["STRIPE_SECRET_KEY", "sk_live_", "business_profile", "charges_enabled"]) assert.ok(!health.includes(leak), `/api/health must not expose ${leak}`);
  assert.match(worker, /async function setup\(req, env, url, store\)/);
  assert.match(worker, /byKey \|\| !?bySession|!byKey && !bySession/, "setup must require the admin key or an owner session");
});

test("a shopper cannot post an enormous body", () => {
  assert.match(worker, /content-length.*64 \* 1024/s);
  assert.match(worker, /content-length.*4096/s);
});

test("back-in-stock requests are rate limited, and the bucket keeps no address", () => {
  assert.match(worker, /rl:restock:\$\{await shortHash\(who\)\}/);
  assert.match(worker, /n > 10\) return bad/);
});

test("the cart escapes every field it writes into the page", () => {
  assert.match(site, /replace\(\/\[&<>"'\]\/g/, "esc() must cover the apostrophe");
  assert.doesNotMatch(site, /<img src="\/\$\{i\.image\}"/, "image path must be escaped");
  assert.doesNotMatch(site, /ships \$\{i\.ship\}/, "ship date must be escaped");
});
