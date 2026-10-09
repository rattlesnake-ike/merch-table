/* Setup: is this store ready to take money? Each row carries its fix. */
import { adminNav, html, page, escapeHtml, notice, saved } from "./ui.js";
import { setupChecks, connectOrders } from "../setup.js";
import { saveStripeKey, saveStore, removeSamples } from "../live.js";
import { keyProblem, stripe } from "../stripe.js";

export async function setupScreen(req, env, url, store, products, me, demo, tok, hint) {
  const path = url.pathname;
  const who = me.email || "admin";
  const keyQ = me.byKey ? `?key=${encodeURIComponent(me.byKey)}` : "";
  const hidden = `<input type="hidden" name="_t" value="${tok}">${me.byKey ? `<input type="hidden" name="key" value="${escapeHtml(me.byKey)}">` : ""}`;
  const checkTok = async (form) => demo || (String(form.get("_t") ?? "") === tok && tok !== "") || (me.byKey && String(form.get("key") ?? "") === me.byKey);
  const wrap = (body, title) => html(page(`${adminNav("/admin/setup", null, store)}<main>${body}</main>`, store, { title }));
  const bad = (t, d, status = 400) => wrap(`<h1>${escapeHtml(t)}</h1><p>${escapeHtml(d)}</p><p><a href="/admin/setup${keyQ}">Back</a></p>`, "Setup", status);
  const demoRefusal = () => wrap(`<h1>This is the demo</h1><p>On your own store this would have saved. <a href="/admin/setup">Back</a></p>`, "Demo");

  if (req.method === "POST") {
    if (demo) return demoRefusal();
    const form = await req.formData();
    if (!(await checkTok(form))) return bad("That form had gone stale", "Open it again.", 403);
    if (path === "/admin/stripe-key") {
      const key = String(form.get("stripe_key") ?? "").trim();
      const problem = keyProblem(key);
      if (problem) return bad("That key didn't look right", problem[0].toUpperCase() + problem.slice(1));
      // Checked against Stripe before it is kept, so a wrong paste is caught here and not at a fan's checkout.
      try { await stripe({ ...env, STRIPE_SECRET_KEY: key }, "GET", "/account"); }
      catch (e) { return bad("Stripe didn't accept that key", e.message); }
      const r = await saveStripeKey(env, key);
      if (!r.ok) return bad("Couldn't keep the key", r.error, 500);
      return saved(`/admin/setup?keyset=${key.startsWith("sk_live_") ? "live" : "test"}${me.byKey ? `&key=${encodeURIComponent(me.byKey)}` : ""}`, hint, r.fresh);
    }
    if (path === "/admin/contact") {
      const email = String(form.get("email") ?? "").trim().slice(0, 200);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad("That email didn't look right", "");
      const r = await saveStore(env, { email }, who, hint);
      if (!r.ok) return bad("Couldn't save", r.error, 500);
      return saved(`/admin/setup${keyQ}`, hint, r.fresh);
    }
    if (path === "/admin/samples") {
      const r = await removeSamples(env, store, products, who, hint);
      if (!r.ok) return bad("Couldn't remove them", r.error, 500);
      return saved(`/admin?saved=${encodeURIComponent("the sample products removed")}`, hint, r.fresh);
    }
    if (path === "/admin/connect") {
      try {
        const r = await connectOrders(env, url);
        if (!r.ok) return bad("Couldn't connect orders", r.error, 500);
        return saved(`/admin/setup?connected=${r.livemode ? "live" : "test"}${me.byKey ? `&key=${encodeURIComponent(me.byKey)}` : ""}`, hint, r.fresh);
      } catch (e) { return bad("Couldn't connect orders", e.message, 502); }
    }
    return null;
  }

  const r = demo ? demoChecks(store) : await setupChecks(env, url, store, hint, { fix: true, products });
  const formFor = (c) => {
    const link = c.link ? `<p class="go"><a href="${escapeHtml(c.link.href)}" target="_blank" rel="noopener">${escapeHtml(c.link.label)} ↗</a></p>` : "";
    if (demo) return link;
    if (c.form === "key") return link + (c.keyEnv ? `<p class="fine" style="margin:8px 0 0">Set in Cloudflare (Settings → Variables and Secrets). To change it, change it there.</p>` : `<form method="post" action="/admin/stripe-key">${hidden}<label for="stripe_key" class="tight">${c.ok ? "Swap it: paste the live key when you're ready" : "Your Stripe secret key"}</label><input id="stripe_key" name="stripe_key" type="password" autocomplete="off" spellcheck="false" placeholder="sk_test_…" required><button type="submit" class="small">${c.ok ? "Use this key" : "Save the key"}</button></form>`);
    if (c.form === "contact" && !c.ok) return link + `<form method="post" action="/admin/contact">${hidden}<label for="contact_email" class="tight">Contact email</label><input id="contact_email" name="email" type="email" autocomplete="email" placeholder="you@yourband.com" required><button type="submit" class="small">Save</button></form>`;
    if (c.action?.post) return link + `<form method="post" action="${c.action.post}">${hidden}<button type="submit" class="small">${escapeHtml(c.action.label)}</button></form>`;
    if (c.action?.href) return link + `<a class="btn small" href="${c.action.href}${keyQ}">${escapeHtml(c.action.label)}</a>`;
    return link;
  };
  const rows = r.checks.map((c) => `<div class="chk ${c.ok === null ? "info" : c.ok ? "ok" : "todo"}"><span class="mark">${c.ok === null ? "·" : c.ok ? "✓" : "✗"}</span><div><b>${escapeHtml(c.name)}</b><p>${escapeHtml(c.detail)}</p>${formFor(c)}</div></div>`).join("");
  const keyset = url.searchParams.get("keyset");
  const connected = url.searchParams.get("connected") || (r.connected?.ok ? (r.connected.livemode ? "live" : "test") : null);
  return wrap(`<header class="bar"><h1>Setup</h1></header>
    ${demo ? notice("On your own store each line here checks something real, and the forms do the fix. This is a picture of a store that is nearly ready.") : ""}
    ${keyset ? notice(`Stripe ${keyset} key saved. Checked with Stripe: it works.`, "ok") : ""}
    ${connected ? notice(`Orders connected (${connected} mode). Stripe will tell this store the moment someone pays.`, "ok") : ""}
    ${notice(`<b>${r.ready ? "Ready to take orders." : `${r.todo} thing${r.todo === 1 ? "" : "s"} to do before the store can take money.`}</b>${r.ready && !demo ? ` <a href="/admin/products">Put your products in.</a>` : ""}`, r.ready ? "ok" : "")}
    <div class="checks">${rows}</div>
    <p class="fine">Only whoever runs this store can open this page. It shows no customer data and no keys.</p>`, "Setup");
}

