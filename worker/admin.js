/* The band's own admin: sign in with the admin password (or an emailed link), and run the store from
   a phone. This file is the door (tokens, sessions, sign-in) and the switchboard; the screens live in
   ./admin/. No GitHub, no files, no terminal: live edits go to KV and the Worker renders the pages
   from them; the repo stays the backup, not the bottleneck. */
import { ownersOf, sessionSecret, siteOf } from "./live.js";
import { keyProblem } from "./stripe.js";
import { page, manifest, html as adminHtml, escapeHtml, adminNav } from "./admin/ui.js";
import { homeScreen } from "./admin/home.js";
import { productsScreen, parsePrice, MAX_PRICE } from "./admin/products.js";
import { ordersScreen } from "./admin/orders.js";
import { storeScreen } from "./admin/store.js";
import { showsScreen, doorScreen } from "./admin/shows.js";
import { setupScreen } from "./admin/setup.js";
export { parsePrice, MAX_PRICE, escapeHtml, adminNav };

const enc = new TextEncoder();
const b64url = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0;
}

/** A token carries its own purpose. A sign-in link is NOT a session, and can never be replayed as one. */
export async function signToken(secret, payload, ttlSeconds) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds, jti: b64url(crypto.getRandomValues(new Uint8Array(9))) };
  const data = b64url(enc.encode(JSON.stringify(body)));
  return `${data}.${await hmac(secret, data)}`;
}
export async function verifyToken(secret, token, expectedPurpose) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [data, sig] = token.split(".");
  if (!sig || !timingSafeEqual(sig, await hmac(secret, data))) return null;
  let body; try { body = JSON.parse(new TextDecoder().decode(unb64url(data))); } catch { return null; }
  if (!body || body.exp < Math.floor(Date.now() / 1000)) return null;
  if (body.t !== expectedPurpose) return null;          // a link token can never act as a session
  return body;
}

const cookie = (req, name) => (req.headers.get("cookie") ?? "").split(";").map((c) => c.trim()).find((c) => c.startsWith(name + "="))?.slice(name.length + 1);

/**
 * A token tying this form to this session.
 *
 * Returns "" when there is nothing to sign with — a demo, or a store whose secret is not set
 * yet. It used to throw, which took down the whole product page with a 500 instead of
 * degrading. A page a band cannot open is worse than a form without a token on a store that
 * cannot save anything anyway; the POST side checks `demo` before trusting what comes back.
 */
export async function csrfToken(secret, session) {
  if (!secret || !session?.email && session?.via !== "key") return "";
  return (await hmac(secret, `csrf:${session.email ?? ""}:${session.gen ?? 0}`)).slice(0, 24);
}

/** Who is signed in: an owner by email, or whoever typed the admin password. */
export async function currentAdmin(req, env, store) {
  const sec = await sessionSecret(env);
  if (!sec) return null;
  const tok = cookie(req, "mt_session");
  if (!tok) return null;
  const s = await verifyToken(sec, tok, "session");
  if (!s) return null;
  if (s.via !== "key" && !ownersOf(store, env).includes(s.email)) return null;     // removed from owners = signed out everywhere
  if (env.STOCK && (await env.STOCK.get(`revoked:${s.email}:${s.gen ?? 0}`))) return null;
  return s;
}

/** A cross-site POST is refused outright. SameSite=Lax already blocks most of this;
    this does not depend on the browser getting that right. */
function sameOrigin(req, env, url) {
  if (req.method !== "POST") return true;
  const site = siteOf(env, url);
  const origin = req.headers.get("origin");
  if (origin) return origin === site || origin === url.origin;
  const referer = req.headers.get("referer");
  if (referer) { try { const r = new URL(referer); return r.origin === new URL(site).origin || r.origin === url.origin; } catch { return false; } }
  return false;   // a form POST from a browser always sends one of the two
}

