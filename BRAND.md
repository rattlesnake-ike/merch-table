# Making the store yours

The store you deployed is deliberately plain. It is a folder of HTML, one stylesheet and
one small script — nothing generated, nothing to fight, no framework in the way. Everything
below is a way to make it look like your band and nobody else's.

Three levels, in order of effort.

## 1. Settings (ten minutes, no code)

`store.json`:

```json
"colors": { "ink": "#2b1a12", "paper": "#fbf6ee", "accent": "#a63d2f" },
"look":   { "corners": "round", "headings": "normal", "font": "serif" }
```

`ink` is the text, `paper` the background, `accent` the links and prices. Take them out of
your album art with a colour picker. `corners`: square, soft, round. `headings`: uppercase
or normal. `font`: system, grotesk, serif, slab, mono, rounded.

Your logo: put an SVG at `brand/favicon.svg`.

## 2. Your own typeface (half an hour)

A face nobody else has is the fastest way to stop looking like a template.

1. Put the `.woff2` files in `public/fonts/`.
2. Make `public/fonts/fonts.css`:

```css
@font-face { font-family: "YourFace"; src: url("/fonts/yourface.woff2") format("woff2"); font-weight: 400; font-display: swap; }
@font-face { font-family: "YourFace"; src: url("/fonts/yourface-bold.woff2") format("woff2"); font-weight: 800; font-display: swap; }
```

3. Set `"font": "YourFace"` in `store.json`.

It stays fast because the file is served from your own domain and nothing is fetched from
Google or anyone else. Check you have the right to use the face commercially.

## 3. Rebuild it however you want (an afternoon, with an agent)

`src/templates.mjs` is every page as a plain function returning a string. There is no
component model and no magic: change the HTML and it changes. `src/site.css` is about 150
lines. Break either of them and `npm run build` tells you at once.

The pages are `indexPage`, `productPage`, `cartPage`, `thanksPage`, `shippingPage` and
`notFoundPage`. The data handed to them is exactly what's in `store.json` and
`products.json`.

**Rules worth keeping** when you or an agent rewrite the look, because they are why the
store is fast, private and hard to break:

- No third-party scripts, fonts or pixels. The Content-Security-Policy in `src/build.mjs`
  enforces it; if something needs loosening, you are usually adding a tracker.
- Keep `data-` attributes on the buy form and the cart. The script finds things by those,
  not by class name, so you can restyle freely without breaking the cart.
- Prices are always formatted through `money()`, never hand-written.
- Keep the page working at 390 pixels wide. Most fans are on a phone.

### Prompts that work

Paste these into Claude Code, Codex or Cursor with the repo open. They are written to get
something that looks like you rather than something that looks like software.

**Make it look like the record**

> Here is our album art in `./brand/`. Redesign the storefront so it feels like it belongs
> with that record: pull the palette from the art, pick type that matches its mood, and set
> the pace of the pages the way the sleeve does. Change `src/templates.mjs` and
> `src/site.css` directly. Don't add a framework, don't add any third-party script or font,
> keep every `data-` attribute on the buy form and cart, and keep it working at 390px wide.
> Show me the front page and a product page on a phone and on a laptop before you finish.

**Stop it looking like a shop**

> Rebuild the front page so it reads like our own site, not a store: our own words at the
> top, the record we just put out treated as the main event, the shirts below it. The cart
> and product pages stay as they are. Same rules: no frameworks, no third-party anything,
> keep the `data-` attributes, works on a phone.

**One strong idea**

> Our band's whole visual identity is <describe it: hand-drawn, brutalist, xeroxed, neon,
> nautical, whatever it is>. Take that idea seriously and push it all the way through the
> store — type, spacing, borders, the way sold-out items look, the cart, the thank-you page.
> It should be obvious within one second whose store this is. Keep it readable and fast,
> keep the `data-` attributes, and show me before and after on a phone.

**Add a page**

> Add a `/shows` page listing our tour dates from a new `shows.json`, in the same style as
> the rest of the store, with a link in the header. Dates in the past drop off by
> themselves. Build it the way the other pages are built, in `src/templates.mjs` and
> `src/build.mjs`.

### If you break it

`git checkout src/templates.mjs src/site.css` puts the look back exactly as it shipped.
Your products and settings are in different files and are never touched by that.
