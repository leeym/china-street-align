#!/usr/bin/env node
"use strict";

/**
 * Capture README screenshots with the extension loaded:
 * 1. 太和殿 · satellite (named GCJ place on WGS photo — aligned)
 * 2. WGS DMS lat/lon · map (WGS query on GCJ street map — aligned pin)
 */
const { chromium } = require("@playwright/test");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const EXT_PATH = ROOT;
const DOCS = path.join(ROOT, "docs");
const VIEWPORT = { width: 1280, height: 800 };

const SHOTS = [
  {
    label: "太和殿 · satellite",
    out: path.join(DOCS, "aligned-taihedian-satellite.png"),
    url:
      "https://www.google.com/maps/place/%E5%A4%AA%E5%92%8C%E6%AE%BF/@39.917273,116.3970962,1179m/data=!3m2!1e3!4b1!4m6!3m5!1s0x35f052c28a42d347:0x4d686c72723159fa!8m2!3d39.917273!4d116.3970962!16zL20vMDQ4N3dn",
    kind: "satellite"
  },
  {
    label: "WGS lat/lon · map",
    out: path.join(DOCS, "aligned-wgs-map.png"),
    url:
      "https://www.google.com/maps/place/39%C2%B054'57.0%22N+116%C2%B023'26.0%22E/@39.9158333,116.3905556,17z/data=!4m4!3m3!8m2!3d39.9158333!4d116.3905556",
    kind: "wgs-map"
  }
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

async function waitForShotReady(page, kind) {
  if (kind === "satellite") {
    await page.waitForFunction(() => {
      const root = document.getElementById("gcj02-aligner-root");
      if (!root || root.style.display === "none") return false;
      const tiles = [...root.querySelectorAll(".gcj02-tile")];
      return tiles.some((img) => img.complete && img.naturalWidth >= 256)
        && (root.dataset.layer || "") === "satellite";
    }, { timeout: 120000 });
  } else {
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
  return {
    x,
    y,
    width: Math.max(640, width),
    height: Math.max(360, height)
  };
}

async function captureShot(page, shot) {
  await page.goto(shot.url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await dismissConsent(page);
  if (!page.url().includes("/maps")) {
    await page.goto(shot.url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
  }
  await waitForMapCanvas(page);
  await waitForShotReady(page, shot.kind);
  await page.addStyleTag({
    content: "#gcj02-aligner-status{opacity:0.85 !important}"
  }).catch(() => {});
  const clip = await mapCropClip(page);
  if (!clip) throw new Error(`map canvas not found: ${shot.label}`);
  await page.screenshot({ path: shot.out, clip });
  console.log(`${shot.label} → ${shot.out} (${clip.width}x${clip.height})`);
}

(async () => {
  fs.mkdirSync(DOCS, { recursive: true });
  const userDataDir = path.join(ROOT, "test-results", `.readme-shot-${Date.now()}`);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: VIEWPORT,
    args: [
      "--disable-blink-features=AutomationControlled",
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`
    ]
  });
  try {
    const page = context.pages()[0] || await context.newPage();
    if (!context.serviceWorkers()[0]) {
      await context.waitForEvent("serviceworker", { timeout: 20000 }).catch(() => {});
    }
    for (const shot of SHOTS) await captureShot(page, shot);
  } finally {
    await context.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