const sessionCookie = (token, maxAge) => `mt_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const SESSION_DAYS = 30;
const KEY_AUTH_PATHS = ["/admin/setup", "/admin/connect", "/admin/stripe-key", "/admin/contact", "/admin/samples"];

export async function handleAdmin(req, env, url, store, products, hint = {}) {
  const path = url.pathname;
  const html = (body, status = 200, headers = {}) => adminHtml(page(`<main>${body}</main>`, store), status, headers);

  if (path === "/admin/manifest.webmanifest") return manifest(store);
  if (path === "/admin/icon.png") { const png = await env.ASSETS.fetch(new Request(new URL("/admin-icon.png", req.url))); return png.ok ? png : icon(store); }
  if (!sameOrigin(req, env, url)) return new Response("Refused: that request didn't come from this store.", { status: 403, headers: { "content-type": "text/plain" } });

  // DEMO_ADMIN=1 lets anyone look around the admin without signing in. Saves are refused.
  // Never set this on a real store: it shows your product list to the public.
  if (env.DEMO_ADMIN === "1") {
    if (req.method === "POST") return html(`<h1>This is the demo</h1><p>Nothing can be changed here. On your own store this would have saved and gone live at once.</p><p><a href="/admin">Back</a></p>`, 200);
    return await screens(req, env, url, store, products, { email: "you@yourband.com", gen: 0 }, true, hint);
  }
  const sec = await sessionSecret(env);
  if (!sec) return html(`<h1>Almost there</h1><p>To turn the admin on, add a setting called <code>ADMIN_KEY</code> (the password for this admin) in Cloudflare: your store → <b>Settings → Variables and Secrets</b>. Any long string you make up.</p><p>Then come back here and type it.</p>`, 503);
  const owners = ownersOf(store, env);

  // --- ask for a sign-in link by email (only reaches anyone when a mail service is set)
  if (path === "/admin/link" && req.method === "POST") {
    const form = await req.formData();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const rate = await bump(env, `rl:link:${email}`, 300);
    // Always answer the same way: never reveal whether an address is an owner.
    if (owners.includes(email) && rate <= 5) {
      const token = await signToken(sec, { t: "link", email }, 15 * 60);
      await sendLink(env, store, email, `${siteOf(env, url)}/admin/in?t=${token}`);
    }
    return html(`<h1>Check your email</h1><p>If <b>${escapeHtml(email)}</b> can sign in to this store, a link is on its way. It works once and expires in fifteen minutes.</p><p class="fine">No email? <a href="/admin">Sign in with the admin password instead.</a></p>`);
  }

  // --- click the link: exchange it for a session
  if (path === "/admin/in") {
    const t = url.searchParams.get("t") ?? "";
    const claim = await verifyToken(sec, t, "link");
    if (!claim || !owners.includes(claim.email)) return html(`<h1>That link didn't work</h1><p>It may have expired, or already been used. <a href="/admin">Ask for a new one</a>.</p>`, 400);
    if (env.STOCK) {
      const used = await env.STOCK.get(`used:${claim.jti}`);
      if (used) return html(`<h1>That link was already used</h1><p>Links work once. <a href="/admin">Ask for a new one</a>.</p>`, 400);
      await env.STOCK.put(`used:${claim.jti}`, "1", { expirationTtl: 3600 });
    }
    const session = await signToken(sec, { t: "session", email: claim.email, gen: 0 }, SESSION_DAYS * 24 * 3600);
    return new Response("", { status: 302, headers: { location: "/admin", "set-cookie": sessionCookie(session, SESSION_DAYS * 24 * 3600), "cache-control": "no-store" } });
  }

  // --- type the admin password: the way in that always works
  if (path === "/admin/key" && req.method === "POST") {
    const form = await req.formData();
    const typed = String(form.get("key") ?? "");
    const who = req.headers.get("cf-connecting-ip") ?? "unknown";
    const tries = await bump(env, `rl:key:${await shortHash(who)}`, 3600);
    if (tries > 10) return html(`<h1>Too many tries</h1><p>Wait an hour and try again.</p>`, 429);
    if (!env.ADMIN_KEY || !timingSafeEqual(typed, env.ADMIN_KEY)) return html(`<h1>That wasn't it</h1><p>The admin password is the <code>ADMIN_KEY</code> you gave Cloudflare when you deployed. Forgotten it? Cloudflare → your store → <b>Settings → Variables and Secrets</b> → edit <code>ADMIN_KEY</code> and set a new one; it takes effect at once.</p><p><a href="/admin">Try again</a></p>`, 401);
    const session = await signToken(sec, { t: "session", email: owners[0] ?? "", via: "key", gen: 0 }, SESSION_DAYS * 24 * 3600);
    // A store with no Stripe key yet opens on Setup, where the key is pasted; nothing else makes sense first.
    return new Response("", { status: 302, headers: { location: keyProblem(env.STRIPE_SECRET_KEY) ? "/admin/setup" : "/admin", "set-cookie": sessionCookie(session, SESSION_DAYS * 24 * 3600), "cache-control": "no-store" } });
  }

  if (path === "/admin/out") return new Response("", { status: 302, headers: { location: "/admin", "set-cookie": "mt_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" } });

  let me = await currentAdmin(req, env, store);

  // The setup check is also reachable with ?key=, as /api/setup always was, so a band can read it
  // before they have ever signed in.
  if (!me && KEY_AUTH_PATHS.includes(path)) {
    const key = url.searchParams.get("key") ?? (req.method === "POST" ? String((await req.clone().formData()).get("key") ?? "") : "");
    if (env.ADMIN_KEY && timingSafeEqual(key, env.ADMIN_KEY)) me = { email: owners[0] ?? "", via: "key", gen: 0, byKey: key };
  }

  // --- signed out: the sign-in form
  if (!me) {
    if (path !== "/admin") return new Response("", { status: 302, headers: { location: "/admin" } });
    const mail = env.RESEND_API_KEY && owners.length;
    return html(`<h1>${escapeHtml(store.name)}</h1><p class="sub">Sign in to run the store.</p>
      <form method="post" action="/admin/key" class="card"><label for="key">Admin password</label><input id="key" name="key" type="password" required autocomplete="current-password" autofocus><button type="submit">Sign in</button>
      <p class="fine">The <code>ADMIN_KEY</code> you gave Cloudflare when you deployed. You stay signed in on this device for ${SESSION_DAYS} days.</p></form>
      ${mail ? `<form method="post" action="/admin/link" class="card"><label for="email">Or get a link by email</label><input id="email" name="email" type="email" required autocomplete="email"><button type="submit">Email me a link</button><p class="fine">Only the owners of this store can sign in that way.</p></form>` : ""}`);
  }

  return await screens(req, env, url, store, products, me, false, hint);
}

