/* Tickets. A ticket is a product with a date, a limit, and a code that opens a door once.
   There is no ticketing company in the middle: the band sells from their own store, the fan
   pays card fees and nothing else, and the door is a phone with a web page open. */

const enc = new TextEncoder();
const b32 = (bytes) => { const A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; let out = ""; for (const b of bytes) out += A[b >> 3] + A[((b & 7) << 2) % 32]; return out; };

/** A ticket code: short enough to read aloud at a door, signed so it cannot be invented. */
export async function ticketCode(secret, orderId, seq) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(`ticket:${orderId}:${seq}`)));
  const body = b32(mac.slice(0, 5)).slice(0, 8);
  return `${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

export async function verifyCode(secret, orderId, seq, code) {
  const want = await ticketCode(secret, orderId, seq);
  const a = String(code ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  const b = want.replace("-", "");
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Which products are events. An event has a `show` block in products.json. */
export const isTicket = (p) => !!p?.show?.date;
export const ticketProducts = (products) => products.filter(isTicket);

/**
 * The band's ALLOCATION: how many of this room's tickets the venue agreed the band may sell.
 *
 * This is deliberately not "the room's capacity". A venue's box office has to close one equation
 * on the night — unsold + comps + sold = the room — and a ticket sold outside that count is a
 * body with no row in it. Four businesses once sold tickets to one Fort Worth show with no
 * shared count: 2,000 people turned up to a room that held 1,670 and the fire marshal closed it.
 * So the band sells a slice the venue has already subtracted from its own manifest, the way an
 * artist presale allocation has always worked. `capacity` still reads as an allocation for
 * stores written before this existed.
 */
export const allocationOf = (p) => {
  const a = p?.show?.allocation ?? p?.show?.capacity;
  return typeof a === "number" ? a : null;
};

/** How many of the band's allocation are left, counting what has sold. */
export function ticketsLeft(p, sold) {
  const a = allocationOf(p);
  if (a === null) return null;
  return Math.max(0, a - (sold ?? 0));
}

/** Doors close: a show in the past cannot be sold. */
export function showOver(p, now = Date.now()) {
  if (!p.show?.date) return false;
  const end = new Date(`${p.show.date}T${p.show.doors_close ?? "23:59"}:00${p.show.utc_offset ?? ""}`);
  return Number.isFinite(end.getTime()) ? end.getTime() < now : false;
}

/** The tickets in one paid order. */
export async function ticketsForOrder(env, order, products) {
  const out = [];
  for (const part of String(order.items ?? "").split(",").filter(Boolean)) {
    const [pid, vid, qty] = part.split(":");
    const p = products.find((x) => x.id === pid);
    if (!isTicket(p)) continue;
    for (let i = 0; i < (Number(qty) || 1); i++) {
      const seq = `${pid}:${vid}:${i}`;
      out.push({ product: p, variant: vid, seq, code: await ticketCode(env.SESSION_SECRET ?? "unset", order.id, seq) });
    }
  }
  return out;
}

const usedKey = (orderId, seq) => `ticket:${orderId}:${seq}`;

/** The door. Marks a ticket used, and says plainly if it was already used. */
export async function admit(env, orderId, seq, { undo = false } = {}) {
  if (!env.STOCK) return { ok: false, reason: "This store has no storage set up, so tickets can't be checked in." };
  const k = usedKey(orderId, seq);
  const already = await env.STOCK.get(k);
  if (undo) { await env.STOCK.delete(k); return { ok: true, undone: true }; }
  if (already) return { ok: false, already: true, at: already };
  const at = new Date().toISOString();
  await env.STOCK.put(k, at, { expirationTtl: 400 * 24 * 3600 });
  return { ok: true, at };
}

export async function usedAt(env, orderId, seq) {
  return env.STOCK ? await env.STOCK.get(usedKey(orderId, seq)) : null;
}

/** A ticket, as a page the fan keeps: big code, show details, works with no signal if cached. */
export function ticketHtml(t, order, store, used) {
  const show = t.product.show;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const when = new Date(`${show.date}T${show.time ?? "20:00"}:00`).toLocaleString(store.locale ?? "en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });
  return `<article class="tkt${used ? " used" : ""}">
    <p class="who">${esc(store.name)}</p>
    <h2>${esc(show.title ?? t.product.title)}</h2>
    <p class="where">${esc(show.venue ?? "")}${show.city ? `, ${esc(show.city)}` : ""}</p>
    <p class="when">${esc(when)}${show.doors ? ` · doors ${esc(show.doors)}` : ""}</p>
    <p class="code" aria-label="Ticket code">${esc(t.code)}</p>
    <p class="holder">${esc(order.name ?? order.email ?? "")}${t.variant && t.variant !== "one" ? ` · ${esc(t.variant)}` : ""}</p>
    ${used ? `<p class="stamp">Already checked in</p>` : ""}
  </article>`;
}

/**
 * How many people are in the room, per show. The number a fire marshal asks for and the number a
 * settlement starts from. Counted from the check-ins themselves, so it cannot drift from the door.
 */
export async function headcount(env, products) {
  if (!env.STOCK) return [];
  const live = ticketProducts(products).filter((p) => !showOver(p));
  if (!live.length) return [];
  const out = [];
  for (const p of live) {
    let inRoom = 0;
    // KV list is prefix-based; every check-in is `ticket:<order>:<product>:<variant>:<n>`.
    let cursor, done = false;
    while (!done) {
      const r = await env.STOCK.list({ prefix: "ticket:", cursor, limit: 1000 });
      for (const k of r.keys) if (k.name.includes(`:${p.id}:`)) inRoom++;
      cursor = r.cursor; done = r.list_complete || !r.cursor;
    }
    out.push({ id: p.id, title: p.show?.title ?? p.title, allocation: allocationOf(p), room: p.show?.room_capacity ?? null, inRoom });
  }
  return out;
}
