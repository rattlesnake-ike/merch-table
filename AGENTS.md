# For the coding agent working in this folder

This is a band's merch store. Read README.md first; it says what everything is and how the band runs it day to day. Most of a band's work happens in the admin at `/admin` (products, photos, prices, store settings, Setup, orders), not in these files; you are here for the things the admin does not do — shipping regions, sections, bundles, drops, tickets, the design — and for fixing what breaks.

Rules that hold no matter what the band asks for:

- Never create an account on the band's behalf, and never ask for a password. When a service is needed, say exactly what to click and what it costs, then wait.
- Secrets stay out of the repo: `.dev.vars` locally, Worker secrets on Cloudflare. Never put a key in `wrangler.jsonc` or in any committed file. The three the store needs are `STRIPE_SECRET_KEY`, `ADMIN_KEY` (the admin password; the session secret is derived from it) and `OWNER_EMAIL`.
- No analytics, ad pixels, social pixels, link shorteners or third-party scripts. The store's only outside calls are to Stripe (and a price feed, only if the band takes coins). The Content-Security-Policy in `src/build.mjs` enforces this; loosen it only if the band asks and understands.
- Prices, stock and names are the band's. Never invent products or change a price unless told.
- If a step costs money, say the amount first. If a step is irreversible (DNS, cancelling a plan, switching Stripe to live), confirm first.
- Keep it a folder of plain files. Do not add a framework, a database or a build tool unless the band asks for something that needs one. `src/build.mjs` has no dependencies on purpose.
- `wrangler.jsonc` declares the KV namespace with no id on purpose: the Deploy button and `wrangler deploy` create one and later deploys inherit it. Do not paste an id in, and do not touch the `env.demo` block (that is the public demo's).

How the code fits together:

- `store.json` and `products.json` are the baseline data. `npm run check` validates them and says exactly what is wrong.
- `worker/live.js` is what is actually on sale: those files plus the band's edits from the admin, kept in KV as versioned records (the writer's browser carries the version it wrote in a cookie, so it reads its own change at once while KV converges). A product pushed in `products.json` still appears; one removed in the admin stays removed. If you change the shape of a product, change `validate()` in `src/lib.mjs` with it, because the admin's saves run through the same check.
- `src/templates.mjs` is the HTML of every page as plain functions. The Worker renders them per request from the live data (`worker/index.js`); `src/build.mjs` also writes them into `dist/` so `npm run dev` and a static preview work. `src/lib.mjs` holds `lookCss()` (the band's colours, corners, type) and `pageConfig()` (what `site.js` needs on every page), used by both.
- `worker/index.js` is the server: pages, `/api/checkout` (prices every line from the live catalogue, never from the browser), `/api/session`, `/api/stock`, `/api/restock`, `/api/webhook`, `/api/wants`, `/img/*` (photos uploaded in the admin, kept in KV).
- `worker/admin.js` is the band's admin; `worker/setup.js` the readiness checks and the one-press Stripe webhook registration; `worker/stripe.js` Stripe by plain HTTPS; `worker/orders.js`, `worker/tickets.js`, `worker/refunds.js` what their names say.
- `src/shopify.mjs` turns a Shopify CSV export into products, for both `npm run import` and the admin's Import screen.
- `npm test` runs the unit tests; `npm run dev` runs the store at http://localhost:8787 with `.dev.vars` (wrangler gives it a local KV).

⚠️ **The demo runs on a real Stripe TEST key.** Checkout opens a real Stripe page and a test
card completes a real order — nothing can move money, because the key is `sk_test_`. The cart
carries `store.demo_banner` so nobody mistakes it for a live shop. A band's own copy sets no
banner and shows none. `DEMO_ADMIN=1` (only in `env.demo`) opens the admin to everyone, read-only.

⚠️ **A push does not update the demo.** Isaac reads the live demo at
https://merch-table-demo.isaac-holze.workers.dev, so a fix that is only committed looks broken
to him. After any change to `src/`, `worker/` or the JSON, run:

    npm run deploy:demo

Then check the LIVE url, not `dist/`. This has already caused one "you didn't fix it" — the
fix was real and the deployed copy was three commits old.

⚠️ **KV reads can lag writes by up to a minute** in a location that read the key recently. That is
why records are versioned and the writer carries a cookie. If you add a new live record, write it
with `writeRecord`/read it with `readRecord` in `worker/live.js` and return its version in `fresh`
so the admin's redirect can set the cookie — never a plain `STOCK.put` that a page then reads back.

Before saying a change is done: `npm run check`, `npm test`, `npm run build`, then open the affected page at localhost:8787 on a phone-sized viewport and a laptop one, and if the admin changed, sign in with the `ADMIN_KEY` from `.dev.vars` and save something.
