const { test, expect } = require("@playwright/test");
const path = require("path");
const { pngRegionStats } = require("./helpers/bmp-luma");
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
  collectNativeMapPins,
  assertOverlayPoisMatchModel,
  assertStreetsShiftedOntoSatellite,
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
        await page.goto("about:blank");
        await page.goto(place.mapHref, { waitUntil: "domcontentloaded", timeout: 120000 });
        await dismissConsent(page);
        await setAlignerMode(context, page, "off");
        await waitForOverlayOff(page);
        await ensureStreetLayer(page);
        await waitForNativePois(page, place.poiNeedles);
        await page.waitForTimeout(2000);
        const nativePins = await collectNativeMapPins(page);
        await page.screenshot({
          path: path.join(__dirname, "..", "test-results", `${place.id}-off-map.png`),
          fullPage: false
        });

        await setAlignerMode(context, page, "on");
        await waitForOverlay(page);
        await ensureStreetLayer(page);
        await waitForOverlay(page);
        await page.waitForTimeout(1500);
        const stats = await overlayAlignmentStats(page);
        expect(stats.mode, JSON.stringify(stats)).toBe("on");
        expect(stats.layer).toBe("map");
        expect(stats.offsetPx).toBeGreaterThan(20);
        expect(stats.roadShift).toBeGreaterThan(20);
        await assertStreetsShiftedOntoSatellite(page);
        expect(stats.poiCount).toBeGreaterThan(0);
        const overlayPins = await overlayPoiScreen(page);
        expect(overlayPins.every((p) => p.kind), JSON.stringify(overlayPins)).toBeTruthy();
        expect(
          await page.locator(".gcj02-poi-pin").count(),
          "search hits must not render as numbered dots"
        ).toBe(0);
        expect(await page.locator(".gcj02-poi-icon").count()).toBe(overlayPins.length);
        expect(
          await page.locator(".gcj02-poi-label").count(),
          "On must show POI names beside icons like Off"
        ).toBe(overlayPins.length);
        if (place.id === "wuzhangyuan") {
          const hits = overlayPins.filter((p) => /五丈原/.test(p.text));
          expect(hits.length, JSON.stringify(overlayPins)).toBeGreaterThan(0);
          const labels = await page.locator(".gcj02-poi-label").allTextContents();
          expect(labels.some((t) => /五丈原/.test(t)), JSON.stringify(labels)).toBeTruthy();
          expect(labels.every((t) => !/開啟過的連結|Opened link/i.test(t)), JSON.stringify(labels)).toBeTruthy();
          for (const p of hits) {
            expect(p.wgsLat, JSON.stringify(p)).toBeLessThan(place.poiWgsSouthOfG310Lat);
            expect(p.wgsLon, JSON.stringify(p)).toBeLessThan(place.poiWgsWestOfX235Lon);
          }
        }
        if (place.id === "forbidden-city") {
          const kinds = overlayPins.map((p) => p.kind);
          expect(kinds.some((k) => k === "attraction" || k === "historic"), JSON.stringify(kinds)).toBeTruthy();
        }
        const snap = await page.evaluate(() => {
          const r = document.getElementById("gcj02-aligner-root").getBoundingClientRect();
          const anchors = [...document.querySelectorAll('a[href*="/maps/place/"]')].map((a) => {
            let category = "";
            let node = a;
            for (let i = 0; i < 10 && node; i++) {
              const t = (node.innerText || "").replace(/\s+/g, " ").trim();
              if (/旅遊景點|旅游景点|歷史|历史|Tourist|Historic|Museum|博物館|遺址/.test(t)) {
                category = t.slice(0, 240);
                break;
              }
              node = node.parentElement;
            }
            return {
              href: a.href || "",
              label: a.getAttribute("aria-label") || a.textContent || "",
              category
            };
          });
          if (/\/maps\/place\//.test(location.href)) {
            anchors.unshift({ href: location.href, label: document.querySelector("h1")?.textContent || "" });
          }
          return { href: location.href, width: r.width, height: r.height, anchors };
        });
        assertOverlayPoisMatchModel(snap, overlayPins);
        if (nativePins.length >= 2 && overlayPins.length >= 2) {
          const ndx = nativePins[1].x - nativePins[0].x;
          const odx = overlayPins[1].left - overlayPins[0].left;
          const ndy = nativePins[1].y - nativePins[0].y;
          const ody = overlayPins[1].top - overlayPins[0].top;
          expect(Math.abs(ndx - odx), JSON.stringify({ nativePins, overlayPins })).toBeLessThan(24);
          expect(Math.abs(ndy - ody), JSON.stringify({ nativePins, overlayPins })).toBeLessThan(24);
        }
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
        await assertStreetsShiftedOntoSatellite(page);
        const satPng = path.join(__dirname, "..", "test-results", `${place.id}-on-sat.png`);
        await page.screenshot({ path: satPng, fullPage: false });
        const mapPx = pngRegionStats(satPng, { x: 430, y: 90, w: 880, h: 680 });
        expect(
          mapPx.hybridRoadShare,
          `${place.name} satellite missing hybrid roads: ${JSON.stringify(mapPx)}`
        ).toBeGreaterThan(0.015);
      });
    });
  }
});
