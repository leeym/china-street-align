const { test, expect, chromium } = require("@playwright/test");
const path = require("path");
const { pngRegionStats, chromeClusterVisible } = require("./helpers/bmp-luma");
const { XIAMEN_XINGLIN } = require("./fixtures/overlay-landmarks");

// Read the shipped version rather than pinning it, so a version bump is not a
// test failure.
const { version: EXT_VERSION } = require("../manifest.json");

const EXT_PATH = path.resolve(__dirname, "..");
const SAT_URL = XIAMEN_XINGLIN.href;
const MAP_URL =
  "https://www.google.com/maps/@24.6013341,118.0704538,16.74z";

async function launchExtensionContext() {
  const userDataDir = path.join(__dirname, "..", "test-results", `.pw-user-${Date.now()}`);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      "--disable-blink-features=AutomationControlled"
    ]
  });
  return context;
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

async function waitForOverlay(page) {
  await page.waitForFunction(() => {
    const root = document.getElementById("gcj02-aligner-root");
    if (!root || root.style.display === "none") return false;
    const tiles = [...root.querySelectorAll(".gcj02-tile")];
    return tiles.length > 0 && tiles.some((img) => img.complete && img.naturalWidth >= 256);
  }, { timeout: 120000 });
}

async function overlayAlignmentStats(page) {
  return page.evaluate(() => {
    const root = document.getElementById("gcj02-aligner-root");
    const road = document.querySelector(".gcj02-road");
    const t = road ? getComputedStyle(road).transform : "";
    const m = t.match(/matrix\(([^)]+)\)/);
    const p = m ? m[1].split(",").map((x) => Number(x.trim())) : [];
    const roadShift = p.length === 6 ? Math.hypot(p[4], p[5]) : 0;
    const hidden = [...document.querySelectorAll("canvas.gcj02-hide-native")];
    const opacities = hidden.map((c) => getComputedStyle(c).opacity);
    return {
      href: location.href,
      mode: root?.dataset.mode || "",
      layer: root?.dataset.layer || "",
      display: root?.style.display || "",
      offsetPx: Number(root?.dataset.offsetPx || 0),
      status: document.getElementById("gcj02-aligner-status")?.textContent || "",
      tileCount: root ? root.querySelectorAll(".gcj02-tile").length : 0,
      roadCount: root ? root.querySelectorAll(".gcj02-road").length : 0,
      roadShift,
      nativeHidden: hidden.length,
      nativeOpacity: opacities[0] || "",
      nativeVisibility: hidden[0] ? getComputedStyle(hidden[0]).visibility : ""
    };
  });
}

function expectSatelliteAligned(stats) {
  expect(stats.mode, JSON.stringify(stats)).toBe("on");
  expect(stats.layer).toBe("satellite");
  expect(stats.display).not.toBe("none");
  expect(stats.offsetPx).toBeGreaterThan(20);
  expect(stats.roadShift).toBeGreaterThan(20);
  expect(stats.tileCount).toBeGreaterThan(4);
  expect(stats.nativeHidden).toBeGreaterThan(0);
  expect(stats.nativeOpacity, "native canvas must be CSS-hidden").toBe("0");
  expect(stats.nativeVisibility).toBe("hidden");
}

