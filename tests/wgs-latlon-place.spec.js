const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const {
  launchExtensionContext,
  dismissConsent,
  waitForOverlay,
  assertStreetsShiftedOntoSatellite
} = require("./helpers/maps-e2e");
const { FORBIDDEN_CITY } = require("./fixtures/overlay-landmarks");
require("../aligner-lib.js");
const lib = globalThis.Gcj02Aligner;

const OUT = path.join(__dirname, "..", "test-results", "wgs-latlon-place");
const T = FORBIDDEN_CITY.taihedianWgs;

test.describe("WGS lat/lon place pins stay on 太和殿", () => {
  /** @type {import('@playwright/test').BrowserContext} */
  let context;
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    context = await launchExtensionContext();
    page = context.pages()[0] || await context.newPage();
    if (!context.serviceWorkers()[0]) {
      await context.waitForEvent("serviceworker", { timeout: 20000 }).catch(() => {});
    }
  });

  test.afterAll(async () => {
    await context?.close();
  });

  for (const [label, href, expectOverlayPin] of [
    ["street", T.href, true],
    ["satellite", T.satHref, false]
  ]) {
    test(`${label}: pin stays on palace axis`, async () => {
      await page.goto(href, { waitUntil: "domcontentloaded", timeout: 120000 });
      await dismissConsent(page);
      if (expectOverlayPin) {
        await waitForOverlay(page);
      } else {
        await page.waitForTimeout(2500);
      }
      await page.waitForTimeout(1500);

      const info = await page.evaluate(() => {
        const root = document.getElementById("gcj02-aligner-root");
        const poi = root?.querySelector(".gcj02-poi.is-place-pin");
        const box = root?.getBoundingClientRect();
        const pr = poi?.getBoundingClientRect();
        return {
          layer: root?.dataset.layer || "",
          display: root ? root.style.display : "absent",
          poiCount: Number(root?.dataset.poiCount || 0),
          wgsLat: poi ? Number(poi.dataset.wgsLat) : null,
          wgsLon: poi ? Number(poi.dataset.wgsLon) : null,
          poiCx: pr && box ? pr.left + pr.width / 2 - box.left : null,
          poiCy: pr && box ? pr.bottom - box.top : null,
          midX: box ? box.width / 2 : null,
          midY: box ? box.height / 2 : null
        };
      });

      await page.screenshot({ path: path.join(OUT, `${label}-on.png`), fullPage: false });

      if (expectOverlayPin) {
        expect(info.poiCount, JSON.stringify(info)).toBe(1);
        expect(info.wgsLat, JSON.stringify(info)).toBeCloseTo(T.lat, 4);
        expect(info.wgsLon, JSON.stringify(info)).toBeCloseTo(T.lon, 4);
        expect(info.wgsLon, "must not slide west of palace").toBeGreaterThan(T.palaceAxisLon);
        const wrong = lib.gcjToWgs(T.lat, T.lon);
        expect(info.wgsLon, JSON.stringify({ info, wrong })).toBeGreaterThan(wrong.lon + 0.002);
        expect(Math.abs(info.poiCx - info.midX), JSON.stringify(info)).toBeLessThan(80);
        expect(Math.abs(info.poiCy - info.midY), JSON.stringify(info)).toBeLessThan(120);
      } else {
        expect(info.poiCount, JSON.stringify(info)).toBe(0);
      }

      if (label === "satellite" && expectOverlayPin) {
        await assertStreetsShiftedOntoSatellite(page);
      }
    });
  }
});
