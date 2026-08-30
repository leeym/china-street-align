const { chromium } = require("@playwright/test");
const path = require("path");

const EXT_PATH = path.resolve(__dirname, "..", "..");

async function launchExtensionContext() {
  const userDataDir = path.join(EXT_PATH, "test-results", `.pw-user-${Date.now()}`);
  return chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      "--disable-blink-features=AutomationControlled"
    ]
  });
}

async function dismissConsent(page) {
  const candidates = [
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Agree")',
    'button:has-text("Accept")',
    'button:has-text("同意")',
    'button:has-text("接受全部")'
  ];
  for (const sel of candidates) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 2500 }).catch(() => false)) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      break;
    }
  }
}

async function setAlignerMode(context, page, mode) {
  let sw = context.serviceWorkers()[0];
  if (!sw) {
    sw = await context.waitForEvent("serviceworker", { timeout: 15000 }).catch(() => null);
  }
  if (sw) {
    await sw.evaluate((m) => chrome.storage.local.set({ mode: m }), mode);
  }
  await page.evaluate((m) => {
    window.postMessage({ source: "gcj02-aligner", type: "setMode", mode: m }, "*");
  }, mode).catch(() => {});
  await page.waitForTimeout(500);
}

async function waitForOverlay(page) {
  await page.waitForFunction(() => {
    const root = document.getElementById("gcj02-aligner-root");
    if (!root || root.style.display === "none") return false;
    const tiles = [...root.querySelectorAll(".gcj02-tile")];
    return tiles.length > 0 && tiles.some((img) => img.complete && img.naturalWidth >= 256);
  }, { timeout: 120000 });
}

async function waitForOverlayOff(page) {
  await page.waitForFunction(() => {
    const root = document.getElementById("gcj02-aligner-root");
    return !root || root.style.display === "none" || root.dataset.mode === "off";
  }, { timeout: 30000 });
}

async function waitForNativePois(page, needles) {
  const list = Array.isArray(needles) ? needles : [needles];
  await page.waitForFunction((texts) => {
    const links = [...document.querySelectorAll('a[href*="/maps/place/"]')];
    const blob = links
      .map((a) => a.getAttribute("aria-label") || a.textContent || "")
      .join("\n");
    const href = decodeURIComponent(location.href);
    const extra = document.body.innerText || "";
    return texts.some((t) => blob.includes(t) || extra.includes(t) || href.includes(t));
  }, list, { timeout: 90000 });
}

async function overlayAlignmentStats(page) {
  return page.evaluate(() => {
    const root = document.getElementById("gcj02-aligner-root");
    const road = document.querySelector(".gcj02-road") || document.querySelector(".gcj02-tile");
    const t = road ? getComputedStyle(road).transform : "";
    const m = t.match(/matrix\(([^)]+)\)/);
    const p = m ? m[1].split(",").map((x) => Number(x.trim())) : [];
    const roadShift = p.length === 6 ? Math.hypot(p[4], p[5]) : 0;
    const hidden = [...document.querySelectorAll("canvas.gcj02-hide-native")];
    const pois = [...document.querySelectorAll(".gcj02-poi")].map((el) => el.textContent || "");
    return {
      href: location.href,
      mode: root?.dataset.mode || "",
      layer: root?.dataset.layer || "",
      display: root?.style.display || "",
      offsetPx: Number(root?.dataset.offsetPx || 0),
      poiCount: Number(root?.dataset.poiCount || 0),
      overlayPoiLabels: pois,
      status: document.getElementById("gcj02-aligner-status")?.textContent || "",
      tileCount: root ? root.querySelectorAll(".gcj02-tile").length : 0,
      roadShift,
      nativeHidden: hidden.length,
      nativeOpacity: hidden[0] ? getComputedStyle(hidden[0]).opacity : "",
      nativeVisibility: hidden[0] ? getComputedStyle(hidden[0]).visibility : ""
    };
  });
}

async function overlayPoiScreen(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll(".gcj02-poi")].map((el) => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent || "", x: r.x + r.width / 2, y: r.y + r.height };
    });
  });
}

async function ensureStreetLayer(page) {
  const layer = () => page.evaluate(() => document.getElementById("gcj02-aligner-root")?.dataset.layer || "");
  if (await layer() === "map") return;
  const btn = page.locator('[aria-label="Layers"], [aria-label="Map type"]').first();
  if (await btn.isVisible({ timeout: 4000 }).catch(() => false)) {
    await btn.click();
    await page.getByText("Default", { exact: true }).click({ timeout: 4000 }).catch(() => {});
    await page.getByText(/^Map$/, { exact: true }).click({ timeout: 2000 }).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(1500);
  }
}

async function ensureSatelliteLayer(page) {
  const layer = () => page.evaluate(() => document.getElementById("gcj02-aligner-root")?.dataset.layer || "");
  if (await layer() === "satellite") return;
  const btn = page.locator('[aria-label="Layers"], [aria-label="Map type"]').first();
  if (await btn.isVisible({ timeout: 4000 }).catch(() => false)) {
    await btn.click();
    await page.getByText("Satellite", { exact: true }).click({ timeout: 4000 }).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(1500);
  }
}

module.exports = {
  EXT_PATH,
  launchExtensionContext,
  dismissConsent,
  setAlignerMode,
  waitForOverlay,
  waitForOverlayOff,
  waitForNativePois,
  overlayAlignmentStats,
  overlayPoiScreen,
  ensureStreetLayer,
  ensureSatelliteLayer
};
