#!/usr/bin/env node
"use strict";

/**
 * Capture README 2×2 grid (plan A): half-size map crops, with / without extension.
 */
const { chromium } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
require("../aligner-lib.js");
const lib = globalThis.Gcj02Aligner;

const ROOT = path.join(__dirname, "..");
const EXT_PATH = ROOT;
const DOCS = path.join(ROOT, "docs");
const VIEWPORT = { width: 1280, height: 800 };
const CROP_W = 426;
const CROP_H = 352;

function projectedPinTip(url, canvasBox) {
  const st = lib.parseMapHref(url);
  const place = lib.parsePlaceCoords(url);
  if (!st || !place || !canvasBox) return null;
  const px = lib.gcjLatLonToScreenPx(
    place.lat,
    place.lon,
    st.lat,
    st.lon,
    st.zoom,
    canvasBox.width,
    canvasBox.height
  );
  return {
    x: canvasBox.left + px.x,
    y: canvasBox.top + px.y,
    source: "projected"
  };
}

async function findRedPinOnMapCanvas(page, hint) {
  return page.evaluate(({ hx, hy }) => {
    const isPinRed = (r, g, b, a) =>
      a > 180 && r > 170 && g < 130 && b < 130 && r > g + 35 && r > b + 35;
    const candidates = [];
    for (const canvas of document.querySelectorAll("canvas")) {
      const cr = canvas.getBoundingClientRect();
      if (cr.width < 200 || cr.height < 200) continue;
      const tmp = document.createElement("canvas");
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const ctx = tmp.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(canvas, 0, 0);
      const data = ctx.getImageData(0, 0, tmp.width, tmp.height).data;
      const sx = canvas.width / cr.width;
      const sy = canvas.height / cr.height;
      const x0 = Math.floor(tmp.width * 0.32);
      for (let y = 48; y < tmp.height - 80; y += 2) {
        for (let x = x0; x < tmp.width - 14; x += 2) {
          let score = 0;
          for (let dy = 0; dy < 14; dy++) {
            for (let dx = 0; dx < 14; dx++) {
              const i = ((y + dy) * tmp.width + (x + dx)) * 4;
              if (isPinRed(data[i], data[i + 1], data[i + 2], data[i + 3])) score++;
            }
          }
          if (score < 12) continue;
          const tipX = cr.left + (x + 7) / sx;
          const tipY = cr.top + (y + 12) / sy;
          if (hx != null && Math.hypot(tipX - hx, tipY - hy) > 180) continue;
          candidates.push({ score, tipX, tipY });
        }
      }
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score || (
      (hx == null ? 0 : Math.hypot(a.tipX - hx, a.tipY - hy))
      - (hx == null ? 0 : Math.hypot(b.tipX - hx, b.tipY - hy))
    ));
    const best = candidates[0];
    return { x: best.tipX, y: best.tipY, source: "canvas-red" };
  }, { hx: hint?.x ?? null, hy: hint?.y ?? null });
}

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

async function findPinTip(page, url) {
  const fromDom = await page.evaluate(() => {
    const poi = document.querySelector("#gcj02-aligner-root .gcj02-poi.is-place-pin")
      || document.querySelector("#gcj02-aligner-root .gcj02-poi");
    if (poi) {
      const r = poi.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.bottom - 1, source: "overlay" };
    }
    return null;
  });
  if (fromDom) return fromDom;

  const canvasBox = await page.evaluate(() => {
    const canvas = [...document.querySelectorAll("canvas")]
      .filter((c) => c.getBoundingClientRect().width > 400)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const hint = projectedPinTip(url, canvasBox);

  const fromCanvas = await findRedPinOnMapCanvas(page, hint);
  if (fromCanvas) return fromCanvas;
  if (hint) return hint;
  return null;
}

function clipAroundPin(pin, vp) {
  const sidebar = Math.round(Math.min(420, vp.width * 0.34));
  const marginTop = 48;
  const marginBottom = 48;
  let x = Math.round(pin.x - CROP_W / 2);
  let y = Math.round(pin.y - CROP_H / 2);
  x = Math.max(sidebar, Math.min(x, vp.width - CROP_W - 4));
  y = Math.max(marginTop, Math.min(y, vp.height - CROP_H - marginBottom));
  return { x, y, width: CROP_W, height: CROP_H };
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
  } else {
    await page.waitForTimeout(2000);
  }
  await page.addStyleTag({
    content: "#gcj02-aligner-status{opacity:0.85!important}.dismissible-content,.Q6EWfb{display:none!important}"
  }).catch(() => {});
  const pin = await findPinTip(page, shot.url);
  if (!pin) throw new Error(`pin not found: ${shot.label}`);
  const clip = clipAroundPin(pin, page.viewportSize());
  await page.screenshot({ path: outPath, clip });
  console.log(`${shot.label} → ${outPath} (${clip.width}x${clip.height}) pin@(${Math.round(pin.x)},${Math.round(pin.y)}) ${pin.source || ""}`);
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
