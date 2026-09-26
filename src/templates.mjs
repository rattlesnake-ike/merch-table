// Page templates. Plain functions that return HTML strings. Edit freely; nothing here is magic.
import { esc, money, fmtDate, variantPrice, isLive, variantAvailable } from "./lib.mjs";

export function shell({ store, title, description, body, path, image, jsonld, extraHead = "" }) {
  const siteUrl = store.siteUrl;
  const t = title ? `${title} · ${store.name}` : store.name;
  return `<!doctype html>
<html lang="${esc(store.lang ?? "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t)}</title>
<meta name="description" content="${esc(description ?? store.description ?? "")}">
<link rel="canonical" href="${esc(siteUrl + path)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/site.css">
<link rel="alternate" type="application/rss+xml" title="${esc(store.name)}: new on the table" href="/feed.xml">
<link rel="alternate" type="application/merch+json" href="/merch.json">
<meta property="og:site_name" content="${esc(store.name)}">
<meta property="og:title" content="${esc(t)}">
<meta property="og:description" content="${esc(description ?? store.description ?? "")}">
<meta property="og:url" content="${esc(siteUrl + path)}">
${image ? `<meta property="og:image" content="${esc(image.startsWith("http") ? image : siteUrl + "/" + image)}">` : ""}
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ""}
${extraHead}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <a class="wm" href="/">${esc(store.name)}</a>
  <nav aria-label="Store">
    ${(store.links ?? []).map((l) => `<a href="${esc(l.url)}" rel="noopener">${esc(l.label)}</a>`).join("")}
    <a href="/cart/" class="cartlink" data-cart-link>Cart <span data-cart-count aria-live="polite"></span></a>
  </nav>
</header>
<main id="main">
${body}
</main>
<footer class="foot">
  <p>${esc(store.name)}${store.email ? ` · <a href="mailto:${esc(store.email)}">${esc(store.email)}</a>` : ""} · <a href="/orders">Where's my order?</a> · <a href="/shipping/">Shipping and returns</a> · <a href="/feed.xml">RSS</a></p>
  ${store.mailing_list?.action ? `<form class="list" action="${esc(store.mailing_list.action)}" method="post" target="_blank"><label for="ml">${esc(store.mailing_list.label ?? "Get an email when there is something new.")}</label><div><input id="ml" name="email" type="email" required placeholder="you@example.com" autocomplete="email"><button type="submit">Sign up</button></div></form>` : ""}
  <p class="fine">No tracking on this site. The only outside call is to the payment page when you check out.</p>
</footer>
<script src="/site.js" defer></script>
</body>
</html>`;
}

const productCard = (store, p) => {
  const live = isLive(p);
  const any = p.variants.some((v) => variantAvailable(v));
  const low = Math.min(...p.variants.map((v) => variantPrice(p, v)));
  const high = Math.max(...p.variants.map((v) => variantPrice(p, v)));
  const price = low === high ? money(low, store.currency, store.locale) : `from ${money(low, store.currency, store.locale)}`;
  const flag = !live ? `Drops ${fmtDate(p.live_at, store.locale)}` : !any ? "Sold out" : p.ship_date ? "Pre-order" : "";
  return `<a class="card${any && live ? "" : " sold"}" href="/products/${esc(p.id)}/" data-product="${esc(p.id)}">
    <span class="im">${p.images?.[0] ? `<img src="/${esc(p.images[0])}" alt="" loading="lazy" width="800" height="800">` : ""}</span>
    <span class="t">${esc(p.title)}</span>
    <span class="row"><span class="price">${price}</span>${flag ? `<span class="flag">${flag}</span>` : ""}</span>
  </a>`;
};

