/* What the store is selling RIGHT NOW, and who may change it.

   Two files in the repo (store.json, products.json) are the baseline. The band's live edits from
   the admin sit in KV on top of them, so a price change on a phone shows at once and a `git push`
   later still lands: a product pushed in products.json appears beside the ones added in the admin,
   and a product removed in the admin stays removed (a tombstone) even if the file still has it.

   KV is eventually consistent: a key read in a location is cached there for up to a minute, so a
   value written right after being read can come back stale — the band saves a price and reloads
   into the old one. So every live record is written under a NEW key per version (immutable, safe to
   cache), a small head key points at the newest, and the browser that did the writing carries the
   version in a short-lived cookie and reads its own version directly. The writer sees their change
   at once; everyone else within a minute.

   Secrets the band would otherwise have to invent and paste are derived or stored here:
   - the session secret comes from ADMIN_KEY when SESSION_SECRET is not set, so one password is enough;
   - the Stripe webhook secret is stored when the store registers its own webhook, so nobody copies a
     whsec_ out of a dashboard. An env value always wins over a stored one. */
import store0 from "../store.json" with { type: "json" };
import products0 from "../products.json" with { type: "json" };
import { validate } from "../src/lib.mjs";

export const PLACEHOLDER = /(^|@)(example\.(com|org|net)|yourband|changeme)/i;

/** The public address of this store: SITE_URL if the band set one, else wherever the request came in. */
export const siteOf = (env, url) => (env.SITE_URL || url.origin).replace(/\/$/, "");

/* ---------- versioned records ---------- */

const FRESH = "mt_fresh";
/** The versions this browser just wrote, from its cookie: { catalogue: "0001…", store: "…" }. */
export function freshHint(req) {
  const raw = (req?.headers?.get("cookie") ?? "").split(";").map((c) => c.trim()).find((c) => c.startsWith(FRESH + "="))?.slice(FRESH.length + 1);
  if (!raw) return {};
  try { const o = JSON.parse(decodeURIComponent(raw)); return o && typeof o === "object" ? o : {}; } catch { return {}; }
}
/** The Set-Cookie value that carries those versions for the next two minutes (KV converges in one). */
export function freshCookie(versions) {
  return `${FRESH}=${encodeURIComponent(JSON.stringify(versions))}; Path=/; Max-Age=120; HttpOnly; Secure; SameSite=Lax`;
}

// Versions sort by time; two writes in the same millisecond still sort by order.
let lastTick = 0;
const newVersion = () => { const t = Math.max(Date.now(), lastTick + 1); lastTick = t; return `${String(t).padStart(14, "0")}-${Math.random().toString(36).slice(2, 8)}`; };

/** Read a record: the writer's own version if newer than the head, else the head's, else the legacy plain key. */
async function readRecord(env, name, hint) {
  if (!env.STOCK) return null;
  try {
    const head = await env.STOCK.get(`head:${name}`);
    const headV = head ? head.split("|")[0] : null;
    const mine = hint?.[name];
    if (mine && (!headV || mine > headV)) { const raw = await env.STOCK.get(`${name}@${mine}`); if (raw != null) return JSON.parse(raw); }
    if (headV) { const raw = await env.STOCK.get(`${name}@${headV}`); if (raw != null) return JSON.parse(raw); }
    const legacy = await env.STOCK.get(name);                               // stores written before versioning
    return legacy ? JSON.parse(legacy) : null;
  } catch { return null; }
}

/** Write a record as a new version and point the head at it. Returns the version for the cookie. */
async function writeRecord(env, name, value) {
  const v = newVersion();
  await env.STOCK.put(`${name}@${v}`, JSON.stringify(value));
  const head = await env.STOCK.get(`head:${name}`);
  const [prev, prevPrev] = head ? head.split("|") : [];
  await env.STOCK.put(`head:${name}`, `${v}|${prev ?? ""}`);
  if (prevPrev) await env.STOCK.delete(`${name}@${prevPrev}`).catch(() => {});   // keep the last two
  return v;
}

