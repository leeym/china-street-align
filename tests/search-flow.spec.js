const { test, expect } = require("@playwright/test");
const path = require("path");
const { SEARCH_PLACES } = require("./fixtures/overlay-landmarks");
const {
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
} = require("./helpers/maps-e2e");

test.describe("Parameterized search landmarks", () => {
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

  for (const place of SEARCH_PLACES) {
    test.describe(place.name, () => {
      test("1 off street map loads with POIs", async () => {
        await page.goto(place.mapHref, { waitUntil: "domcontentloaded", timeout: 120000 });
        await dismissConsent(page);
        await setAlignerMode(context, page, "off");
        await page.waitForTimeout(2000);
        await waitForOverlayOff(page);
        await waitForNativePois(page, place.poiNeedles);
        const off = await overlayAlignmentStats(page);
        expect(off.mode === "off" || off.display === "none" || !off.mode).toBeTruthy();
        expect(off.nativeHidden, JSON.stringify(off)).toBe(0);
      });

      test("2 off satellite is skewed (native canvas, no overlay)", async () => {
        await page.goto(place.satHref, { waitUntil: "domcontentloaded", timeout: 120000 });
        await dismissConsent(page);
        await setAlignerMode(context, page, "off");
        await page.waitForTimeout(2000);
        await waitForOverlayOff(page);
        const off = await overlayAlignmentStats(page);
        expect(off.display === "none" || off.mode === "off" || off.mode === "").toBeTruthy();
        expect(off.nativeHidden).toBe(0);
        const canvasOn = await page.evaluate(() =>
          [...document.querySelectorAll("canvas")].some((c) => {
            const r = c.getBoundingClientRect();
            return r.width * r.height >= 80000 && getComputedStyle(c).opacity !== "0";
          })
        );
        expect(canvasOn).toBe(true);
      });

      test("3 on street map keeps POIs with the roads", async () => {
        await page.goto(place.mapHref, { waitUntil: "domcontentloaded", timeout: 120000 });
        await dismissConsent(page);
        await setAlignerMode(context, page, "on");
        await waitForOverlay(page);
        await ensureStreetLayer(page);
        await waitForOverlay(page);
        await page.waitForTimeout(1500);
        await waitForNativePois(page, place.poiNeedles);
        const stats = await overlayAlignmentStats(page);
        expect(stats.mode, JSON.stringify(stats)).toBe("on");
        expect(stats.layer).toBe("map");
        expect(stats.offsetPx).toBeGreaterThan(20);
        expect(stats.roadShift).toBeGreaterThan(20);
        expect(stats.poiCount).toBeGreaterThan(0);
        const pins = await overlayPoiScreen(page);
        expect(pins.length, JSON.stringify(pins)).toBeGreaterThan(0);
        await page.screenshot({
          path: path.join(__dirname, "..", "test-results", `${place.id}-on-map.png`),
          fullPage: false
        });
      });

      test("4 on satellite overlaps streets and keeps POIs", async () => {
        await page.goto(place.satHref, { waitUntil: "domcontentloaded", timeout: 120000 });
        await dismissConsent(page);
        await setAlignerMode(context, page, "on");
        await waitForOverlay(page);
        await ensureSatelliteLayer(page);
        await waitForOverlay(page);
        await page.waitForTimeout(1500);
        const stats = await overlayAlignmentStats(page);
        expect(stats.mode, JSON.stringify(stats)).toBe("on");
        expect(stats.layer).toBe("satellite");
        expect(stats.offsetPx).toBeGreaterThan(20);
        expect(stats.roadShift).toBeGreaterThan(20);
        expect(stats.nativeOpacity).toBe("0");
        expect(stats.poiCount).toBeGreaterThan(0);
        await page.screenshot({
          path: path.join(__dirname, "..", "test-results", `${place.id}-on-sat.png`),
          fullPage: false
        });
      });
    });
  }
});
