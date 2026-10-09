# Merch Table

Your band's own merch store, on your own domain, run from your phone. A cart, Apple Pay and cards through Stripe, free hosting on Cloudflare. No platform between you and your fans, no monthly rent, no tracking scripts. Leaving is copying a folder.

**What it does:** product pages with sizes, sold-out sizes struck through, a cart, Apple Pay / Google Pay / Link / cards at checkout, discount codes, shipping by region with free-over thresholds, receipts, pre-orders (a ship date on the page, in the cart and on the receipt), drops that go on sale at a set time by themselves, bundles, back-in-stock requests, live stock counting, an order list with tracking and a dispute pack, tickets to your own shows with a door check-in, old Shopify URLs redirected, a sitemap, an RSS feed, `merch.json` for fan tools, and schema.org data for search engines.

**How you run it:** an admin on your phone. Add a product with a photo from your camera roll, change a price, count stock, put a show on sale, pack and refund orders, change the shipping prices and the colours. The files in this folder are the baseline and the backup; a coding agent can change anything the admin doesn't reach.

**What it costs:** Stripe's card fee (2.9% + 30¢ on US cards) and your domain. Hosting is free on Cloudflare's plan for the traffic a band store gets, and the free plan allows commercial use.

**Live demo:** https://merch-table-demo.isaac-holze.workers.dev — and the [admin the band uses](https://merch-table-demo.isaac-holze.workers.dev/admin), which you can look around without signing in. (A made-up band. Checkout runs in Stripe's test mode and nothing on the demo can be saved.)

---

## Set up in an hour

You need three free accounts, all in the band's name: [Stripe](https://dashboard.stripe.com/register) (takes the money), [GitHub](https://github.com/signup) (holds the code), [Cloudflare](https://dash.cloudflare.com/sign-up) (hosts the store). Make them yourself; nothing here does it for you.

### 1. Deploy the store

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/rattlesnake-ike/merch-table)

Click the button. Cloudflare copies this repository into your GitHub account, asks you for **one thing** — a password for your store's admin (`ADMIN_KEY`; make up something long and keep it) — creates the storage the admin needs, builds the store and gives you a `*.workers.dev` address. From then on, every push to your copy redeploys the store — but you will rarely need to push anything.

**Give the project a name nobody has used**, like `yourband-store`. If you see a red *"Cloudflare could not create the Git repository"*, that name is already taken in your GitHub account: change it and click Deploy again.

Prefer the command line? `git clone`, `npm install`, copy `.dev.vars.example` to `.dev.vars` and fill it in, then `npm run deploy`. Wrangler creates the storage for you too.

### 2. Open the admin

Go to **`your-store-address/admin`** on your phone and type the password. You land on **Setup**, which checks whether the store can take money and names anything that isn't right, with the fix in the same row:

- **Paste your Stripe secret key.** In Stripe: **Developers → API keys → Secret key → Reveal**; it starts with `sk_test_`. ⚠️ Not the *Publishable* key (`pk_…`), which is the one Stripe shows first. The store checks the key with Stripe on the spot, keeps it encrypted under your admin password, and connects itself to Stripe so orders arrive and stock is counted. Nothing to copy anywhere else.
- **Type the contact email.** It goes on every page and receipt. A person must read it.
- **Remove the sample products** in one tap when you have your own.

