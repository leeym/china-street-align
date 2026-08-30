const { test, expect } = require("@playwright/test");
const path = require("path");
const { WUZHANGYUAN } = require("./fixtures/overlay-landmarks");
const { alignPngs } = require("./helpers/img-align");
const {
  launchExtensionContext,
  dismissConsent,
  setAlignerMode,
  waitForOverlay,
  waitForOverlayOff,
  waitForNativePois,
  overlayAlignmentStats,
  ensureStreetLayer,
  MAP_CROP,
  withOverlayDecorHidden
} = require("./helpers/maps-e2e");

const OUT = path.join(__dirname, "..", "test-results", "tile-align");

// On a street-only view there is no satellite to align to, so the overlay must
// land its tiles exactly where Maps had them: it re-centers on the WGS-84 twin
// of the GCJ URL camera and then CSS-shifts the GCJ tiles back by the same
// vector, which cancels. Anything left over is a real placement bug, and it is
// what makes POI markers sit off the roads they name.
//
// Every earlier POI test compared numbers the extension itself produced, so a
// wrong tile position was invisible to them. This one compares pixels: the same
// screen rectangle, rendered by Maps (Off) and by the overlay (On), correlated
// on edges. That is how the half-tile longitude bug in tileCenterLatLon was
// found — it put every tile 128px west at every zoom while the markers stayed
// on the correct pixel.
test.describe("overlay tiles land where Maps had them", () => {
  /** @type {import('@playwright/test').BrowserContext} */
  let context;
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async () => {
    context = await launchExtensionContext();
    page = context.pages()[0] || await context.newPage();
    if (!context.serviceWorkers()[0]) {
      await context.waitForEvent("serviceworker", { timeout: 20000 }).catch(() => {});
    }
  });

  test.afterAll(async () => {
    await context?.close();
  });

  for (const step of WUZHANGYUAN.tileAlignHrefs) {
    test(`${step.label} street tiles sit on the native map`, async () => {
      await page.goto("about:blank");
      await page.goto(step.href, { waitUntil: "domcontentloaded", timeout: 120000 });
      await dismissConsent(page);

      await setAlignerMode(context, page, "off");
      await waitForOverlayOff(page);
      await ensureStreetLayer(page);
      await waitForNativePois(page, WUZHANGYUAN.poiNeedles);
      await page.waitForTimeout(3000);
      const offPng = path.join(OUT, `off-${step.label}.png`);
      await page.screenshot({ path: offPng, clip: MAP_CROP });

      await setAlignerMode(context, page, "on");
      await waitForOverlay(page);
      await page.waitForTimeout(3000);
      const stats = await overlayAlignmentStats(page);
      expect(stats.mode, JSON.stringify(stats)).toBe("on");
      expect(stats.layer).toBe("map");
      expect(stats.tileCount).toBeGreaterThan(4);
      expect(stats.poiCount).toBeGreaterThan(0);
      // Maps silently rewrites zooms it does not like, which once hollowed out
      // an intended fractional case into another z16. Fail loudly instead.
      const liveZoom = await page.evaluate(
        () => Number(document.getElementById("gcj02-aligner-root")?.dataset.zoom)
      );
      expect(liveZoom, `${step.label}: Maps served z${liveZoom}, not z${step.expectZoom}`)
        .toBeCloseTo(step.expectZoom, 1);
      const onPng = path.join(OUT, `on-${step.label}.png`);
      await withOverlayDecorHidden(page, () =>
        page.screenshot({ path: onPng, clip: MAP_CROP })
      );

      // Centre the reference patch so the search can reach ±160px in x: the
      // half-tile bug was -128px, and a window pinned near the left edge caps
      // the reachable dx and reports a garbage peak instead of the real one.
      const fit = alignPngs(offPng, onPng, { window: { x: 160, y: 90, w: 320, h: 200 } });
      const why = `${step.label} On tiles offset from Off by (${fit.dx},${fit.dy}) ncc=${fit.score.toFixed(3)} — ${onPng}`;
      expect(Math.abs(fit.dx), why).toBeLessThanOrEqual(4);
      expect(Math.abs(fit.dy), why).toBeLessThanOrEqual(4);
      // A featureless or badly mismatched crop can peak at (0,0) by luck, so
      // require the match itself to be strong before trusting the offset.
      expect(fit.score, `image compare peak too weak to trust: ${why}`).toBeGreaterThan(0.28);
    });
  }
});
