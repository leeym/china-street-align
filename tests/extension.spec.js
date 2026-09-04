const { test, expect } = require("@playwright/test");
const path = require("path");
const { pngRegionStats, chromeClusterVisible } = require("./helpers/bmp-luma");
const { XIAMEN_XINGLIN } = require("./fixtures/overlay-landmarks");
const {
  launchExtensionContext,
  dismissConsent,
  waitForOverlay
} = require("./helpers/maps-e2e");

// Road/sat GCJ offset Off-vs-On coverage lives in google-hybrid-offset.spec.js.
// This file only keeps chrome / tile-load smoke that those cases do not assert.

const { version: EXT_VERSION } = require("../manifest.json");
const SAT_URL = XIAMEN_XINGLIN.href;

test.describe("GCJ-02 extension chrome smoke", () => {
  /** @type {import('@playwright/test').BrowserContext} */
  let context;
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async () => {
    context = await launchExtensionContext();
    page = context.pages()[0] || (await context.newPage());
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("integer-zoom tiles load and Maps chrome stays clickable", async () => {
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
      return {
        mode: root.dataset.mode,
        zoom: root.dataset.zoom,
        zTile: root.dataset.zTile,
        status: document.getElementById("gcj02-aligner-status")?.textContent || "",
        loaded: loaded.length,
        failed: failed.length,
        failedAlts: [...new Set(failed.map((img) => img.alt))].slice(0, 5),
        roadLoaded: roadLoaded.length,
        layer: root.dataset.layer
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

    const zoomIn = page.getByRole("button", { name: /zoom in/i }).first();
    const menu = page.getByRole("button", { name: /^menu$/i }).first();
    await expect(zoomIn).toBeVisible();
    await expect(menu).toBeVisible();
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
        inline: host?.style.clipPath || ""
      };
    });
    expect(clipInfo.inline || "", JSON.stringify(clipInfo)).not.toMatch(/polygon/i);
    expect(clipInfo.clip || "", JSON.stringify(clipInfo)).not.toMatch(/polygon/i);

    const fullPng = path.join(__dirname, "..", "test-results", "xiamen-chrome-smoke.png");
    await page.screenshot({ path: fullPng, fullPage: false });
    const cluster = pngRegionStats(fullPng, { x: 1360, y: 660, w: 80, h: 240 });
    expect(
      chromeClusterVisible(cluster),
      `zoom cluster missing from full screenshot: ${JSON.stringify(cluster)}`
    ).toBe(true);
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
        return {
          topInOverlay: !!(top && (top.id === "gcj02-aligner-root" || top.closest?.("#gcj02-aligner-root")))
        };
      }
      const hiddenIcons = [...document.querySelectorAll("img.gcj02-hide-native")].filter((img) =>
        /maps\.gstatic\.com\/mapfiles/i.test(img.currentSrc || img.src || "")
      ).length;
      return {
        overlayZ,
        overlayPos,
        parentTag,
        wouldCover: parentTag === "HTML" || overlayPos === "fixed" || overlayZ > 0,
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
  });
});