test.describe("GCJ-02 Google Maps extension", () => {
  /** @type {import('@playwright/test').BrowserContext} */
  let context;
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async () => {
    context = await launchExtensionContext();
    page = context.pages()[0] || await context.newPage();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("loads integer-zoom satellite tiles over Xiamen and aligns with roads", async () => {
    await page.goto(SAT_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await page.waitForTimeout(4000);
    if (!page.url().includes("/maps")) {
      await page.goto(SAT_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
      await dismissConsent(page);
    }

    await waitForOverlay(page);
    await page.waitForTimeout(2500);

    const stats = await page.evaluate(async () => {
      const root = document.getElementById("gcj02-aligner-root");
      const tiles = [...root.querySelectorAll(".gcj02-tile")];
      const roads = [...root.querySelectorAll(".gcj02-road")];
      await Promise.all(
        [...tiles, ...roads].map(
          (img) =>
            img.complete
              ? Promise.resolve()
              : new Promise((resolve) => {
                  img.addEventListener("load", resolve, { once: true });
                  img.addEventListener("error", resolve, { once: true });
                  setTimeout(resolve, 8000);
                })
        )
      );
      const badAlt = (img) => /error|400|invalid|tile error/i.test(img.alt || "");
      const loaded = tiles.filter((img) => img.naturalWidth >= 256);
      const failed = tiles.filter((img) => badAlt(img) || (img.complete && img.naturalWidth === 0));
      const roadLoaded = roads.filter((img) => img.naturalWidth >= 64);
      const t = tiles.find((img) => img.naturalWidth >= 256);
      const cs = t ? getComputedStyle(t) : null;
      const transform = cs ? cs.transform : "";
      const m = transform.match(/matrix\(([^)]+)\)/);
      const parts = m ? m[1].split(",").map((x) => Number(x.trim())) : [];
      const dx = parts.length === 6 ? parts[4] : 0;
      const dy = parts.length === 6 ? parts[5] : 0;
      return {
        mode: root.dataset.mode,
        zoom: root.dataset.zoom,
        zTile: root.dataset.zTile,
        offsetPx: Number(root.dataset.offsetPx),
        status: document.getElementById("gcj02-aligner-status")?.textContent || "",
        tileCount: tiles.length,
        loaded: loaded.length,
        failed: failed.length,
        failedAlts: [...new Set(failed.map((img) => img.alt))].slice(0, 5),
        roadLoaded: roadLoaded.length,
        sampleShift: Math.hypot(dx, dy),
        layer: root.dataset.layer,
        href: location.href
      };
    });

    expect(stats.mode, JSON.stringify(stats)).toBe("on");
    expect(stats.status).toContain(`v${EXT_VERSION}`);
    expect(Number(stats.zoom)).toBeGreaterThan(15.8);
    expect(Number(stats.zoom)).toBeLessThan(17.5);
    expect(stats.layer).toBe("satellite");
    expect(stats.failed, `tile errors: ${stats.failedAlts.join("; ")}`).toBe(0);
    expect(stats.loaded).toBeGreaterThan(4);
    expect(stats.roadLoaded).toBeGreaterThan(4);
    expect(Number(stats.zTile)).toBeGreaterThanOrEqual(12);
    expect(Number(stats.zTile)).toBeLessThanOrEqual(18);
    expect(String(stats.zTile)).not.toMatch(/\./);
    expect(stats.sampleShift).toBeLessThan(2);
    const { assertStreetsShiftedOntoSatellite } = require("./helpers/maps-e2e");
    await assertStreetsShiftedOntoSatellite(page);

    const satPng = path.join(__dirname, "..", "test-results", "xiamen-satellite-align.png");
    await page.screenshot({ path: satPng, fullPage: false });
    const mapStatsPx = pngRegionStats(satPng, { x: 430, y: 90, w: 880, h: 680 });
    expect(
      mapStatsPx.hybridRoadShare,
      `hybrid roads missing on satellite: ${JSON.stringify(mapStatsPx)}`
    ).toBeGreaterThan(0.015);

    const zoomIn = page.getByRole("button", { name: /zoom in/i }).first();
    const menu = page.getByRole("button", { name: /^menu$/i }).first();
    await expect(zoomIn).toBeVisible();
    await expect(menu).toBeVisible();
    const zoomPng = path.join(__dirname, "..", "test-results", "maps-zoom-control.png");
    const menuPng = path.join(__dirname, "..", "test-results", "maps-menu-control.png");
    await zoomIn.screenshot({ path: zoomPng });
    await menu.screenshot({ path: menuPng });
    const zoomBox = await zoomIn.boundingBox();
    expect(zoomBox).toBeTruthy();
    expect(zoomBox.width).toBeGreaterThan(16);
    expect(zoomBox.width).toBeLessThan(80);
    expect(zoomBox.height).toBeLessThan(80);
    expect(zoomBox.x).toBeGreaterThan(page.viewportSize().width * 0.7);

    const clipInfo = await page.evaluate(() => {
      const overlay = document.getElementById("gcj02-aligner-root");
      const host = overlay?.parentElement;
      return {
        parentTag: host?.tagName,
        clip: host ? getComputedStyle(host).clipPath : "",
        inline: host?.style.clipPath || "",
        hasLib: typeof globalThis.Gcj02Aligner?.chromeClipPath
      };
    });
    expect(clipInfo.inline || "", JSON.stringify(clipInfo)).not.toMatch(/polygon/i);
    expect(clipInfo.clip || "", JSON.stringify(clipInfo)).not.toMatch(/polygon/i);

    const fullPng = path.join(__dirname, "..", "test-results", "xiamen-satellite-align.png");
    const cluster = pngRegionStats(fullPng, { x: 1360, y: 660, w: 80, h: 240 });
    expect(
      chromeClusterVisible(cluster),
      `zoom cluster missing from full screenshot: ${JSON.stringify(cluster)}`
    ).toBe(true);
    // Former clip holes must show map tiles, not the page's white background.
    const brCorner = pngRegionStats(fullPng, { x: 1380, y: 820, w: 36, h: 36 });
    expect(brCorner.mean, `bottom-right under chrome: ${JSON.stringify(brCorner)}`).toBeLessThan(248);
    expect(brCorner.variance, JSON.stringify(brCorner)).toBeGreaterThan(20);

    const chromeOk = await page.evaluate(() => {
      const zoom = document.querySelector('[aria-label="Zoom in"]');
      const layers = document.querySelector('[aria-label="Layers"]')
        || document.querySelector('[aria-label="Interactive map"]');
      const menuBtn = document.querySelector('[aria-label="Menu"]');
      const overlay = document.getElementById("gcj02-aligner-root");
      const overlayZ = Number(getComputedStyle(overlay).zIndex);
      const overlayPos = getComputedStyle(overlay).position;
      const parentTag = overlay.parentElement?.tagName || "";
      function paintTop(el) {
        if (!el) return { topInOverlay: true };
        const r = el.getBoundingClientRect();
        const x = r.x + r.width / 2;
        const y = r.y + r.height / 2;
        const top = document.elementFromPoint(x, y);
        const stack = document.elementsFromPoint(x, y);
        return {
          topInOverlay: !!(top && (top.id === "gcj02-aligner-root" || top.closest?.("#gcj02-aligner-root"))),
          stack0InOverlay: !!(stack[0] && (stack[0].id === "gcj02-aligner-root" || stack[0].closest?.("#gcj02-aligner-root")))
        };
      }
      const hiddenIcons = [...document.querySelectorAll("img.gcj02-hide-native")].filter((img) =>
        /maps\.gstatic\.com\/mapfiles/i.test(img.currentSrc || img.src || "")
      ).length;
      const coverFn = (parent, pos, z) => {
        const p = String(parent || "").toUpperCase();
        const ps = String(pos || "").toLowerCase();
        return p === "HTML" || ps === "fixed" || Number(z) > 0;
      };
      return {
        overlayZ,
        overlayPos,
        parentTag,
        wouldCover: coverFn ? coverFn(parentTag, overlayPos, overlayZ) : parentTag === "HTML",
        zoomVisible: !!(zoom && zoom.getClientRects().length && getComputedStyle(zoom).visibility !== "hidden"),
        layersVisible: !!(layers && layers.getClientRects().length),
        menuVisible: !!(menuBtn && menuBtn.getClientRects().length),
        zoomPaint: paintTop(zoom),
        menuPaint: paintTop(menuBtn),
        hiddenGstaticIcons: hiddenIcons
      };
    });
    expect(chromeOk.parentTag, JSON.stringify(chromeOk)).not.toBe("HTML");
    expect(chromeOk.overlayPos).toBe("absolute");
    expect(chromeOk.overlayZ).toBe(0);
    expect(chromeOk.wouldCover, JSON.stringify(chromeOk)).toBe(false);
    expect(chromeOk.zoomVisible, JSON.stringify(chromeOk)).toBe(true);
    expect(chromeOk.layersVisible).toBe(true);
    expect(chromeOk.menuVisible).toBe(true);
    expect(chromeOk.hiddenGstaticIcons, "gstatic control sprites must not be hidden").toBe(0);
    expect(chromeOk.zoomPaint.topInOverlay, JSON.stringify(chromeOk.zoomPaint)).toBe(false);
    expect(chromeOk.menuPaint.topInOverlay, JSON.stringify(chromeOk.menuPaint)).toBe(false);

    await page.goto(MAP_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForOverlay(page);
    await page.waitForTimeout(2000);
    const mapStats = await page.evaluate(() => {
      const root = document.getElementById("gcj02-aligner-root");
      const tiles = [...root.querySelectorAll(".gcj02-tile")];
      return {
        mode: root.dataset.mode,
        layer: root.dataset.layer,
        zoom: Number(root.dataset.zoom),
        loaded: tiles.filter((img) => img.naturalWidth >= 256).length,
        nativeHidden: [...document.querySelectorAll("canvas")].some((c) => c.classList.contains("gcj02-hide-native"))
      };
    });
    expect(mapStats.mode, JSON.stringify(mapStats)).toBe("on");
    expect(mapStats.layer).toBe("map");
    expect(mapStats.zoom).toBeGreaterThan(15.8);
    expect(mapStats.zoom).toBeLessThan(17.5);
    expect(mapStats.loaded).toBeGreaterThan(4);
    expect(mapStats.nativeHidden).toBe(true);
    await assertStreetsShiftedOntoSatellite(page);

    await page.screenshot({
      path: path.join(__dirname, "..", "test-results", "xiamen-alignment.png"),
      fullPage: false
    });
  });

});
