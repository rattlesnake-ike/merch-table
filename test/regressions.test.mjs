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

import { trackingUrl } from "../worker/orders.js";
const orders = readFileSync(new URL("../worker/orders.js", import.meta.url), "utf8");

test("a buyer's lookup shows their order and never someone else's", () => {
  // Email is not proof of identity, so the lookup must show only receipt-level facts.
  assert.match(orders, /ordersForEmail[\s\S]*?filter\(\(o\) => \(o\.email \?\? ""\)\.toLowerCase\(\) === e\)/);
  const rows = orders.slice(orders.indexOf("export function orderRows"));
  assert.match(rows, /forBand \?/, "the address and phone are shown to the band only");
});

test("tracking numbers become links a buyer can click", () => {
  assert.match(trackingUrl("USPS", "94001118992231974"), /tools\.usps\.com/);
  assert.match(trackingUrl("ups", "1Z999"), /ups\.com\/track/);
  assert.match(trackingUrl("FedEx Ground", "7712"), /fedex\.com/);
  assert.equal(trackingUrl("Some Local Courier", "X1"), null);   // unknown carrier: no guessed link
  assert.equal(trackingUrl("USPS", ""), null);
});

test("a tracking number is stripped of anything that isn't a tracking number", () => {
  assert.match(orders, /String\(tracking\)\.replace\(\/\[\^A-Za-z0-9-\]\/g, ""\)/);
});

test("the store records what a bank asks for, at the time of sale", () => {
  // None of this can be reconstructed months later when a dispute arrives.
  for (const field of ["buyer:", "order_no:", "ordered_at:", "ip_country:", "goods:", "terms:"]) assert.ok(worker.includes(field), `checkout must record ${field}`);
  assert.match(worker, /buyerKey = ip \? await shortHash/, "the buyer key must be a hash, never a stored IP");
  assert.doesNotMatch(worker, /metadata: \{[^}]*\bip:/, "a raw IP must never go into Stripe metadata");
});

import { ticketCode, verifyCode, isTicket, showOver, ticketsLeft } from "../worker/tickets.js";
const SEC = "a-long-test-secret-for-tickets";

test("a ticket code cannot be invented without the store's secret", async () => {
  const good = await ticketCode(SEC, "cs_1", "show:a:0");
  assert.equal(await verifyCode(SEC, "cs_1", "show:a:0", good), true);
  assert.equal(await verifyCode("another-secret", "cs_1", "show:a:0", good), false);
  assert.equal(await verifyCode(SEC, "cs_2", "show:a:0", good), false, "a code is bound to its order");
  assert.equal(await verifyCode(SEC, "cs_1", "show:a:1", good), false, "and to its seat");
  for (const junk of ["", "ZZZZ-9999", "A", null, undefined, good + "X"]) assert.equal(await verifyCode(SEC, "cs_1", "show:a:0", junk), false);
});

test("a code is read the way a person types it", async () => {
  const c = await ticketCode(SEC, "cs_1", "show:a:0");
  for (const form of [c.toLowerCase(), c.replace("-", ""), c.replace("-", " "), ` ${c} `]) assert.equal(await verifyCode(SEC, "cs_1", "show:a:0", form), true);
});

test("every seat in one order gets its own code", async () => {
  const codes = new Set();
  for (let i = 0; i < 25; i++) codes.add(await ticketCode(SEC, "cs_1", `show:a:${i}`));
  assert.equal(codes.size, 25);
});

test("a show that has happened cannot be sold", () => {
  const past = { show: { date: "2020-01-01" } }, future = { show: { date: "2099-01-01" } };
  assert.equal(showOver(past), true);
  assert.equal(showOver(future), false);
  assert.equal(showOver({}), false, "a normal product is not a show");
  assert.equal(isTicket(past), true);
  assert.equal(isTicket({ id: "tee" }), false);
  assert.match(worker, /isTicket\(p\) && showOver\(p, now\)/, "checkout must refuse a past show");
});

test("capacity counts down", () => {
  assert.equal(ticketsLeft({ show: { capacity: 120 } }, 40), 80);
  assert.equal(ticketsLeft({ show: { capacity: 120 } }, 200), 0, "never negative");
  assert.equal(ticketsLeft({ show: {} }, 5), null, "no capacity set means no limit");
});

const siteJs = readFileSync(new URL("../src/site.js", import.meta.url), "utf8");
const buildMjs = readFileSync(new URL("../src/build.mjs", import.meta.url), "utf8");

test("a sold-out product says so once, not twice", () => {
  // Two code paths used to insert the message; only one guarded against a duplicate.
  assert.equal((siteJs.match(/className = "soldout"/g) ?? []).length, 1, "only one place may create the sold-out line");
  assert.match(siteJs, /if \(!\$\(".soldout", prod\)\)/, "and it must check the line isn't already there");
});

