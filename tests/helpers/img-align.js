const fs = require("fs");
const { pngToBmp } = require("./bmp-luma");

// Decode a BMP written by sips into a luma plane.
function bmpLuma(bmpPath) {
  const buf = fs.readFileSync(bmpPath);
  const w = Math.abs(buf.readInt32LE(18));
  const rawH = buf.readInt32LE(22);
  const topDown = rawH < 0;
  const h = Math.abs(rawH);
  const off = buf.readUInt32LE(10);
  const row = Math.floor((w * 3 + 3) / 4) * 4;
  const y = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const rowY = topDown ? j : h - 1 - j;
    for (let i = 0; i < w; i++) {
      const o = off + rowY * row + i * 3;
      y[j * w + i] = (buf[o] + buf[o + 1] + buf[o + 2]) / 3;
    }
  }
  return { w, h, y };
}

// Sobel-ish gradient magnitude. Correlating on edges instead of raw luma keeps
// the match honest across Google's vector rendering (Off) and its raster tiles
// (On), which share geometry but not exact colours or label glyphs.
function edges(img) {
  const { w, h, y } = img;
  const g = new Float32Array(w * h);
  for (let j = 1; j < h - 1; j++) {
    for (let i = 1; i < w - 1; i++) {
      const gx = y[j * w + i + 1] - y[j * w + i - 1];
      const gy = y[(j + 1) * w + i] - y[(j - 1) * w + i];
      g[j * w + i] = Math.hypot(gx, gy);
    }
  }
  return { w, h, y: g };
}

function zeroMeanUnit(vals) {
  const n = vals.length || 1;
  let mean = 0;
  for (const v of vals) mean += v;
  mean /= n;
  let ss = 0;
  for (let i = 0; i < vals.length; i++) {
    vals[i] -= mean;
    ss += vals[i] * vals[i];
  }
  const norm = Math.sqrt(ss) || 1;
  for (let i = 0; i < vals.length; i++) vals[i] /= norm;
  return vals;
}

// Best (dx, dy) that maps `a` onto `b`: b[p] ≈ a[p - (dx,dy)].
// Positive dx means the content in b sits further right than in a.
function bestTranslation(aImg, bImg, opts = {}) {
  const range = opts.range ?? 260;
  const rangeY = opts.rangeY ?? 140;
  const a = edges(aImg);
  const b = edges(bImg);
  const win = opts.window ?? {
    x: Math.round(aImg.w * 0.5) - 150,
    y: Math.round(aImg.h * 0.5) - 110,
    w: 300,
    h: 220
  };
  // Reference patch from a, taken well inside so shifts stay in bounds.
  const patch = [];
  for (let j = win.y; j < win.y + win.h; j++) {
    for (let i = win.x; i < win.x + win.w; i++) patch.push(a.y[j * a.w + i]);
  }
  // A flat patch (blank crop, off-canvas region) correlates with anything, so
  // refuse to report a meaningless dx/dy. Loop rather than spread: the patch is
  // ~10^5 elements and Math.max(...patch) overflows the call stack.
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of patch) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const spread = hi - lo;
  if (!(spread > 8)) {
    throw new Error(`reference patch is featureless (spread ${spread.toFixed(1)}) — bad crop region`);
  }
  const ref = zeroMeanUnit(Float32Array.from(patch));

  let best = { dx: 0, dy: 0, score: -Infinity };
  const scan = (dxs, dys) => {
    for (const dy of dys) {
      for (const dx of dxs) {
        const x0 = win.x + dx;
        const y0 = win.y + dy;
        if (x0 < 0 || y0 < 0 || x0 + win.w > b.w || y0 + win.h > b.h) continue;
        const cand = new Float32Array(ref.length);
        let k = 0;
        for (let j = 0; j < win.h; j++) {
          const rowBase = (y0 + j) * b.w + x0;
          for (let i = 0; i < win.w; i++) cand[k++] = b.y[rowBase + i];
        }
        zeroMeanUnit(cand);
        let score = 0;
        for (let i = 0; i < ref.length; i++) score += ref[i] * cand[i];
        if (score > best.score) best = { dx, dy, score };
      }
    }
  };

  const coarse = [];
  for (let d = -range; d <= range; d += 4) coarse.push(d);
  const coarseY = [];
  for (let d = -rangeY; d <= rangeY; d += 4) coarseY.push(d);
  scan(coarse, coarseY);

  const fineX = [];
  for (let d = best.dx - 5; d <= best.dx + 5; d++) fineX.push(d);
  const fineY = [];
  for (let d = best.dy - 5; d <= best.dy + 5; d++) fineY.push(d);
  scan(fineX, fineY);
  return best;
}

function alignPngs(aPng, bPng, opts) {
  const a = bmpLuma(pngToBmp(aPng));
  const b = bmpLuma(pngToBmp(bPng));
  return bestTranslation(a, b, opts);
}

module.exports = { bmpLuma, edges, bestTranslation, alignPngs };
