"use strict";

/**
 * Measure Google Maps hybrid offset from a single screenshot.
 *
 * Two complementary scorers:
 *   1) Darkness — overlay ink prefers darker sat corridors (strong on dense
 *      mainland cities; coastal water can fool it).
 *   2) Edge NCC — overlay mask vs water-masked sat (strong when already
 *      aligned; weak / locks to 0 when GCJ-offset, so only used to *confirm*
 *      alignment on sparse/coastal scenes).
 *
 * Off — expectGoogleOffset selects which verdict must hold.
 * On  — DOM for mainland shift; outside China, overlay idle + aligned screen.
 */
const fs = require("fs");
const path = require("path");
require("../../aligner-lib.js");
const lib = globalThis.Gcj02Aligner;
const { pngToBmp } = require("./bmp-luma");
const { bestTranslation } = require("./img-align");

function satUrl(lat, lon, meters) {
  return `https://www.google.com/maps/@${lat},${lon},${meters}m/data=!3m1!1e3?hl=en`;
}

function cameraMeta(lat, lon, meters) {
  const zoom = lib.metersToZoom(lat, meters);
  const z = Math.min(21, Math.max(1, Math.round(zoom)));
  return {
    z,
    expectedShift: lib.overlayShiftPx(lat, lon, z),
    outOfChina: lib.outOfChina(lat, lon)
  };
}

function mapCropBox(viewport) {
  const w = viewport?.width || 1280;
  const h = viewport?.height || 900;
  return {
    x: Math.round(w * 0.28),
    y: Math.round(h * 0.12),
    width: Math.round(w * 0.55),
    height: Math.round(h * 0.70)
  };
}

function readBmpRgb(bmpPath) {
  const buf = fs.readFileSync(bmpPath);
  const w = Math.abs(buf.readInt32LE(18));
  const rawH = buf.readInt32LE(22);
  const topDown = rawH < 0;
  const h = Math.abs(rawH);
  const off = buf.readUInt32LE(10);
  const row = Math.floor((w * 3 + 3) / 4) * 4;
  const rgb = Buffer.alloc(w * h * 3);
  for (let j = 0; j < h; j++) {
    const rowY = topDown ? j : h - 1 - j;
    for (let i = 0; i < w; i++) {
      const o = off + rowY * row + i * 3;
      const d = (j * w + i) * 3;
      rgb[d] = buf[o + 2];
      rgb[d + 1] = buf[o + 1];
      rgb[d + 2] = buf[o];
    }
  }
  return { w, h, rgb };
}

/** Google hybrid road ink: amber highways + near-white casings. */
function isRoadOverlay(r, g, b) {
  if (r > 180 && g > 140 && b < 120 && (r - b) > 60 && (g - b) > 40) return true;
  if (r > 210 && g > 210 && b > 200 && Math.max(r, g, b) - Math.min(r, g, b) < 25) {
    return true;
  }
  return false;
}

function sampleOverlayPoints(overlay, w, h) {
  const pts = [];
  for (let j = 40; j < h - 40; j += 2) {
    for (let i = 40; i < w - 40; i += 2) {
      if (overlay[j * w + i]) pts.push([i, j]);
    }
  }
  const step = Math.max(1, Math.floor(pts.length / 600));
  const sample = [];
  for (let k = 0; k < pts.length; k += step) sample.push(pts[k]);
  return sample;
}

function measureDarknessOffset(rgb, w, h, overlay, luma, sample, range) {
  function scoreAt(dx, dy) {
    let s = 0;
    let n = 0;
    for (const [x, y] of sample) {
      const x2 = x + dx;
      const y2 = y + dy;
      if (x2 < 1 || y2 < 1 || x2 >= w - 1 || y2 >= h - 1) continue;
      const i2 = y2 * w + x2;
      if (overlay[i2]) continue;
      s += 180 - luma[i2];
      n++;
    }
    return n > 40 ? s / n : -Infinity;
  }

  let best = { dx: 0, dy: 0, score: -Infinity };
  for (let dy = -range; dy <= range; dy += 4) {
    for (let dx = -range; dx <= range; dx += 4) {
      const sc = scoreAt(dx, dy);
      if (sc > best.score) best = { dx, dy, score: sc };
    }
  }
  for (let dy = best.dy - 4; dy <= best.dy + 4; dy++) {
    for (let dx = best.dx - 4; dx <= best.dx + 4; dx++) {
      const sc = scoreAt(dx, dy);
      if (sc > best.score) best = { dx, dy, score: sc };
    }
  }
  let near0 = -Infinity;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      near0 = Math.max(near0, scoreAt(dx, dy));
    }
  }
  const hypot = Math.hypot(best.dx, best.dy);
  return {
    dx: best.dx,
    dy: best.dy,
    hypot,
    score: best.score,
    near0,
    prefer0: near0 >= best.score - 1.5
  };
}