export function indexPage(store, products) {
  const shown = products.filter((p) => !p.hidden);
  const sections = (store.sections ?? []).map((s) => ({ ...s, items: shown.filter((p) => (p.kind ?? "other") === s.kind) })).filter((s) => s.items.length);
  const rest = shown.filter((p) => !(store.sections ?? []).some((s) => s.kind === (p.kind ?? "other")));
  if (rest.length) sections.push({ kind: "other", title: "Everything else", items: rest });
  const body = `
<section class="hero">
  <h1>${esc(store.name)}</h1>
  ${store.tagline ? `<p class="lede">${esc(store.tagline)}</p>` : ""}
</section>
${sections.map((s) => `<section class="sec" id="${esc(s.kind)}"><h2>${esc(s.title)}</h2><div class="grid">${s.items.map((p) => productCard(store, p)).join("")}</div></section>`).join("")}`;
  return shell({ store, body, path: "/", image: shown[0]?.images?.[0], jsonld: { "@context": "https://schema.org", "@type": "Store", name: store.name, url: store.siteUrl, ...(store.email ? { email: store.email } : {}) } });
}

export function productPage(store, p, products) {
  const live = isLive(p);
  const anyAvail = p.variants.some((v) => variantAvailable(v));
  const one = p.variants.length === 1;
  const variants = p.variants.map((v) => {
    const av = variantAvailable(v);
    const pr = variantPrice(p, v);
    return `<label class="sz${av ? "" : " out"}" data-variant="${esc(v.id)}" data-price="${pr}" data-available="${av}"><input type="radio" name="variant" value="${esc(v.id)}" ${av ? "" : "disabled"} ${one && av ? "checked" : ""}><span>${esc(v.title)}</span>${!av ? `<s aria-hidden="true"></s><span class="vis">sold out</span>` : pr !== p.price ? `<small>${money(pr, store.currency, store.locale)}</small>` : ""}</label>`;
  }).join("");
  const bundleParts = p.bundle ? `<p class="parts">Includes: ${p.bundle.map((b) => { const q = products.find((x) => x.id === b.product); return q ? `<a href="/products/${esc(q.id)}/">${esc(q.title)}</a>` : esc(b.product); }).join(", ")}.</p>` : "";
  const gallery = (p.images ?? []).map((src, i) => `<img src="/${esc(src)}" alt="${esc(p.title)}${i ? `, view ${i + 1}` : ""}" width="800" height="800" ${i ? 'loading="lazy"' : 'fetchpriority="high"'}>`).join("");
  const desc = (p.description ?? "").split(/\n\n+/).map((para) => `<p>${esc(para).replace(/\n/g, "<br>")}</p>`).join("");
  const body = `
<article class="product" data-product="${esc(p.id)}" data-sold-out-text="${esc(store.sold_out_text ?? "Sold out.")}" data-title="${esc(p.title)}" data-price="${p.price}" data-image="${esc(p.images?.[0] ?? "")}" ${p.live_at ? `data-live-at="${esc(p.live_at)}"` : ""} ${p.ship_date ? `data-ship-date="${esc(p.ship_date)}"` : ""}>
  <div class="gallery">${gallery}</div>
  <div class="buy">
    <p class="crumb"><a href="/">${esc(store.name)}</a> / ${esc(p.title)}</p>
    <h1>${esc(p.title)}</h1>
    <p class="price big"><span data-price-display>${money(p.price, store.currency, store.locale)}</span>${p.compare_at ? ` <s class="was">${money(p.compare_at, store.currency, store.locale)}</s>` : ""}</p>
    ${p.ship_date ? `<p class="ship">Pre-order. Ships ${fmtDate(p.ship_date, store.locale)}.</p>` : ""}
    ${!live ? `<p class="drop" data-drop>On sale ${fmtDate(p.live_at, store.locale)} at <time datetime="${esc(p.live_at)}">${esc(new Date(p.live_at).toLocaleTimeString(store.locale, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }))}</time>.</p>` : ""}
    <form class="addform" data-add ${live && anyAvail ? "" : "hidden"}>
      <fieldset class="sizes"><legend>${one ? "" : "Size"}</legend>${variants}</fieldset>
      <div class="qty"><label for="qty">Quantity</label><input id="qty" name="qty" type="number" min="1" max="10" value="1" inputmode="numeric"></div>
      <button class="btn" type="submit" data-add-btn ${one && anyAvail ? "" : "disabled"}>${p.ship_date ? "Pre-order" : "Add to cart"}</button>
      <p class="added" data-added hidden>Added. <a href="/cart/">Go to the cart</a> or keep looking.</p>
    </form>
    ${live && !anyAvail ? `<p class="soldout">Sold out.</p>` : ""}
    <form class="restock" data-restock hidden>
      <p>Want an email if this size comes back?</p>
      <div><input type="email" name="email" required placeholder="you@example.com" autocomplete="email" aria-label="Your email"><button class="btn ghost" type="submit">Tell me</button></div>
      <p class="fine" data-restock-msg></p>
    </form>
    <div class="desc">${desc}${bundleParts}</div>
    <p class="fine"><a href="/shipping/">Shipping and returns</a></p>
  </div>
</article>`;
  const offers = p.variants.map((v) => ({ "@type": "Offer", name: v.title, price: (variantPrice(p, v) / 100).toFixed(2), priceCurrency: store.currency.toUpperCase(), availability: variantAvailable(v) && live ? "https://schema.org/InStock" : live ? "https://schema.org/OutOfStock" : "https://schema.org/PreOrder", url: `${store.siteUrl}/products/${p.id}/` }));
  return shell({ store, title: p.title, description: (p.description ?? "").split("\n")[0].slice(0, 160), body, path: `/products/${p.id}/`, image: p.images?.[0], jsonld: { "@context": "https://schema.org", "@type": "Product", name: p.title, description: p.description, image: (p.images ?? []).map((i) => `${store.siteUrl}/${i}`), brand: { "@type": "Brand", name: store.name }, offers } });
}

