/* Orders: what the band packs, and what a buyer can check.
   Most disputes are not fraud. They are a person who forgot, or never got a receipt they
   understood, or could not find a way to ask. So: the band sees one list with a tracking box,
   the buyer can look up their own order with nothing but the email they paid with, and every
   dispute-relevant fact is on the record before anyone argues about it. */

import { escapeHtml } from "./admin.js";

const K = {
  order: (id) => `order:${id}`,
  index: "orders:index",
  // A door scan must be ONE read, not a walk of every order. The code itself is the key.
  // Without this a 600-ticket show reads ~300 orders sequentially per scan — seconds of KV
  // latency while a queue waits outside in the cold.
  ticket: (code) => `tcode:${String(code).toUpperCase().replace(/[^0-9A-Z]/g, "")}`,
};

/** Everything the band and the bank need, kept small and readable. */
export async function recordOrder(env, session) {
  if (!env.STOCK) return;
  const m = session.metadata ?? {};
  const o = {
    id: session.id,
    at: m.ordered_at || new Date().toISOString(),
    paid: session.payment_status === "paid",
    total: session.amount_total,
    currency: session.currency,
    email: session.customer_details?.email ?? null,
    name: session.customer_details?.name ?? null,
    phone: session.customer_details?.phone ?? null,
    ship: session.collected_information?.shipping_details ?? session.shipping_details ?? null,
    items: m.items ?? "",
    goods: m.goods ?? "",
    buyer: m.buyer ?? "",
    orderNo: m.order_no ?? "",
    ipCountry: m.ip_country ?? "",
    shipsOn: m.ships ?? null,
    payment: session.payment_intent ?? null,
    status: "to pack",
  };
  await env.STOCK.put(K.order(session.id), JSON.stringify(o));
  const idx = JSON.parse((await env.STOCK.get(K.index)) ?? "[]");
  if (!idx.includes(session.id)) { idx.unshift(session.id); await env.STOCK.put(K.index, JSON.stringify(idx.slice(0, 2000))); }
  await indexTickets(env, o);
}

/**
 * Point every ticket code at its own order, so the door is one read.
 * Called when an order is recorded; `backfillTicketIndex` catches orders taken before this existed.
 */
export async function indexTickets(env, order) {
  if (!env.STOCK) return 0;
  const { ticketsForOrder, isTicket } = await import("./tickets.js");
  const products = JSON.parse((await env.STOCK.get("catalogue")) ?? "null") ?? null;
  if (!products) return 0;                       // no catalogue cached: the door falls back to the walk
  if (!products.some(isTicket)) return 0;        // no shows in this store, nothing to index
  let n = 0;
  for (const t of await ticketsForOrder(env, order, products)) {
    await env.STOCK.put(K.ticket(t.code), JSON.stringify({ order: order.id, seq: t.seq }), { expirationTtl: 400 * 24 * 3600 });
    n++;
  }
  return n;
}

/** One order + seq for a code, or null when the code was never sold (or predates the index). */
export async function ticketByCode(env, code) {
  if (!env.STOCK) return null;
  const raw = await env.STOCK.get(K.ticket(code));
  return raw ? JSON.parse(raw) : null;
}

/** Index every ticket in every order on file. Run once after upgrading, and after a catalogue change. */
export async function backfillTicketIndex(env, products) {
  if (!env.STOCK) return { orders: 0, tickets: 0 };
  await env.STOCK.put("catalogue", JSON.stringify(products));
  const orders = await listOrders(env, 2000);
  let tickets = 0;
  for (const o of orders) tickets += await indexTickets(env, o);
  return { orders: orders.length, tickets };
}

export async function listOrders(env, limit = 200) {
  if (!env.STOCK) return [];
  const idx = JSON.parse((await env.STOCK.get(K.index)) ?? "[]");
  const out = [];
  for (const id of idx.slice(0, limit)) { const raw = await env.STOCK.get(K.order(id)); if (raw) out.push(JSON.parse(raw)); }
  return out;
}

export async function getOrder(env, id) {
  if (!env.STOCK) return null;
  const raw = await env.STOCK.get(K.order(id));
  return raw ? JSON.parse(raw) : null;
}

/** The band marks it shipped. This is the single most useful thing they can do for themselves. */
export async function markShipped(env, id, { carrier, tracking, note }) {
  const o = await getOrder(env, id); if (!o) return null;
  o.status = "shipped";
  o.shippedAt = new Date().toISOString();
  if (carrier) o.carrier = String(carrier).slice(0, 60);
  if (tracking) o.tracking = String(tracking).replace(/[^A-Za-z0-9-]/g, "").slice(0, 60);
  if (note) o.note = String(note).slice(0, 500);
  await env.STOCK.put(K.order(id), JSON.stringify(o));
  return o;
}

/** A buyer looking for their own order. Email only: it is what they have, and it proves nothing
    on its own, so nothing sensitive is shown — just their order, the way a receipt would. */
export async function ordersForEmail(env, email) {
  const e = String(email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return [];
  return (await listOrders(env, 500)).filter((o) => (o.email ?? "").toLowerCase() === e);
}

const money = (c, cur, loc) => new Intl.NumberFormat(loc ?? "en-US", { style: "currency", currency: (cur ?? "usd").toUpperCase() }).format((c ?? 0) / 100);
const when = (iso, loc) => (iso ? new Date(iso).toLocaleDateString(loc ?? "en-US", { day: "numeric", month: "long", year: "numeric" }) : "");

/** Tracking that a buyer can click, without the store having to know every carrier. */
export function trackingUrl(carrier, tracking) {
  if (!tracking) return null;
  const c = String(carrier ?? "").toLowerCase();
  if (c.includes("usps")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tracking}`;
  if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${tracking}`;
  if (c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${tracking}`;
  if (c.includes("dhl")) return `https://www.dhl.com/en/express/tracking.html?AWB=${tracking}`;
  if (c.includes("royal")) return `https://www.royalmail.com/track-your-item#/tracking-results/${tracking}`;
  return null;
}

export function orderRows(orders, store, { forBand }) {
  return orders.map((o) => {
    const t = trackingUrl(o.carrier, o.tracking);
    const track = o.tracking ? (t ? `<a href="${t}" rel="noopener">${escapeHtml(o.carrier || "Tracking")} ${escapeHtml(o.tracking)}</a>` : `${escapeHtml(o.carrier || "")} ${escapeHtml(o.tracking)}`) : "";
    return `<tr>
      <td><b>${escapeHtml(o.goods || o.items)}</b><br><small>${when(o.at, store.locale)}${o.orderNo && Number(o.orderNo) > 1 ? ` · order ${escapeHtml(o.orderNo)} from this buyer` : ""}</small></td>
      ${forBand ? `<td>${escapeHtml(o.name ?? "")}<br><small>${escapeHtml(o.email ?? "")}</small>${o.ship?.address ? `<br><small>${escapeHtml([o.ship.address.line1, o.ship.address.line2, o.ship.address.city, o.ship.address.state, o.ship.address.postal_code, o.ship.address.country].filter(Boolean).join(", "))}</small>` : ""}</td>` : ""}
      <td class="num">${money(o.total, o.currency, store.locale)}</td>
      <td>${o.status === "shipped" ? `Shipped ${when(o.shippedAt, store.locale)}${track ? `<br><small>${track}</small>` : ""}` : o.shipsOn ? `Pre-order, ships ${when(o.shipsOn, store.locale)}` : "Being packed"}</td>
    </tr>`;
  }).join("");
}
