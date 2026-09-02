#!/usr/bin/env node
"use strict";

/**
 * Capture README before/after screenshots of 太和殿 satellite alignment.
 * Before: vanilla Chrome. After: extension loaded.
 */
const { chromium } = require("@playwright/test");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const EXT_PATH = ROOT;
const OUT_BEFORE = path.join(ROOT, "docs", "before-align.png");
const OUT_AFTER = path.join(ROOT, "docs", "after-align.png");
const URL =
  "https://www.google.com/maps/place/%E5%A4%AA%E5%92%8C%E6%AE%BF/@39.917273,116.3970962,1179m/data=!3m2!1e3!4b1!4m6!3m5!1s0x35f052c28a42d347:0x4d686c72723159fa!8m2!3d39.917273!4d116.3970962!16zL20vMDQ4N3dn";
const VIEWPORT = { width: 1280, height: 800 };

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

async function waitForOverlay(page) {
  await page.waitForFunction(() => {
    const root = document.getElementById("gcj02-aligner-root");
    if (!root || root.style.display === "none") return false;
    const tiles = [...root.querySelectorAll(".gcj02-tile")];
    return tiles.length > 0 && tiles.some((img) => img.complete && img.naturalWidth >= 256);
  }, { timeout: 120000 });
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
  // Place pages keep a ~400px sidebar; crop the satellite pane only.
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

async function capture(outPath, withExtension) {
  const userDataDir = path.join(ROOT, "test-results", `.readme-shot-${withExtension ? "on" : "off"}-${Date.now()}`);
  const args = ["--disable-blink-features=AutomationControlled"];
  if (withExtension) {
    args.push(`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`);
  }
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: VIEWPORT,
    args
  });
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    if (!page.url().includes("/maps")) {
      await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120000 });
      await dismissConsent(page);
    }
    await waitForMapCanvas(page);
    if (withExtension) {
      await waitForOverlay(page);
      await page.addStyleTag({
        content: "#gcj02-aligner-status{opacity:0.85 !important}"
      }).catch(() => {});
    } else {
      await page.waitForTimeout(2000);
    }
    const clip = await mapCropClip(page);
    if (!clip) throw new Error("map canvas not found for crop");
    await page.screenshot({ path: outPath, clip });
    console.log(`${withExtension ? "After" : "Before"} → ${outPath} (${clip.width}x${clip.height})`);
  } finally {
    await context.close();
  }
}

(async () => {
  fs.mkdirSync(path.dirname(OUT_BEFORE), { recursive: true });
  await capture(OUT_BEFORE, false);
  await capture(OUT_AFTER, true);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
