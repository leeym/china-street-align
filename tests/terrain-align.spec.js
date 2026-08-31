const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const {
  launchExtensionContext,
  dismissConsent,
  waitForOverlay,
  withOverlayDecorHidden,
  assertStreetsShiftedOntoSatellite,
  MAP_CROP
} = require("./helpers/maps-e2e");
const { pngRegionColorStats } = require("./helpers/bmp-luma");
const { WUZHANGYUAN } = require("./fixtures/overlay-landmarks");

const OUT = path.join(__dirname, "..", "test-results", "terrain-align");

test.describe("terrain keeps X235 in the west valley", () => {
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

  // Regression: CSS-shifting combined lyrs=p moves WGS cliffs with GCJ roads, so
  // at 五丈原 X235 climbs the west plateau face instead of the valley floor.
  // Look: shifted street `m` + unshifted shade `t` (outside-China style), not B&W t+h.
  test("uses shifted m under unshifted t shade, never shifted p", async () => {
    await page.goto(WUZHANGYUAN.terrainHref, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await waitForOverlay(page);
    await page.waitForTimeout(1500);

    const info = await page.evaluate(() => {
      const root = document.getElementById("gcj02-aligner-root");
      if (!root) return null;
      const tiles = [...root.querySelectorAll("img.gcj02-tile, img.gcj02-road, img.gcj02-shade")].map((img) => ({
        lyrs: img.dataset.lyrs || "",
        cls: img.className,
        transform: img.style.transform || "",
        left: img.style.left || "",
        top: img.style.top || "",
        blend: getComputedStyle(img).mixBlendMode || ""
      }));
      const shade = tiles.find((t) => t.lyrs === "t");
      return {
        layer: root.dataset.layer || "",
        tiles,
        hasT: tiles.some((t) => t.lyrs === "t"),
        hasM: tiles.some((t) => t.lyrs === "m"),
        hasH: tiles.some((t) => t.lyrs === "h"),
        hasP: tiles.some((t) => t.lyrs === "p"),
        tShifted: tiles.some((t) => t.lyrs === "t" && /translate/i.test(t.transform)),
        mShifted: tiles.some((t) => t.lyrs === "m" && /translate/i.test(t.transform)),
        pShifted: tiles.some((t) => t.lyrs === "p" && /translate/i.test(t.transform)),
        shadeBlend: shade?.blend || ""
      };
    });

    expect(info, "overlay root missing").toBeTruthy();
    expect(info.layer, JSON.stringify(info)).toBe("terrain");
    expect(info.hasT, "WGS shade required").toBeTruthy();
    expect(info.hasM, "colored street map required").toBeTruthy();
    expect(info.hasH, "labels-only h is the B&W path").toBeFalsy();
    expect(info.hasP, "combined p must not paint (cliff/road lockstep)").toBeFalsy();
    expect(info.tShifted, "shade must not CSS-shift").toBeFalsy();
    expect(info.mShifted, "streets must CSS-shift").toBeTruthy();
    expect(info.pShifted, "shifted p is the X235-on-cliff bug").toBeFalsy();
    expect(info.shadeBlend, JSON.stringify(info)).toMatch(/multiply/i);

    await assertStreetsShiftedOntoSatellite(page);

    const shot = path.join(OUT, "terrain-on.png");
    await withOverlayDecorHidden(page, async () => {
      await page.screenshot({ path: shot, fullPage: false });
    });
    // Colored roadmap under shade — reject near-B&W t+h (0.6.37). Multiply
    // shade raises grayShare; require real chroma from street `m`.
    const color = pngRegionColorStats(shot, MAP_CROP);
    expect(color.meanSat, JSON.stringify(color)).toBeGreaterThan(12);
    expect(color.grayShare, JSON.stringify(color)).toBeLessThan(0.92);
  });
});
