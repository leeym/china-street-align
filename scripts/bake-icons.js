#!/usr/bin/env node
"use strict";

/**
 * Bake Chrome extension toolbar / store icons (16 / 48 / 128).
 * Concept: misaligned satellite plate + street grid, pinned together.
 * Not Google branding colors.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "assets", "icons");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function setPx(rgba, w, x, y, r, g, b, a = 255) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= w || yi >= w) return;
  const i = (yi * w + xi) * 4;
  const oa = rgba[i + 3] / 255;
  const na = a / 255;
  const outA = na + oa * (1 - na);
  if (outA <= 0) return;
  rgba[i] = Math.round((r * na + rgba[i] * oa * (1 - na)) / outA);
  rgba[i + 1] = Math.round((g * na + rgba[i + 1] * oa * (1 - na)) / outA);
  rgba[i + 2] = Math.round((b * na + rgba[i + 2] * oa * (1 - na)) / outA);
  rgba[i + 3] = Math.round(outA * 255);
}

function fillRect(rgba, w, x0, y0, x1, y1, r, g, b, a) {
  const xa = Math.max(0, Math.floor(x0));
  const ya = Math.max(0, Math.floor(y0));
  const xb = Math.min(w, Math.ceil(x1));
  const yb = Math.min(w, Math.ceil(y1));
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) setPx(rgba, w, x, y, r, g, b, a);
  }
}

function fillCircle(rgba, w, cx, cy, rad, r, g, b, a) {
  const r2 = rad * rad;
  for (let y = Math.floor(cy - rad) - 1; y <= Math.ceil(cy + rad) + 1; y++) {
    for (let x = Math.floor(cx - rad) - 1; x <= Math.ceil(cx + rad) + 1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) setPx(rgba, w, x, y, r, g, b, a);
    }
  }
}

function roundedBg(rgba, w, radius, r, g, b) {
  const r2 = radius * radius;
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      let inside = true;
      const cx = x < radius ? radius : x >= w - radius ? w - 1 - radius : null;
      const cy = y < radius ? radius : y >= w - radius ? w - 1 - radius : null;
      if (cx != null && cy != null) {
        const dx = x - cx;
        const dy = y - cy;
        inside = dx * dx + dy * dy <= r2;
      }
      if (inside) setPx(rgba, w, x, y, r, g, b, 255);
    }
  }
}

/** Classic map teardrop (head circle + pointed stem). */
function fillPin(rgba, w, cx, top, headR, r, g, b) {
  fillCircle(rgba, w, cx, top + headR, headR, r, g, b, 255);
  const tipY = top + headR * 2.85;
  for (let y = Math.floor(top + headR); y <= Math.ceil(tipY); y++) {
    const t = (y - (top + headR)) / (tipY - (top + headR));
    const half = headR * (1 - t) * 0.92;
    fillRect(rgba, w, cx - half, y, cx + half, y + 1, r, g, b, 255);
  }
  fillCircle(rgba, w, cx, top + headR, headR * 0.38, 255, 248, 240, 255);
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size / 128;
  roundedBg(rgba, size, Math.max(2, Math.round(22 * s)), 18, 58, 68);

  if (size <= 16) {
    // Toolbar: keep readable — two offset plates + a pin head.
    fillRect(rgba, size, 2, 3, 10, 11, 62, 110, 96, 255);
    fillRect(rgba, size, 6, 5, 14, 13, 232, 214, 176, 255);
    fillRect(rgba, size, 8, 7, 12, 8, 18, 58, 68, 255);
    fillRect(rgba, size, 9, 6, 11, 11, 18, 58, 68, 255);
    fillCircle(rgba, size, 10, 7, 2.2, 196, 58, 48, 255);
    fillCircle(rgba, size, 10, 7, 0.9, 255, 248, 240, 255);
    return encodePng(size, size, rgba);
  }

  // Satellite plate (offset up-left)
  fillRect(rgba, size, 20 * s, 26 * s, 76 * s, 86 * s, 62, 110, 96, 235);
  // Street plate (offset down-right)
  const gx0 = 46 * s;
  const gy0 = 38 * s;
  const gx1 = 110 * s;
  const gy1 = 102 * s;
  fillRect(rgba, size, gx0, gy0, gx1, gy1, 236, 220, 186, 235);
  const stroke = Math.max(1, Math.round(s * 2));
  for (let i = 1; i <= 3; i++) {
    const x = gx0 + (i * (gx1 - gx0)) / 4;
    fillRect(rgba, size, x - stroke / 2, gy0, x + stroke / 2, gy1, 18, 58, 68, 200);
    const y = gy0 + (i * (gy1 - gy0)) / 4;
    fillRect(rgba, size, gx0, y - stroke / 2, gx1, y + stroke / 2, 18, 58, 68, 200);
  }

  fillPin(rgba, size, 78 * s, 44 * s, 11 * s, 196, 58, 48);
  return encodePng(size, size, rgba);
}

fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, drawIcon(size));
  console.log(`wrote ${path.relative(root, file)} (${fs.statSync(file).size} bytes)`);
}
