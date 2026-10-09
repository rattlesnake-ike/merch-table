// Draws the sample store's product pictures: simple line drawings in one hand, so Northern Dogs
// looks like a band with a look rather than a pile of clip art. Run after editing: node scripts/sample-art.mjs
// A real band replaces every one of these with photos from the admin.
import { writeFileSync, mkdirSync } from "node:fs";

const INK = "#141416", PAPER = "#f3f1ea";
const C = { green: "#8fc9a8", blue: "#2743d0", red: "#d64b2a", mustard: "#e2b43a", sand: "#e9dcc2", night: "#1f2a44", white: "#ffffff", brown: "#7a4a2a", pink: "#e8a6b4", smoke: "#9a9a9a" };
const S = `fill="none" stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"`;

/* ---------- motifs, each drawn around (0,0) ---------- */
// The dog, as it is on the tee. Roughly 350 wide, 220 tall, origin at its top-left.
const DOG_OF = (fill, paper) => `<g fill="${fill}"><rect x="128" y="176" width="18" height="42" rx="9"/><path d="M64 172C48 154 50 122 66 108C70 126 66 140 78 152L96 154C100 130 122 116 154 114L198 114C210 114 218 108 224 98C234 82 250 72 270 72C294 72 312 88 318 110C323 126 332 137 344 143C350 146 350 153 342 155C330 157 318 151 310 142C304 156 292 166 276 168L248 168C242 176 236 180 230 183L230 208C230 214 226 218 220 218C214 218 210 214 210 208L210 186L192 186L192 208C192 214 188 218 182 218C176 218 172 214 172 208L172 184C146 180 124 174 110 164L110 208C110 214 106 218 100 218C94 218 90 214 90 208L90 174Z"/><path d="M252 80C268 76 280 90 282 112C284 136 277 160 262 170C251 178 238 173 237 162C235 149 242 128 246 110C249 97 249 84 252 80Z" stroke="${paper}" stroke-width="6" stroke-linejoin="round"/></g><circle cx="304" cy="104" r="7.5" fill="${paper}"/>`;
const DOG = DOG_OF(INK, PAPER);
const dog = (x, y, k = 1, fill = INK, paper = PAPER) => `<g transform="translate(${x} ${y}) scale(${k})">${fill === INK ? DOG : DOG_OF(fill, paper)}</g>`;
// The van: 360 wide, 150 tall.
const VAN = `<g ${S}><path d="M0 120V40q0-40 40-40h180l60 60h60q20 0 20 20v40z"/><path d="M40 20h80v50H40zM140 20h70l40 50h-110z"/><circle cx="70" cy="125" r="26" fill="${PAPER}"/><circle cx="290" cy="125" r="26" fill="${PAPER}"/><path d="M0 100h360"/></g>`;
const van = (x, y, k = 1) => `<g transform="translate(${x} ${y}) scale(${k})">${VAN}</g>`;
// The lighthouse: 160 wide, 300 tall, origin at the base centre.
const LIGHT_OF = (stroke) => `<g ${S.replace(INK, stroke)}><path d="M-40 200l20-200h40l20 200z"/><path d="M-28 0h56M-34 60h68M-38 120h76"/><rect x="-24" y="-50" width="48" height="50"/><path d="M-30-50l30-30 30 30"/><path d="M-70-30l-40-10M70-30l40-10M-60-70l-30-30M60-70l30-30"/></g>`;
const LIGHT = LIGHT_OF(INK);
const lighthouse = (x, y, k = 1, stroke = INK) => `<g transform="translate(${x} ${y}) scale(${k})">${stroke === INK ? LIGHT : LIGHT_OF(stroke)}</g>`;
const word = (x, y, t, size = 30, fill = PAPER, extra = "") => `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="700" fill="${fill}" text-anchor="middle" letter-spacing="${Math.round(size / 4)}" ${extra}>${t}</text>`;

/* ---------- garments ---------- */
const tee = (fill = PAPER) => `<g ${S}><path d="M250 190l-120 70 50 90 60-30v290h320V320l60 30 50-90-120-70q-40 60-150 60t-150-60z" fill="${fill}"/><path d="M330 190q70 60 140 0"/></g>`;
const longsleeve = (fill = PAPER) => `<g ${S}><path d="M250 190l-120 70 10 300 80-10V320v290h360V320v240l80 10 10-300-120-70q-40 60-150 60t-150-60z" fill="${fill}"/><path d="M330 190q70 60 140 0"/></g>`;
const hoodie = (fill = PAPER) => `<g ${S}><path d="M270 200q40-70 130-70t130 70l140 60 40 100-60 20-50-70v300H200V310l-50 70-60-20 40-100z" fill="${fill}"/><path d="M270 200q130 60 260 0"/><path d="M330 200q-20-70 70-100 90 30 70 100"/><rect x="290" y="470" width="220" height="90" rx="10"/></g>`;
const crewneck = (fill = PAPER) => `<g ${S}><path d="M260 190l-130 70 30 110 60-20v260h360V350l60 20 30-110-130-70q-40 50-140 50t-140-50z" fill="${fill}"/><path d="M330 190q70 50 140 0"/><path d="M220 610h360"/></g>`;
const kidTee = (fill = PAPER) => `<g transform="translate(400 400) scale(0.72) translate(-400 -400)">${tee(fill)}</g>`;

