/* Is this store ready to take money? One list, in plain words, with the fix next to each line — and
   where the store can do the fix itself, it does it before you see the list. Shown at /admin/setup. */
import { stripe, keyProblem, isLiveKey, STRIPE_VERSION } from "./stripe.js";
import { webhookSecret, rememberWebhook, ownersOf, PLACEHOLDER, siteOf, sampleIds } from "./live.js";

const WEBHOOK_EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];

/** Does the webhook on file match this key's mode and this address? */
function webhookState(w, live, hookUrl) {
  if (!w) return "none";
  if (w.from === "env") return "ok";
  if (typeof w.livemode === "boolean" && w.livemode !== live) return "mode";
  if (w.url && w.url !== hookUrl) return "moved";
  return "ok";
}

/**
 * Every check, as data. ok: true = fine, false = fix this, null = worth knowing, not a fault.
 * `form` on a check means the page shows an input right there (the Stripe key, the contact address).
 * With `fix: true` the store first connects orders itself when it can, so the band never presses anything.
 */
export async function setupChecks(env, url, store, hint, { fix = false, products = [] } = {}) {
  const site = siteOf(env, url);
  const checks = [];
  const add = (key, name, ok, detail, extra) => checks.push({ key, name, ok, detail, ...(extra ?? {}) });
  const k = env.STRIPE_SECRET_KEY;
  const problem = keyProblem(k);
  const live = isLiveKey(k);
  const fromAdmin = env.STRIPE_KEY_FROM === "admin";
  add("key", "Stripe key", !problem,
    problem ? (k ? problem[0].toUpperCase() + problem.slice(1) : "Paste your Stripe secret key here. In Stripe: Developers → API keys → Secret key → Reveal. It starts with sk_test_. Not the Publishable key (pk_…), which is the one Stripe shows first.")
      : live ? `A LIVE key${fromAdmin ? ", set here" : ""}: real cards are charged.` : `A test key${fromAdmin ? ", set here" : ""}. Try the store with card 4242 4242 4242 4242, any future date, any CVC. Nothing is charged.`,
    { form: "key", keyEnv: !!k && !fromAdmin });

  let acct = null;
  if (!problem) {
    try {
      acct = await stripe(env, "GET", "/account");
      add("account", "Stripe account", true, `Connected to ${acct.business_profile?.name || acct.email || acct.id}.${acct.charges_enabled ? "" : " Charges are not enabled yet: finish activating the account in Stripe (it asks for the band's details and a bank account)."}`);
      add("payouts", "Payouts", !!acct.payouts_enabled, acct.payouts_enabled ? "Stripe can pay you out." : "Add your bank details in Stripe before going live. Until then money would sit in Stripe.");
    } catch (e) { add("account", "Stripe account", false, e.message); }
  }

  const hookUrl = `${site}/api/webhook`;
  let w = await webhookSecret(env, hint);
  let state = problem ? "nokey" : webhookState(w, live, hookUrl);
  let connected = null;
  // The store connects itself when it can: a valid key, storage, and no matching webhook yet.
  if (fix && !problem && env.STOCK && state !== "ok") {
    try { connected = await connectOrders(env, url); if (connected.ok) { w = { from: "kv", livemode: connected.livemode, url: hookUrl, at: new Date().toISOString() }; state = "ok"; } }
    catch (e) { connected = { ok: false, error: e.message }; }
  }
  if (state === "nokey") add("orders", "Orders", false, "Once the key is in, the store connects itself to Stripe so orders arrive and stock is counted.");
  else if (state === "ok") add("orders", "Orders", true, w.from === "env" ? "Stripe tells the store when an order is paid (webhook secret set by hand)." : `Stripe tells this store when an order is paid${w.at ? `, connected ${new Date(w.at).toLocaleDateString(store.locale ?? "en-US", { day: "numeric", month: "short", year: "numeric" })}` : ""}.`);
  else add("orders", "Orders", false, connected?.error ? `Couldn't connect to Stripe: ${connected.error}` : state === "mode" ? `Connected for ${w.livemode ? "live" : "test"} mode, but the key is now a ${live ? "live" : "test"} key.` : state === "moved" ? `Connected at ${w.url}, but the store now answers at ${site}.` : "Stripe doesn't tell this store when someone pays yet.", { action: { label: "Connect orders", post: "/admin/connect" } });

  const owners = ownersOf(store, env);
  add("owners", "Who can sign in", !!(owners.length || env.ADMIN_KEY), owners.length ? `${owners.join(", ")}${env.ADMIN_KEY ? ", or anyone with the admin password." : "."}` : env.ADMIN_KEY ? "Anyone with the admin password." : "Nobody: set ADMIN_KEY in Cloudflare → Settings → Variables and Secrets.");

  const email = store.email ?? "";
  const contactOk = !!email && !PLACEHOLDER.test(email);
  add("contact", "Contact address", contactOk, contactOk ? `${email} is on every page and receipt. Someone reads it, right?` : "A buyer with a problem writes here; when nobody answers, they go to their bank. Type an address a person reads.", { form: "contact" });

  const samples = sampleIds(products);
  if (samples.length) add("samples", "Sample products", false, `${samples.length} made-up products from the template are still on the table (Northern Dogs). Remove them in one go; your own stay.`, { action: { label: "Remove the sample products", post: "/admin/samples" } });

  const host = url.hostname;
  add("domain", "Your own address", host.endsWith(".workers.dev") ? null : true, host.endsWith(".workers.dev") ? `The store answers at ${host}. When you own a domain: Cloudflare → Workers & Pages → this store → Settings → Domains & Routes → Add → Custom domain, and type something like shop.yourband.com. Nothing else to change; the store reconnects itself.` : `${host}. Fans and Stripe both use it.`);

  if (!problem && acct) {
    const pm = await paymentMethods(env).catch(() => null);
    if (pm) add("wallets", "Apple Pay, Google Pay, Link", pm.off.length ? false : true, pm.off.length ? `${pm.off.join(", ")} ${pm.off.length === 1 ? "is" : "are"} off. In Stripe: Settings → Payment methods → turn ${pm.off.length === 1 ? "it" : "them"} on. Fans buy more when their phone can pay.` : "On. Fans can pay with a tap.");
  }
  if (!problem) add("live", "Real money", live ? true : null, live ? "On. Buy the cheapest thing yourself with a real card and refund it in Stripe, once." : "Not yet: the key is a test key. When a test order has worked end to end, get the live one (Stripe → turn off Test mode → Developers → API keys → Secret key → Reveal) and paste it above. The store reconnects itself.");

  checks.push({ key: "coins", name: "Stablecoin payments", ok: null, detail: "Optional. Turning this on in your Stripe Dashboard costs 1.5% against 2.9% + 30¢ on cards, settles as dollars, and refunds to the buyer's wallet by itself. Expect very few people to use it." });

  const ready = checks.filter((c) => ["key", "account", "orders", "contact"].includes(c.key)).every((c) => c.ok);
  const todo = checks.filter((c) => c.ok === false).length;
  return { ready, todo, live, checks, connected };
}

/** Which wallets the band's Stripe account offers at checkout, from its default payment method configuration. */
async function paymentMethods(env) {
  const r = await stripe(env, "GET", "/payment_method_configurations?limit=10");
  const cfg = (r.data ?? []).find((c) => c.is_default) ?? r.data?.[0];
  if (!cfg) return null;
  const on = (m) => cfg[m]?.display_preference?.value === "on";
  const names = { apple_pay: "Apple Pay", google_pay: "Google Pay", link: "Link" };
  const off = Object.keys(names).filter((m) => cfg[m] && !on(m)).map((m) => names[m]);
  return { off };
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
