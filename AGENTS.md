# For the coding agent working in this folder

This is a band's merch store. Read README.md first; it says what everything is and how the band runs it day to day.

Rules that hold no matter what the band asks for:

- Never create an account on the band's behalf, and never ask for a password. When a service is needed, say exactly what to click and what it costs, then wait.
- Secrets stay out of the repo: `.dev.vars` locally, Worker secrets on Cloudflare. Never put a key in `wrangler.jsonc` or in any committed file.
- No analytics, ad pixels, social pixels, link shorteners or third-party scripts. The store's only outside call is to Stripe. The Content-Security-Policy in `src/build.mjs` enforces this; loosen it only if the band asks and understands.
- Prices, stock and names are the band's. Never invent products or change a price unless told.
- If a step costs money, say the amount first. If a step is irreversible (DNS, cancelling a plan, switching Stripe to live), confirm first.
- Keep it a folder of plain files. Do not add a framework, a database or a build tool unless the band asks for something that needs one. `src/build.mjs` has no dependencies on purpose.

How the code fits together:

- `store.json` and `products.json` are the data. `npm run check` validates them and says exactly what is wrong.
- `src/build.mjs` renders `dist/` from the data using `src/templates.mjs` (HTML), `src/site.css` and `src/site.js`. `npm run build`.
- `worker/index.js` is the only server code: it prices the cart from `products.json` (never from the browser), creates the Stripe Checkout Session, reads it back for the thank-you page, counts stock in KV when the webhook is set up, and keeps back-in-stock requests.
- `scripts/import-shopify.mjs` turns a Shopify CSV export into `products.json`.
- `npm test` runs the unit tests; `npm run dev` runs the store at http://localhost:8787 with `.dev.vars`.

Before saying a change is done: `npm run check`, `npm test`, `npm run build`, then open the affected page at localhost:8787 on a phone-sized viewport and a laptop one.
