/* The admin's shell: one page frame, one nav, the small helpers every screen uses.
   Built for a phone in one hand first, then a laptop. No framework, no build step. */
import { freshCookie } from "../live.js";

export const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const money = (c, store) => new Intl.NumberFormat(store.locale ?? "en-US", { style: "currency", currency: (store.currency ?? "usd").toUpperCase(), minimumFractionDigits: c % 100 === 0 ? 0 : 2 }).format((c ?? 0) / 100);
export const currencySign = (store) => ({ usd: "$", cad: "$", aud: "$", nzd: "$", gbp: "£", eur: "€", jpy: "¥" }[store.currency] ?? store.currency.toUpperCase());
export const when = (iso, store, opts = { day: "numeric", month: "short" }) => (iso ? new Date(iso).toLocaleDateString(store.locale ?? "en-US", opts) : "");
/** Image paths in products.json are relative to the site root; make them a URL the admin can show. */
export const imgSrc = (src) => (/^https?:/.test(src) ? src : `/${src}`);

export const TABS = [["/admin", "Home"], ["/admin/products", "Products"], ["/admin/orders", "Orders"], ["/admin/shows", "Shows"], ["/admin/door", "Door"], ["/admin/store", "Store"], ["/admin/setup", "Setup"]];

/** One nav on every screen. `here` marks the section; `back` is an explicit way out of a detail screen,
    because a phone's back gesture is not something to rely on after a form post. */
export function adminNav(here = "", back = null, store = null) {
  const links = TABS.map(([href, label]) => `<a href="${href}"${href === here ? ' aria-current="page" class="on"' : ""}>${label}</a>`).join("");
  return `<nav class="anav"><div class="brand"><a class="wm" href="/admin">${escapeHtml(store?.name ?? "Store")}</a><a class="out" href="/" target="_blank" rel="noopener">See the store ↗</a></div><div class="tabs">${links}</div>${back ? `<a class="back" href="${back.href}">← ${escapeHtml(back.label)}</a>` : ""}</nav>`;
}

/** An HTML response from the admin: never cached, never indexed. */
export const html = (body, status = 200, headers = {}) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", ...headers } });
/** After a write: redirect, and hand the browser the versions it just wrote so it reads its own change. */
export const saved = (location, hint, fresh) => new Response("", { status: 302, headers: { location, "set-cookie": freshCookie({ ...(hint ?? {}), ...(fresh ?? {}) }), "cache-control": "no-store" } });

/** A small message block. kind: "", "ok", "warn". */
export const notice = (text, kind = "") => `<p class="demo ${kind}">${text}</p>`;

