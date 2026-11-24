import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const SIZE = 128;
const SS = 2; // 2x supersampling for crisp anti-aliasing

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function mixColor(c1, c2, t) {
  const k = Math.max(0, Math.min(1, t));
  return [lerp(c1[0], c2[0], k), lerp(c1[1], c2[1], k), lerp(c1[2], c2[2], k), lerp(c1[3], c2[3], k)];
}

function over(dst, src) {
  const sa = src[3] / 255;
  const da = dst[3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return [0, 0, 0, 0];
  return [
    (src[0] * sa + dst[0] * da * (1 - sa)) / outA,
    (src[1] * sa + dst[1] * da * (1 - sa)) / outA,
    (src[2] * sa + dst[2] * da * (1 - sa)) / outA,
    outA * 255,
  ];
}

function sdRoundedRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function pointInTri(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function inAstroid(px, py, cx, cy, r) {
  const dx = Math.abs(px - cx) / r;
  const dy = Math.abs(py - cy) / r;
  return Math.pow(dx, 0.62) + Math.pow(dy, 0.62) <= 1.0;
}

function samplePixel(x, y) {
  let c = [0, 0, 0, 0];
  const bgDist = sdRoundedRect(x, y, 64, 64, 59, 59, 26);
  if (bgDist <= 0) {
    const t = (x + y) / 256;
    c = mixColor([25, 22, 58, 255], [78, 50, 138, 255], t);
  }
  const hairCol = mixColor([77, 107, 255, 255], [216, 150, 255, 255], (x * 0.4 + y * 0.8) / 145);

  // Cat ears outer + inner
  const inLeftEar = pointInTri(x, y, 22, 62, 30, 19, 55, 44);
  const inRightEar = pointInTri(x, y, 106, 62, 98, 19, 73, 44);
  if (inLeftEar || inRightEar) c = over(c, hairCol);
  if (pointInTri(x, y, 30, 54, 34, 29, 49, 45) || pointInTri(x, y, 98, 54, 94, 29, 79, 45)) {
    c = over(c, [247, 178, 220, 255]);
  }

  // Head hair silhouette
  const hairDist = Math.hypot((x - 64) / 40, (y - 70) / 36);
  if (hairDist <= 1) c = over(c, hairCol);

  // Face skin
  const faceDist = Math.hypot((x - 64) / 31, (y - 76) / 26.5);
  if (faceDist <= 1) c = over(c, [255, 242, 234, 255]);

  // Bangs
  if (faceDist <= 1.05 && y < 67 + 5 * Math.sin((x - 32) * 0.24)) {
    if (hairDist <= 1.02) c = over(c, hairCol);
  }

  // Blush
  const bL = Math.hypot((x - 40) / 6.5, (y - 84.5) / 3.2);
  if (bL < 1) c = over(c, [255, 150, 186, (1 - bL) * 160]);
  const bR = Math.hypot((x - 88) / 6.5, (y - 84.5) / 3.2);
  if (bR < 1) c = over(c, [255, 150, 186, (1 - bR) * 160]);

  // Left Eye (Pink-Purple)
  const eL = Math.hypot((x - 50) / 7.8, (y - 76) / 9.2);
  if (eL <= 1) {
    const col = mixColor([255, 148, 232, 255], [96, 30, 142, 255], Math.min(1, eL * 1.15));
    c = over(c, col);
    if (Math.hypot(x - 47.4, y - 72.4) <= 2.6) c = over(c, [255, 255, 255, 255]);
    if (Math.hypot(x - 52.6, y - 79.4) <= 1.4) c = over(c, [255, 217, 247, 240]);
  }

  // Right Eye (Golden-Yellow)
  const eR = Math.hypot((x - 78) / 7.8, (y - 76) / 9.2);
  if (eR <= 1) {
    const col = mixColor([255, 244, 158, 255], [168, 92, 12, 255], Math.min(1, eR * 1.15));
    c = over(c, col);
    if (Math.hypot(x - 75.4, y - 72.4) <= 2.6) c = over(c, [255, 255, 255, 255]);
    if (Math.hypot(x - 80.6, y - 79.4) <= 1.4) c = over(c, [255, 248, 200, 240]);
  }

  // Cute cat mouth :3
  if (y >= 84 && y <= 93 && x >= 56 && x <= 72) {
    const dLeft = Math.abs(Math.hypot(x - 61, y - 86.5) - 3.2);
    const dRight = Math.abs(Math.hypot(x - 67, y - 86.5) - 3.2);
    if (y >= 86.5 && (dLeft < 1.05 || dRight < 1.05)) {
      c = over(c, [112, 58, 96, 255]);
    }
  }

  // Gemini 4-point star hairclip
  if (inAstroid(x, y, 89, 55, 13)) {
    const st = mixColor([124, 212, 255, 255], [255, 232, 135, 255], (x - 76 + y - 42) / 48);
    c = over(c, st);
  }
  // Ambient floating mini star
  if (inAstroid(x, y, 24, 34, 7.5)) {
    c = over(c, [186, 224, 255, 245]);
  }

  return c;
}

export function generateIconPng(outPath) {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const s = samplePixel(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
          r += s[0];
          g += s[1];
          b += s[2];
          a += s[3];
        }
      }
      const n = SS * SS;
      const idx = (y * SIZE + x) * 4;
      rgba[idx] = Math.round(r / n);
      rgba[idx + 1] = Math.round(g / n);
      rgba[idx + 2] = Math.round(b / n);
      rgba[idx + 3] = Math.round(a / n);
    }
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, encodePng(SIZE, SIZE, rgba));
}

if (process.argv[1] && process.argv[1].endsWith('generate-icon-png.mjs')) {
  const out = resolve(process.cwd(), 'assets', 'icon.png');
  generateIconPng(out);
  console.log('[gemini-pet] generated', out);
}