/* ---------- objects ---------- */
const record = (label = C.green, sleeve = INK, title = "", text = PAPER) => `<rect x="120" y="120" width="560" height="560" fill="${sleeve}"/><circle cx="400" cy="400" r="225" fill="${label}"/><circle cx="400" cy="400" r="220" fill="none" stroke="${INK}" stroke-width="2" stroke-dasharray="1 5"/><circle cx="400" cy="400" r="80" fill="${PAPER}"/><circle cx="400" cy="400" r="6" fill="${INK}"/>${lighthouse(400, 370, 0.22)}${title ? word(400, 660, title, 28, text) : ""}`;
const disc = (color = INK, label = C.red, small = false) => `<circle cx="400" cy="400" r="${small ? 220 : 300}" fill="${color}"/><circle cx="400" cy="400" r="${small ? 215 : 295}" fill="none" stroke="${PAPER}" stroke-width="2" stroke-dasharray="1 6"/><circle cx="400" cy="400" r="${small ? 100 : 110}" fill="${label}"/><circle cx="400" cy="400" r="7" fill="${PAPER}"/>`;
const cassette = (shell = PAPER, ink = C.blue) => `<g ${S}><rect x="140" y="240" width="520" height="320" rx="18" fill="${shell}"/><rect x="190" y="290" width="420" height="120" rx="10" fill="${ink}"/><circle cx="300" cy="350" r="34" fill="${PAPER}"/><circle cx="500" cy="350" r="34" fill="${PAPER}"/><path d="M300 330v40M280 350h40M500 330v40M480 350h40"/><path d="M250 560l20-60h260l20 60"/><circle cx="180" cy="520" r="8" fill="${INK}"/><circle cx="620" cy="520" r="8" fill="${INK}"/></g>`;
const cd = () => `<rect x="150" y="150" width="500" height="500" rx="10" fill="${C.sand}" stroke="${INK}" stroke-width="7"/><circle cx="400" cy="400" r="190" fill="${C.smoke}"/><circle cx="400" cy="400" r="185" fill="none" stroke="${PAPER}" stroke-width="2" stroke-dasharray="1 6"/><circle cx="400" cy="400" r="40" fill="${C.sand}" stroke="${INK}" stroke-width="7"/>`;
const cap = (fill = PAPER, dogFill = INK) => `<g ${S}><path d="M190 420q0-180 210-180t210 180z" fill="${fill}"/><path d="M190 420h420"/><path d="M160 420q-50 40 20 60h440q70-20 20-60"/><path d="M400 240v-30"/></g>${dog(330, 300, 0.42, dogFill, fill)}`;
const beanie = (fill = C.night) => `<g ${S}><path d="M200 520q-20-250 200-290t200 290z" fill="${fill}"/><rect x="170" y="500" width="460" height="90" rx="20" fill="${PAPER}"/><circle cx="400" cy="215" r="28" fill="${PAPER}"/></g>${word(400, 562, "NORTHERN", 34, INK)}`;
const bucket = (fill = C.sand) => `<g ${S}><path d="M270 300h260l30 140H240z" fill="${fill}"/><path d="M150 440q250 60 500 0l20 60q-270 70-540 0z" fill="${fill}"/><path d="M270 300q130-120 260 0"/></g>${dog(345, 330, 0.3)}`;
const poster = (bg = C.blue, title = "", sub = "", inner = "") => `<rect x="170" y="90" width="460" height="620" fill="${bg}"/><rect x="190" y="110" width="420" height="580" fill="none" stroke="${PAPER}" stroke-width="3"/>${inner}${word(400, 560, title, 40, PAPER)}${word(400, 600, sub, 16, PAPER)}`;
const riso = () => `<rect x="170" y="90" width="460" height="620" fill="${PAPER}" stroke="${INK}" stroke-width="7"/><rect x="200" y="120" width="400" height="400" fill="${C.pink}"/><g opacity="0.85">${lighthouse(400, 460, 1.05)}</g><rect x="230" y="150" width="340" height="340" fill="none" stroke="${C.blue}" stroke-width="10" transform="rotate(-6 400 320)"/>${word(400, 640, "HARBOR LIGHTS", 24, INK)}`;
const pins = () => `<g ${S}><circle cx="260" cy="320" r="90" fill="${INK}"/><circle cx="540" cy="320" r="90" fill="${C.blue}"/><circle cx="400" cy="540" r="90" fill="${C.green}"/></g>${dog(205, 275, 0.28)}${van(480, 290, 0.32)}${lighthouse(400, 585, 0.3)}`;
const patch = () => `<g ${S}><rect x="200" y="260" width="400" height="280" rx="60" fill="${C.sand}"/><rect x="214" y="274" width="372" height="252" rx="50" fill="none" stroke="${INK}" stroke-width="4" stroke-dasharray="6 8"/></g>${dog(275, 320, 0.56)}`;
const stickers = () => `<rect x="150" y="110" width="500" height="580" fill="${PAPER}" stroke="${INK}" stroke-width="7"/><circle cx="270" cy="230" r="70" fill="${C.green}" stroke="${INK}" stroke-width="5"/><rect x="390" y="160" width="190" height="140" rx="20" fill="${C.blue}" stroke="${INK}" stroke-width="5"/><rect x="200" y="340" width="400" height="110" rx="55" fill="${INK}"/>${word(400, 410, "NORTHERN DOGS", 30, PAPER)}<circle cx="280" cy="580" r="70" fill="${C.red}" stroke="${INK}" stroke-width="5"/><rect x="400" y="500" width="180" height="160" rx="16" fill="${C.mustard}" stroke="${INK}" stroke-width="5"/>${dog(210, 190, 0.26)}${van(410, 200, 0.4)}${lighthouse(490, 640, 0.36)}`;
const keychain = () => `<g ${S}><circle cx="400" cy="230" r="70"/><circle cx="400" cy="230" r="40"/><path d="M400 300v60"/><rect x="330" y="360" width="140" height="300" rx="30" fill="${INK}"/><path d="M360 600h80"/></g><rect x="360" y="580" width="80" height="34" rx="6" fill="${PAPER}"/>${dog(345, 390, 0.3)}`;
const tote = (fill = C.sand) => `<g ${S}><path d="M220 330h360v330H220z" fill="${fill}"/><path d="M300 330q0-150 100-150t100 150"/></g>${dog(305, 400, 0.55)}`;
const pennant = () => `<g ${S}><path d="M120 250h580L140 560z" fill="${C.green}"/><path d="M120 250v310"/></g>${word(380, 360, "NORTHERN DOGS", 36, INK, 'transform="rotate(-16 380 360)"')}${word(330, 420, "QUEENS NY", 18, INK, 'transform="rotate(-16 330 420)"')}`;
const towel = () => `<g ${S}><rect x="160" y="140" width="480" height="520" fill="${PAPER}"/><path d="M160 160q240 30 480 0M160 640q240-30 480 0"/></g><rect x="200" y="200" width="400" height="400" fill="none" stroke="${C.blue}" stroke-width="5"/><path d="M230 520q60-80 120-40t90-60 60-80 70-40" fill="none" stroke="${C.blue}" stroke-width="9"/><path d="M230 300l60 60M380 250l40 40M300 420l50 50" stroke="${C.red}" stroke-width="9"/>${word(400, 630, "QUEENS", 24, INK)}`;
const incense = () => `<g ${S}><path d="M160 560h480l-60 60H220z" fill="${C.brown}"/><path d="M300 560L480 180" stroke-width="10"/><path d="M480 180q-10-50 20-80" stroke-width="5" stroke="${C.smoke}"/><path d="M500 100q20-40-10-70" stroke-width="5" stroke="${C.smoke}"/><rect x="180" y="300" width="120" height="260" rx="10" fill="${C.sand}"/></g>${word(240, 450, "HARBOR", 16, INK, 'transform="rotate(-90 240 450)"')}`;
const dice = () => `<g ${S}><rect x="200" y="300" width="200" height="200" rx="28" fill="${PAPER}" transform="rotate(-12 300 400)"/><rect x="420" y="300" width="200" height="200" rx="28" fill="${INK}" transform="rotate(10 520 400)"/></g><g fill="${INK}"><circle cx="265" cy="360" r="16"/><circle cx="300" cy="400" r="16"/><circle cx="335" cy="440" r="16"/></g><g fill="${PAPER}"><circle cx="480" cy="360" r="16"/><circle cx="560" cy="360" r="16"/><circle cx="480" cy="440" r="16"/><circle cx="560" cy="440" r="16"/><circle cx="520" cy="400" r="16"/><circle cx="520" cy="320" r="0"/></g>`;
const bandana = () => `<g ${S}><path d="M120 220h560L400 620z" fill="${C.red}"/><path d="M160 260h480" stroke="${PAPER}" stroke-dasharray="14 10" stroke-width="4"/><path d="M400 560L200 300h400z" fill="none" stroke="${PAPER}" stroke-width="4" stroke-dasharray="2 8"/></g>${dog(305, 300, 0.45)}`;
const leash = () => `<g ${S}><path d="M200 220q-60 60 0 120t120 0 120 0 120 0 60 60-60 120-120 0" stroke-width="18" stroke="${C.mustard}"/><path d="M200 220q-60 60 0 120t120 0 120 0 120 0 60 60-60 120-120 0" stroke-width="6" stroke-dasharray="2 14"/><path d="M200 220l-40-60"/><circle cx="150" cy="140" r="28" fill="${PAPER}"/><path d="M560 540l40 60"/><rect x="580" y="590" width="60" height="70" rx="12" fill="${INK}"/></g>`;
const socks = () => `<g ${S}><path d="M230 160h150v260l100 80q40 40 0 80t-90 10l-160-130z" fill="${PAPER}"/><path d="M420 160h150v260l100 80q40 40 0 80t-90 10l-160-130z" fill="${PAPER}" transform="translate(-30 0)"/><path d="M230 200h150M390 200h150"/></g><g fill="${C.blue}"><rect x="245" y="230" width="120" height="22"/><rect x="245" y="280" width="120" height="22"/><rect x="405" y="230" width="120" height="22"/><rect x="405" y="280" width="120" height="22"/></g>`;
const slipmat = () => `<circle cx="400" cy="400" r="290" fill="${C.night}"/><circle cx="400" cy="400" r="14" fill="${PAPER}"/><g fill="none" stroke="${PAPER}" stroke-width="3"><circle cx="400" cy="400" r="120"/><circle cx="400" cy="400" r="200"/></g>${lighthouse(400, 300, 0.42)}${word(400, 560, "NORTHERN DOGS", 26, PAPER)}`;
const cooler = () => `<g ${S}><rect x="270" y="200" width="260" height="420" rx="40" fill="${C.mustard}"/><path d="M270 240q130 40 260 0M270 580q130-40 260 0"/></g>${word(400, 470, "QUEENS", 28, INK, 'transform="rotate(-90 400 430)"')}${van(305, 350, 0.52)}`;
const zine = () => `<g ${S}><rect x="190" y="130" width="420" height="540" fill="${C.sand}"/><path d="M190 130l420 540" opacity="0"/><rect x="220" y="160" width="360" height="300" fill="${INK}"/></g>${word(400, 560, "LYRICS &amp; PHOTOS", 24, INK)}${word(400, 600, "2019 – 2026", 18, INK)}${dog(245, 230, 0.75)}`;
const mug = () => `<g ${S}><path d="M240 230h300v300q0 70-70 70H310q-70 0-70-70z" fill="${PAPER}"/><path d="M540 290h50q60 0 60 70t-60 70h-50"/><path d="M240 230q150 40 300 0"/></g>${dog(300, 330, 0.45)}`;
const seven = () => `<rect x="170" y="170" width="460" height="460" fill="${C.red}"/><circle cx="400" cy="400" r="190" fill="${INK}"/><circle cx="400" cy="400" r="185" fill="none" stroke="${PAPER}" stroke-width="2" stroke-dasharray="1 6"/><circle cx="400" cy="400" r="70" fill="${C.mustard}"/><circle cx="400" cy="400" r="6" fill="${INK}"/>${word(400, 240, "SKILLMAN AVE", 26, PAPER)}`;
const bundle = () => `<g transform="translate(70 60) scale(0.62)">${record(C.green, INK)}</g><g transform="translate(290 220) scale(0.62)">${tee(PAPER)}</g>${dog(515, 505, 0.3)}`;
const ticket = (title, when) => `<rect x="110" y="250" width="580" height="300" rx="24" fill="${C.blue}"/><circle cx="110" cy="400" r="30" fill="${PAPER}"/><circle cx="690" cy="400" r="30" fill="${PAPER}"/><path d="M520 270v260" stroke="${PAPER}" stroke-width="4" stroke-dasharray="8 10"/>${lighthouse(600, 470, 0.4)}${word(315, 380, "NORTHERN DOGS", 28, PAPER)}${word(315, 430, title, 15, PAPER)}${word(315, 470, when, 13, PAPER)}`;
const irregular = () => `${tee(PAPER)}${dog(372, 452, 0.78)}<g transform="rotate(-18 400 300)"><rect x="300" y="150" width="200" height="64" fill="${C.red}"/>${word(400, 195, "IRREGULAR", 30, PAPER)}</g>`;