/* ---------- what is on sale ---------- */

/** The catalogue on sale: the band's edits, plus anything pushed since, minus what they removed. */
export async function liveProducts(env, hint) {
  const edited = await readRecord(env, "catalogue", hint);
  const deleted = new Set((await readRecord(env, "deleted", hint)) ?? []);
  const list = Array.isArray(edited) && edited.length ? [...edited] : [...products0];
  for (const p of products0) if (!list.some((x) => x.id === p.id) && !deleted.has(p.id)) list.push(p);
  return list.filter((p) => !deleted.has(p.id));
}

/** The fields of store.json the admin may change. Shipping, currency and sections stay in the file. */
export const STORE_FIELDS = ["name", "tagline", "description", "email", "homepage", "colors", "look", "returns", "sold_out_text", "links", "sections", "shipping", "mailing_list", "phone_at_checkout", "statement_descriptor", "tax", "currency", "locale"];

/** store.json with the band's live settings on top. The contact address falls back to the owner. */
export async function liveStore(env, hint) {
  const over = (await readRecord(env, "store", hint)) ?? {};
  const s = { ...store0 };
  for (const k of STORE_FIELDS) if (over[k] !== undefined) s[k] = over[k];
  const owner = ownersOf(s, env)[0];
  if ((!s.email || PLACEHOLDER.test(s.email)) && owner) s.email = owner;
  if (s.homepage && PLACEHOLDER.test(s.homepage)) s.homepage = "";
  return s;
}

/** Who may sign in: OWNER_EMAIL (one or several, separated by commas) plus store.json's owners. */
export function ownersOf(store, env) {
  const fromEnv = String(env?.OWNER_EMAIL ?? "").split(/[\s,;]+/);
  return [...new Set([...(store?.owners ?? []), ...fromEnv].map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The secret that signs sessions, forms and ticket codes. Derived from ADMIN_KEY unless set explicitly. */
export async function sessionSecret(env) {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (env.ADMIN_KEY) return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`merch-table session v1|${env.ADMIN_KEY}`)));
  return null;
}

/** The Stripe webhook signing secret: from the environment, else the one the store registered itself. */
export async function webhookSecret(env, hint) {
  if (env.STRIPE_WEBHOOK_SECRET) return { secret: env.STRIPE_WEBHOOK_SECRET, from: "env" };
  const w = await readRecord(env, "webhook", hint);
  return w?.secret ? { ...w, from: "kv" } : null;
}

export async function rememberWebhook(env, w) { return { webhook: await writeRecord(env, "webhook", w) }; }

/* ---------- The Stripe key, pasted in the admin and kept encrypted under the admin password ----------
   A Worker cannot set its own secrets, and sending a band to Cloudflare's dashboard to paste a key is
   where the first hour used to go wrong. So the key is pasted in Setup, checked against Stripe on the
   spot, and kept in KV encrypted (AES-GCM) with a key derived from ADMIN_KEY — the same secret that
   already guards the whole store. An env STRIPE_SECRET_KEY still wins when set. */

async function aesKey(env) {
  if (!env.ADMIN_KEY) return null;
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`merch-table stripe v1|${env.ADMIN_KEY}`));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function saveStripeKey(env, key) {
  if (!env.STOCK) return { ok: false, error: NO_KV };
  const k = await aesKey(env);
  if (!k) return { ok: false, error: "ADMIN_KEY is not set, so there is nothing to lock the key with." };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(key));
  const v = await writeRecord(env, "stripekey", { iv: b64(iv), ct: b64(ct), mode: key.startsWith("sk_live_") ? "live" : "test", at: new Date().toISOString() });
  await log(env, "admin", `stripe ${key.startsWith("sk_live_") ? "live" : "test"} key set`);
  return { ok: true, fresh: { stripekey: v } };
}