/** A form field. */
export const field = (id, label, input, hint = "") => `<label for="${id}">${label}${hint ? ` <small>${hint}</small>` : ""}</label>${input}`;
export const text = (name, value = "", attrs = "") => `<input id="${name}" name="${name}" value="${escapeHtml(value)}" ${attrs}>`;
export const select = (name, options, current, attrs = "") => `<select id="${name}" name="${name}" ${attrs}>${options.map(([v, t]) => `<option value="${escapeHtml(v)}"${String(v) === String(current) ? " selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select>`;

export function page(body, store = null, { title = "Store admin", wide = false } = {}) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(store?.colors?.accent ?? "") ? store.colors.accent : "#2743d0";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><title>${escapeHtml(title)}${store ? ` · ${escapeHtml(store.name)}` : ""}</title>
<link rel="manifest" href="/admin/manifest.webmanifest"><meta name="theme-color" content="${accent}"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="${escapeHtml(store?.name ?? "Store")}"><link rel="apple-touch-icon" href="/admin/icon.png"><link rel="icon" href="/favicon.svg">
<style>
:root{--ink:#141416;--paper:#fff;--soft:#f4f3ef;--line:#d9d7d0;--mute:#6b6a66;--accent:${accent};--ok:#2e7d32;--bad:#b3261e;--w:${wide ? "60rem" : "36rem"}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;margin:0;background:var(--soft);color:var(--ink);padding:0 0 72px}
main{max-width:var(--w);margin:0 auto;padding:0 14px}
h1{font-size:1.45rem;margin:.2rem 0;letter-spacing:-.01em}
h2{font-size:1.05rem;margin:22px 0 8px;text-transform:uppercase;letter-spacing:.06em;color:var(--mute)}
a{color:var(--accent)}
.anav{position:sticky;top:0;z-index:5;background:var(--paper);border-bottom:1px solid var(--line);margin:0 0 16px;padding:10px 14px 0}
.anav .brand{max-width:var(--w);margin:0 auto;display:flex;align-items:baseline;gap:12px}
.anav .wm{font-weight:800;font-size:1.05rem;color:var(--ink);text-decoration:none;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.anav .out{color:var(--mute);font-size:.85rem;text-decoration:none;white-space:nowrap}
.anav .tabs{max-width:var(--w);margin:6px auto 0;display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.anav .tabs::-webkit-scrollbar{display:none}
.anav .tabs a{padding:8px 10px;text-decoration:none;color:var(--mute);font-weight:600;font-size:.95rem;border-bottom:2px solid transparent;white-space:nowrap}
.anav .tabs a.on{color:var(--ink);border-bottom-color:var(--ink)}
.anav .back{display:block;max-width:var(--w);margin:4px auto 0;padding:6px 0 8px;font-weight:600;text-decoration:none}
.bar{display:flex;align-items:center;gap:12px;margin:0 0 12px}
.bar h1{flex:1}
.bar .ghost{font-size:.9rem;text-decoration:none;color:var(--mute)}
.sub{margin:0 0 16px;color:var(--mute)}
.fine{margin:16px 0;font-size:.85rem;color:var(--mute)}
.actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:0 0 14px}
.btn,button.btn{display:inline-block;padding:11px 16px;background:var(--ink);color:#fff;border:0;border-radius:9px;text-decoration:none;font:inherit;font-weight:700;cursor:pointer;line-height:1.2}
.btn.ghost{background:var(--paper);color:var(--ink);border:1.5px solid var(--line)}
.btn.small,button.small{display:inline-block;width:auto;padding:8px 13px;margin:8px 0 0;font-size:.92rem}
.btn.danger{background:none;color:var(--bad);border:1.5px solid #e0b4b4}
.list{display:grid;gap:8px}
.row{display:flex;gap:12px;align-items:center;padding:10px;background:var(--paper);border:1px solid var(--line);border-radius:10px;text-decoration:none;color:inherit}
.row:hover{border-color:#bdbbb3}
.thumb{width:54px;height:54px;flex:none;background:var(--soft);border-radius:7px;overflow:hidden}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.meta{flex:1;min-width:0;display:grid;gap:2px}
.meta b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta small{color:var(--mute);font-size:.84rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta .out{text-decoration:line-through;color:#999}
.tag{display:inline-block;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:2px 6px;border-radius:5px;background:var(--soft);color:var(--mute);vertical-align:1px}
.tag.hot{background:#fde7e5;color:var(--bad)}.tag.ok{background:#e8f5e9;color:var(--ok)}.tag.new{background:#e8ecfb;color:var(--accent)}
.go{color:#bbb;font-size:1.3rem}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:0 0 14px}
.stat{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:12px;text-decoration:none;color:inherit}
.stat b{display:block;font-size:1.5rem;line-height:1.1;letter-spacing:-.02em}
.stat span{font-size:.82rem;color:var(--mute)}
form.card,.card{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 14px}
form.inline,form.bare{background:none;border:0;padding:0;margin:0}
label{display:block;font-weight:600;margin:14px 0 6px}
label small{font-weight:400;color:var(--mute)}
input,textarea,select{width:100%;font:inherit;padding:11px 12px;border:1.5px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink)}
input:focus,textarea:focus,select:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
input[type=file]{padding:9px;background:var(--soft)}
input[type=color]{width:52px;height:40px;padding:2px;border-radius:8px}
input[type=checkbox]{width:22px;height:22px;accent-color:var(--accent)}
button{width:100%;margin-top:20px;padding:14px;font:inherit;font-weight:700;background:var(--ink);color:#fff;border:0;border-radius:9px;cursor:pointer}
.two{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}
@media (max-width:520px){.two,.region .two{grid-template-columns:1fr}}
.money{display:flex;align-items:center;gap:8px}.money span{font-weight:700;font-size:1.05rem}
.colors{display:flex;gap:18px;flex-wrap:wrap}.colors label{display:grid;gap:4px;margin:0;font-weight:500;font-size:.9rem}
.sizes{display:grid;gap:8px}
.sw{display:grid;grid-template-columns:24px 1fr auto;align-items:center;gap:6px 12px;margin:0;padding:12px;border:1.5px solid var(--line);border-radius:8px;font-weight:500}
.sw input[type=checkbox]{grid-row:1}
.sw small{grid-column:2;color:var(--mute);font-weight:400;font-size:.84rem;line-height:1.35}
.sw .n{grid-column:3;grid-row:1;display:flex;align-items:center;gap:6px;font-size:.84rem;color:var(--mute)}
.sw .n input{width:68px;padding:6px 8px;text-align:right}
.sw:not(:has(input[type=checkbox]:checked)) > span{text-decoration:line-through;color:#999}
form > .sw{margin-top:16px;grid-template-columns:24px 1fr}
.pics{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px}
.pic{display:grid;gap:5px;margin:0;font-weight:400;font-size:.8rem}
.pic img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;border:1px solid var(--line);background:var(--soft)}
.pic.main img{outline:2px solid var(--accent)}
.pic input{width:16px;height:16px;vertical-align:-2px}
.demo{margin:0 0 14px;padding:12px 14px;background:#fff7e6;border:1px solid #e8c37a;border-radius:8px;font-size:.92rem}
.demo.ok{background:#e8f5e9;border-color:#a5c8a9}.demo.warn{background:#fde7e5;border-color:#e0b4b4}
.checks{display:grid;gap:10px}
.chk{display:grid;grid-template-columns:1.6rem 1fr;gap:10px;padding:12px 14px;background:var(--paper);border:1px solid var(--line);border-radius:10px}
.chk .mark{font-size:1.2rem;line-height:1.3}
.chk.ok .mark{color:var(--ok)}.chk.todo .mark{color:var(--bad)}.chk.info .mark{color:#999}
.chk p{margin:2px 0 0;color:#444;font-size:.95rem}
.chk form{padding:0;border:0;background:none}
.chk label.tight{margin:10px 0 4px;font-size:.95rem}
.chk .go{margin:8px 0 0;font-size:.95rem}.chk .go a{font-weight:600}
.tbl{overflow-x:auto}.tbl table{border-collapse:collapse;width:100%;font-size:.95rem}.tbl td,.tbl th{padding:8px 10px 8px 0;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}.tbl th{font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--mute)}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pl{list-style:none;padding:0;margin:0}.pl li{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);align-items:baseline}.pl .d{flex:1;border-bottom:1px dotted var(--line)}
.region{border:1px solid var(--line);border-radius:10px;padding:4px 12px 12px;margin:10px 0}
.region .two{grid-template-columns:2fr 1fr}
.filters{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}
.filters a{padding:6px 11px;border-radius:999px;border:1.5px solid var(--line);text-decoration:none;color:var(--ink);font-size:.9rem;background:var(--paper)}
.filters a.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.search{display:flex;gap:8px;margin:0 0 12px}.search input{flex:1}.search button{width:auto;margin:0;padding:10px 14px}
.danger{margin-top:14px;background:none;border:1px dashed #e0b4b4;border-radius:12px;padding:14px}
.danger button{background:none;color:var(--bad);border:1.5px solid #e0b4b4;margin-top:0}
.empty{padding:28px 14px;text-align:center;color:var(--mute);background:var(--paper);border:1px dashed var(--line);border-radius:12px}
.log{list-style:none;padding:0;margin:0}.log li{padding:7px 0;border-bottom:1px solid var(--line);font-size:.92rem}.log small{color:var(--mute);margin-left:6px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.move{display:flex;gap:4px}.move button{width:34px;height:34px;margin:0;padding:0;background:var(--soft);color:var(--ink);border:1px solid var(--line);border-radius:7px;font-size:1rem}
@media print{.anav,.actions,button,.btn{display:none!important}body{background:#fff;padding:0}.card{border:0}}
</style></head><body>${body}
<script>
document.querySelectorAll("[data-sz] input[type=checkbox]").forEach((i)=>i.addEventListener("change",()=>{const s=i.closest("[data-sz]").querySelector("[data-state]");if(s)s.textContent=i.checked?"in stock":"sold out";}));
// Phone photos are 3 to 8 MB. Shrink them to 1600px before upload, so the store stays fast and the
// upload takes a second: the browser does it, nothing leaves the phone until it is small.
document.querySelectorAll('input[type=file][accept^="image"]').forEach((inp)=>inp.addEventListener("change",async()=>{
  if(!window.createImageBitmap||!window.DataTransfer) return;
  const out=new DataTransfer();
  for(const f of inp.files){
    if(!/^image\\/(jpeg|png|webp|heic|heif)/.test(f.type)||f.size<350000){ out.items.add(f); continue; }
    try{
      const bmp=await createImageBitmap(f); const max=1600; const k=Math.min(1,max/Math.max(bmp.width,bmp.height));
      const c=document.createElement("canvas"); c.width=Math.round(bmp.width*k); c.height=Math.round(bmp.height*k);
      c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);
      const blob=await new Promise((r)=>c.toBlob(r,"image/jpeg",0.86));
      out.items.add(new File([blob],(f.name||"photo").replace(/\\.[^.]+$/,"")+".jpg",{type:"image/jpeg"}));
    }catch{ out.items.add(f); }
  }
  inp.files=out.files;
}));
// A form that is already saving should not be sent twice by an impatient thumb.
document.querySelectorAll("form").forEach((f)=>f.addEventListener("submit",()=>{const b=f.querySelector("button[type=submit]");if(b){b.disabled=true;b.dataset.t=b.textContent;b.textContent="Saving…";}}));
</script></body></html>`;
}

/** The web app manifest: the admin on a phone's home screen, with the store's name and colour. */
export function manifest(store) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(store?.colors?.accent ?? "") ? store.colors.accent : "#2743d0";
  return new Response(JSON.stringify({ name: `${store.name} admin`, short_name: store.name.slice(0, 12), start_url: "/admin", display: "standalone", background_color: "#f4f3ef", theme_color: accent, icons: [{ src: "/admin/icon.png", sizes: "512x512", type: "image/png" }, { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }] }), { headers: { "content-type": "application/manifest+json", "cache-control": "no-store" } });
}
