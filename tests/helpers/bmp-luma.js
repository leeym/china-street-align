const fs = require("fs");
const { execFileSync } = require("child_process");
const os = require("os");
const path = require("path");

// Google hybrid highways are gold/peach (R≈200 G≈160 B≈145), not saturated yellow.
function isHybridRoadPixel(r, g, b) {
  return r > 150 && g > 100 && r - b > 20 && g > b - 5 && b < 190 && !(r > 230 && g > 230 && b > 220);
}

let bmpSeq = 0;

function pngToBmp(pngPath) {
  // Counter as well as the clock: two conversions in the same millisecond
  // otherwise pick the same temp path.
  const bmpPath = path.join(os.tmpdir(), `gcj02-chrome-${Date.now()}-${bmpSeq++}.bmp`);
  execFileSync("sips", ["-s", "format", "bmp", pngPath, "--out", bmpPath], {
    stdio: "pipe"
  });
  return bmpPath;
}

function bmpLumaStats(bmpPath, crop) {
  const buf = fs.readFileSync(bmpPath);
  const w = Math.abs(buf.readInt32LE(18));
  const rawH = buf.readInt32LE(22);
  const topDown = rawH < 0;
  const h = Math.abs(rawH);
  const off = buf.readUInt32LE(10);
  const row = Math.floor((w * 3 + 3) / 4) * 4;
  const x0 = crop ? Math.max(0, crop.x) : 0;
  const y0 = crop ? Math.max(0, crop.y) : 0;
  const cw = crop ? (crop.w ?? crop.width) : w;
  const ch = crop ? (crop.h ?? crop.height) : h;
  const x1 = crop ? Math.min(w, x0 + cw) : w;
  const y1 = crop ? Math.min(h, y0 + ch) : h;
  const lumas = [];
  for (let y = y0; y < y1; y++) {
    const rowY = topDown ? y : h - 1 - y;
    for (let x = x0; x < x1; x++) {
      const o = off + rowY * row + x * 3;
      const b = buf[o];
      const g = buf[o + 1];
      const r = buf[o + 2];
      lumas.push((r + g + b) / 3);
    }
  }
  const n = lumas.length || 1;
  const mean = lumas.reduce((a, v) => a + v, 0) / n;
  const variance = lumas.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
  const darkShare = lumas.filter((v) => v < 50).length / n;
  const brightShare = lumas.filter((v) => v > 180).length / n;
  let yellow = 0;
  let hybrid = 0;
  for (let y = y0; y < y1; y++) {
    const rowY = topDown ? y : h - 1 - y;
    for (let x = x0; x < x1; x++) {
      const o = off + rowY * row + x * 3;
      const b = buf[o];
      const g = buf[o + 1];
      const r = buf[o + 2];
      if (r > 170 && g > 120 && b < 90) yellow += 1;
      if (isHybridRoadPixel(r, g, b)) hybrid += 1;
    }
  }
  return {
    width: x1 - x0,
    height: y1 - y0,
    mean,
    variance,
    darkShare,
    brightShare,
    yellowShare: yellow / n,
    hybridRoadShare: hybrid / n
  };
}

function pngRegionStats(pngPath, crop) {
  return bmpLumaStats(pngToBmp(pngPath), crop);
}

function isSaturatedMapRed(r, g, b) {
  // Classic Google pin red (~#EA4335) and nearby search-hit reds on the canvas.
  return r > 180 && g < 120 && b < 110 && r - g > 70 && r - b > 80;
}

