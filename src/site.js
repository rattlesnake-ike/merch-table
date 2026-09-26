/* The whole front-end: a cart in localStorage, the size picker, drops that open themselves,
   live stock, back-in-stock requests, and the hand-off to checkout. No framework, no tracking.

   RESTYLING? These are the hooks this file needs. Everything else is yours.
     data- attributes:  data-product, data-add, data-add-btn, data-added, data-restock,
                        data-restock-msg, data-variant, data-price, data-price-display,
                        data-cart-rows, data-cart-empty, data-cart-full, data-cart-count,
                        data-subtotal, data-shipping, data-total, data-ship-note,
                        data-checkout, data-checkout-btn, data-checkout-err, data-rm,
                        data-qty, data-order, data-thanks-line, data-drop, data-live-at
     class names:       .sz and .sz.out (a size), .buy (where the sold-out line is put),
                        .soldout (the sold-out line itself)
     structure:         a .sz label contains one <input> and one <span> holding the size name.
   Rename any of those and something breaks quietly. Style them however you like. */
(() => {
  const KEY = "cart";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const fmt = (c) => (window.__store ? new Intl.NumberFormat(window.__store.locale, { style: "currency", currency: window.__store.currency, minimumFractionDigits: c % 100 === 0 ? 0 : 2 }).format(c / 100) : "$" + (c / 100).toFixed(2));
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
  const save = (c) => { localStorage.setItem(KEY, JSON.stringify(c)); count(); };
  const count = () => { const n = load().reduce((a, i) => a + i.qty, 0); $$("[data-cart-count]").forEach((e) => (e.textContent = n ? String(n) : "")); };
  count();

  /* Product page */
  const prod = $("[data-product][data-title]");
  if (prod) {
    const form = $("[data-add]", prod), btn = $("[data-add-btn]", prod), priceEl = $("[data-price-display]", prod), restock = $("[data-restock]", prod);
    const radios = $$("input[name=variant]", prod);
    const chosen = () => radios.find((r) => r.checked);
    const sync = () => {
      const r = chosen(); const lab = r && r.closest("[data-variant]");
      if (btn) btn.disabled = !r;
      if (lab && priceEl) priceEl.textContent = fmt(+lab.dataset.price);
    };
    radios.forEach((r) => r.addEventListener("change", sync)); sync();
    // Sold-out sizes: offer a back-in-stock request when one is clicked.
    $$(".sz.out", prod).forEach((l) => l.addEventListener("click", () => { if (restock) { restock.hidden = false; restock.dataset.variant = l.dataset.variant; $("input", restock).focus(); } }));
    if (restock && !form?.hidden && $$(".sz.out", prod).length === radios.length) restock.hidden = false;
    if (restock && $(".soldout", prod)) { restock.hidden = false; }
    restock?.addEventListener("submit", async (e) => {
      e.preventDefault(); const msg = $("[data-restock-msg]", restock);
      const res = await fetch("/api/restock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ product: prod.dataset.product, variant: restock.dataset.variant || "", email: $("input", restock).value }) }).catch(() => null);
      msg.textContent = res && res.ok ? "Noted. One email if it comes back, nothing else." : "That didn't go through. Try again, or email us.";
    });
    form?.addEventListener("submit", (e) => {
      e.preventDefault(); const r = chosen(); if (!r) return;
      const lab = r.closest("[data-variant]"); const qty = Math.max(1, Math.min(10, +$("#qty", prod).value || 1));
      const cart = load(); const ex = cart.find((i) => i.product === prod.dataset.product && i.variant === r.value);
      if (ex) ex.qty = Math.min(10, ex.qty + qty); else cart.push({ product: prod.dataset.product, variant: r.value, qty, title: prod.dataset.title, vtitle: $("span", lab).textContent, price: +lab.dataset.price, image: prod.dataset.image, ship: prod.dataset.shipDate || "", ticket: prod.dataset.ticket === "1" });
      save(cart); const a = $("[data-added]", prod); if (a) a.hidden = false;
    });
    // Drops: when the time comes, show the form without a reload.
    if (prod.dataset.liveAt) {
      const at = new Date(prod.dataset.liveAt).getTime();
      const tick = () => { if (Date.now() >= at) { if (form) form.hidden = false; const d = $("[data-drop]", prod); if (d) d.remove(); sync(); } else setTimeout(tick, Math.min(60000, at - Date.now())); };
      tick();
    }
    // Live stock: grey out what the count says is gone (only where the store counts stock).
    /* The one place that decides what a sold-out product looks like. Both callers use it, so
       the message can never be added twice, however many times stock news arrives. */
    const markSoldOut = (list) => {
      if (!list || !list.length) return;
      for (const v of list) { const lab = $(`[data-variant="${v}"]`, prod); if (!lab || lab.classList.contains("out")) continue; lab.classList.add("out"); const inp = $("input", lab); inp.disabled = true; inp.checked = false; lab.insertAdjacentHTML("beforeend", '<s aria-hidden="true"></s><span class="vis">sold out</span>'); }
      if (radios.every((r) => r.disabled)) {
        if (form) form.hidden = true;
        if (!$(".soldout", prod)) {
          const so = document.createElement("p");
          so.className = "soldout";
          // The wording lives on the page, so a band can change it without touching this file.
          so.textContent = prod.dataset.soldOutText || "Sold out.";
          ($(".buy", prod) || prod).insertBefore(so, restock);
        }
        if (restock) restock.hidden = false;
      }
      sync();
    };
    if (Array.isArray(window.__soldOut)) markSoldOut(window.__soldOut);
    fetch(`/api/stock?product=${encodeURIComponent(prod.dataset.product)}`).then((r) => (r.ok ? r.json() : null)).then((s) => {
      if (!s || !s.soldOut) return;
      for (const v of s.soldOut) { const lab = $(`[data-variant="${v}"]`, prod); if (!lab || lab.classList.contains("out")) continue; lab.classList.add("out"); const inp = $("input", lab); inp.disabled = true; inp.checked = false; lab.insertAdjacentHTML("beforeend", '<s aria-hidden="true"></s><span class="vis">sold out</span>'); }
      markSoldOut(s.soldOut);
    }).catch(() => {});
  }

  /* Cart page */
  const rows = $("[data-cart-rows]");
  if (rows) {
    const empty = $("[data-cart-empty]"), full = $("[data-cart-full]"), country = $("#country"), err = $("[data-checkout-err]");
    const ship = () => { const r = (window.__shipping || []).find((x) => x.countries.includes(country.value)); return r || null; };
    const render = () => {
      const cart = load(); empty.hidden = cart.length > 0; full.hidden = cart.length === 0; if (!cart.length) return;
      rows.innerHTML = cart.map((i, n) => `<tr><td>${i.image ? `<img src="/${esc(i.image)}" alt="">` : ""}<a href="/products/${encodeURIComponent(i.product)}/">${esc(i.title)}</a>${i.vtitle && i.vtitle !== "One size" ? ` <small>${esc(i.vtitle)}</small>` : ""}${i.ship ? `<br><small>Pre-order, ships ${esc(i.ship)}</small>` : ""}<button class="rm" data-rm="${n}" type="button">Remove</button></td><td class="num">${fmt(i.price)}</td><td><input type="number" min="1" max="10" value="${Number(i.qty) || 1}" data-qty="${n}" aria-label="Quantity"></td><td class="num">${fmt(i.price * i.qty)}</td></tr>`).join("");
      const sub = cart.reduce((a, i) => a + i.price * i.qty, 0);
      // Tickets are collected at a door. A cart of only tickets must not ask where to post them.
      //
      // Decided from the CURRENT product list, not from a flag saved when the item was added.
      // A cart saved before this shipped has no flag, and trusting it charged postage on a
      // ticket — which is exactly the bug Isaac hit. `i.ticket` is still honoured as a
      // fallback for a product that has since left the store.
      const isTicketItem = (i) => (window.__tickets || []).includes(i.product) || i.ticket === true;
      const allTickets = cart.length > 0 && cart.every(isTicketItem);
      const shipField = document.querySelector("[data-ship-field]");
      if (shipField) shipField.hidden = allTickets;
      const r = allTickets ? null : ship();
      const shipping = r ? (r.free_over && sub >= r.free_over ? 0 : r.amount) : 0;
      $("[data-subtotal]").textContent = fmt(sub); $("[data-shipping]").textContent = allTickets ? "Nothing to post" : r ? (shipping ? fmt(shipping) : "Free") : "";
      $("[data-total]").textContent = fmt(sub + shipping);
      $("[data-ship-note]").textContent = r ? `${r.estimate || ""}${r.free_over && sub < r.free_over ? ` · free over ${fmt(r.free_over)}` : ""}` : "";
    };
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    rows.addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (!b) return; const c = load(); c.splice(+b.dataset.rm, 1); save(c); render(); });
    rows.addEventListener("change", (e) => { const q = e.target.closest("[data-qty]"); if (!q) return; const c = load(); c[+q.dataset.qty].qty = Math.max(1, Math.min(10, +q.value || 1)); save(c); render(); });
    country.addEventListener("change", () => { localStorage.setItem("country", country.value); render(); });
    const saved = localStorage.getItem("country"); if (saved && $(`option[value="${saved}"]`, country)) country.value = saved;
    render();
    $("[data-checkout]").addEventListener("submit", async (e) => {
      e.preventDefault(); err.textContent = ""; const btn = $("[data-checkout-btn]"); btn.disabled = true; btn.textContent = "One moment";
      try {
        const res = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: load().map((i) => ({ product: i.product, variant: i.variant, qty: i.qty })), country: country.value }) });
        const j = await res.json().catch(() => ({}));
        if (res.ok && j.url) { location.href = j.url; return; }
        err.textContent = j.error || "Checkout didn't open. Try again in a moment.";
        if (j.soldOut) { const c = load().filter((i) => !j.soldOut.some((s) => s.product === i.product && s.variant === i.variant)); save(c); render(); }
      } catch { err.textContent = "Checkout didn't open. Check your connection and try again."; }
      btn.disabled = false; btn.textContent = "Check out";
    });
  }

  /* Thanks page: show the order, clear the cart. */
  const order = $("[data-order]");
  if (order) {
    const id = new URLSearchParams(location.search).get("session");
    if (id) fetch(`/api/session?id=${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : null)).then((o) => {
      if (!o) return; if (o.paid) { save([]); }
      $("[data-thanks-line]").textContent = o.paid ? `Your order is in${o.email ? `, and a receipt is on its way to ${o.email}` : ""}.` : "We're waiting for the payment to confirm. This page will not update; your receipt will.";
      if (o.items?.length) { order.hidden = false; order.innerHTML = `<table><tbody>${o.items.map((i) => `<tr><td>${esc(i.description)}</td><td class="num">× ${i.quantity}</td><td class="num">${fmt(i.amount)}</td></tr>`).join("")}${o.shipping != null ? `<tr><td>Shipping</td><td></td><td class="num">${fmt(o.shipping)}</td></tr>` : ""}<tr><td><b>Total</b></td><td></td><td class="num"><b>${fmt(o.total)}</b></td></tr></tbody></table>`; }
    }).catch(() => {});
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