/* ---------- the pictures ---------- */
const frame = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800"><rect width="800" height="800" fill="${PAPER}"/>${inner}</svg>`;
const ART = {
  "harbor-lights-lp": record(C.green, INK, "HARBOR LIGHTS"),
  "harbor-lights-lp-black": record(INK, C.night, "HARBOR LIGHTS"),
  "harbor-lights-lp-white": record(C.white, C.blue, "QUEENS EDITION"),
  "harbor-lights-cassette": cassette(PAPER, C.blue),
  "harbor-lights-cd": cd(),
  "skillman-ave-7": seven(),
  "live-at-the-broadway": `<rect x="120" y="120" width="560" height="560" fill="${C.night}"/>${disc(INK, C.red)}${word(400, 640, "LIVE AT THE BROADWAY", 24, PAPER)}`,
  "northern-dogs-lp": record(C.brown, C.sand, "NORTHERN DOGS", INK),
  "dog-logo-tee": `${tee(PAPER)}${dog(372, 452, 0.78)}`,
  "dog-logo-tee-back": `${tee(PAPER)}${word(400, 340, "NORTHERN DOGS", 36, INK)}${word(400, 390, "QUEENS, NY", 18, INK)}`,
  "harbor-lights-tour-tee": `${tee(INK)}${lighthouse(400, 470, 0.7, PAPER)}`,
  "harbor-lights-tour-tee-back": `${tee(INK)}${[["OCT 24", "BROOKLYN"], ["OCT 25", "PHILADELPHIA"], ["OCT 27", "WASHINGTON DC"], ["OCT 29", "PITTSBURGH"], ["NOV 1", "CHICAGO"], ["NOV 13", "BROOKLYN"]].map(([d, c], i) => word(400, 320 + i * 42, `${d}  ${c}`, 18, PAPER)).join("")}`,
  "get-in-tee": `${tee(C.sand)}${van(278, 390, 0.68)}${word(400, 330, "GET IN", 30, INK)}`,
  "lighthouse-long-sleeve": `${longsleeve(C.night)}${lighthouse(400, 470, 0.7, PAPER)}`,
  "van-hoodie": `${hoodie(PAPER)}${van(230, 330, 0.45)}`,
  "nobody-walks-crewneck": `${crewneck(C.mustard)}${word(400, 400, "NOBODY WALKS", 34, INK)}${word(400, 450, "IN QUEENS", 34, INK)}`,
  "kids-dog-tee": `${kidTee(C.pink)}${dog(380, 440, 0.55)}`,
  "harbor-socks": socks(),
  "harbor-cap": cap(PAPER),
  "dog-rope-hat": cap(C.night, PAPER),
  "northern-beanie": beanie(C.night),
  "harbor-bucket-hat": bucket(C.sand),
  "fall-tour-poster": poster(C.blue, "FALL TOUR 2026", "SCREEN PRINT · 150", lighthouse(400, 460, 0.85)),
  "release-show-poster": poster(C.red, "RELEASE SHOW", "THE BROADWAY · NOV 13", `<g transform="translate(300 200) scale(0.6)">${DOG}</g>`),
  "lighthouse-riso": riso(),
  "enamel-pin-set": pins(),
  "dog-patch": patch(),
  "sticker-pack": stickers(),
  "keychain-opener": keychain(),
  "canvas-tote": tote(C.sand),
  "felt-pennant": pennant(),
  "queens-tea-towel": towel(),
  "harbor-incense": incense(),
  "pair-of-dice": dice(),
  "dog-bandana": bandana(),
  "walks-leash": leash(),
  "harbor-lights-slipmat": slipmat(),
  "can-cooler": cooler(),
  "lyric-zine": zine(),
  "harbor-mug": mug(),
  "harbor-lights-bundle": bundle(),
  "release-show-brooklyn": ticket("RELEASE SHOW · THE BROADWAY", "NOV 13 2026 · DOORS 8PM"),
  "winter-show-queens": ticket("THE WINDJAMMER · QUEENS", "DEC 5 2026 · DOORS 7PM"),
  "dog-logo-tee-irregular": irregular(),
};

mkdirSync("images", { recursive: true });
for (const [name, inner] of Object.entries(ART)) writeFileSync(`images/${name}.svg`, frame(inner) + "\n");
console.log(`drew ${Object.keys(ART).length} pictures into images/`);
