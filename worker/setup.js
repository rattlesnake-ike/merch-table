/* Is this store ready to take money? One list, in plain words, with the fix next to each line and a
   button where the store can do the fix itself. Shown at /admin/setup to whoever runs the store. */
import { stripe, keyProblem, isLiveKey, STRIPE_VERSION } from "./stripe.js";
import { webhookSecret, rememberWebhook, ownersOf, PLACEHOLDER, siteOf } from "./live.js";

const WEBHOOK_EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];

/** Every check, as data. ok: true = fine, false = fix this, null = worth knowing, not a fault. */
export async function setupChecks(env, url, store, hint) {
  const site = siteOf(env, url);
  const checks = [];
  const add = (key, name, ok, detail, action) => checks.push({ key, name, ok, detail, ...(action ? { action } : {}) });
  const k = env.STRIPE_SECRET_KEY;
  const problem = keyProblem(k);
  const live = isLiveKey(k);
  add("key", "Stripe key", !problem, problem ? problem[0].toUpperCase() + problem.slice(1) : live ? "A LIVE key: real cards are charged." : "A test key. Try the store with card 4242 4242 4242 4242, any future date, any CVC. Nothing is charged.");

  let acct = null;
  if (!problem) {
    try {
      acct = await stripe(env, "GET", "/account");
      add("account", "Stripe account", true, `Connected to ${acct.business_profile?.name || acct.email || acct.id}.${acct.charges_enabled ? "" : " Charges are not enabled yet: finish activating the account in Stripe (it asks for the band's details and a bank account)."}`);
      add("payouts", "Payouts", !!acct.payouts_enabled, acct.payouts_enabled ? "Stripe can pay you out." : "Add your bank details in Stripe before going live. Until then money would sit in Stripe.");
    } catch (e) { add("account", "Stripe account", false, e.message); }
  }

  const w = await webhookSecret(env, hint);
  const hookUrl = `${site}/api/webhook`;
  if (!w) add("orders", "Orders", false, "Stripe doesn't tell this store when someone pays yet, so the Orders list stays empty and stock isn't counted. One press fixes it.", { label: "Connect orders", post: "/admin/connect" });
  else if (w.from === "kv" && typeof w.livemode === "boolean" && w.livemode !== live) add("orders", "Orders", false, `Connected for ${w.livemode ? "live" : "test"} mode, but the key is now a ${live ? "live" : "test"} key. Press Connect again.`, { label: "Connect orders", post: "/admin/connect" });
  else if (w.from === "kv" && w.url && w.url !== hookUrl) add("orders", "Orders", false, `Connected at ${w.url}, but the store now answers at ${site}. Press Connect again so Stripe reaches the new address.`, { label: "Connect orders", post: "/admin/connect" });
  else add("orders", "Orders", true, w.from === "env" ? "Stripe tells the store when an order is paid (webhook secret set by hand)." : `Stripe tells this store when an order is paid${w.at ? `, connected ${new Date(w.at).toLocaleDateString(store.locale ?? "en-US", { day: "numeric", month: "short", year: "numeric" })}` : ""}.`);

  const owners = ownersOf(store, env);
  add("owners", "Who can sign in", !!(owners.length || env.ADMIN_KEY), owners.length ? `${owners.join(", ")}${env.ADMIN_KEY ? ", or anyone with the admin password." : "."}` : env.ADMIN_KEY ? "Anyone with the admin password. Add OWNER_EMAIL in Cloudflare (Settings → Variables and Secrets) to sign in by email as well." : "Nobody: set ADMIN_KEY or OWNER_EMAIL in Cloudflare → Settings → Variables and Secrets.");
  add("mail", "Sign-in by email", env.RESEND_API_KEY ? true : null, env.RESEND_API_KEY ? "On." : "Optional. Signing in with the admin password works now. For emailed links, add a Resend API key as RESEND_API_KEY and MAIL_FROM at your own domain.");

  const email = store.email ?? "";
  const contactOk = !!email && !PLACEHOLDER.test(email);
  add("contact", "Contact address", contactOk, contactOk ? `${email} is on every page and receipt. Someone reads it, right?` : "Put a real address in Store settings. A buyer with a problem writes there; when nobody answers, they go to their bank.", contactOk ? null : { label: "Store settings", href: "/admin/store" });

  const host = url.hostname;
  add("domain", "Your own address", host.endsWith(".workers.dev") ? null : true, host.endsWith(".workers.dev") ? `The store answers at ${host}. When you own a domain: Cloudflare → Workers & Pages → this store → Settings → Domains & Routes → Add → Custom domain, and type something like shop.yourband.com. Nothing else to change; come back and press Connect orders once more.` : `${host}. Fans and Stripe both use it.`);

  if (!problem) add("live", "Real money", live ? true : null, live ? "On. Buy the cheapest thing yourself with a real card and refund it in Stripe, once." : "Not yet: the key is a test key. When a test order has worked end to end, swap it for the live one: Stripe → turn off Test mode → Developers → API keys → Secret key; then Cloudflare → this store → Settings → Variables and Secrets → STRIPE_SECRET_KEY. Then press Connect orders again.");

  checks.push({ key: "coins", name: "Stablecoin payments", ok: null, detail: "Optional. Turning this on in your Stripe Dashboard costs 1.5% against 2.9% + 30¢ on cards, settles as dollars, and refunds to the buyer's wallet by itself. Expect very few people to use it." });

  const ready = checks.filter((c) => ["key", "account", "orders", "contact"].includes(c.key)).every((c) => c.ok);
  const todo = checks.filter((c) => c.ok === false).length;
  return { ready, todo, live, checks };
}

/**
 * Register this store's webhook with Stripe, so orders arrive and stock is counted, without the
 * band copying anything out of a dashboard. The signing secret is only returned when an endpoint
 * is created, so an endpoint we have no secret for is replaced rather than reused.
 */
export async function connectOrders(env, url) {
  if (!env.STOCK) return { ok: false, error: "This store has no storage yet (a KV namespace called STOCK), so there is nowhere to keep orders." };
  const site = siteOf(env, url);
  const hookUrl = `${site}/api/webhook`;
  const existing = await stripe(env, "GET", "/webhook_endpoints?limit=100");
  for (const e of existing.data ?? []) {
    if (e.url === hookUrl || e.metadata?.merch_table === site) await stripe(env, "DELETE", `/webhook_endpoints/${e.id}`);
  }
  const made = await stripe(env, "POST", "/webhook_endpoints", { url: hookUrl, enabled_events: WEBHOOK_EVENTS, api_version: STRIPE_VERSION, description: "merch-table: orders and stock", metadata: { merch_table: site } });
  const fresh = await rememberWebhook(env, { secret: made.secret, id: made.id, url: hookUrl, livemode: !!made.livemode, at: new Date().toISOString() });
  return { ok: true, livemode: !!made.livemode, fresh };
}