/** The Stripe key from the environment, else the one the band pasted in the admin. */
export async function stripeKey(env, hint) {
  if (env.STRIPE_SECRET_KEY) return env.STRIPE_SECRET_KEY;
  const rec = await readRecord(env, "stripekey", hint);
  const k = rec?.ct ? await aesKey(env) : null;
  if (!k) return "";
  try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(rec.iv) }, k, unb64(rec.ct))); } catch { return ""; }
}

/** The env every handler sees: the real bindings plus the stored Stripe key, so nothing else has to know where it came from. */
export async function withStripeKey(env, hint) {
  if (env.STRIPE_SECRET_KEY) return env;
  const key = await stripeKey(env, hint);
  return key ? Object.assign(Object.create(null), env, { STRIPE_SECRET_KEY: key, STRIPE_KEY_FROM: "admin" }) : env;
}

/** The products that shipped with the template, cleared in one tap once the band has its own. */
export const sampleIds = (products) => products.filter((p) => p.sample).map((p) => p.id);
export async function removeSamples(env, store, products, who, hint) {
  if (!env.STOCK) return { ok: false, error: NO_KV };
  const ids = sampleIds(products);
  if (!ids.length) return { ok: true, fresh: {} };
  const deleted = (await readRecord(env, "deleted", hint)) ?? [];
  for (const id of ids) if (!deleted.includes(id)) deleted.push(id);
  const dv = await writeRecord(env, "deleted", deleted);
  const cv = await writeRecord(env, "catalogue", products.filter((p) => !p.sample));
  await log(env, who, `removed the ${ids.length} sample products`);
  return { ok: true, fresh: { deleted: dv, catalogue: cv } };
}

async function log(env, who, what) {
  let entries = []; try { entries = JSON.parse((await env.STOCK.get("editlog")) ?? "[]"); } catch {}
  entries.unshift({ at: new Date().toISOString(), who, what });
  await env.STOCK.put("editlog", JSON.stringify(entries.slice(0, 200)));
}

const NO_KV = "This store has no storage for live edits yet. Create a KV namespace called STOCK (the README says how), or edit products.json and push.";

/** Every write answers { ok, fresh } — `fresh` is what goes in the writer's cookie. */
export async function saveProducts(env, store, next, who, what) {
  const errs = validate(store, next);
  if (errs.length) return { ok: false, error: errs[0] };
  if (!env.STOCK) return { ok: false, error: NO_KV };
  const v = await writeRecord(env, "catalogue", next);
  await log(env, who, what);
  return { ok: true, fresh: { catalogue: v } };
}

export async function removeProduct(env, store, products, id, who, hint) {
  if (!env.STOCK) return { ok: false, error: NO_KV };
  const p = products.find((x) => x.id === id);
  if (!p) return { ok: false, error: "No such product." };
  const deleted = (await readRecord(env, "deleted", hint)) ?? [];
  if (!deleted.includes(id)) deleted.push(id);
  const dv = await writeRecord(env, "deleted", deleted);
  const cv = await writeRecord(env, "catalogue", products.filter((x) => x.id !== id));
  await log(env, who, `removed ${p.title}`);
  return { ok: true, fresh: { deleted: dv, catalogue: cv } };
}

export async function saveStore(env, patch, who, hint) {
  if (!env.STOCK) return { ok: false, error: NO_KV };
  const over = (await readRecord(env, "store", hint)) ?? {};
  for (const k of STORE_FIELDS) if (patch[k] !== undefined) over[k] = patch[k];
  const merged = { ...store0 }; for (const k of STORE_FIELDS) if (over[k] !== undefined) merged[k] = over[k];
  const errs = validate(merged, []);
  if (errs.length) return { ok: false, error: errs[0] };
  const v = await writeRecord(env, "store", over);
  await log(env, who, "store settings");
  return { ok: true, fresh: { store: v } };
}