Then **Store** (the band's name, the colours picked out of your artwork, the type) and **Add a product**: a name, a price, the sizes, a photo from your camera roll. It's on sale when you press the button. Coming from Shopify? **Import from Shopify**: in your Shopify admin, **Products → Export → All products → Plain CSV**, then choose the file in the admin. Names, prices, sizes, stock, descriptions and pictures come across, and every product keeps its old address, so links to `/products/<name>` still work.

### 3. Try it

Add a shirt to the cart and check out with card number `4242 4242 4242 4242`, any future date, any CVC. You land on the thank-you page with the order shown, and it appears under **Orders** in the admin.

### 4. Your own domain

Buy it at [Cloudflare](https://www.cloudflare.com/products/registrar/), [Porkbun](https://porkbun.com/) or [Namecheap](https://www.namecheap.com/), in the band's name. In Cloudflare: **Workers & Pages → your store → Settings → Domains & Routes → Add → Custom domain**, and type `shop.yourband.com`. If your DNS is elsewhere, Cloudflare shows you the one CNAME record to add at your registrar. Nothing in the store needs changing; it answers at whatever address it's reached on, and reconnects itself to Stripe the next time you open Setup.

### 5. Go live

1. Stripe Dashboard → turn off **Test mode** → Developers → API keys → copy the live secret key.
2. In the admin's **Setup**, paste it into the Stripe key row. The store checks it and reconnects itself (Stripe keeps test and live apart).
3. Setup tells you if Apple Pay, Google Pay or Link are off in your Stripe account (**Settings → Payment methods**). In Stripe also turn on **Settings → Emails → Successful payments** so fans get receipts, and make any discount codes under **Products → Coupons**.
4. Buy the cheapest thing yourself with a real card and refund it in Stripe. Check the receipt, the shipping line, and that the thank-you page shows the order.
5. Point everything at the new address: your homepage, Bandcamp, social bios. If you're leaving Shopify, set its store to redirect to yours for 90 days, then cancel once the last order ships.

---

## Day to day: the admin

Most days you don't touch a file. Go to **`your-store-address/admin`** (or tap **Run this store** at the bottom of any page), sign in with the admin password (you stay signed in on that phone for a month), and the home screen shows what needs you: orders to pack, money this month, sizes running low or sold out, what changed last. Add it to your phone's home screen and it opens like an app, in your store's colour.

- **Products:** add one with photos from your camera roll (shrunk in the browser before they upload), a price, a was-price for sales, the sizes, how many of each are left, a pre-order ship date, a drop time after which the page opens itself. Search, filter by section, move products up and down, duplicate one, remove one. **Import from Shopify** reads the CSV export. **Who wants a restock** lists the fans who asked.
- **Orders:** to pack, shipped, all; search by name, email, item or tracking. Each order has a packing slip that prints on one sheet, a box for the tracking number, a dispute pack with every field a bank asks for, and a refund button. The whole list downloads as CSV.
- **Shows:** add a show from your phone (room, date, price, how many the venue lets you sell, what the room holds) and tickets go on sale; see how it's selling; move it or call it off, and refund everyone who bought a ticket with one press. **Door** is the check-in screen, built for one hand in bad light.
- **Store:** the band's name, contact email, logo, colours and type; shipping regions and prices; the sections on the front page; the links in the header; the mailing-list form; what shows on the card statement; your returns line; Stripe Tax.
- **Setup:** is the store ready to take money, with the fix in each row and a direct link to the exact Stripe or Cloudflare screen.

Everything the admin saves is live for you at once and for everyone else within a minute.

**Signing in by email** instead of the password is optional: add a [Resend](https://resend.com) API key as `RESEND_API_KEY` and `MAIL_FROM` at your domain, and the owners listed in `OWNER_EMAIL` (several addresses, comma-separated) get a one-time link.

**How it's kept safe:** the password is checked in constant time and tries are rate-limited; a sign-in link works once and expires in fifteen minutes; neither can ever be replayed as a session; saves are refused unless they come from your own store, and every form carries a token tied to your session. Rotating `ADMIN_KEY` in Cloudflare signs every device out.

## Orders, and not losing an argument with a bank

Every paid order lands at **`/admin/orders`**: who ordered, what, where it goes, and a box for the tracking number. Put the tracking in when you post it. That one habit is the difference between winning and losing if a buyer ever tells their bank the parcel never came.

Your buyers get **`/orders`** on the store, linked from the footer and the thank-you page. They type the email they paid with and see their own order and its tracking. Nothing else is shown, and an address is never revealed there. Most disputes are not fraud, they're someone who forgot or couldn't find you, so this page and a reply-to address prevent more chargebacks than any fraud tool.

If a dispute does arrive, open the order and click **"If this is ever disputed"**. Every field Stripe's response form asks for is already filled in, because the store recorded it when the order was placed: the product description, the terms the buyer agreed to, the country the order came from, the shipping address and date, the tracking number, and how many times that buyer has ordered from you before. That last one matters: Visa's Compelling Evidence rule lets two earlier undisputed orders from the same buyer overturn a fraud claim outright.

**What protects the buyer**, in the same breath: a real refund policy shown at checkout, their own order page, a human to write to, and a store that keeps no card details at all. Card numbers never touch this code, only Stripe's.

**One setting worth turning on.** In Stripe, **Radar** screens every payment for free and blocks the highest-risk ones. If you sell something expensive, add a rule under Radar → Rules: `Request 3D Secure if :risk_level: != 'normal'`. When a buyer authenticates that way, fraud liability moves from you to their bank.

## Tickets: sell your own shows

A ticket is a product with a `show` block. Add one to `products.json` and the store sells tickets — no ticketing company, no service fee, no per-ticket cut. The fan pays the price on the page.

```json
{
  "id": "release-show-brooklyn",
  "title": "Harbor Lights release show — Brooklyn",
  "price": 1800,
  "variants": [{ "id": "advance", "title": "Advance", "available": true, "stock": 120 }],
  "show": {
    "title": "Harbor Lights release show",
    "venue": "The Broadway", "city": "Brooklyn, NY",
    "date": "2026-11-13", "time": "20:00", "doors": "8pm",
    "allocation": 120, "room_capacity": 250
  }
}
```

**The fan** goes to `/tickets`, types the email they bought with, and gets their tickets with a big code on each. Tell them to save the page before they leave home, so it works if the venue has no signal.

**The door** is `/admin/door` on a phone. Someone types the code and gets a green *Let them in* or a red *Already used*, with the buyer's name. Each code works exactly once, is tied to one seat in one order, and can't be invented without your store's secret. Typing it in lowercase or without the dash works fine, because that's how people type at a door.

**What it costs you:** Stripe's 2.9% + 30¢. Nothing else. On an $18 ticket that's about 82¢. Ticketmaster's service fees run about 21% of the ticket, and even the 2026 settlement caps them at 15% of face value.

**Where this doesn't reach:** a venue with an exclusive ticketing contract. That's a contract, not a technical limit, and no software gets around it. `allocation` is how many the venue agreed you may sell; `room_capacity` is what the room holds. Selling outside the venue's count is how a show gets shut down, so the setup check asks for both.

## Taking crypto, if you want to

Short version: **turn on stablecoin payments in your Stripe Dashboard.** One toggle, no code here changes, and it is cheaper than the cards you already take — 1.5% against 2.9% + 30¢. It settles as dollars in the same Stripe balance, so there is no wallet to guard, no price swing, and nothing new at tax time. **Expect almost nobody to use it:** under 2% of US consumers pay with crypto at all. Taking coins into your own wallet is also possible (`wallets` in `store.json`) and is a different, harder project; the comments in `worker/coins.js` say why.

## The files, when you want them

Everything the admin edits lives in Cloudflare's storage on top of two files in this folder. The files are the baseline and the backup; the admin's changes win where they overlap, a product pushed in `products.json` still appears, and a product removed in the admin stays removed.

| To… | Do this |
|---|---|
| Add a product, change a price, count stock, swap a photo, a sale price, a pre-order, a drop | The admin. (`"ship_date"`, `"live_at"` and `"compare_at"` in the file do the same.) |
| Shipping regions, sections, header links, the mailing list, the logo | The admin's Store screen. |
| Sell tickets to a show, move it, call it off, refund it | The admin's Shows screen. |
| Sell a bundle | `"bundle": [{"product":"lp","variant":"green"},{"product":"tee","variant":"*"}]`. `*` means the fan's chosen variant. When it sells, the parts' stock counts move. |
| Sale price | `"compare_at": 5300` (the old price, struck through). |
| Old Shopify URLs | Product handles already match. For anything else, add lines to `redirects.txt`: `/pages/about /shipping/`. |
| Who wants a restock | `https://shop.yourband.com/api/wants?key=YOUR_ADMIN_KEY` downloads a CSV. Email them yourself from your mailing tool. |
| Mailing list | `store.json` → `mailing_list.action`: the form URL from Buttondown, Mailchimp or your own tool. The sign-up appears in the footer. |
| Your own typeface, a real redesign | `BRAND.md`. |
| Export everything | It's already yours: the repo is the store. Orders and customers live in Stripe → Payments → Export. |

Working on the files on a laptop: `npm install`, `npm run check` (says exactly what is wrong in the JSON, if anything), `npm run dev` (the store at http://localhost:8787 with `.dev.vars`), `npm test`, push to deploy.

## What's where

```
store.json        the band, shipping, colours, links (the admin's Store screen edits the first few)
products.json     the catalogue (the admin adds to it and edits it)
images/           the sample band's drawings (scripts/sample-art.mjs redraws them); photos added in the admin live in storage
brand/            favicon.svg, artwork for whoever designs
public/           anything copied as-is: fonts, extra pages
redirects.txt     old-path new-path, one per line
src/build.mjs     builds dist/ (stylesheet, script, images, feeds) — node, no dependencies
src/templates.mjs the HTML of every page; the Worker renders them live
src/site.css      the stylesheet
src/site.js       cart, size picker, drops, stock, checkout hand-off
src/lib.mjs       validation, money, the look, shared by build and Worker
src/shopify.mjs   the Shopify CSV reader, shared by `npm run import` and the admin
worker/index.js   the server: pages, /api/checkout, /api/session, /api/stock, /api/restock, /api/webhook, /api/wants
worker/admin.js   the band's admin: sign-in and the switchboard; the screens are in worker/admin/ (home, products, orders, store, shows + door, setup, ui)
worker/live.js    what's on sale right now: files + the band's edits; secrets derived or kept
worker/setup.js   the readiness checks, and connecting orders to Stripe
worker/stripe.js  Stripe by plain HTTPS
worker/orders.js  orders, tracking, the buyer's lookup, the dispute pack
worker/tickets.js ticket codes, the fan's tickets, the door
worker/refunds.js refunding a cancelled show
scripts/          import-shopify.mjs, check.mjs
```

## How it holds up

- Prices are never trusted from the browser. The Worker prices every line from the live catalogue; the cart only says which items and how many.
- The Worker refuses sold-out sizes, hidden products, unreleased drops and countries you don't ship to, before Stripe is involved.
- No third-party scripts. The Content-Security-Policy header only allows this site and the Stripe redirect. Blocking every tracker changes nothing.
- Secrets never touch the repo. `ADMIN_KEY` is a Cloudflare secret; `.dev.vars` is git-ignored. The Stripe key you paste in Setup is kept in storage encrypted (AES-GCM) under a key derived from `ADMIN_KEY`, the same secret that already guards the whole store; set `STRIPE_SECRET_KEY` as a Cloudflare secret instead if you prefer, and it wins. The session secret is derived from `ADMIN_KEY` too (`SESSION_SECRET` overrides); the webhook secret the store registers for itself is kept in storage (`STRIPE_WEBHOOK_SECRET` overrides).
- Webhook signatures are checked (HMAC, five-minute window), and each order is counted once even when Stripe retries.
- Photos uploaded in the admin are shrunk in the browser before upload and served from your own address with a year-long cache.

## Limits, honestly

- The admin edits products, shows, orders and the store's settings. Bundles, the currency and the design itself are still a file and a push (or a coding agent, see `AGENTS.md`).
- Up to 10 of one item per order and 50 lines per cart; Stripe allows 100.
- Shipping is a flat rate per region. Weight-based rates would need code.
- Stripe Tax (0.5% per transaction) does the tax maths if you turn `tax.automatic` on and have registered in Stripe; filing is still yours.
- The Cloudflare free plan allows 100,000 Worker requests a day. Page views, checkouts and API calls count; images, the stylesheet and the script are static files and don't.

## License

MIT. Take it, change it, sell shirts.
