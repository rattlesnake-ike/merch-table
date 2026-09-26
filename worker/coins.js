/* Taking coin straight into the band's own wallet. No processor, nobody in the middle.
   Optional, off unless the band fills in an address, and deliberately small.

   WHAT THIS DOES: shows a fan a payment request — an address, an exact amount, a QR code —
   and records that the band said it arrived. That last part is the honest bit. This does not
   watch the chain; a band with no server to run cannot. A person checks their wallet and marks
   the order paid, the same way a band selling at a merch table checks the cash box.

   WHY IT IS BUILT THIS WAY. Watching a chain needs a key, a node or an API account, and it has
   to keep running when nobody is looking. The rest of this store needs none of that — it is
   files on a CDN and one Worker. Adding a background watcher would change what this project
   is. So: the QR is real and standards-correct, and the confirmation is a human one.

   NEVER ships anything on an unconfirmed payment. A band marks an order paid after they have
   seen it confirmed in their own wallet, which is also the only judgement a wallet can make
   that this code cannot. */

/** Currencies we can build a payment request for. */
export const COINS = {
  btc: { label: "Bitcoin", scheme: "bitcoin", decimals: 8, unit: "BTC" },
  ada: { label: "Cardano", scheme: "web+cardano", decimals: 6, unit: "ADA" },
  eth: { label: "Ethereum", scheme: "ethereum", decimals: 18, unit: "ETH" },
};

/**
 * A payment URI a wallet will understand.
 *
 * Bitcoin is BIP-21: the amount MUST be decimal BTC with a period, never satoshis, and the
 * part after `bitcoin:` is case-sensitive. Cardano is CIP-13, and note the scheme really is
 * `web+cardano` rather than `cardano`. Ethereum is ERC-681, whose `value` is in wei — the
 * single most common way to send someone a thousand times too much or too little.
 */
export function paymentUri(coin, address, amount) {
  const c = COINS[coin];
  if (!c || !address) return null;
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return null;

  if (coin === "eth") {
    // ERC-681 wants atomic units, as an integer, with no exponent notation.
    const wei = BigInt(Math.round(amt * 1e6)) * 10n ** BigInt(c.decimals - 6);
    return `ethereum:${address}?value=${wei.toString()}`;
  }
  // BIP-21 and CIP-13 both take a decimal amount in the main unit.
  const dec = amt.toFixed(c.decimals).replace(/0+$/, "").replace(/\.$/, "");
  return `${c.scheme}:${address}?amount=${dec}`;
}

/**
 * A QR code, drawn as SVG, with no library.
 *
 * Deliberately narrow: version-40 byte mode at the lowest error correction, which is enough
 * for any payment URI a store produces. It is not a general QR encoder and should not become
 * one — a wrong QR sends money to nowhere, so this stays small enough to read in full.
 */
