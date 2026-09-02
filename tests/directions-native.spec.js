const path = require("path");
const { test, expect } = require("@playwright/test");
const {
  launchExtensionContext,
  dismissConsent,
  switchToSatelliteBasemap,
  waitForOverlay,
  readHybridDirectionsState,
  waitForHybridDirectionsMapMode,
  assertHybridDirectionsMapMode,
  assertDirectionsVectorMapVisual
} = require("./helpers/maps-e2e");

const OUT = path.join(__dirname, "..", "test-results", "directions-native");

// User-reported flow (清永陵):
// 1. Place page on street map
// 2. Switch to satellite via Maps UI
// 3. Click 規劃路線
const PLACE_STREET_URL =
  "https://www.google.com/maps/place/%E6%B8%85%E6%B0%B8%E9%99%B5/@41.7088729,124.7898743,15.99z/data=!4m6!3m5!1s0x5e2e238c032cbc93:0xfcc3e337e7f95939!8m2!3d41.710262!4d124.802589!16s%2Fg%2F155q2694";

const PLACE_SAT_URL =
  "https://www.google.com/maps/place/%E6%B8%85%E6%B0%B8%E9%99%B5/@41.7088729,124.7898743,2316m/data=!3m1!1e3!4m6!3m5!1s0x5e2e238c032cbc93:0xfcc3e337e7f95939!8m2!3d41.710262!4d124.802589!16s%2Fg%2F155q2694";

// User search flow: satellite place URL with !3m2!1e3!4b1
const PLACE_SAT_SEARCH_URL =
  "https://www.google.com/maps/place/%E6%B8%85%E6%B0%B8%E9%99%B5/@41.710266,124.8000141,1148m/data=!3m2!1e3!4b1!4m6!3m5!1s0x5e2e238c032cbc93:0xfcc3e337e7f95939!8m2!3d41.710262!4d124.802589!16s%2Fg%2F155q2694";

const DIRECTIONS_SAT_URL =
  "https://www.google.com/maps/dir//%E6%B8%85%E6%B0%B8%E9%99%B5/@41.7088729,124.7898743,2316m/data=!3m1!1e3!4m8!1m0!1m5!1m1!1s0x5e2e238c032cbc93:0xfcc3e337e7f95939!2m2!1d124.802589!2d41.710262!3e0";

test.describe.serial("directions forces native map in China", () => {
  test.setTimeout(300000);

  let context;
  let page;

  test.beforeAll(async () => {
    const fs = require("fs");
    fs.mkdirSync(OUT, { recursive: true });
    context = await launchExtensionContext();
    if (!context.serviceWorkers()[0]) {
      await context.waitForEvent("serviceworker", { timeout: 20000 }).catch(() => {});
    }
  });

  test.beforeEach(async () => {
    page = await context.newPage();
  });

  test.afterEach(async () => {
    await page?.close().catch(() => {});
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("清永陵: street → satellite UI → 規劃路線 → native map (user flow)", async () => {
    await page.goto(PLACE_STREET_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await page.waitForTimeout(2000);

    await switchToSatelliteBasemap(page);
    await page.waitForFunction(() => {
      const m = location.href.match(/[?&/]data=([^&#]*)/);
      const data = m ? decodeURIComponent(m[1]) : "";
      return /!3m\d+!1e3/i.test(data);
    }, { timeout: 30000 });
    await waitForOverlay(page);

    const beforeDir = await readHybridDirectionsState(page);
    expect(beforeDir.satelliteInUrl, JSON.stringify(beforeDir)).toBe(true);
    expect(beforeDir.loadedOverlayTiles, JSON.stringify(beforeDir)).toBeGreaterThan(0);

    const dirBtn = page.getByRole("button", { name: /directions|規劃路線|规划路线|路线|路線/i }).first();
    await expect(dirBtn).toBeVisible({ timeout: 20000 });
    await dirBtn.click({ timeout: 30000 });

    await waitForHybridDirectionsMapMode(page, 60000);
    await page.waitForTimeout(1500);

    const afterDir = await readHybridDirectionsState(page);
    assertHybridDirectionsMapMode(afterDir);
    await assertDirectionsVectorMapVisual(page);
  });

  test("清永陵: satellite URL then 規劃路線 click (URL may stay on /place/)", async () => {
    test.skip(!!process.env.CI, "Slow/flaky on GitHub Actions; covered by the street→satellite→directions flow");
    await page.goto(PLACE_SAT_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await waitForOverlay(page);

    const dirBtn = page.getByRole("button", { name: /directions|規劃路線|规划路线|路线|路線/i }).first();
    await expect(dirBtn).toBeVisible({ timeout: 30000 });
    await dirBtn.click({ timeout: 30000 });
    await waitForHybridDirectionsMapMode(page);

    const state = await readHybridDirectionsState(page);
    assertHybridDirectionsMapMode(state);
    await assertDirectionsVectorMapVisual(page);
  });

  test("清永陵: search satellite place (!3m2!1e3!4b1) → 規劃路線 → vector map", async () => {
    test.skip(!!process.env.CI, "Slow on GitHub Actions; run locally with npm run test:directions");
    await page.goto(PLACE_SAT_SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await page.waitForFunction(() => {
      const m = location.href.match(/[?&/]data=([^&#]*)/);
      const data = m ? decodeURIComponent(m[1]) : "";
      return /!3m\d+!1e3/i.test(data);
    }, { timeout: 30000 });
    await waitForOverlay(page);

    const dirBtn = page.getByRole("button", { name: /directions|規劃路線|规划路线|路线|路線/i }).first();
    await dirBtn.click({ timeout: 30000 });
    await waitForHybridDirectionsMapMode(page, 90000);
    await page.waitForTimeout(2000);

    const state = await readHybridDirectionsState(page);
    assertHybridDirectionsMapMode(state);
    await assertDirectionsVectorMapVisual(page);
  });

  test("directions /dir/ URL on satellite rewinds to map basemap", async () => {
    await page.goto(DIRECTIONS_SAT_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await waitForHybridDirectionsMapMode(page, 60000);
    const state = await readHybridDirectionsState(page);
    assertHybridDirectionsMapMode(state);
    await assertDirectionsVectorMapVisual(page);
  });
});