test("the class names the script depends on are documented in the file that depends on them", () => {
  const header = siteJs.slice(0, siteJs.indexOf("(() =>"));
  for (const hook of [".sz", ".buy", ".soldout", "data-variant", "data-cart-rows"]) assert.ok(header.includes(hook), `${hook} must be listed as a hook a restyle has to keep`);
});

test("a band restyling properly can switch off the rules the build appends", () => {
  assert.match(buildMjs, /if \(!look\.raw\) css \+=/, "look.raw must skip the appended heading and corner rules");
});

test("a missing font file is reported, never silently ignored", () => {
  assert.match(buildMjs, /public\/fonts\/fonts\.css/, "the build must look for the file, not just the folder");
  assert.match(buildMjs, /console\.warn/, "and say so when it isn't there");
});

test("the sold-out wording is changeable without editing the script", () => {
  assert.match(siteJs, /prod\.dataset\.soldOutText/);
  assert.match(readFileSync(new URL("../src/templates.mjs", import.meta.url), "utf8"), /data-sold-out-text=/);
});

// --- The door has to keep up with a queue ---
import { indexTickets, ticketByCode } from "../worker/orders.js";

/** A stand-in for Cloudflare KV that counts how many reads a door scan costs. */
function fakeKV() {
  const m = new Map();
  let reads = 0;
  return {
    reads: () => reads,
    get: async (k) => { reads++; return m.has(k) ? m.get(k) : null; },
    put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
  };
}

test("a door scan is one read, not a walk of every order", async () => {
  const kv = fakeKV();
  const env = { STOCK: kv, SESSION_SECRET: "s" };
  const products = [{ id: "show", title: "Release show", variants: [{ id: "one", title: "Ticket" }], show: { date: "2099-01-01", capacity: 300 } }];
  await kv.put("catalogue", JSON.stringify(products));

  // 300 orders, two tickets each: a sold-out 600-cap room.
  for (let i = 0; i < 300; i++) await indexTickets(env, { id: `o${i}`, items: "show:one:2" });

  const code = await ticketCode("s", "o217", "show:one:1");
  const before = kv.reads();
  const hit = await ticketByCode(env, code);
  const cost = kv.reads() - before;

  assert.equal(hit.order, "o217", "the code finds its own order");
  assert.equal(hit.seq, "show:one:1");
  assert.equal(cost, 1, `a scan cost ${cost} reads; it must be 1, or the queue waits`);
});

test("a code that was never sold is not a ticket", async () => {
  const kv = fakeKV();
  const env = { STOCK: kv, SESSION_SECRET: "s" };
  await kv.put("catalogue", JSON.stringify([{ id: "show", title: "x", variants: [{ id: "one", title: "T" }], show: { date: "2099-01-01" } }]));
  await indexTickets(env, { id: "o1", items: "show:one:1" });
  assert.equal(await ticketByCode(env, "ZZZZ-9999"), null);
});

test("a ticket code is found however it is typed", async () => {
  const kv = fakeKV();
  const env = { STOCK: kv, SESSION_SECRET: "s" };
  await kv.put("catalogue", JSON.stringify([{ id: "show", title: "x", variants: [{ id: "one", title: "T" }], show: { date: "2099-01-01" } }]));
  await indexTickets(env, { id: "o1", items: "show:one:1" });
  const code = await ticketCode("s", "o1", "show:one:0");
  for (const typed of [code, code.toLowerCase(), code.replace("-", ""), ` ${code} `, code.replace("-", " ")]) {
    assert.ok(await ticketByCode(env, typed), `door staff typed "${typed}" and it was not found`);
  }
});

import { headcount, allocationOf } from "../worker/tickets.js";

test("the door can say how many are in the room", async () => {
  const keys = [];
  const env = { STOCK: {
    list: async () => ({ keys, list_complete: true }),
    get: async () => null, put: async () => {},
  } };
  const products = [
    { id: "fri", title: "Friday", variants: [{ id: "one" }], show: { date: "2099-01-01", title: "Friday", allocation: 200, room_capacity: 450 } },
    { id: "sat", title: "Saturday", variants: [{ id: "one" }], show: { date: "2099-01-02", title: "Saturday", capacity: 120 } },
  ];
  for (let i = 0; i < 37; i++) keys.push({ name: `ticket:o${i}:fri:one:0` });
  for (let i = 0; i < 5; i++) keys.push({ name: `ticket:o${i}:sat:one:0` });

  const c = await headcount(env, products);
  const fri = c.find((x) => x.id === "fri");
  const sat = c.find((x) => x.id === "sat");
  assert.equal(fri.inRoom, 37, "Friday's count must not include Saturday's check-ins");
  assert.equal(sat.inRoom, 5);
  assert.equal(fri.allocation, 200, "the band's slice of the room, not the room");
  assert.equal(fri.room, 450, "the room's own capacity, for the venue's count");
  assert.equal(sat.allocation, 120, "a store written before allocations still reads");
});

