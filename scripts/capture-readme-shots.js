#!/usr/bin/env node
"use strict";

/**
 * Capture README 2×2 grid (plan A): half-size map crops, with / without extension.
 */
const { chromium } = require("@playwright/test");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const EXT_PATH = ROOT;
const DOCS = path.join(ROOT, "docs");
const VIEWPORT = { width: 1280, height: 800 };
const CROP_SCALE = 0.5;

const TAIHEDIAN_SAT =
  "https://www.google.com/maps/place/%E5%A4%AA%E5%92%8C%E6%AE%BF/@39.917273,116.3970962,1179m/data=!3m2!1e3!4b1!4m6!3m5!1s0x35f052c28a42d347:0x4d686c72723159fa!8m2!3d39.917273!4d116.3970962!16zL20vMDQ4N3dn";
const WGS_MAP =
  "https://www.google.com/maps/place/39%C2%B054'57.0%22N+116%C2%B023'26.0%22E/@39.9158333,116.3905556,17z/data=!4m4!3m3!8m2!3d39.9158333!4d116.3905556";

const SHOTS = [
  { label: "without · 太和殿 · satellite", out: "taihedian-sat-without.png", url: TAIHEDIAN_SAT, kind: "native", extension: false },
  { label: "without · WGS · map", out: "wgs-map-without.png", url: WGS_MAP, kind: "native", extension: false },
  { label: "with · 太和殿 · satellite", out: "taihedian-sat-with.png", url: TAIHEDIAN_SAT, kind: "satellite", extension: true },
  { label: "with · WGS · map", out: "wgs-map-with.png", url: WGS_MAP, kind: "wgs-map", extension: true }
];

async function dismissConsent(page) {
  for (const sel of [
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Agree")',
    'button:has-text("Accept")',
    'button:has-text("同意")',
    'button:has-text("接受全部")'
  ]) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 2500 }).catch(() => false)) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      break;
    }
  }
}

async function waitForMapCanvas(page) {
  await page.waitForFunction(() => {
    const canvas = [...document.querySelectorAll("canvas")]
      .filter((c) => c.getBoundingClientRect().width > 400)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return !!canvas && canvas.getBoundingClientRect().width > 500;
  }, { timeout: 120000 });
  await page.waitForTimeout(3000);
}

async function waitForExtensionReady(page, kind) {
  if (kind === "satellite") {
    await page.waitForFunction(() => {
      const root = document.getElementById("gcj02-aligner-root");
      if (!root || root.style.display === "none") return false;
      const tiles = [...root.querySelectorAll(".gcj02-tile")];
      return tiles.some((img) => img.complete && img.naturalWidth >= 256)
        && (root.dataset.layer || "") === "satellite";
    }, { timeout: 120000 });
  } else if (kind === "wgs-map") {
    await page.waitForFunction(() => {
      const root = document.getElementById("gcj02-aligner-root");
      const poi = root?.querySelector(".gcj02-poi.is-place-pin");
      return !!(root && root.style.display !== "none" && poi
        && (root.dataset.layer || "") === "map"
        && Number(root.dataset.poiCount || 0) === 1);
    }, { timeout: 120000 });
  }
  await page.waitForTimeout(2500);
}

async function mapCropClip(page) {
  const vp = page.viewportSize();
  const fromCanvas = await page.evaluate(() => {
    const canvas = [...document.querySelectorAll("canvas")]
      .filter((c) => c.getBoundingClientRect().width > 400)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  if (!fromCanvas) return null;
  const sidebar = Math.round(Math.min(420, vp.width * 0.34));
  const x = Math.round(Math.max(fromCanvas.x, sidebar));
  const y = Math.round(fromCanvas.y + 8);
  const width = Math.round(Math.min(fromCanvas.width, vp.width - x - 8));
  const height = Math.round(fromCanvas.height - 96);
  const full = {
    x,
    y,
    width: Math.max(640, width),
    height: Math.max(360, height)
  };
  const w = Math.round(full.width * CROP_SCALE);
  const h = Math.round(full.height * CROP_SCALE);
  return {
    x: Math.round(full.x + (full.width - w) / 2),
    y: Math.round(full.y + (full.height - h) / 2),
    width: w,
    height: h
  };
}

async function launchContext(withExtension) {
  const args = ["--disable-blink-features=AutomationControlled"];
  if (withExtension) {
    args.push(`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`);
  }
  const userDataDir = path.join(
    ROOT,
    "test-results",
    `.readme-${withExtension ? "on" : "off"}-${Date.now()}`
  );
  return chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: VIEWPORT,
    args
  });
}

async function captureShot(page, shot) {
  const outPath = path.join(DOCS, shot.out);
  await page.goto(shot.url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await dismissConsent(page);
  if (!page.url().includes("/maps")) {
    await page.goto(shot.url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
  }
  await waitForMapCanvas(page);
  if (shot.extension) {
    await waitForExtensionReady(page, shot.kind);
    await page.addStyleTag({
      content: "#gcj02-aligner-status{opacity:0.85 !important}"
    }).catch(() => {});
  } else {
    await page.waitForTimeout(2000);
  }
  const clip = await mapCropClip(page);
  if (!clip) throw new Error(`map canvas not found: ${shot.label}`);
  await page.screenshot({ path: outPath, clip });
  console.log(`${shot.label} → ${outPath} (${clip.width}x${clip.height})`);
}

(async () => {
  fs.mkdirSync(DOCS, { recursive: true });
  let context = await launchContext(false);
  try {
    const page = context.pages()[0] || await context.newPage();
    for (const shot of SHOTS.filter((s) => !s.extension)) await captureShot(page, shot);
  } finally {
    await context.close();
  }
  context = await launchContext(true);
  try {
    const page = context.pages()[0] || await context.newPage();
    if (!context.serviceWorkers()[0]) {
      await context.waitForEvent("serviceworker", { timeout: 20000 }).catch(() => {});
    }
    for (const shot of SHOTS.filter((s) => s.extension)) await captureShot(page, shot);
  } finally {
    await context.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
