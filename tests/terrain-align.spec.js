const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const {
  launchExtensionContext,
  dismissConsent,
  waitForOverlay,
  withOverlayDecorHidden,
  MAP_CROP
} = require("./helpers/maps-e2e");
const { pngRegionColorStats } = require("./helpers/bmp-luma");

const OUT = path.join(__dirname, "..", "test-results", "terrain-align");
const TERRAIN_URL =
  "https://www.google.com/maps/place/%E4%BA%94%E4%B8%88%E5%8E%9F/@34.264874,107.6212778,13.85z/data=!4m6!3m5!1s0x36613e2da81fc14b:0xeee51cceea4d3465!8m2!3d34.282582!4d107.618568!16zL20vMDZkOGxk!5m1!1e4";

test.describe("terrain relief stays WGS while roads shift", () => {
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

  test("uses unshifted lyrs=t plus shifted lyrs=h, never unshifted p", async () => {
    await page.goto(TERRAIN_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await waitForOverlay(page);
    await page.waitForTimeout(1500);

    const info = await page.evaluate(() => {
      const root = document.getElementById("gcj02-aligner-root");
      if (!root) return null;
      const tiles = [...root.querySelectorAll("img.gcj02-tile, img.gcj02-road")].map((img) => ({
        lyrs: img.dataset.lyrs || "",
        cls: img.className,
        transform: img.style.transform || ""
      }));
      const tImg = root.querySelector('img.gcj02-tile[data-lyrs="t"]');
      const tCs = tImg ? getComputedStyle(tImg) : null;
      return {
        layer: root.dataset.layer || "",
        bg: getComputedStyle(root).backgroundColor,
        blend: tCs?.mixBlendMode || "",
        filter: tCs?.filter || "",
        tiles,
        hasT: tiles.some((t) => t.lyrs === "t" && t.cls.includes("gcj02-tile")),
        hasH: tiles.some((t) => t.lyrs === "h"),
        hasP: tiles.some((t) => t.lyrs === "p"),
        tShifted: tiles.some((t) => t.lyrs === "t" && /translate/i.test(t.transform)),
        hShifted: tiles.some((t) => t.lyrs === "h" && /translate/i.test(t.transform))
      };
    });

    expect(info, "overlay root missing").toBeTruthy();
    expect(info.layer, JSON.stringify(info)).toBe("terrain");
    expect(info.hasT, JSON.stringify(info)).toBeTruthy();
    expect(info.hasH, JSON.stringify(info)).toBeTruthy();
    expect(info.hasP, "must not paint skewed p roads").toBeFalsy();
    expect(info.tShifted, "relief must not CSS-shift").toBeFalsy();
    expect(info.hShifted, "roads must CSS-shift").toBeTruthy();
    expect(info.filter, "soft invert wash").toMatch(/invert/i);
    expect(info.filter, "must not fluorescent-saturate").not.toMatch(/saturate\(/i);
    expect(info.filter, "must not sepia neon").not.toMatch(/sepia\(/i);

    const shot = path.join(OUT, "terrain-on.png");
    await withOverlayDecorHidden(page, async () => {
      await page.screenshot({ path: shot, fullPage: false });
    });

    // Not near-B&W, and not fluorescent neon green (0.6.34 oversaturated).
    // Soft sage is light (mean ~200) with low sat — reject high sat / channel spikes.
    const color = pngRegionColorStats(shot, MAP_CROP);
    expect(color.grayShare, JSON.stringify(color)).toBeLessThan(0.9);
    expect(color.meanSat, JSON.stringify(color)).toBeGreaterThan(8);
    expect(color.meanSat, JSON.stringify(color)).toBeLessThan(55);
    expect(color.greenBias, JSON.stringify(color)).toBeGreaterThan(1.5);
    expect(color.greenBias, JSON.stringify(color)).toBeLessThan(28);
    expect(color.meanG, JSON.stringify(color)).toBeGreaterThan(color.meanB + 2);
    expect(color.meanG - color.meanR, JSON.stringify(color)).toBeLessThan(35);
  });
});