function bmpRedPinStats(bmpPath, crop) {
  const buf = fs.readFileSync(bmpPath);
  const w = Math.abs(buf.readInt32LE(18));
  const rawH = buf.readInt32LE(22);
  const topDown = rawH < 0;
  const h = Math.abs(rawH);
  const off = buf.readUInt32LE(10);
  const row = Math.floor((w * 3 + 3) / 4) * 4;
  const x0 = crop ? Math.max(0, crop.x) : 0;
  const y0 = crop ? Math.max(0, crop.y) : 0;
  const cw = crop ? (crop.w ?? crop.width) : w;
  const ch = crop ? (crop.h ?? crop.height) : h;
  const x1 = crop ? Math.min(w, x0 + cw) : w;
  const y1 = crop ? Math.min(h, y0 + ch) : h;
  let red = 0;
  let n = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = y0; y < y1; y++) {
    const rowY = topDown ? y : h - 1 - y;
    for (let x = x0; x < x1; x++) {
      const o = off + rowY * row + x * 3;
      const b = buf[o];
      const g = buf[o + 1];
      const r = buf[o + 2];
      n += 1;
      if (!isSaturatedMapRed(r, g, b)) continue;
      red += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const bboxH = red ? maxY - minY + 1 : 0;
  const bboxW = red ? maxX - minX + 1 : 0;
  return {
    redCount: red,
    redShare: red / (n || 1),
    bboxW,
    bboxH,
    // Teardrop is taller than the idle circle (~26px); require a tall red cluster.
    tallPin: bboxH >= 32 && bboxH > bboxW * 1.15
  };
}

function pngRedPinStats(pngPath, crop) {
  return bmpRedPinStats(pngToBmp(pngPath), crop);
}

// Red pixels that appear (or grow) in `hover` relative to `idle` — isolates the
// teardrop that Maps paints on sidebar hover from the idle circular hits.
function pngNewRedPinStats(idlePng, hoverPng, crop) {
  const idleBmp = pngToBmp(idlePng);
  const hoverBmp = pngToBmp(hoverPng);
  const idle = fs.readFileSync(idleBmp);
  const hover = fs.readFileSync(hoverBmp);
  const w = Math.abs(hover.readInt32LE(18));
  const rawH = hover.readInt32LE(22);
  const topDown = rawH < 0;
  const h = Math.abs(rawH);
  const off = hover.readUInt32LE(10);
  const row = Math.floor((w * 3 + 3) / 4) * 4;
  const x0 = crop ? Math.max(0, crop.x) : 0;
  const y0 = crop ? Math.max(0, crop.y) : 0;
  const cw = crop ? (crop.w ?? crop.width) : w;
  const ch = crop ? (crop.h ?? crop.height) : h;
  const x1 = crop ? Math.min(w, x0 + cw) : w;
  const y1 = crop ? Math.min(h, y0 + ch) : h;
  let red = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = y0; y < y1; y++) {
    const rowY = topDown ? y : h - 1 - y;
    for (let x = x0; x < x1; x++) {
      const o = off + rowY * row + x * 3;
      const hb = hover[o];
      const hg = hover[o + 1];
      const hr = hover[o + 2];
      if (!isSaturatedMapRed(hr, hg, hb)) continue;
      const ib = idle[o];
      const ig = idle[o + 1];
      const ir = idle[o + 2];
      if (isSaturatedMapRed(ir, ig, ib)) continue;
      red += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const bboxH = red ? maxY - minY + 1 : 0;
  const bboxW = red ? maxX - minX + 1 : 0;
  return {
    redCount: red,
    bboxW,
    bboxH,
    // Idle hits are ~26px circles; the classic hover teardrop is taller.
    tallPin: red >= 80 && bboxH >= 28
  };
}

function chromeClusterVisible(stats) {
  return stats.darkShare > 0.05 && stats.brightShare > 0.004;
}

function bmpColorStats(bmpPath, crop) {
  const buf = fs.readFileSync(bmpPath);
  const w = Math.abs(buf.readInt32LE(18));
  const rawH = buf.readInt32LE(22);
  const topDown = rawH < 0;
  const h = Math.abs(rawH);
  const off = buf.readUInt32LE(10);
  const row = Math.floor((w * 3 + 3) / 4) * 4;
  const x0 = crop ? Math.max(0, crop.x) : 0;
  const y0 = crop ? Math.max(0, crop.y) : 0;
  const cw = crop ? (crop.w ?? crop.width) : w;
  const ch = crop ? (crop.h ?? crop.height) : h;
  const x1 = crop ? Math.min(w, x0 + cw) : w;
  const y1 = crop ? Math.min(h, y0 + ch) : h;
  let n = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumSat = 0;
  let gray = 0;
  let greenish = 0;
  for (let y = y0; y < y1; y++) {
    const rowY = topDown ? y : h - 1 - y;
    for (let x = x0; x < x1; x++) {
      const o = off + rowY * row + x * 3;
      const b = buf[o];
      const g = buf[o + 1];
      const r = buf[o + 2];
      n += 1;
      sumR += r;
      sumG += g;
      sumB += b;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max - min;
      sumSat += sat;
      if (sat < 18) gray += 1;
      // Terrain flats should read green/olive, not neutral gray.
      if (g > r + 8 && g > b + 8 && sat >= 18) greenish += 1;
    }
  }
  const nn = n || 1;
  return {
    width: x1 - x0,
    height: y1 - y0,
    meanR: sumR / nn,
    meanG: sumG / nn,
    meanB: sumB / nn,
    meanSat: sumSat / nn,
    grayShare: gray / nn,
    greenishShare: greenish / nn,
    greenBias: (sumG - sumR) / nn
  };
}

function pngRegionColorStats(pngPath, crop) {
  return bmpColorStats(pngToBmp(pngPath), crop);
}

module.exports = {
  isHybridRoadPixel,
  isSaturatedMapRed,
  pngToBmp,
  bmpLumaStats,
  bmpRedPinStats,
  bmpColorStats,
  pngRegionStats,
  pngRegionColorStats,
  pngRedPinStats,
  pngNewRedPinStats,
  chromeClusterVisible
};
