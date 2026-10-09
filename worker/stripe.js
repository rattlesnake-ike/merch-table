/* Stripe, by plain HTTPS. No SDK to install or update. */

export const STRIPE_VERSION = "2025-08-27.basil";

export function form(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" ? form(x, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === "object") form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

/** What is wrong with the key the band pasted, in words that say what to do. Null when it looks right. */
export function keyProblem(k) {
  if (!k) return "the store has no Stripe key yet. Put your Stripe SECRET key (it starts with sk_test_ or sk_live_) in the STRIPE_SECRET_KEY setting.";
  if (k.startsWith("pk_")) return "the PUBLISHABLE key was pasted instead of the secret one. In Stripe go to Developers → API keys, click Reveal on the Secret key, and copy the value starting sk_test_ or sk_live_ into STRIPE_SECRET_KEY.";
  if (k.startsWith("rk_")) return "a restricted key was used. It needs permission to write Checkout Sessions, or use the full secret key (sk_test_ or sk_live_).";
  if (k.startsWith("whsec_")) return "the webhook signing secret was pasted into STRIPE_SECRET_KEY. The secret key starts with sk_test_ or sk_live_; whsec_ belongs in STRIPE_WEBHOOK_SECRET.";
  if (!k.startsWith("sk_")) return "that doesn't look like a Stripe secret key. It should start with sk_test_ or sk_live_.";
  if (k.length < 40) return "the secret key looks cut short, as if the paste was incomplete. Copy the whole value from Stripe.";
  return null;
}

export const isLiveKey = (k) => String(k ?? "").startsWith("sk_live_");

export class StripeError extends Error { constructor(m, status) { super(m); this.status = status; } }

export async function stripe(env, method, path, body) {
  const problem = keyProblem(env.STRIPE_SECRET_KEY);
  if (problem) throw new StripeError(`Checkout isn't connected yet: ${problem}`, 503);
  const res = await fetch(`https://api.stripe.com/v1${path}`, { method, headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded", "stripe-version": STRIPE_VERSION }, body: body ? form(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("stripe", res.status, JSON.stringify(j.error ?? j));
    if (res.status === 401) throw new StripeError("Checkout isn't connected yet: Stripe rejected this key. Copy the Secret key again from Stripe → Developers → API keys (click Reveal), and make sure you're looking at the same account and the same test/live mode as the store. Check it at /admin/setup.", 503);
    throw new StripeError("The payment page couldn't be opened. Try again in a moment.", 502);
  }
  return j;
}
