const { test, expect } = require("@playwright/test");
const {
  launchExtensionContext,
  dismissConsent,
  switchToSatelliteBasemap,
  waitForOverlay
} = require("./helpers/maps-e2e");
const { FORBIDDEN_CITY } = require("./fixtures/overlay-landmarks");
require("../aligner-lib.js");
const lib = globalThis.Gcj02Aligner;

const PLACE_URL =
  "https://www.google.com/maps/place/%E5%A4%AA%E5%92%8C%E6%AE%BF/@39.9172771,116.3945213,2359m/data=!4m6!3m5!1s0x35f052c28a42d347:0x4d686c72723159fa!8m2!3d39.917273!4d116.3970962!16zL20vMDQ4N3dn";

test("太和殿 GCJ place on satellite: aligned photo and one teardrop", async () => {
  const context = await launchExtensionContext();
  const page = context.pages()[0] || await context.newPage();
  if (!context.serviceWorkers()[0]) {
    await context.waitForEvent("serviceworker", { timeout: 20000 }).catch(() => {});
  }
  await page.goto(PLACE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  await dismissConsent(page);
  await switchToSatelliteBasemap(page);
  await waitForOverlay(page);
  const pin = await page.evaluate(() => {
    const root = document.getElementById("gcj02-aligner-root");
    const poi = root?.querySelector(".gcj02-poi.is-place-pin");
    return {
      layer: root?.dataset.layer || "",
      poiCount: Number(root?.dataset.poiCount || 0),
      hasTeardrop: !!poi,
      wgsLat: poi ? Number(poi.dataset.wgsLat) : null,
      wgsLon: poi ? Number(poi.dataset.wgsLon) : null
    };
  });
  const place = lib.parsePlaceCoords(PLACE_URL);
  const wgs = lib.gcjToWgs(place.lat, place.lon);
  expect(pin.layer).toBe("satellite");
  expect(pin.poiCount).toBe(1);
  expect(pin.hasTeardrop).toBe(true);
  expect(pin.wgsLat).toBeCloseTo(wgs.lat, 4);
  expect(pin.wgsLon).toBeCloseTo(wgs.lon, 4);
  expect(pin.wgsLon).toBeGreaterThan(FORBIDDEN_CITY.taihedianWgs.palaceAxisLon);
  await context.close();
});