/* ---------- Stock counting (KV). sold:<product>:<variant> = number sold so far. ---------- */
export const soldKey = (p, v) => `sold:${p}:${v}`;
export async function soldCount(env, p, v) { if (!env.STOCK) return 0; return Number((await env.STOCK.get(soldKey(p, v))) ?? 0); }
/** Every product's sold counts in one go, for the admin. { "pid:vid": n } */
export async function soldCounts(env, products) {
  const out = {};
  if (!env.STOCK) return out;
  await Promise.all(products.flatMap((p) => p.variants.map(async (v) => { if (typeof v.stock === "number") out[`${p.id}:${v.id}`] = await soldCount(env, p.id, v.id); })));
  return out;
}

/** The log of what changed, newest first. */
export async function recentChanges(env, n = 20) {
  if (!env.STOCK) return [];
  try { return JSON.parse((await env.STOCK.get("editlog")) ?? "[]").slice(0, n); } catch { return []; }
}

/** A logo the band uploaded in the admin (SVG or PNG), served at /favicon.svg and /logo. */
export async function putLogo(env, bytes, type) {
  if (!env.STOCK) return false;
  await env.STOCK.put("logo", bytes, { metadata: { type } });
  return true;
}
export async function getLogo(env) {
  if (!env.STOCK) return null;
  const got = await env.STOCK.getWithMetadata("logo", "arrayBuffer");
  return got?.value ? { bytes: got.value, type: got.metadata?.type ?? "image/svg+xml" } : null;
}

/* ---------- Images the band adds from a phone, kept in KV and served from this site ----------
   A product image path is one of three shapes: `images/x.jpg` (a file in the repo, served as a
   static asset), `img/k/<id>` (uploaded in the admin, kept in KV), or `img/r/<hash>` (a remote
   picture from a Shopify export, fetched once on first view and kept in KV from then on). Image
   keys are named by their content, so they are never rewritten and never stale. */

export const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export async function putImage(env, bytes, type) {
  if (!env.STOCK) return null;
  if (!IMAGE_TYPES[type]) return null;
  const id = hex(await crypto.subtle.digest("SHA-256", bytes)).slice(0, 20);
  await env.STOCK.put(`img:${id}`, bytes, { metadata: { type } });
  return `img/k/${id}`;
}

/** A remote image URL becomes a stable local path; the bytes are fetched the first time anyone asks. */
export async function rememberRemoteImage(env, url) {
  if (!env.STOCK || !/^https:\/\//.test(url)) return url;
  const h = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url))).slice(0, 20);
  await env.STOCK.put(`imgsrc:${h}`, url);
  return `img/r/${h}`;
}

/** GET /img/k/<id> and /img/r/<hash>. Long cache: the id is the content. */
export async function serveImage(env, url) {
  const m = url.pathname.match(/^\/img\/([kr])\/([a-f0-9]{8,40})$/);
  if (!m || !env.STOCK) return null;
  const [, kind, id] = m;
  const headers = (type) => ({ "content-type": type, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" });
  const got = await env.STOCK.getWithMetadata(`img:${id}`, "arrayBuffer");
  if (got?.value) return new Response(got.value, { headers: headers(got.metadata?.type ?? "image/jpeg") });
  if (kind !== "r") return null;
  const src = await env.STOCK.get(`imgsrc:${id}`);
  if (!src) return null;
  const res = await fetch(src, { signal: AbortSignal.timeout(10000), headers: { accept: "image/*" } }).catch(() => null);
  if (!res?.ok) return null;
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!IMAGE_TYPES[type]) return null;
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) return new Response(bytes, { headers: headers(type) });   // too big to keep, still shown
  await env.STOCK.put(`img:${id}`, bytes, { metadata: { type } });
  return new Response(bytes, { headers: headers(type) });
}

export const builtProducts = products0;
export const builtStore = store0;