async function screens(req, env, url, store, products, me, demo, hint) {
  const path = url.pathname;
  const sec = demo ? null : await sessionSecret(env);
  const tok = demo ? "" : await csrfToken(sec, me);
  const args = [req, env, url, store, products, me, demo, tok, hint];
  let res = null;
  if (path === "/admin") res = await homeScreen(...args);
  else if (path === "/admin/products" || path === "/admin/new" || path === "/admin/import" || path === "/admin/wants" || path === "/admin/wants.csv" || path.startsWith("/admin/p/")) res = await productsScreen(...args);
  else if (path === "/admin/orders" || path === "/admin/orders.csv" || path.startsWith("/admin/orders/")) res = await ordersScreen(...args);
  else if (path === "/admin/store") res = await storeScreen(...args);
  else if (path === "/admin/shows" || path.startsWith("/admin/shows/")) res = await showsScreen(...args);
  else if (path === "/admin/show") res = new Response("", { status: 302, headers: { location: "/admin/shows" } });
  else if (path === "/admin/door" || path.startsWith("/admin/door/")) res = await doorScreen(...args);
  else if (path === "/admin/setup" || KEY_AUTH_PATHS.includes(path)) res = await setupScreen(...args);
  return res ?? adminHtml(page(`${adminNav("", null, store)}<main><h1>Not found</h1><p><a href="/admin">Back</a></p></main>`, store), 404);
}

/** The home-screen icon: the store's first letter in its accent colour. */
function icon(store) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(store?.colors?.accent ?? "") ? store.colors.accent : "#2743d0";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" rx="96" fill="${accent}"/><text x="256" y="330" font-family="Helvetica,Arial,sans-serif" font-weight="900" font-size="280" fill="#fff" text-anchor="middle">${escapeHtml((store?.name || "M")[0].toUpperCase())}</text></svg>`;
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
}

async function bump(env, key, ttl) {
  if (!env.STOCK) return 0;
  const n = Number((await env.STOCK.get(key)) ?? 0) + 1;
  await env.STOCK.put(key, String(n), { expirationTtl: ttl });
  return n;
}

async function shortHash(s) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendLink(env, store, email, link) {
  const host = (() => { try { return new URL(link).hostname; } catch { return "store"; } })();
  const from = env.MAIL_FROM || `store@${host}`;
  const text = `Here's your link to edit ${store.name}:\n\n${link}\n\nIt works once and expires in fifteen minutes. If you didn't ask for it, ignore this email and nothing happens.`;
  if (env.RESEND_API_KEY) {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from, to: email, subject: `Sign in to ${store.name}`, text }) });
    if (!r.ok) console.error("resend", r.status, await r.text());
    return;
  }
  console.log("ADMIN SIGN-IN LINK (no mail service configured):", link);
}