export function qrSvg(text, size = 240) {
  const m = qrMatrix(text);
  if (!m) return null;
  const n = m.length, q = 4, total = n + q * 2, s = size / total;
  let rects = "";
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (m[y][x]) rects += `<rect x="${((x + q) * s).toFixed(2)}" y="${((y + q) * s).toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Payment QR code"><rect width="${size}" height="${size}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

/* ---- QR encoding. Byte mode, error correction L, smallest version that fits. ---- */

const GF_EXP = new Uint8Array(512), GF_LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]; })();
const gmul = (a, b) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

function rsGenerator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const ng = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { ng[j] ^= gmul(g[j], 1); ng[j + 1] ^= gmul(g[j], GF_EXP[i]); }
    g = ng;
  }
  return g;
}

function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen), res = new Uint8Array(data.length + ecLen);
  res.set(data);
  for (let i = 0; i < data.length; i++) {
    const c = res[i];
    if (c === 0) continue;
    for (let j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], c);
  }
  return res.slice(data.length);
}

// [version, total codewords, ec codewords per block, blocks] for error correction L.
// Only the sizes a payment URI needs; a longer string returns null rather than guessing.
const VERSIONS = [
  [4, 100, 20, 1], [5, 134, 26, 1], [6, 172, 36, 2], [7, 196, 40, 2],
  [8, 242, 48, 2], [9, 292, 60, 2], [10, 346, 72, 2],
];

function qrMatrix(text) {
  const bytes = new TextEncoder().encode(text);
  const pick = VERSIONS.find(([, total, ec, blocks]) => bytes.length + 2 + Math.ceil(((bytes.length + 2) * 0) / 1) <= total - ec * blocks - 2);
  if (!pick) return null;
  const [version, totalCw, ecPerBlock, blocks] = pick;
  const dataCw = totalCw - ecPerBlock * blocks;

  // Bit stream: mode 0100 (byte), 8- or 16-bit length, the data, a terminator, then padding.
  const bits = [];
  const push = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  for (let i = 0; i < 4 && bits.length < dataCw * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const cw = [];
  for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let i = 0; cw.length < dataCw; i++) cw.push(i % 2 ? 0x11 : 0xec);

  // Split into blocks, add error correction, interleave.
  const per = Math.floor(dataCw / blocks), extra = dataCw % blocks;
  const dBlocks = [], eBlocks = [];
  let off = 0;
  for (let b = 0; b < blocks; b++) {
    const len = per + (b >= blocks - extra ? 1 : 0);
    const d = Uint8Array.from(cw.slice(off, off + len)); off += len;
    dBlocks.push(d); eBlocks.push(rsEncode(d, ecPerBlock));
  }
  const out = [];
  for (let i = 0; i < Math.max(...dBlocks.map((d) => d.length)); i++) for (const d of dBlocks) if (i < d.length) out.push(d[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const e of eBlocks) out.push(e[i]);

  return place(version, out);
}

function place(version, codewords) {
  const n = version * 4 + 17;
  const m = Array.from({ length: n }, () => new Array(n).fill(null));
  const set = (y, x, v) => { if (y >= 0 && y < n && x >= 0 && x < n) m[y][x] = v; };

  const finder = (ry, rx) => {
    for (let y = -1; y <= 7; y++) for (let x = -1; x <= 7; x++) {
      const on = y >= 0 && y <= 6 && x >= 0 && x <= 6 && (y === 0 || y === 6 || x === 0 || x === 6 || (y >= 2 && y <= 4 && x >= 2 && x <= 4));
      set(ry + y, rx + x, on ? 1 : 0);
    }
  };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);

  for (let i = 8; i < n - 8; i++) { const v = i % 2 === 0 ? 1 : 0; set(6, i, v); set(i, 6, v); }

  // Alignment patterns. Versions 4..10 have two coordinates.
  const ac = { 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] }[version] ?? [];
  for (const cy of ac) for (const cx of ac) {
    if ((cy <= 8 && cx <= 8) || (cy <= 8 && cx >= n - 9) || (cy >= n - 9 && cx <= 8)) continue;
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++)
      set(cy + y, cx + x, Math.max(Math.abs(y), Math.abs(x)) !== 1 ? 1 : 0);
  }
  set(n - 8, 8, 1);   // the always-dark module

  // Reserve the format areas so data does not land in them.
  for (let i = 0; i < 9; i++) { if (m[8][i] === null) set(8, i, 0); if (m[i][8] === null) set(i, 8, 0); }
  for (let i = 0; i < 8; i++) { if (m[8][n - 1 - i] === null) set(8, n - 1 - i, 0); if (m[n - 1 - i][8] === null) set(n - 1 - i, 8, 0); }

  // Zig-zag the data in from the bottom right, with mask 0.
  let bit = 0, up = true;
  const bitsOf = (i) => (codewords[i >> 3] >> (7 - (i & 7))) & 1;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let r = 0; r < n; r++) {
      const y = up ? n - 1 - r : r;
      for (const x of [col, col - 1]) {
        if (m[y][x] !== null) continue;
        let v = bit < codewords.length * 8 ? bitsOf(bit) : 0; bit++;
        if ((y + x) % 2 === 0) v ^= 1;          // mask pattern 0
        m[y][x] = v;
      }
    }
    up = !up;
  }

  // Format information for EC level L, mask 0.
  const FORMAT = 0b111011111000100;
  for (let i = 0; i <= 5; i++) set(8, i, (FORMAT >> (14 - i)) & 1);
  set(8, 7, (FORMAT >> 8) & 1); set(8, 8, (FORMAT >> 7) & 1); set(7, 8, (FORMAT >> 6) & 1);
  for (let i = 9; i <= 14; i++) set(14 - i, 8, (FORMAT >> (14 - i)) & 1);
  for (let i = 0; i <= 7; i++) set(n - 1 - i, 8, (FORMAT >> (14 - i)) & 1);
  for (let i = 8; i <= 14; i++) set(8, n - 15 + i, (FORMAT >> (14 - i)) & 1);

  return m.map((row) => row.map((v) => v ?? 0));
}
