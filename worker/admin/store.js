/* Store settings: the name, the look, where you ship and for how much, the sections, the links,
   the mailing list, the checkout, your logo. Everything store.json held that a band changes. */
import { adminNav, html, page, escapeHtml, currencySign, notice, field, text, select, saved } from "./ui.js";
import { saveStore, putLogo, PLACEHOLDER } from "../live.js";
import { FONTS } from "../../src/lib.mjs";
import { countryName } from "../../src/templates.mjs";

const COMMON = ["US", "CA", "GB", "IE", "FR", "DE", "NL", "BE", "ES", "IT", "PT", "SE", "NO", "DK", "FI", "AT", "CH", "PL", "CZ", "AU", "NZ", "JP", "KR", "MX", "BR", "AR", "CL", "ZA", "IN", "SG", "HK", "TW", "IL", "GR", "HU", "RO", "IS", "LU"];

export async function storeScreen(req, env, url, store, products, me, demo, tok, hint) {
  const hidden = `<input type="hidden" name="_t" value="${tok}">${me.byKey ? `<input type="hidden" name="key" value="${escapeHtml(me.byKey)}">` : ""}`;
  const checkTok = async (form) => demo || (String(form.get("_t") ?? "") === tok && tok !== "") || (me.byKey && String(form.get("key") ?? "") === me.byKey);
  const wrap = (body, title) => html(page(`${adminNav("/admin/store", null, store)}<main>${body}</main>`, store, { title }));
  const who = me.email || "admin";

  if (req.method === "POST") {
    if (demo) return wrap(`<h1>This is the demo</h1><p>On your own store this would have saved and gone live at once. <a href="/admin/store">Back</a></p>`, "Demo");
    if (Number(req.headers.get("content-length") ?? 0) > 6 * 1024 * 1024) return wrap(`<h1>That logo is too big</h1><p>Under 2 MB, please. <a href="/admin/store">Back</a></p>`, "Store", 413);
    const form = await req.formData();
    if (!(await checkTok(form))) return wrap(`<h1>That form had gone stale</h1><p><a href="/admin/store">Open it again</a>.</p>`, "Store");
    const str = (k, max) => String(form.get(k) ?? "").trim().slice(0, max);
    const color = (k, fallback) => { const v = str(k, 9); return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback; };
    const bad = (t, d) => wrap(`<h1>${escapeHtml(t)}</h1><p>${escapeHtml(d)}</p><p><a href="/admin/store">Back</a></p>`, "Store");
    const email = str("email", 200);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad("That email didn't look right", "");
    let homepage = str("homepage", 300);
    if (homepage && !/^https?:\/\//i.test(homepage)) homepage = `https://${homepage}`;
    const font = str("font", 60);

    // Shipping regions: rows of name / countries / amount / free over / estimate.
    const shipping = [];
    const seen = new Set();
    for (let i = 0; i < 12; i++) {
      const name = str(`sh_name_${i}`, 60); if (!name) continue;
      const countries = str(`sh_countries_${i}`, 600).toUpperCase().split(/[\s,;]+/).filter(Boolean);
      if (!countries.length || countries.some((c) => !/^[A-Z]{2}$/.test(c))) return bad("A shipping region needs country codes", `${name}: two-letter codes separated by commas, like US, CA.`);
      for (const c of countries) { if (seen.has(c)) return bad("A country is in two regions", `${c} appears twice. Each country belongs to one region.`); seen.add(c); }
      const amount = str(`sh_amount_${i}`, 12); const free = str(`sh_free_${i}`, 12);
      if (!/^\d{1,5}(\.\d{1,2})?$/.test(amount)) return bad("A shipping price didn't look right", `${name}: a plain number like 6 or 6.50, or 0 for free.`);
      if (free && !/^\d{1,6}(\.\d{1,2})?$/.test(free)) return bad("A free-over amount didn't look right", `${name}: a plain number, or leave it empty.`);
      const id = (str(`sh_id_${i}`, 30) || name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `r${i}`;
      shipping.push({ id, name, countries, amount: Math.round(Number(amount) * 100), ...(free ? { free_over: Math.round(Number(free) * 100) } : {}), ...(str(`sh_est_${i}`, 80) ? { estimate: str(`sh_est_${i}`, 80) } : {}) });
    }
    if (!shipping.length) return bad("At least one shipping region", "Fans need somewhere to ship to. Add a region with a name, country codes and a price.");

    // Sections: title + kind, in order.
    const sections = [];
    for (let i = 0; i < 12; i++) {
      const title = str(`sec_title_${i}`, 60); const kind = str(`sec_kind_${i}`, 30).toLowerCase();
      if (!title && !kind) continue;
      if (!/^[a-z0-9-]{1,30}$/.test(kind)) return bad("A section needs a short key", `${title || "A section"}: lowercase letters, like apparel or hats. It's what products are filed under.`);
      if (!sections.some((s) => s.kind === kind)) sections.push({ kind, title: title || kind });
    }
    // Header links.
    const links = [];
    for (let i = 0; i < 6; i++) { const label = str(`ln_label_${i}`, 40); let u = str(`ln_url_${i}`, 300); if (!label || !u) continue; if (!/^(https?:\/\/|\/)/i.test(u)) u = `https://${u}`; links.push({ label, url: u }); }
    const mlAction = str("ml_action", 300);
    if (mlAction && !/^https:\/\//i.test(mlAction)) return bad("The mailing list address must start with https://", "");

    const patch = {
      name: str("name", 80) || store.name,
      tagline: str("tagline", 200),
      description: str("description", 400),
      email, homepage,
      colors: { ink: color("ink", store.colors?.ink ?? "#141416"), paper: color("paper", store.colors?.paper ?? "#f3f1ea"), accent: color("accent", store.colors?.accent ?? "#2743d0") },
      look: { ...(store.look ?? {}), corners: ["square", "soft", "round"].includes(str("corners", 10)) ? str("corners", 10) : "square", headings: ["uppercase", "normal"].includes(str("headings", 10)) ? str("headings", 10) : "uppercase", font: font in FONTS ? font : (store.look?.font ?? "system") },
      returns: str("returns", 600),
      sold_out_text: str("sold_out_text", 80) || undefined,
      shipping, sections, links,
      mailing_list: { action: mlAction, label: str("ml_label", 120) || "Get an email when there's something new. Nothing else." },
      phone_at_checkout: form.get("phone_at_checkout") === "on",
      statement_descriptor: str("statement_descriptor", 22).toUpperCase(),
      tax: { automatic: form.get("tax_automatic") === "on" },
    };
    const logo = form.get("logo");
    if (logo && typeof logo !== "string" && logo.size) {
      const type = ["image/svg+xml", "image/png"].includes(logo.type) ? logo.type : null;
      if (!type) return bad("The logo must be an SVG or a PNG", `${logo.name || "The file"} is ${logo.type || "something else"}.`);
      if (logo.size > 2 * 1024 * 1024) return bad("That logo is too big", "Under 2 MB, please.");
      await putLogo(env, await logo.arrayBuffer(), type);
    }
    const r = await saveStore(env, patch, who, hint);
    if (!r.ok) return bad("Couldn't save", r.error);
    return saved(`/admin?saved=${encodeURIComponent("store settings")}`, hint, r.fresh);
  }

  const look = store.look ?? {}; const c = store.colors ?? {};
  const customFont = look.font && !FONTS[look.font];
  const regions = [...(store.shipping ?? []), {}].slice(0, 12);
  const regionRow = (r, i) => `<div class="region">${r.id ? `<input type="hidden" name="sh_id_${i}" value="${escapeHtml(r.id)}">` : ""}
    <div class="two">${field(`sh_name_${i}`, i === regions.length - 1 && !r.id ? "Another region" : "Region", text(`sh_name_${i}`, r.name ?? "", `placeholder="${i === 0 ? "United States" : "Everywhere else"}"`))}${field(`sh_amount_${i}`, "Price", `<div class="money"><span>${currencySign(store)}</span><input id="sh_amount_${i}" name="sh_amount_${i}" inputmode="decimal" value="${r.amount != null ? (r.amount / 100).toFixed(2) : ""}" placeholder="6"></div>`)}</div>
    ${field(`sh_countries_${i}`, "Countries", text(`sh_countries_${i}`, (r.countries ?? []).join(", "), 'placeholder="US" autocapitalize="characters"'), "two-letter codes, separated by commas")}
    <div class="two">${field(`sh_free_${i}`, "Free over", `<div class="money"><span>${currencySign(store)}</span><input id="sh_free_${i}" name="sh_free_${i}" inputmode="decimal" value="${r.free_over != null ? (r.free_over / 100).toFixed(2) : ""}" placeholder=""></div>`, "optional")}${field(`sh_est_${i}`, "Usually arrives", text(`sh_est_${i}`, r.estimate ?? "", 'placeholder="3 to 7 business days"'))}</div></div>`;
  const sectionRows = [...(store.sections ?? []), {}].slice(0, 12).map((s, i) => `<div class="two" style="grid-template-columns:2fr 1fr">${field(`sec_title_${i}`, i === 0 ? "Section" : "", text(`sec_title_${i}`, s.title ?? "", 'placeholder="Shirts and hoodies"'))}${field(`sec_kind_${i}`, i === 0 ? "Key" : "", text(`sec_kind_${i}`, s.kind ?? "", 'placeholder="apparel"'))}</div>`).join("");
  const linkRows = [...(store.links ?? []), {}].slice(0, 6).map((l, i) => `<div class="two">${field(`ln_label_${i}`, i === 0 ? "Link" : "", text(`ln_label_${i}`, l.label ?? "", 'placeholder="Bandcamp"'))}${field(`ln_url_${i}`, i === 0 ? "Address" : "", text(`ln_url_${i}`, l.url ?? "", 'placeholder="https://yourband.bandcamp.com"'))}</div>`).join("");

  return wrap(`<header class="bar"><h1>Store settings</h1></header>
    ${demo ? notice("On your own store this is where the name, the contact address, the colours, the shipping regions and the sections live. Here it can't save.") : ""}
    <form method="post" enctype="multipart/form-data" class="card">${hidden}
      <h2 style="margin-top:0">The band</h2>
      ${field("name", "Band or store name", text("name", store.name, 'required maxlength="80"'))}
      ${field("tagline", "One line under the name", text("tagline", store.tagline ?? "", 'maxlength="200"'), "optional")}
      ${field("email", "Contact email", `<input id="email" name="email" type="email" value="${escapeHtml(store.email && !PLACEHOLDER.test(store.email) ? store.email : "")}" placeholder="you@yourband.com">`, "on every page and receipt; a person must read it")}
      ${field("homepage", "Your website", text("homepage", store.homepage ?? "", 'placeholder="https://yourband.com"'), "optional")}
      ${field("description", "About the store", `<textarea id="description" name="description" rows="2" maxlength="400">${escapeHtml(store.description ?? "")}</textarea>`, "one or two sentences, for search engines")}
      ${field("logo", "Logo", `<input id="logo" name="logo" type="file" accept="image/svg+xml,image/png">`, "SVG or PNG; becomes the browser icon and the app icon")}

      <h2>The look</h2>
      <label>Colours <small>pick them out of your artwork</small></label>
      <div class="colors"><label>Text <input type="color" name="ink" value="${escapeHtml(c.ink ?? "#141416")}"></label><label>Background <input type="color" name="paper" value="${escapeHtml(c.paper ?? "#f3f1ea")}"></label><label>Accent <input type="color" name="accent" value="${escapeHtml(c.accent ?? "#2743d0")}"></label></div>
      <div class="two">${field("font", "Type", select("font", [...Object.keys(FONTS).map((f) => [f, f[0].toUpperCase() + f.slice(1)]), ...(customFont ? [[look.font, `${look.font} (your own, from the files)`]] : [])], look.font ?? "system"))}${field("corners", "Corners", select("corners", [["square", "Square"], ["soft", "Soft"], ["round", "Round"]], look.corners ?? "square"))}</div>
      ${field("headings", "Headings", select("headings", [["uppercase", "UPPERCASE"], ["normal", "As written"]], look.headings === "normal" ? "normal" : "uppercase"))}

      <h2>Shipping</h2>
      <p class="fine" style="margin:0">A flat price per region; free over an amount if you like. Each country belongs to one region. Common codes: ${COMMON.map((k) => `<span title="${escapeHtml(countryName(k, store.locale))}">${k}</span>`).join(" ")}.</p>
      ${regions.map(regionRow).join("")}

      <h2>Sections on the front page</h2>
      <p class="fine" style="margin:0">In this order. A product is filed under a section by its key.</p>
      ${sectionRows}

      <h2>Links in the header</h2>
      ${linkRows}

      <h2>Mailing list</h2>
      ${field("ml_action", "Sign-up form address", text("ml_action", store.mailing_list?.action ?? "", 'placeholder="https://buttondown.com/api/emails/embed-subscribe/yourband"'), "from Buttondown, Mailchimp or your own tool; empty hides the form")}
      ${field("ml_label", "What it says", text("ml_label", store.mailing_list?.label ?? "", 'maxlength="120"'))}

      <h2>Checkout</h2>
      ${field("statement_descriptor", "On the card statement", text("statement_descriptor", store.statement_descriptor ?? "", 'maxlength="22" autocapitalize="characters"'), "the band's name, so nobody disputes a charge they don't recognise")}
      ${field("returns", "Your returns line", `<textarea id="returns" name="returns" rows="3" maxlength="600" placeholder="Wrong size, or something arrived damaged? Write to us within 30 days and we'll swap it or refund it.">${escapeHtml(store.returns ?? "")}</textarea>`, "on the shipping page and at checkout")}
      ${field("sold_out_text", "The sold-out line", text("sold_out_text", store.sold_out_text ?? "", 'maxlength="80" placeholder="Sold out."'))}
      <label class="sw"><input type="checkbox" name="phone_at_checkout" ${store.phone_at_checkout ? "checked" : ""}><span>Ask for a phone number at checkout</span><small>for the carrier; most bands don't</small></label>
      <label class="sw"><input type="checkbox" name="tax_automatic" ${store.tax?.automatic ? "checked" : ""}><span>Stripe works out sales tax</span><small>Stripe Tax, 0.5% a transaction, only once you've registered in Stripe</small></label>
      <button type="submit">Save</button>
      <p class="fine">Currency: ${escapeHtml((store.currency ?? "usd").toUpperCase())}. Changing it is a file edit (<code>store.json</code>), since every price would need to change with it.</p>
    </form>`, "Store settings");
}
