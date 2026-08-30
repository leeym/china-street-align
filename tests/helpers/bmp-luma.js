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
  const x1 = crop ? Math.min(w, crop.x + crop.w) : w;
  const y1 = crop ? Math.min(h, crop.y + crop.h) : h;
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

function chromeClusterVisible(stats) {
  return stats.darkShare > 0.05 && stats.brightShare > 0.004;
}

module.exports = { isHybridRoadPixel, pngToBmp, bmpLumaStats, pngRegionStats, chromeClusterVisible };
