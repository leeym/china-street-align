#!/usr/bin/env node
"use strict";

/**
 * Compare terrain shade opacities against Seattle native terrain darkening.
 * Run: node scripts/tune-terrain-shade.js
 */
const path = require("path");
const fs = require("fs");
const {
  launchExtensionContext,
  dismissConsent,
  waitForOverlay,
  withOverlayDecorHidden,
  MAP_CROP
} = require("../tests/helpers/maps-e2e");
const { pngRegionStats, pngRegionColorStats } = require("../tests/helpers/bmp-luma");
const { WUZHANGYUAN } = require("../tests/fixtures/overlay-landmarks");

const OUT = path.join(__dirname, "..", "test-results", "terrain-shade-tune");
const SEATTLE_TERRAIN =
  "https://www.google.com/maps/@47.6987105,-122.1693717,16z/data=!5m1!1e4";
const SEATTLE_MAP = "https://www.google.com/maps/@47.6987105,-122.1693717,16z";
const OPACITIES = [0.28, 0.36, 0.42, 0.48, 0.55, 0.62, 0.7];

function meanLuma(stats) {
  return stats.mean;
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await withOverlayDecorHidden(page, async () => {
    await page.screenshot({ path: file, fullPage: false });
  });
  return file;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const context = await launchExtensionContext();
  const page = context.pages()[0] || (await context.newPage());
  if (!context.serviceWorkers()[0]) {
    await context.waitForEvent("serviceworker", { timeout: 20000 }).catch(() => {});
  }

  // Outside China: native map vs terrain — target relative darkening.
  await page.goto(SEATTLE_MAP, { waitUntil: "domcontentloaded", timeout: 120000 });
  await dismissConsent(page);
  await page.waitForTimeout(2500);
  const seattleMapPng = await shot(page, "seattle-map");
  await page.goto(SEATTLE_TERRAIN, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2500);
  const seattleTerrainPng = await shot(page, "seattle-terrain");
  const seattleMap = pngRegionStats(seattleMapPng, MAP_CROP);
  const seattleTerrain = pngRegionStats(seattleTerrainPng, MAP_CROP);
  const seattleDrop = meanLuma(seattleMap) - meanLuma(seattleTerrain);
  const seattleDropPct = seattleDrop / Math.max(1, meanLuma(seattleMap));
  console.log(
    "Seattle reference:",
    JSON.stringify({
      mapLuma: +meanLuma(seattleMap).toFixed(1),
      terrainLuma: +meanLuma(seattleTerrain).toFixed(1),
      drop: +seattleDrop.toFixed(1),
      dropPct: +seattleDropPct.toFixed(4),
      terrainVar: +seattleTerrain.variance.toFixed(1)
    })
  );

  await page.goto(WUZHANGYUAN.terrainHref, { waitUntil: "domcontentloaded", timeout: 120000 });
  await dismissConsent(page);
  await waitForOverlay(page);
  await page.waitForTimeout(1500);

  // Baseline: no shade.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll(".gcj02-shade")) el.style.opacity = "0";
  });
  await page.waitForTimeout(200);
  const basePng = await shot(page, "china-opacity-0");
  const base = pngRegionStats(basePng, MAP_CROP);
  const baseLuma = meanLuma(base);
  console.log("China street-only luma:", baseLuma.toFixed(1));

  const rows = [];
  for (const op of OPACITIES) {
    await page.evaluate((opacity) => {
      for (const el of document.querySelectorAll(".gcj02-shade")) {
        el.style.setProperty("opacity", String(opacity), "important");
      }
    }, op);
    await page.waitForTimeout(250);
    const tag = String(op).replace(".", "p");
    const png = await shot(page, `china-opacity-${tag}`);
    const st = pngRegionStats(png, MAP_CROP);
    const color = pngRegionColorStats(png, MAP_CROP);
    const luma = meanLuma(st);
    const drop = baseLuma - luma;
    const dropPct = drop / Math.max(1, baseLuma);
    const dropErr = Math.abs(dropPct - seattleDropPct);
    const varErr = Math.abs(st.variance - seattleTerrain.variance) / Math.max(1, seattleTerrain.variance);
    // Prefer matching Seattle's relative darkening; light penalty if crushed (<130)
    // or nearly invisible drop (< 40% of Seattle drop).
    const crushPenalty = luma < 130 ? (130 - luma) / 50 : 0;
    const weakPenalty = dropPct < seattleDropPct * 0.4 ? 0.5 : 0;
    const score = dropErr + 0.15 * varErr + crushPenalty + weakPenalty;
    rows.push({
      opacity: op,
      luma: +luma.toFixed(1),
      drop: +drop.toFixed(1),
      dropPct: +dropPct.toFixed(4),
      dropErr: +dropErr.toFixed(4),
      variance: +st.variance.toFixed(1),
      meanSat: +color.meanSat.toFixed(1),
      score: +score.toFixed(4)
    });
    console.log(rows[rows.length - 1]);
  }

  rows.sort((a, b) => a.score - b.score);
  const best = rows[0];
  fs.writeFileSync(
    path.join(OUT, "summary.json"),
    JSON.stringify({ seattleDropPct, baseLuma, best, ranked: rows }, null, 2)
  );
  console.log("\nBEST opacity:", best.opacity, "score", best.score);
  await context.close();
  console.log(best.opacity);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