function measureEdgeOffset(rgb, w, h, overlay, luma) {
  const overlayImg = { w, h, y: new Float32Array(w * h) };
  const sat = { w, h, y: new Float32Array(w * h) };
  let nOverlay = 0;
  for (let i = 0; i < w * h; i++) {
    const L = luma[i];
    sat.y[i] = L < 40 ? 0 : L;
    if (overlay[i]) {
      overlayImg.y[i] = 255;
      nOverlay++;
    }
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const idx = j * w + i;
      if (!overlay[idx]) continue;
      let sum = 0;
      let n = 0;
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = i + dx;
          const y = j + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const k = y * w + x;
          if (overlay[k] || sat.y[k] === 0) continue;
          sum += sat.y[k];
          n++;
        }
      }
      if (n) sat.y[idx] = sum / n;
    }
  }
  if (nOverlay < 80) {
    return { ok: false, reason: "few-overlay", nOverlay };
  }
  const win = {
    x: Math.round(w * 0.5) - 130,
    y: Math.round(h * 0.5) - 110,
    w: 260,
    h: 220
  };
  try {
    const m = bestTranslation(overlayImg, sat, { range: 180, rangeY: 180, window: win });
    return {
      ok: true,
      dx: m.dx,
      dy: m.dy,
      hypot: Math.hypot(m.dx, m.dy),
      score: m.score,
      nOverlay
    };
  } catch (err) {
    return { ok: false, reason: err.message, nOverlay };
  }
}

/**
 * Combined Off/On screen verdict.
 * aligned — Google hybrid looks registered (no GCJ street/sat mismatch).
 * offset  — clear street/sat mismatch (mainland Google hybrid).
 */
function measureOverlayOffsetFromBmp(bmpPath, opts = {}) {
  const range = opts.range ?? 160;
  const { w, h, rgb } = readBmpRgb(bmpPath);
  const overlay = new Uint8Array(w * h);
  const luma = new Float32Array(w * h);
  let nOverlay = 0;
  for (let i = 0; i < w * h; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    luma[i] = (r + g + b) / 3;
    if (isRoadOverlay(r, g, b)) {
      overlay[i] = 1;
      nOverlay++;
    }
  }
  const sample = sampleOverlayPoints(overlay, w, h);
  if (sample.length < 40) {
    throw new Error(
      `too few road-overlay samples (${sample.length}; pct=${((100 * nOverlay) / (w * h)).toFixed(2)})`
    );
  }
  const darkness = measureDarknessOffset(rgb, w, h, overlay, luma, sample, range);
  const edge = measureEdgeOffset(rgb, w, h, overlay, luma);
  const overlayPct = (100 * nOverlay) / (w * h);

  const darknessAligned = darkness.prefer0 && darkness.hypot < 25;
  const darknessOffset = !darkness.prefer0 && darkness.hypot > 80;
  const edgeAligned = edge.ok && edge.score >= 0.2 && edge.hypot < 25;
  // Sparse coastal ink: darkness often chases water; edge score stays weak.
  const sparseInconclusive = overlayPct < 5.5 && !(edge.ok && edge.score >= 0.2);

  const aligned = darknessAligned || edgeAligned || sparseInconclusive;
  const offset = darknessOffset;

  return {
    dx: darkness.dx,
    dy: darkness.dy,
    hypot: darkness.hypot,
    prefer0: darkness.prefer0,
    score: darkness.score,
    near0: darkness.near0,
    overlayPct,
    samples: sample.length,
    darkness,
    edge,
    aligned,
    offset,
    sparseInconclusive
  };
}

async function screenshotMapCrop(page, filePath) {
  const box = mapCropBox(page.viewportSize());
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await page.screenshot({ path: filePath, clip: box });
  return box;
}

async function measureHybridScreenOffset(page, outPng) {
  await screenshotMapCrop(page, outPng);
  const bmp = pngToBmp(outPng);
  return { ...measureOverlayOffsetFromBmp(bmp), png: outPng, bmp };
}

async function readOverlayRoadShift(page) {
  return page.evaluate(() => {
    const root = document.getElementById("gcj02-aligner-root");
    if (!root || root.style.display === "none") {
      return { active: false, dx: 0, dy: 0, hypot: 0, satHypot: 0, tileCount: 0 };
    }
    function cssShift(el) {
      if (!el) return { dx: 0, dy: 0, hypot: 0 };
      const t = getComputedStyle(el).transform;
      const m = t.match(/matrix\(([^)]+)\)/);
      const p = m ? m[1].split(",").map((x) => Number(x.trim())) : [];
      const dx = p.length === 6 ? p[4] : 0;
      const dy = p.length === 6 ? p[5] : 0;
      return { dx, dy, hypot: Math.hypot(dx, dy) };
    }
    const road = root.querySelector(".gcj02-road");
    const sat = root.querySelector(".gcj02-tile:not(.gcj02-road)");
    const roadShift = cssShift(road);
    const satShift = cssShift(sat);
    return {
      active: true,
      dx: roadShift.dx,
      dy: roadShift.dy,
      hypot: roadShift.hypot,
      satHypot: satShift.hypot,
      tileCount: root.querySelectorAll(".gcj02-tile,.gcj02-road").length,
      offsetPx: Number(root.dataset.offsetPx || 0)
    };
  });
}

module.exports = {
  satUrl,
  cameraMeta,
  mapCropBox,
  screenshotMapCrop,
  measureOverlayOffsetFromBmp,
  measureHybridScreenOffset,
  readOverlayRoadShift,
  isRoadOverlay
};
