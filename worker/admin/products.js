/* Products: the list, one product, a new one, duplicates, order, and the Shopify import. */
import { adminNav, html, page, money, escapeHtml, imgSrc, currencySign, notice, field, text, select, saved } from "./ui.js";
import { saveProducts, removeProduct, putImage, rememberRemoteImage, IMAGE_TYPES, MAX_IMAGE_BYTES, soldCounts, sampleIds } from "../live.js";
import { convertShopifyCsv, slug } from "../../src/shopify.mjs";
import { variantAvailable, isLive, fmtDate } from "../../src/lib.mjs";

export const MAX_PRICE = 100000 * 100;   // $100,000: a typo guard, not a limit anyone will meet
/** Read a typed price. Returns whole cents, or null if it isn't a sane positive amount.
    Checks what was TYPED: stripping characters first turns "-5" into 5 and a typo into a live price. */
export function parsePrice(raw) {
  const s = String(raw ?? "").trim().replace(/[$£€¥]/g, "").replace(/,/g, "").trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;      // no minus, no exponent, no spaces, at most 2 decimals
  const cents = Math.round(Number(s) * 100);
  if (!Number.isFinite(cents) || cents <= 0 || cents > MAX_PRICE) return null;
  return cents;
}

const sectionsOf = (store) => [...(store.sections ?? []).map((s) => [s.kind, s.title]), ...(store.sections?.some((s) => s.kind === "other") ? [] : [["other", "Everything else"]])];