export function cartPage(store) {
  const regions = store.shipping.map((r) => `<optgroup label="${esc(r.name)}">${r.countries.map((c) => `<option value="${c}">${esc(countryName(c, store.locale))}</option>`).join("")}</optgroup>`).join("");
  const body = `
<section class="cartpage">
  <h1>Cart</h1>
  <div data-cart-empty hidden><p class="lede">Nothing in it yet.</p><p><a class="btn" href="/">Back to the table</a></p></div>
  <div data-cart-full hidden>
    <table class="cart"><thead><tr><th>Item</th><th>Each</th><th>Qty</th><th class="num">Total</th></tr></thead><tbody data-cart-rows></tbody></table>
    <form class="checkout" data-checkout>
      <div class="field"><label for="country">Ships to</label><select id="country" name="country" required>${regions}</select><p class="fine" data-ship-note></p></div>
      <p class="totals"><span>Items</span><b data-subtotal></b></p>
      <p class="totals"><span>Shipping</span><b data-shipping></b></p>
      <p class="totals grand"><span>Total</span><b data-total></b></p>
      <p class="fine">Discount codes, tax where it applies, and Apple Pay, Google Pay or a card: all on the next page, which is run by Stripe. You'll get a receipt by email.</p>
      <button class="btn" type="submit" data-checkout-btn>Check out</button>
      <p class="err" data-checkout-err role="alert"></p>
    </form>
  </div>
</section>`;
  return shell({ store, title: "Cart", body, path: "/cart/", extraHead: `<meta name="robots" content="noindex">` });
}

export function thanksPage(store) {
  const body = `
<section class="thanks">
  <h1>Thank you.</h1>
  <p class="lede" data-thanks-line>Your order is in. A receipt is on its way to your email.</p>
  <div data-order hidden></div>
  <p>You can check on it any time at <a href="/orders">Where&rsquo;s my order</a>, with the email you paid with. Questions, or something wrong: <a href="mailto:${esc(store.email ?? "")}">${esc(store.email ?? "write to the band")}</a>. A person reads it.</p>
  <p><a class="btn ghost" href="/">Back to the table</a></p>
</section>`;
  return shell({ store, title: "Thank you", body, path: "/thanks/", extraHead: `<meta name="robots" content="noindex">` });
}

