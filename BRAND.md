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

1. Put the `.woff2` files in `public/fonts/` (the folder is there, with a README and an example).
2. Copy `public/fonts/fonts.css.example` to `public/fonts/fonts.css` and edit it:

```css
@font-face { font-family: "YourFace"; src: url("/fonts/yourface.woff2") format("woff2"); font-weight: 400; font-display: swap; }
@font-face { font-family: "YourFace"; src: url("/fonts/yourface-bold.woff2") format("woff2"); font-weight: 800; font-display: swap; }
```

3. Set `"font": "YourFace"` in `store.json`.

It stays fast because the file is served from your own domain and nothing is fetched from
Google or anyone else. Check you have the right to use the face commercially.

If the name in `store.json` isn't one of the presets and `public/fonts/fonts.css` is
missing, `npm run build` says so rather than quietly falling back.

## 3. Rebuild it however you want (an afternoon, with an agent)

`src/templates.mjs` is every page as a plain function returning a string. There is no
component model and no magic: change the HTML and it changes. `src/site.css` is about 150
lines. Break either of them and `npm run build` tells you at once.

The pages are `indexPage`, `productPage`, `cartPage`, `thanksPage`, `shippingPage` and
`notFoundPage`. The data handed to them is exactly what's in `store.json` and
`products.json`.

### What the build adds to your CSS

`npm run build` appends a few lines *after* your stylesheet, built from `store.json`:

```css
:root{--ink:…;--paper:…;--accent:…;--radius:…;--display:…;--body:…}
h1,h2,h3{text-transform:uppercase}          /* from look.headings */
.card,.btn,input,select,textarea,.restock,.sz{border-radius:var(--radius)}
```

Because they come last, they beat anything you wrote on a plain `:root` or a bare
`h1,h2,h3`. That is deliberate when you only want the settings, and in the way when you're
properly restyling. **If you're restyling, set `"look": { "raw": true }` in `store.json`** —
the heading and corner rules are then not added at all, and only the custom properties
remain, which you can override in `:root` as normal.

**Rules worth keeping** when you or an agent rewrite the look, because they are why the
store is fast, private and hard to break:

- No third-party scripts, fonts or pixels. The Content-Security-Policy in `src/build.mjs`
  enforces it; if something needs loosening, you are usually adding a tracker.
- **Keep the hooks the script needs.** Mostly `data-` attributes, but three class names are
  load-bearing too: `.sz` (a size button) and `.sz.out` (a sold-out one), `.buy` (where the
  sold-out line gets inserted), and `.soldout` (that line). Inside a `.sz` label the script
  expects one `<input>` and one `<span>` holding the size name. The full list is in a comment
  at the top of `src/site.js`. Style all of them however you want; just don't rename them.
  Rename one and the cart or the sold-out handling breaks silently.
- **Test a sold-out product.** The shipped sample data has none fully sold out, so the code
  path is easy to miss. Set every variant of one product to `"available": false`, rebuild,
  and look at its page before you call the job done.
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

### Things that will trip you up

- **Rotating a full-width element causes sideways scrolling** on a phone. Rotate
  inline-block elements instead, or give the parent `overflow: hidden`. Check
  `document.documentElement.scrollWidth` is still 390 at 390px wide.
- **The cart is a four-column table.** It survives narrow screens because `.num` sets
  `white-space: nowrap`. Restyle `td` carefully, or change the markup to a list.
- **Inline SVG as a `data:` URI is allowed** by the store's Content-Security-Policy, so
  textures and patterns are available without adding an image file or a third-party asset.
- **A product card is a single `<a>`** with `.im`, `.t` and `.row` inside. For a stamp or
  band across the image, use `::after` on `.im`.
- **The sold-out wording** comes from `"sold_out_text"` in `store.json`, so you can change
  it without editing `src/site.js`.

### If you break it

`git checkout src/templates.mjs src/site.css` puts the look back exactly as it shipped.
Your products and settings are in different files and are never touched by that. If you
downloaded the store rather than cloning it, keep your own copy of those two files before
you start.
