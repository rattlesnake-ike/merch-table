/* Refunds. A show gets called off and the people who paid are owed their money back — without
   having to chase anyone for it. This is the part of "be straight about refunds" that is code
   rather than a promise: the band marks the night off, presses one button, and every person who
   bought a ticket to it is refunded to the card they paid with.

   Deliberately conservative: it refunds ONLY tickets to the named show, never the rest of an
   order (a shirt in the same basket is still coming), it never refunds the same payment twice,
   and it reports every failure by name instead of swallowing it. */

import { stripe } from "./index.js";
import { listOrders, getOrder } from "./orders.js";
import { isTicket } from "./tickets.js";

const K = (orderId, productId) => `refunded:${orderId}:${productId}`;

/** What this order paid for tickets to one show, in the smallest currency unit. */
export function ticketAmountFor(order, productId, products) {
  let cents = 0;
  for (const part of String(order.items ?? "").split(",").filter(Boolean)) {
    const [pid, vid, qty] = part.split(":");
    if (pid !== productId) continue;
    const p = products.find((x) => x.id === pid);
    if (!p || !isTicket(p)) continue;
    const v = (p.variants ?? []).find((x) => x.id === vid);
    const unit = typeof v?.price === "number" ? v.price : typeof p.price === "number" ? p.price : 0;
    cents += unit * (Number(qty) || 1);
  }
  return cents;
}

/**
 * Refund everyone who holds a ticket to this show.
 * Returns what happened per order, so the band can see it rather than trust it.
 */
export async function refundShow(env, productId, products, { dryRun = false } = {}) {
  const out = { refunded: [], skipped: [], failed: [], total: 0, currency: null };
  if (!env.STOCK) { out.failed.push({ order: null, why: "This store has no storage set up, so orders can't be read." }); return out; }
  const orders = await listOrders(env, 2000);
  for (const o of orders) {
    const cents = ticketAmountFor(o, productId, products);
    if (!cents) continue;                                   // nothing for this show in this order
    if (!o.paid) { out.skipped.push({ order: o.id, why: "never paid" }); continue; }
    if (!o.payment) { out.failed.push({ order: o.id, why: "no payment on file to refund" }); continue; }
    if (await env.STOCK.get(K(o.id, productId))) { out.skipped.push({ order: o.id, why: "already refunded" }); continue; }
    out.currency ??= o.currency ?? null;
    if (dryRun) { out.refunded.push({ order: o.id, email: o.email ?? null, cents, dryRun: true }); out.total += cents; continue; }
    try {
      const r = await stripe(env, "POST", "/refunds", {
        payment_intent: o.payment,
        amount: cents,
        metadata: { reason: "show called off", show: productId, order: o.id },
      });
      await env.STOCK.put(K(o.id, productId), JSON.stringify({ at: new Date().toISOString(), refund: r.id, cents }), { expirationTtl: 400 * 24 * 3600 });
      out.refunded.push({ order: o.id, email: o.email ?? null, cents, refund: r.id });
      out.total += cents;
    } catch (e) {
      out.failed.push({ order: o.id, email: o.email ?? null, cents, why: e?.message ?? String(e) });
    }
  }
  return out;
}

/** Has this order already been refunded for this show? */
export async function refundedAt(env, orderId, productId) {
  if (!env.STOCK) return null;
  const raw = await env.STOCK.get(K(orderId, productId));
  return raw ? JSON.parse(raw) : null;
}
