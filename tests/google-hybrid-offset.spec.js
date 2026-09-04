const path = require("path");
const fs = require("fs");
const { test, expect } = require("@playwright/test");
const { CASES, METERS } = require("./fixtures/hybrid-offset-cases");
const {
  satUrl,
  cameraMeta,
  measureHybridScreenOffset,
  readOverlayRoadShift
} = require("./helpers/hybrid-offset");
const {
  launchExtensionContext,
  dismissConsent,
  setModeViaPopup,
  extensionId,
  waitForAlignMode,
  waitForOverlay,
  waitForOverlayOff,
  assertStreetsShiftedOntoSatellite
} = require("./helpers/maps-e2e");

const OUT = path.join(__dirname, "..", "test-results", "hybrid-offset");

/**
 * Fixture rows: [lat, lon, expectGoogleOffset]
 *
 * Off — native hybrid screenshot: road-overlay ink vs sat corridors must match
 *       expectGoogleOffset (replaces the old Xiamen-only "aligns with roads" check).
 * On  — hybrid mode must not leave an offset on screen:
 *       mainland ⇒ overlay active with a real road CSS shift (sat unshifted)
 *       HK/Macau ⇒ overlay idle (must not invent a GCJ shift) + screen still aligned
 */
test.describe.serial("Google hybrid offset Off vs On", () => {
  test.setTimeout(360000);

  let context;
  let extId;
  let page;

  test.beforeAll(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    context = await launchExtensionContext();
    extId = await extensionId(context);
    page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  for (const [lat, lon, expectOffset] of CASES) {
    test(`${lat},${lon} Off expectOffset=${expectOffset}; On aligned`, async () => {
      const meta = cameraMeta(lat, lon, METERS);
      // Fixture must agree with geo policy (HK excluded, Shenzhen inside).
      expect(meta.outOfChina, JSON.stringify(meta)).toBe(!expectOffset);

      await setModeViaPopup(context, extId, "off");
      await page.goto(satUrl(lat, lon, METERS), {
        waitUntil: "domcontentloaded",
        timeout: 120000
      });
      await dismissConsent(page);
      await waitForAlignMode(page, "off");
      await waitForOverlayOff(page);
      await page.waitForTimeout(4000);

      const offDir = path.join(OUT, "off");
      fs.mkdirSync(offDir, { recursive: true });
      const off = await measureHybridScreenOffset(
        page,
        path.join(offDir, `${lat}_${lon}.png`)
      );
      const offSummary = JSON.stringify({ ...off, meta }, null, 2);

      if (expectOffset) {
        expect(off.offset, offSummary).toBe(true);
        expect(off.hypot, offSummary).toBeGreaterThan(80);
      } else {
        expect(off.aligned, offSummary).toBe(true);
      }

      await setModeViaPopup(context, extId, "hybrid");
      await page.goto(satUrl(lat, lon, METERS), {
        waitUntil: "domcontentloaded",
        timeout: 120000
      });
      await dismissConsent(page);
      await waitForAlignMode(page, "hybrid");
      await page.waitForTimeout(3000);

      if (expectOffset) {
        await waitForOverlay(page);
        const road = await readOverlayRoadShift(page);
        const onSummary = JSON.stringify({ off, road, meta }, null, 2);
        expect(road.active, onSummary).toBe(true);
        expect(road.hypot, onSummary).toBeGreaterThan(30);
        expect(road.satHypot, onSummary).toBeLessThan(3);
        await assertStreetsShiftedOntoSatellite(page);
      } else {
        await waitForOverlayOff(page);
        const road = await readOverlayRoadShift(page);
        const onDir = path.join(OUT, "on");
        fs.mkdirSync(onDir, { recursive: true });
        const on = await measureHybridScreenOffset(
          page,
          path.join(onDir, `${lat}_${lon}.png`)
        );
        const onSummary = JSON.stringify({ off, on, road, meta }, null, 2);
        expect(road.active, onSummary).toBe(false);
        expect(road.hypot, onSummary).toBeLessThan(3);
        // Must not invent a GCJ shift (the old Hong Kong false-positive).
        expect(on.aligned, onSummary).toBe(true);
      }
    });
  }
});