export async function productsScreen(req, env, url, store, products, me, demo, tok, hint) {
  const path = url.pathname;
  const who = me.email || "admin";
  const hidden = `<input type="hidden" name="_t" value="${tok}">${me.byKey ? `<input type="hidden" name="key" value="${escapeHtml(me.byKey)}">` : ""}`;
  const checkTok = async (form) => demo || (String(form.get("_t") ?? "") === tok && tok !== "") || (me.byKey && String(form.get("key") ?? "") === me.byKey);
  const stale = (back) => html(page(`${adminNav("/admin/products", null, store)}<main><h1>That form had gone stale</h1><p>Open it again and make the change once more. <a href="${back}">Back</a></p></main>`, store), 403);
  const demoRefusal = (back) => html(page(`${adminNav("/admin/products", null, store)}<main><h1>This is the demo</h1><p>On your own store this would have saved and gone live at once. <a href="${back}">Back</a></p></main>`, store));
  const fail = (title, detail, back, status = 400) => html(page(`${adminNav("/admin/products", null, store)}<main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p><p><a href="${back}">Back</a></p></main>`, store), status);
  const sections = sectionsOf(store);

  /* --- the list --- */
  if (path === "/admin/products" && req.method === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const sec = url.searchParams.get("section") ?? "";
    const sold = demo ? {} : await soldCounts(env, products);
    let list = products;
    if (q) list = list.filter((p) => `${p.title} ${p.id} ${p.description ?? ""}`.toLowerCase().includes(q));
    if (sec) list = list.filter((p) => (p.kind ?? "other") === sec);
    const row = (p, i) => {
      const sizes = p.variants.map((v) => { const n = sold[`${p.id}:${v.id}`] ?? 0; const ok = variantAvailable(v, n); return `<span class="${ok ? "in" : "out"}">${escapeHtml(v.title)}${ok && typeof v.stock === "number" ? `<small>(${v.stock - n})</small>` : ""}</span>`; }).join(" ");
      const tags = [p.hidden ? `<span class="tag">hidden</span>` : "", !isLive(p) ? `<span class="tag new">drops ${fmtDate(p.live_at, store.locale)}</span>` : "", p.ship_date ? `<span class="tag new">pre-order</span>` : "", p.variants.every((v) => !variantAvailable(v, sold[`${p.id}:${v.id}`] ?? 0)) ? `<span class="tag hot">sold out</span>` : "", p.sample ? `<span class="tag">sample</span>` : ""].filter(Boolean).join(" ");
      const move = demo || q || sec ? "" : `<form method="post" action="/admin/p/${encodeURIComponent(p.id)}/move" class="bare move">${hidden}<button name="dir" value="up" title="Move up" ${i === 0 ? "disabled" : ""}>↑</button><button name="dir" value="down" title="Move down" ${i === products.length - 1 ? "disabled" : ""}>↓</button></form>`;
      return `<div class="row"><a href="/admin/p/${encodeURIComponent(p.id)}" class="thumb">${p.images?.[0] ? `<img src="${imgSrc(p.images[0])}" alt="" loading="lazy">` : ""}</a><a class="meta" href="/admin/p/${encodeURIComponent(p.id)}" style="text-decoration:none;color:inherit"><b>${escapeHtml(p.title)} ${tags}</b><small>${money(p.price, store)} · ${sizes}</small></a>${move}<a class="go" href="/admin/p/${encodeURIComponent(p.id)}">›</a></div>`;
    };
    const savedMsg = url.searchParams.get("saved");
    return html(page(`${adminNav("/admin/products", null, store)}<main>
      <header class="bar"><h1>Products</h1></header>
      ${savedMsg ? notice(`Saved: ${escapeHtml(savedMsg)}. It's live for you now, and for everyone within a minute.`, "ok") : ""}
      ${demo ? notice("Tap a product to see its page: prices, sizes with stock counts, photos, pre-orders, drops. Nothing here can be saved.") : ""}
      <div class="actions"><a class="btn" href="/admin/new">Add a product</a><a class="btn ghost" href="/admin/import">Import from Shopify</a><a class="btn ghost" href="/admin/wants">Who wants a restock</a></div>
      <form method="get" class="search bare"><input name="q" value="${escapeHtml(q)}" placeholder="Search" aria-label="Search products">${sec ? `<input type="hidden" name="section" value="${escapeHtml(sec)}">` : ""}<button type="submit" class="small">Find</button></form>
      <div class="filters"><a href="/admin/products${q ? `?q=${encodeURIComponent(q)}` : ""}" class="${sec ? "" : "on"}">All</a>${sections.map(([k, t]) => `<a href="/admin/products?section=${encodeURIComponent(k)}${q ? `&q=${encodeURIComponent(q)}` : ""}" class="${sec === k ? "on" : ""}">${escapeHtml(t)}</a>`).join("")}</div>
      <div class="list">${list.length ? list.map(row).join("") : `<p class="empty">${q || sec ? "Nothing matches." : "Nothing on the table yet. Add your first product above."}</p>`}</div>
      <p class="fine">${list.length} product${list.length === 1 ? "" : "s"}. The order here is the order on the store; the arrows move a product within its section and on the front page.</p>
    </main>`, store, { title: "Products" }));
  }

  /* --- a new product --- */
  if (path === "/admin/new") {
    if (req.method === "POST") {
      if (demo) return demoRefusal("/admin/new");
      if (Number(req.headers.get("content-length") ?? 0) > 40 * 1024 * 1024) return fail("Those photos are too big", "Try fewer at a time.", "/admin/new", 413);
      const form = await req.formData();
      if (!(await checkTok(form))) return stale("/admin/new");
      const r = await readProductForm(form, env, store, null, products, {});
      if (r.error) return fail(r.error.title, r.error.detail, "/admin/new");
      const w = await saveProducts(env, store, [...products, r.product], who, `added ${r.product.title}`);
      if (!w.ok) return fail("Couldn't save", w.error, "/admin/new", 500);
      return saved(`/admin/products?saved=${encodeURIComponent(r.product.title)}`, hint, w.fresh);
    }
    return html(page(`${adminNav("/admin/products", { href: "/admin/products", label: "All products" }, store)}<main><header class="bar"><h1>Add a product</h1></header>
      ${demo ? notice("On your own store this form adds a product, photo and all, from your phone. Here it can't save.") : ""}
      <form method="post" enctype="multipart/form-data" class="card">${hidden}${productFields(null, store, sections, {})}<button type="submit">Put it on the table</button></form></main>`, store, { title: "Add a product" }));
  }

  /* --- import from a Shopify export --- */
  if (path === "/admin/import") {
    if (req.method === "POST") {
      if (demo) return demoRefusal("/admin/import");
      if (Number(req.headers.get("content-length") ?? 0) > 20 * 1024 * 1024) return fail("That file is too big", "", "/admin/import", 413);
      const form = await req.formData();
      if (!(await checkTok(form))) return stale("/admin/import");
      const f = form.get("csv");
      if (!f || typeof f === "string") return fail("No file", "Choose the .csv Shopify gave you.", "/admin/import");
      const { products: incoming, problems } = convertShopifyCsv(await f.text(), products);
      if (!incoming.length) return fail("Nothing in that file", problems[0] ?? "No products were found.", "/admin/import");
      const replace = form.get("replace") === "on";
      const next = [...products]; let added = 0, replaced = 0, kept = 0;
      for (const p of incoming) {
        p.images = await Promise.all((p.images ?? []).map((u) => rememberRemoteImage(env, u)));
        const i = next.findIndex((x) => x.id === p.id);
        if (i === -1) { next.push(p); added++; } else if (replace) { next[i] = p; replaced++; } else kept++;
      }
      const w = await saveProducts(env, store, next, who, `imported ${added} from Shopify${replaced ? `, replaced ${replaced}` : ""}`);
      if (!w.ok) return fail("Couldn't save", w.error, "/admin/import", 500);
      return html(page(`${adminNav("/admin/products", { href: "/admin/products", label: "All products" }, store)}<main><h1>Imported</h1><p><b>${added}</b> product${added === 1 ? "" : "s"} added${replaced ? `, <b>${replaced}</b> replaced` : ""}${kept ? `, <b>${kept}</b> already here and left alone` : ""}. Pictures are fetched from Shopify the first time anyone looks and kept here from then on.</p>${problems.length ? notice(`Worth a look:<br>${problems.map(escapeHtml).join("<br>")}`) : ""}<p><a class="btn" href="/admin/products">See the products</a></p></main>`, store, { title: "Imported" }), 200, { "set-cookie": (await import("../live.js")).freshCookie({ ...hint, ...w.fresh }) });
    }
    return html(page(`${adminNav("/admin/products", { href: "/admin/products", label: "All products" }, store)}<main><header class="bar"><h1>Import from Shopify</h1></header>
      <p class="sub">In your Shopify admin: <b>Products → Export → All products → Plain CSV file</b>. Shopify emails it to you; save it, then choose it here. Names, prices, sizes, sold-out sizes, stock counts, descriptions and pictures all come across, and every product keeps its old address, so links to <code>/products/&lt;name&gt;</code> still work.</p>
      ${demo ? notice("On your own store the file is read right here and the products appear at once. Here it can't save.") : ""}
      <form method="post" enctype="multipart/form-data" class="card">${hidden}
        ${field("csv", "The export", `<input id="csv" name="csv" type="file" accept=".csv,text/csv" required>`)}
        <label class="sw"><input type="checkbox" name="replace"><span>Replace products that are already here</span><small>off: anything with the same address is left as it is</small></label>
        <button type="submit">Import</button></form></main>`, store, { title: "Import" }));
  }

  /* --- who wants a restock --- */
  if (path === "/admin/wants") {
    const wants = demo ? [] : await listWants(env);
    const byProduct = new Map();
    for (const w of wants) { const p = products.find((x) => x.id === w.product); const k = `${w.product}:${w.variant}`; if (!byProduct.has(k)) byProduct.set(k, { p, variant: w.variant, emails: [] }); byProduct.get(k).emails.push(w.email); }
    const rows = [...byProduct.values()].sort((a, b) => b.emails.length - a.emails.length).map(({ p, variant, emails }) => `<div class="card"><b>${escapeHtml(p?.title ?? "a product that's gone")}</b>${variant && variant !== "*" ? ` · ${escapeHtml(p?.variants.find((v) => v.id === variant)?.title ?? variant)}` : ""} <span class="tag">${emails.length} waiting</span><p class="fine" style="margin:6px 0 0">${emails.map(escapeHtml).join(", ")}</p></div>`).join("");
    return html(page(`${adminNav("/admin/products", { href: "/admin/products", label: "All products" }, store)}<main><header class="bar"><h1>Who wants a restock</h1></header>
      <p class="sub">Fans who asked to hear when a size comes back. When it does, email them yourself from your mailing tool; nothing here sends mail.</p>
      ${demo ? notice("On your own store the requests pile up here by product and size, with a CSV to download.") : ""}
      ${rows || `<p class="empty">Nobody waiting yet. A sold-out size on the store offers the form.</p>`}
      ${wants.length ? `<p class="fine"><a href="/admin/wants.csv">Download as CSV</a></p>` : ""}</main>`, store, { title: "Restock requests" }));
  }
  if (path === "/admin/wants.csv") {
    const wants = demo ? [] : await listWants(env);
    return new Response("product,variant,email,at\n" + wants.map((w) => `${w.product},${w.variant},${w.email},${w.at}`).join("\n") + "\n", { headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=back-in-stock.csv", "cache-control": "no-store" } });
  }

  /* --- one product --- */
  if (path.startsWith("/admin/p/")) {
    const [idRaw, action] = path.slice("/admin/p/".length).split("/");
    const id = decodeURIComponent(idRaw);
    const i = products.findIndex((x) => x.id === id);
    const p = products[i];
    if (!p) return html(page(`${adminNav("/admin/products", { href: "/admin/products", label: "All products" }, store)}<main><h1>Not found</h1></main>`, store), 404);
    const back = `/admin/p/${encodeURIComponent(id)}`;

    if (action === "delete" && req.method === "POST") {
      if (demo) return demoRefusal(back);
      const form = await req.formData();
      if (!(await checkTok(form))) return stale(back);
      const r = await removeProduct(env, store, products, id, who, hint);
      if (!r.ok) return fail("Couldn't remove it", r.error, back, 500);
      return saved(`/admin/products?saved=${encodeURIComponent(`${p.title} removed`)}`, hint, r.fresh);
    }
    if (action === "duplicate" && req.method === "POST") {
      if (demo) return demoRefusal(back);
      const form = await req.formData();
      if (!(await checkTok(form))) return stale(back);
      const copy = structuredClone(p); delete copy.sample;
      copy.id = uniqueId(`${p.id}-copy`, products); copy.title = `${p.title} (copy)`; copy.hidden = true; copy.published = new Date().toISOString();
      const next = [...products]; next.splice(i + 1, 0, copy);
      const w = await saveProducts(env, store, next, who, `duplicated ${p.title}`);
      if (!w.ok) return fail("Couldn't save", w.error, back, 500);
      return saved(`/admin/p/${encodeURIComponent(copy.id)}?copied=1`, hint, w.fresh);
    }
    if (action === "move" && req.method === "POST") {
      if (demo) return demoRefusal("/admin/products");
      const form = await req.formData();
      if (!(await checkTok(form))) return stale("/admin/products");
      const dir = form.get("dir") === "up" ? -1 : 1;
      const j = i + dir;
      if (j < 0 || j >= products.length) return saved("/admin/products", hint, {});
      const next = [...products]; [next[i], next[j]] = [next[j], next[i]];
      const w = await saveProducts(env, store, next, who, `moved ${p.title} ${dir < 0 ? "up" : "down"}`);
      if (!w.ok) return fail("Couldn't save", w.error, "/admin/products", 500);
      return saved("/admin/products", hint, w.fresh);
    }
    if (req.method === "POST") {
      if (demo) return demoRefusal(back);
      if (Number(req.headers.get("content-length") ?? 0) > 40 * 1024 * 1024) return fail("Those photos are too big", "Try fewer at a time.", back, 413);
      const form = await req.formData();
      if (!(await checkTok(form))) return stale(back);
      const sold = await soldCounts(env, [p]);
      const r = await readProductForm(form, env, store, p, products, sold);
      if (r.error) return fail(r.error.title, r.error.detail, back);
      const w = await saveProducts(env, store, products.map((x) => (x.id === id ? r.product : x)), who, describe(p, r.product, store));
      if (!w.ok) return fail("Couldn't save", w.error, back, 500);
      return saved(`/admin/products?saved=${encodeURIComponent(r.product.title)}`, hint, w.fresh);
    }

    const sold = demo ? {} : await soldCounts(env, [p]);
    return html(page(`${adminNav("/admin/products", { href: "/admin/products", label: "All products" }, store)}<main><header class="bar"><h1>${escapeHtml(p.title)}</h1><a class="ghost" href="/products/${encodeURIComponent(p.id)}/" target="_blank" rel="noopener">On the store ↗</a></header>
      ${url.searchParams.get("copied") ? notice("Copied. It's hidden until you untick <b>Hide from the store</b> below.", "ok") : ""}
      ${p.show ? notice(`This is a ticket. The show itself (date, venue, allocation, calling it off) is under <a href="/admin/shows/${encodeURIComponent(p.id)}">Shows</a>.`) : ""}
      <form method="post" enctype="multipart/form-data" class="card">${hidden}${productFields(p, store, sections, sold)}<button type="submit">Save</button></form>
      <div class="actions"><form method="post" action="${back}/duplicate" class="bare">${hidden}<button type="submit" class="btn ghost small" style="margin:0">Duplicate</button></form></div>
      <form method="post" action="${back}/delete" class="danger" onsubmit="return confirm('Take ${escapeHtml(p.title).replace(/'/g, "\\'")} off the table for good?')">${hidden}<button type="submit">Remove this product</button><p class="fine" style="margin:10px 0 0">Sold out for now? Untick its sizes above instead, so fans can ask to hear when it's back.</p></form>
    </main>`, store, { title: p.title }));
  }

  return null;
}

/** The product form, shared by new and edit. `sold` = { "pid:vid": n } for remaining counts. */
function productFields(p, store, sections, sold) {
  const isNew = !p;
  const sizes = !isNew && p.variants.length ? p.variants.map((v) => {
    const n = sold[`${p.id}:${v.id}`] ?? 0;
    const left = typeof v.stock === "number" ? Math.max(0, v.stock - n) : "";
    return `<label class="sw" data-sz><input type="checkbox" name="v_${escapeHtml(v.id)}" ${v.available === false ? "" : "checked"}><span>${escapeHtml(v.title)}${v.price != null && v.price !== p.price ? ` <small>${money(v.price, store)}</small>` : ""}</span><small data-state>${v.available === false ? "sold out" : "in stock"}</small><span class="n"><input name="stock_${escapeHtml(v.id)}" inputmode="numeric" value="${left}" placeholder="∞" aria-label="How many left"> left</span></label>`;
  }).join("") : "";
  const pics = (p?.images ?? []).map((src, i) => `<label class="pic${i === 0 ? " main" : ""}"><img src="${imgSrc(src)}" alt=""><span><input type="radio" name="main_img" value="${escapeHtml(src)}" ${i === 0 ? "checked" : ""}> main</span><span><input type="checkbox" name="rm_img" value="${escapeHtml(src)}"> remove</span></label>`).join("");
  const liveAt = p?.live_at ? new Date(p.live_at) : null;
  const liveLocal = liveAt && !Number.isNaN(liveAt.getTime()) ? p.live_at.slice(0, 16) : "";
  return `
    ${pics ? `<div class="pics">${pics}</div>` : ""}
    ${field("photos", pics ? "Add photos" : "Photos", `<input id="photos" name="photos" type="file" accept="image/*" multiple>`, "from your camera roll; the first is the main picture")}
    ${field("title", "Name", text("title", p?.title ?? "", 'required maxlength="200" placeholder="Dog logo tee"' + (isNew ? " autofocus" : "")))}
    <div class="two">
      ${field("price", "Price", `<div class="money"><span>${currencySign(store)}</span><input id="price" name="price" inputmode="decimal" value="${p ? (p.price / 100).toFixed(2) : ""}" required placeholder="25"></div>`)}
      ${field("compare_at", "Was", `<div class="money"><span>${currencySign(store)}</span><input id="compare_at" name="compare_at" inputmode="decimal" value="${p?.compare_at ? (p.compare_at / 100).toFixed(2) : ""}" placeholder=""></div>`, "optional: struck through next to the price")}
    </div>
    ${sizes ? `<label>Sizes <small>untick to mark sold out; a number is how many are left, empty means no count</small></label><div class="sizes">${sizes}</div>` : ""}
    ${field("sizes", sizes ? "Add sizes" : "Sizes", text("sizes", "", 'placeholder="S, M, L, XL, 2XL" autocapitalize="characters"'), sizes ? "separated by commas" : "separated by commas; leave empty if there's one size")}
    ${isNew ? field("stock", "How many of each size", text("stock", "", 'inputmode="numeric"'), "optional; empty means no count") : ""}
    ${field("kind", "Section", select("kind", sections, p?.kind ?? "apparel"))}
    ${field("description", "Description", `<textarea id="description" name="description" rows="5" placeholder="Heavyweight cotton, printed by hand in Queens. Runs true to size.">${escapeHtml(p?.description ?? "")}</textarea>`)}
    <div class="two">
      ${field("ship_date", "Pre-order ship date", `<input id="ship_date" name="ship_date" type="date" value="${escapeHtml(p?.ship_date ?? "")}">`, "empty if it's in stock")}
      ${field("live_at", "Goes on sale", `<input id="live_at" name="live_at" type="datetime-local" value="${escapeHtml(liveLocal)}">`, "a drop: the page opens itself then")}
    </div>
    <label class="sw"><input type="checkbox" name="hidden" ${p?.hidden ? "checked" : ""}><span>${isNew ? "Keep it off the store for now" : "Hide from the store"}</span><small>the page exists, it just isn't listed</small></label>`;
}

/* ---------- reading a product form, for a new product or an existing one ---------- */
export async function readProductForm(form, env, store, existing, products, sold = {}) {
  const title = String(form.get("title") ?? "").trim().slice(0, 200);
  if (!title) return { error: { title: "It needs a name", detail: "Give the product a name fans will recognise." } };
  const cents = parsePrice(form.get("price"));
  if (cents === null) return { error: { title: "That price didn't look right", detail: `Use a plain number, like 25 or 25.00, and no more than ${money(MAX_PRICE, store)}.` } };
  const next = existing ? structuredClone(existing) : { id: uniqueId(slug(title) || "item", products), title, price: cents, kind: "other", description: "", images: [], variants: [], published: new Date().toISOString() };
  next.title = title; next.price = cents;
  const cmpRaw = String(form.get("compare_at") ?? "").trim();
  if (cmpRaw) { const c = parsePrice(cmpRaw); if (c === null || c <= cents) return { error: { title: "The old price didn't look right", detail: "The 'was' price has to be a plain number higher than the price." } }; next.compare_at = c; } else delete next.compare_at;
  next.description = String(form.get("description") ?? "").slice(0, 4000);
  const kind = String(form.get("kind") ?? next.kind ?? "other");
  if (/^[a-z0-9-]{1,30}$/.test(kind)) next.kind = kind;
  next.hidden = form.get("hidden") === "on" ? true : undefined;
  const shipDate = String(form.get("ship_date") ?? "").trim();
  next.ship_date = /^\d{4}-\d{2}-\d{2}$/.test(shipDate) ? shipDate : undefined;
  const liveRaw = String(form.get("live_at") ?? "").trim();
  if (liveRaw) { const d = new Date(liveRaw); if (Number.isNaN(d.getTime())) return { error: { title: "That date didn't look right", detail: "Pick the date and time the drop opens." } }; next.live_at = liveRaw.length === 16 ? `${liveRaw}:00` : liveRaw; } else delete next.live_at;

  // Sizes: existing ones keep their id, become sold out when unticked, and take a remaining count.
  if (existing) next.variants = existing.variants.map((v) => {
    const out = { ...v, available: form.get(`v_${v.id}`) === "on" };
    const raw = String(form.get(`stock_${v.id}`) ?? "").trim();
    if (raw === "") delete out.stock;
    else if (/^\d{1,6}$/.test(raw)) out.stock = Number(raw) + (sold[`${existing.id}:${v.id}`] ?? 0);   // the band types what's LEFT; the count stores what there WAS
    return out;
  });
  const stockRaw = String(form.get("stock") ?? "").trim();
  const stock = /^\d{1,6}$/.test(stockRaw) ? Number(stockRaw) : null;
  for (const t of String(form.get("sizes") ?? "").split(/[,\n;]+/).map((s) => s.trim().slice(0, 40)).filter(Boolean)) {
    const id = slug(t) || `v${next.variants.length + 1}`;
    if (next.variants.some((v) => v.id === id)) continue;
    next.variants.push({ id, title: t, available: true, ...(stock !== null ? { stock } : {}) });
  }
  if (!next.variants.length) next.variants = [{ id: "one", title: "One size", available: true, ...(stock !== null ? { stock } : {}) }];

  // Pictures: remove the ticked ones, add the uploaded ones, put the chosen main first.
  const rm = new Set(form.getAll("rm_img").map(String));
  next.images = (next.images ?? []).filter((i) => !rm.has(i));
  for (const f of form.getAll("photos")) {
    if (!f || typeof f === "string" || !f.size) continue;
    if (f.size > MAX_IMAGE_BYTES) return { error: { title: "A photo is too big", detail: `${f.name || "One of them"} is over ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB. Most phones shrink it for you; try again, or send yourself a smaller copy.` } };
    const type = IMAGE_TYPES[f.type] ? f.type : null;
    if (!type) return { error: { title: "That isn't a picture we can show", detail: `${f.name || "The file"} is ${f.type || "an unknown type"}. JPEG, PNG, WebP, GIF or AVIF, please.` } };
    const path = await putImage(env, await f.arrayBuffer(), type);
    if (!path) return { error: { title: "Couldn't keep that photo", detail: "This store has no storage yet (a KV namespace called STOCK). The README says how to add one." } };
    next.images.push(path);
  }
  const main = String(form.get("main_img") ?? "");
  if (main && next.images.includes(main)) next.images = [main, ...next.images.filter((i) => i !== main)];
  return { product: next };
}

export function uniqueId(base, products) {
  let id = base, n = 2;
  while (products.some((p) => p.id === id)) id = `${base}-${n++}`;
  return id;
}

export function describe(before, after, store) {
  const bits = [];
  if (before.price !== after.price) bits.push(`price ${money(before.price, store)} → ${money(after.price, store)}`);
  if (before.title !== after.title) bits.push(`renamed`);
  const flip = after.variants.filter((v) => (before.variants.find((b) => b.id === v.id)?.available !== false) !== (v.available !== false));
  for (const v of flip) bits.push(`${v.title} ${v.available ? "back in stock" : "sold out"}`);
  const added = after.variants.filter((v) => !before.variants.some((b) => b.id === v.id));
  if (added.length) bits.push(`sizes added: ${added.map((v) => v.title).join(", ")}`);
  if (after.variants.some((v) => { const b = before.variants.find((x) => x.id === v.id); return b && b.stock !== v.stock; })) bits.push("stock counts");
  if (!!before.hidden !== !!after.hidden) bits.push(after.hidden ? "hidden" : "shown");
  if ((before.ship_date ?? "") !== (after.ship_date ?? "")) bits.push(after.ship_date ? `pre-order ${after.ship_date}` : "no longer a pre-order");
  if ((before.live_at ?? "") !== (after.live_at ?? "")) bits.push(after.live_at ? `drops ${after.live_at}` : "drop time cleared");
  if ((before.compare_at ?? 0) !== (after.compare_at ?? 0)) bits.push(after.compare_at ? "on sale" : "sale ended");
  if ((before.images ?? []).join() !== (after.images ?? []).join()) bits.push("photos changed");
  if ((before.kind ?? "other") !== (after.kind ?? "other")) bits.push(`moved to ${after.kind}`);
  return `${after.title}: ${bits.join(", ") || "edited"}`;
}

async function listWants(env) {
  if (!env.STOCK) return [];
  const out = []; let cursor;
  do { const l = await env.STOCK.list({ prefix: "want:", cursor }); for (const k of l.keys) { const [, p, v] = k.name.split(":"); for (const w of JSON.parse((await env.STOCK.get(k.name)) ?? "[]")) out.push({ product: p, variant: v, email: w.email, at: w.at }); } cursor = l.list_complete ? null : l.cursor; } while (cursor);
  return out;
}
