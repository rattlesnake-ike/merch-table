# Merch Table

Your band's own merch store. Static pages on your own domain, a cart, Stripe Checkout, hosted free on Cloudflare. No platform between you and your fans, no monthly rent, no tracking scripts. Leaving is copying a folder.

**What it does:** product pages with sizes and variants, sold-out sizes struck through, a cart, Apple Pay / Google Pay / Link / cards at checkout, discount codes, shipping by region with free-over thresholds, receipts, pre-orders (a ship date on the page, in the cart and on the receipt), bundles, drops that go on sale at a set time by themselves, back-in-stock requests, live stock counting, old Shopify URLs redirected, a sitemap, an RSS feed, `merch.json` for fan tools, and schema.org data for search engines. Two JSON files hold the whole catalogue.

**What it costs:** Stripe's card fee (2.9% + 30¢ on US cards) and your domain. Hosting is free on Cloudflare's plan for the traffic a band store gets, and the free plan allows commercial use.

**Live demo:** https://merch-table-demo.isaac-holze.workers.dev (a made-up band; checkout is not connected on the demo)

---

## Set up in an hour

You need three free accounts, all in the band's name: [Stripe](https://dashboard.stripe.com/register) (takes the money), [GitHub](https://github.com/signup) (holds the code), [Cloudflare](https://dash.cloudflare.com/sign-up) (hosts the store). Make them yourself; nothing here does it for you.

### 1. Deploy the empty store

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/rattlesnake-ike/merch-table)

Click the button. Cloudflare copies this repository into your GitHub account, asks you for the secrets below, builds it and gives you a `*.workers.dev` address. From then on, every push to your copy redeploys the store.

It will ask for:

| Secret | Where to find it |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys → **Secret key**. Use the **test** key (`sk_test_…`) for now. |
| `STRIPE_WEBHOOK_SECRET` | Leave blank for now. Step 6 fills it in. |
| `ADMIN_KEY` | Any long random string you make up. It protects the back-in-stock list. |

Prefer the command line? `git clone`, `npm install`, copy `.dev.vars.example` to `.dev.vars` and fill it in, then `npm run deploy`.

### 2. Put your store in it

Open your copy of the repo (on GitHub, or clone it to your laptop). Everything about the store lives in two files:

- **`store.json`**: the band's name, tagline, email, colours, the links in the header, shipping regions and prices, and whether Stripe collects tax and phone numbers.
- **`products.json`**: the catalogue. One entry per product; a product has variants (sizes). Prices are whole cents: `2500` is $25.00.

Coming from Shopify? In your Shopify admin go to **Products → Export → All products, Plain CSV**, save the file into `exports/`, and run:

```
npm run import -- exports/products_export_1.csv
npm run check
```

That writes `products.json` with your handles, prices, sizes, stock and images (images are pulled from Shopify once at build time and served from your own site). Product URLs stay `/products/<handle>/`, so old links keep working.

Put your logo or favicon in `brand/favicon.svg`. Product images go in `images/` (or stay as URLs; the build downloads them).

### 3. Check it and look at it

```
npm install
npm run check      # tells you exactly what is wrong in the JSON, if anything
npm run dev        # the store at http://localhost:8787, with Stripe in test mode
```

Add a shirt to the cart and check out with card number `4242 4242 4242 4242`, any future date, any CVC. You'll land on the thank-you page with the order shown.

### 4. Make it yours

`store.json` → `colors` sets the ink, paper and accent colours. `src/site.css` is the whole stylesheet, 150 lines. System fonts by default (zero bytes to download); to use your own, drop a `.woff2` in `public/fonts/`, add an `@font-face`, and set `--display` and `--body` at the top of the stylesheet.

If you use a coding agent (Claude Code, Codex, Cursor), open it in this folder and ask for what you want: "make the front page look like our album art in `brand/`", "add a second image to every product", "add a page for tour dates". Everything is plain HTML, CSS and JavaScript.

### 5. Your domain

In Cloudflare: **Workers & Pages → your worker → Settings → Domains & Routes → Add → Custom domain**, and enter `shop.yourband.com`. If your domain's DNS is at Cloudflare, that's it. If it's elsewhere, Cloudflare shows you the one CNAME record to add at your registrar.

Then set `SITE_URL` in `wrangler.jsonc` to `https://shop.yourband.com` and push. Stripe sends fans back to that address after paying.

### 6. Go live