test("a show that has happened is not counted at the door", async () => {
  const env = { STOCK: { list: async () => ({ keys: [], list_complete: true }), get: async () => null, put: async () => {} } };
  const past = [{ id: "old", title: "Last year", variants: [{ id: "one" }], show: { date: "2020-01-01", title: "Last year" } }];
  assert.equal((await headcount(env, past)).length, 0);
});


test("the band sells its allocation, never the whole room", () => {
  const show = { id: "s", show: { date: "2099-01-01", allocation: 40, room_capacity: 300 } };
  assert.equal(allocationOf(show), 40, "the band's slice");
  assert.equal(ticketsLeft(show, 0), 40);
  assert.equal(ticketsLeft(show, 39), 1);
  assert.equal(ticketsLeft(show, 40), 0, "sold out at the allocation, not at the room");
  assert.equal(ticketsLeft(show, 999), 0, "never negative");
});

test("a show written before allocations existed still works", () => {
  const old = { id: "s", show: { date: "2099-01-01", capacity: 120 } };
  assert.equal(allocationOf(old), 120, "capacity is read as an allocation");
  assert.equal(ticketsLeft(old, 100), 20);
});

test("a show with no number sells without a limit, and says so by returning null", () => {
  const open = { id: "s", show: { date: "2099-01-01" } };
  assert.equal(allocationOf(open), null);
  assert.equal(ticketsLeft(open, 5), null);
});

// --- A called-off show, and the money owed back ---
import { showStatus, showOff } from "../worker/tickets.js";
import { ticketAmountFor } from "../worker/refunds.js";

test("a called-off show says so on the ticket the fan is holding", () => {
  const off = { show: { date: "2099-01-01", cancelled: true } };
  assert.equal(showStatus(off).state, "cancelled");
  assert.equal(showOff(off), true);
  const moved = { show: { date: "2099-01-01", moved_to: "14 March" } };
  assert.equal(showStatus(moved).state, "moved");
  assert.equal(showStatus(moved).to, "14 March");
  assert.equal(showOff(moved), false, "a moved show is still a show");
  assert.equal(showStatus({ show: { date: "2099-01-01" } }).state, "on");
});

test("a refund covers the tickets to that show and nothing else in the basket", () => {
  const products = [
    { id: "show", price: 1800, variants: [{ id: "one", price: 1800 }], show: { date: "2099-01-01" } },
    { id: "shirt", price: 3000, variants: [{ id: "m", price: 3000 }] },
  ];
  // two tickets and a shirt in one order
  const order = { id: "o1", items: "show:one:2,shirt:m:1", paid: true, payment: "pi_1" };
  assert.equal(ticketAmountFor(order, "show", products), 3600, "two tickets, not the shirt");
  assert.equal(ticketAmountFor(order, "shirt", products), 0, "a shirt is not a ticket and is never auto-refunded");
});

test("an order with nothing for that show is left alone", () => {
  const products = [{ id: "fri", price: 1000, variants: [{ id: "one", price: 1000 }], show: { date: "2099-01-01" } },
                    { id: "sat", price: 1000, variants: [{ id: "one", price: 1000 }], show: { date: "2099-01-02" } }];
  const order = { id: "o2", items: "sat:one:1", paid: true, payment: "pi_2" };
  assert.equal(ticketAmountFor(order, "fri", products), 0);
});

test("a ticket's own variant price wins over the product price", () => {
  const products = [{ id: "show", price: 1800, variants: [{ id: "early", price: 1200 }, { id: "door", price: 2500 }], show: { date: "2099-01-01" } }];
  const order = { id: "o3", items: "show:early:2", paid: true, payment: "pi_3" };
  assert.equal(ticketAmountFor(order, "show", products), 2400, "early-bird buyers get back what they actually paid");
});

test("a placeholder contact address is caught before a fan needs it", () => {
  const src = readFileSync(new URL("../scripts/check.mjs", import.meta.url), "utf8");
  assert.match(src, /placeholder/, "check.mjs must test the store's contact address");
  const placeholder = /(^|@)(example\.(com|org|net)|yourband|changeme)/i;
  for (const bad of ["hello@example.com", "band@example.org", "you@yourband.com", "changeme@x.com"])
    assert.ok(placeholder.test(bad), `${bad} should be caught`);
  for (const good of ["hi@harborlights.net", "band@gmail.com", "shop@arealband.co.uk"])
    assert.ok(!placeholder.test(good), `${good} is a real address and must not be flagged`);
});