export function shippingPage(store) {
  const rows = store.shipping.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${money(r.amount, store.currency, store.locale)}${r.free_over ? `<br><small>free over ${money(r.free_over, store.currency, store.locale)}</small>` : ""}</td><td>${esc(r.estimate ?? "")}</td></tr>`).join("");
  const body = `
<section class="prose">
  <h1>Shipping and returns</h1>
  <p class="lede">Everything ships from us, packed by hand. Here's what it costs and how long it takes.</p>
  <table><thead><tr><th>Region</th><th class="num">Cost</th><th>Usually arrives</th></tr></thead><tbody>${rows}</tbody></table>
  <h2>Pre-orders</h2>
  <p>A pre-order ships on the date shown on its page. If your order also has something in stock, it all ships together when the pre-order does. Write to us if you'd rather have the in-stock part first.</p>
  <h2>Returns</h2>
  <p>${esc(store.returns ?? "Wrong size, or something arrived damaged? Write to us within 30 days and we'll swap it or refund it. You cover return postage for a size swap; we cover it if it's our mistake.")}</p>
  <p>Write to <a href="mailto:${esc(store.email ?? "")}">${esc(store.email ?? "")}</a> with your order number from the receipt.</p>
</section>`;
  return shell({ store, title: "Shipping and returns", body, path: "/shipping/" });
}

export function notFoundPage(store) {
  return shell({ store, title: "Not found", body: `<section class="prose"><h1>That page isn't here.</h1><p class="lede">It may have moved when we moved the store. <a href="/">Everything is on the front page.</a></p></section>`, path: "/404.html", extraHead: `<meta name="robots" content="noindex">` });
}

const names = { US: "United States", CA: "Canada", GB: "United Kingdom", IE: "Ireland", FR: "France", DE: "Germany", NL: "Netherlands", BE: "Belgium", ES: "Spain", IT: "Italy", PT: "Portugal", SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland", AT: "Austria", CH: "Switzerland", PL: "Poland", CZ: "Czechia", AU: "Australia", NZ: "New Zealand", JP: "Japan", MX: "Mexico", BR: "Brazil", KR: "South Korea", SG: "Singapore", HK: "Hong Kong", TW: "Taiwan", AR: "Argentina", CL: "Chile", ZA: "South Africa", IN: "India", IL: "Israel", GR: "Greece", HU: "Hungary", RO: "Romania", IS: "Iceland", LU: "Luxembourg" };
export function countryName(code, locale = "en") {
  try { const n = new Intl.DisplayNames([locale], { type: "region" }).of(code); if (n && n !== code) return n; } catch {}
  return names[code] ?? code;
}

export function rss(store, products) {
  const items = [...products].filter((p) => !p.hidden && isLive(p)).sort((a, b) => new Date(b.published ?? 0) - new Date(a.published ?? 0)).slice(0, 30);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${esc(store.name)}: new on the table</title><link>${esc(store.siteUrl)}</link><description>${esc(store.description ?? "")}</description>
${items.map((p) => `<item><title>${esc(p.title)}</title><link>${esc(store.siteUrl)}/products/${esc(p.id)}/</link><guid isPermaLink="true">${esc(store.siteUrl)}/products/${esc(p.id)}/</guid>${p.published ? `<pubDate>${new Date(p.published).toUTCString()}</pubDate>` : ""}<description>${esc(`${money(p.price, store.currency, store.locale)}. ${(p.description ?? "").split("\n")[0]}`)}</description></item>`).join("\n")}
</channel></rss>
`;
}

export function sitemap(store, products) {
  const urls = ["/", "/shipping/", ...products.filter((p) => !p.hidden).map((p) => `/products/${p.id}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(store.siteUrl + u)}</loc></url>`).join("\n")}\n</urlset>\n`;
}
