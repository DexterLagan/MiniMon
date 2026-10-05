import zlib from "node:zlib";
import fs from "node:fs";

const SIZE = 1024;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePng(path, rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  fs.writeFileSync(path, png);
}

// signed distance to a rounded rect, negative = inside
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx) - hw + r;
  const dy = Math.abs(y - cy) - hh + r;
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - r;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;

const img = Buffer.alloc(SIZE * SIZE * 4);

const PAD = 96;
const BG_R = 190;
const bgCx = SIZE / 2, bgCy = SIZE / 2, bgHw = (SIZE - 2 * PAD) / 2, bgHh = (SIZE - 2 * PAD) / 2;

const bars = [
  { color: [34, 211, 238], frac: 0.62 },   // cpu  cyan
  { color: [52, 211, 153], frac: 0.45 },   // gpu  green
  { color: [251, 191, 36], frac: 0.74 },   // mem  amber
  { color: [167, 139, 250], frac: 0.38 },  // disk violet
];

const barX0 = PAD + 150;
const barW = SIZE - 2 * PAD - 300;
const barH = 74;
const barGap = 62;
const barsTotal = bars.length * barH + (bars.length - 1) * barGap;
const barY0 = (SIZE - barsTotal) / 2;
const TRACK_R = barH / 2;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    // background rounded square with vertical gradient
    const d = sdRoundRect(x, y, bgCx, bgCy, bgHw, bgHh, BG_R);
    const aBg = clamp01(0.5 - d);
    if (aBg <= 0) continue;
    const t = y / SIZE;
    let r = lerp(24, 10, t), g = lerp(28, 13, t), b = lerp(44, 24, t);
    let a = aBg;

    for (let k = 0; k < bars.length; k++) {
      const cy = barY0 + k * (barH + barGap) + barH / 2;
      // track
      const dt = sdRoundRect(x, y, SIZE / 2, cy, barW / 2, barH / 2, TRACK_R);
      if (dt < 0.5) {
        const at = clamp01(0.5 - dt) * 0.10;
        r = lerp(r, 255, at); g = lerp(g, 255, at); b = lerp(b, 255, at);
        a = Math.max(a, clamp01(0.5 - dt) * 0.9 + a * (1 - clamp01(0.5 - dt)));
      }
      // fill
      const wFill = barW * bars[k].frac;
      if (x >= barX0 && x <= barX0 + wFill + TRACK_R * 2) {
        const df = sdRoundRect(x, y, barX0 + wFill / 2, cy, wFill / 2, barH / 2, TRACK_R);
        const af = clamp01(0.5 - df);
        if (af > 0) {
          const [cr, cg, cb] = bars[k].color;
          const glow = af * 0.35 * clamp01(1 - Math.abs(df) / 26);
          r = lerp(r, cr, af) + cr * glow;
          g = lerp(g, cg, af) + cg * glow;
          b = lerp(b, cb, af) + cb * glow;
          a = Math.max(a, af);
        }
      }
    }
    img[i] = Math.min(255, r);
    img[i + 1] = Math.min(255, g);
    img[i + 2] = Math.min(255, b);
    img[i + 3] = Math.min(255, a * 255);
  }
}

writePng("scripts/app-icon.png", img, SIZE, SIZE);
console.log("wrote scripts/app-icon.png");