1. Stripe Dashboard → turn off **Test mode** → Developers → API keys → copy the live secret key.
2. Cloudflare → your worker → **Settings → Variables and Secrets** → edit `STRIPE_SECRET_KEY` → paste it.
3. In Stripe: **Settings → Payment methods**: turn on Apple Pay, Google Pay and Link. **Settings → Emails**: turn on "Successful payments" so fans get receipts. **Products → Coupons** for any discount codes.
4. Optional, for live stock counting: **Developers → Webhooks → Add endpoint** → `https://shop.yourband.com/api/webhook`, event `checkout.session.completed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`. Then create the stock store: `npx wrangler kv namespace create STOCK`, paste the id into `wrangler.jsonc` under `kv_namespaces`, push.
5. Buy the cheapest thing yourself with a real card and refund it in Stripe. Check the receipt, the shipping line, and that the thank-you page shows the order.
6. Point everything at the new address: your homepage, Bandcamp, social bios. If you're leaving Shopify, set its store to redirect to yours for 90 days, then cancel once the last order ships.

---

## Day to day

| To… | Do this |
|---|---|
| Add a product | Add an entry to `products.json` (copy an existing one). Put the image in `images/`. `npm run check`, commit, push. |
| Change a price | Edit `price` (cents). Push. |
| Mark a size sold out | Set that variant's `"available": false`. Push. Or give variants a `"stock"` number and let the count do it. |
| Run a pre-order | Add `"ship_date": "2026-11-13"`. The page, cart and receipt say when it ships. |
| Run a drop | Add `"live_at": "2026-11-13T20:00:00-05:00"`. The page shows the date and time and opens itself at that moment. Nobody can check out before it. |
| Sell a bundle | Add `"bundle": [{"product":"lp","variant":"green"},{"product":"tee","variant":"*"}]`. `*` means the fan's chosen variant. When it sells, the parts' stock counts move. |
| Sale price | Add `"compare_at": 5300` (the old price, struck through). |
| Hide a product | `"hidden": true` keeps it off the front page; the URL still works. |
| Old Shopify URLs | Product handles already match. For anything else, add lines to `redirects.txt`: `/pages/about /shipping/`. |
| Shipping prices | `store.json` → `shipping`. Each region has countries, `amount` (cents), optional `free_over`, and an `estimate` line fans see. |
| Who wants a restock | `https://shop.yourband.com/api/wants?key=YOUR_ADMIN_KEY` downloads a CSV. Email them yourself from your mailing tool. |
| Export everything | It's already yours: the repo is the store. Orders and customers live in Stripe → Payments → Export. |
| Mailing list | `store.json` → `mailing_list.action`: the form URL from Buttondown, Mailchimp or your own tool. The sign-up appears in the footer. |

## What's where

```
store.json        the band, shipping, colours, links
products.json     the catalogue
images/           product images (or URLs in products.json)
brand/            favicon.svg, artwork for whoever designs
public/           anything copied as-is: fonts, extra pages
redirects.txt     old-path new-path, one per line
src/build.mjs     builds dist/ from the JSON (node, no dependencies)
src/templates.mjs the HTML of every page
src/site.css      the stylesheet
src/site.js       cart, size picker, drops, stock, checkout hand-off
worker/index.js   the server: /api/checkout, /api/session, /api/stock, /api/restock, /api/webhook, /api/wants
scripts/          import-shopify.mjs, check.mjs
```

## How it holds up

- Prices are never trusted from the browser. The Worker prices every line from `products.json`; the cart only says which items and how many.
- The Worker refuses sold-out sizes, unreleased drops and countries you don't ship to, before Stripe is involved.
- No third-party scripts. The Content-Security-Policy header only allows this site and the Stripe redirect. Blocking every tracker changes nothing.
- Secrets live in Cloudflare's encrypted secrets, never in the repo. `.dev.vars` is git-ignored.
- Webhook signatures are checked (HMAC, five-minute window), and each order is counted once even when Stripe retries.
- Static assets are served from Cloudflare's edge; the only server work is creating a checkout session.

## Limits, honestly

- Stock counting needs the optional KV namespace and webhook (step 6.4). Without them, sold out is whatever you set in `products.json`.
- Up to 10 of one item per order and 50 lines per cart; Stripe allows 100.
- Shipping is a flat rate per region. Weight-based rates would need code.
- Stripe Tax (0.5% per transaction) does the tax maths if you turn `tax.automatic` on and have registered in Stripe; filing is still yours.
- The Cloudflare free plan allows 100,000 Worker requests a day. Page views don't count against it (static files are free and unlimited), only checkouts and API calls.

## License

MIT. Take it, change it, sell shirts.
