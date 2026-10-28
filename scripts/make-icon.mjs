/**
 * 生成 1024x1024 应用图标 app-icon.png（纯 Node + zlib，无第三方图像依赖）。
 * 之后由 `pnpm tauri icon app-icon.png` 派生出 ico/icns/各尺寸 png。
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../app-icon.png");
const S = 1024;
const px = Buffer.alloc(S * S * 4);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function blend(x, y, r, g, b, a) {
  if (a <= 0) return;
  const i = (y * S + x) * 4;
  const da = px[i + 3] / 255;
  const oa = a + da * (1 - a);
  if (oa <= 0) return;
  px[i] = Math.round((r * a + px[i] * da * (1 - a)) / oa);
  px[i + 1] = Math.round((g * a + px[i + 1] * da * (1 - a)) / oa);
  px[i + 2] = Math.round((b * a + px[i + 2] * da * (1 - a)) / oa);
  px[i + 3] = Math.round(oa * 255);
}

function sdfRoundRect(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx) - (hw - r);
  const dy = Math.abs(y - cy) - (hh - r);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inside = Math.min(Math.max(dx, dy), 0);
  return outside + inside - r;
}

/** colorFn(x,y) -> [r,g,b,a01]，支持渐变 */
function roundRect(x0, y0, w, h, r, colorFn) {
  const pad = 2;
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  const minX = Math.max(0, Math.floor(x0 - pad));
  const maxX = Math.min(S - 1, Math.ceil(x0 + w + pad));
  const minY = Math.max(0, Math.floor(y0 - pad));
  const maxY = Math.min(S - 1, Math.ceil(y0 + h + pad));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = sdfRoundRect(x + 0.5, y + 0.5, cx, cy, w / 2, h / 2, r);
      const cov = clamp01(0.5 - d);
      if (cov <= 0) continue;
      const [cr, cg, cb, ca] = colorFn(x, y);
      blend(x, y, cr, cg, cb, cov * ca);
    }
  }
}

const solid = (r, g, b, a = 1) => () => [r, g, b, a];

function circle(cx, cy, rad, colorFn) {
  roundRect(cx - rad, cy - rad, rad * 2, rad * 2, rad, colorFn);
}

function segDist(x, y, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = x - x1;
  const wy = y - y1;
  const len2 = vx * vx + vy * vy || 1;
  let t = (wx * vx + wy * vy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (x1 + vx * t), y - (y1 + vy * t));
}

function stroke(x1, y1, x2, y2, width, colorFn) {
  const pad = width;
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - pad));
  const maxX = Math.min(S - 1, Math.ceil(Math.max(x1, x2) + pad));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - pad));
  const maxY = Math.min(S - 1, Math.ceil(Math.max(y1, y2) + pad));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = segDist(x + 0.5, y + 0.5, x1, y1, x2, y2) - width / 2;
      const cov = clamp01(0.5 - d);
      if (cov <= 0) continue;
      const [cr, cg, cb, ca] = colorFn(x, y);
      blend(x, y, cr, cg, cb, cov * ca);
    }
  }
}

// ── 背景：圆角方形 + 品牌渐变 ─────────────────────────────
roundRect(32, 32, S - 64, S - 64, 216, (x, y) => {
  const t = clamp01((y - 32) / (S - 64));
  const r = Math.round(123 + (79 - 123) * t);
  const g = Math.round(147 + (110 - 147) * t);
  const b = Math.round(255 + (247 - 255) * t);
  // 右上角柔光
  const hx = clamp01(1 - Math.hypot(x - 780, y - 220) / 720);
  const lift = hx * hx * 26;
  return [Math.min(255, r + lift), Math.min(255, g + lift), Math.min(255, b + lift * 0.6), 1];
});

// ── 日历卡片 ─────────────────────────────────────────────
const cardX = 156;
const cardY = 208;
const cardW = S - cardX * 2;
const cardH = 688;
roundRect(cardX, cardY, cardW, cardH, 66, solid(255, 255, 255, 0.98));

// 卡片顶部色带（月份栏）
const headH = 132;
roundRect(cardX, cardY, cardW, headH, 66, solid(59, 78, 190, 1));
roundRect(cardX, cardY + headH - 66, cardW, 66, 8, solid(59, 78, 190, 1));

// 顶部三个「星期」圆点
for (let i = 0; i < 3; i++) {
  circle(cardX + 96 + i * 56, cardY + headH / 2, 13, solid(255, 255, 255, 0.9));
}
// 顶部标题条
roundRect(cardX + cardW - 300, cardY + headH / 2 - 12, 200, 24, 12, solid(255, 255, 255, 0.55));

// 装订环
for (const rx of [cardX + 190, cardX + cardW - 190 - 34]) {
  roundRect(rx, cardY - 62, 34, 128, 17, solid(232, 236, 248, 1));
  roundRect(rx + 7, cardY - 55, 20, 114, 10, solid(255, 255, 255, 0.75));
}

// 日期格子 5 列 x 3 行
const cols = 5;
const rows = 3;
const gx = cardX + 74;
const gy = cardY + headH + 62;
const gw = cardW - 148;
const gh = cardH - headH - 130;
const cellW = gw / cols;
const cellH = gh / rows;
const dot = 40;
let highlight = null;
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const cx = gx + c * cellW + cellW / 2;
    const cy = gy + r * cellH + cellH / 2;
    const isHot = r === 1 && c === 3;
    if (isHot) highlight = [cx, cy];
    circle(cx, cy, dot / 2 + 8, isHot ? solid(79, 110, 247, 1) : solid(222, 227, 240, 0.95));
  }
}

// 高亮格里的对勾
if (highlight) {
  const [cx, cy] = highlight;
  const w = 13;
  stroke(cx - 17, cy + 1, cx - 5, cy + 14, w, solid(255, 255, 255, 1));
  stroke(cx - 5, cy + 14, cx + 19, cy - 13, w, solid(255, 255, 255, 1));
}

// ── PNG 编码 ─────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter: none
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

fs.writeFileSync(OUT, png);
console.log(`[icon] wrote ${OUT} (${(png.length / 1024).toFixed(1)} KB)`);