/** What the demo's setup page shows: a store nearly ready, so the shape of the page is clear. */
function demoChecks(store) {
  return { ready: false, todo: 1, checks: [
    { key: "key", name: "Stripe key", ok: true, detail: "A test key, set here. Try the store with card 4242 4242 4242 4242, any future date, any CVC. Nothing is charged. On your own store you paste the key into this row and it is checked with Stripe on the spot.", link: { href: "https://dashboard.stripe.com/test/apikeys", label: "Open your Stripe keys page" } },
    { key: "account", name: "Stripe account", ok: true, detail: `Connected to ${store.name}.` },
    { key: "payouts", name: "Payouts", ok: false, detail: "Add your bank details before going live. Until then money would sit in Stripe.", link: { href: "https://dashboard.stripe.com/settings/payouts", label: "Add bank details" } },
    { key: "orders", name: "Orders", ok: true, detail: "Stripe tells this store when an order is paid. The store connected itself the moment the key was in." },
    { key: "owners", name: "Who can sign in", ok: true, detail: "you@yourband.com, or anyone with the admin password." },
    { key: "contact", name: "Contact address", ok: true, detail: `${store.email} is on every page and receipt.` },
    { key: "domain", name: "Your own address", ok: null, detail: "The store answers at merch-table-demo.isaac-holze.workers.dev, which is fine to sell from. When you own a domain: on this store's settings page in Cloudflare, Domains & Routes → Add → Custom domain. The row links straight to that page on your own store." },
    { key: "wallets", name: "Apple Pay, Google Pay, Link", ok: true, detail: "On. Fans can pay with a tap." },
    { key: "receipts", name: "Receipts", ok: null, detail: "Stripe emails a receipt for every order if it's switched on: Settings → Emails → Successful payments. Worth a minute.", link: { href: "https://dashboard.stripe.com/settings/emails", label: "Email settings in Stripe" } },
    { key: "live", name: "Real money", ok: null, detail: "Not yet: the key is a test key. When a test order has worked end to end, paste the live key into the Stripe key row above. The store reconnects itself." },
  ] };
}
