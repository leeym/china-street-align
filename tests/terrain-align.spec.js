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

test.describe("terrain uses native p tiles, CSS-shifted", () => {
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

  test("paints shifted lyrs=p like native terrain, no t tint", async () => {
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
      const pImg = root.querySelector('img[data-lyrs="p"]');
      const pCs = pImg ? getComputedStyle(pImg) : null;
      return {
        layer: root.dataset.layer || "",
        bg: getComputedStyle(root).backgroundColor,
        filter: pCs?.filter || "none",
        tiles,
        hasT: tiles.some((t) => t.lyrs === "t"),
        hasH: tiles.some((t) => t.lyrs === "h"),
        hasP: tiles.some((t) => t.lyrs === "p"),
        pShifted: tiles.some((t) => t.lyrs === "p" && /translate/i.test(t.transform))
      };
    });

    expect(info, "overlay root missing").toBeTruthy();
    expect(info.layer, JSON.stringify(info)).toBe("terrain");
    expect(info.hasP, JSON.stringify(info)).toBeTruthy();
    expect(info.pShifted, "native p must CSS-shift").toBeTruthy();
    expect(info.hasT, "must not use grayscale t + fake tint").toBeFalsy();
    expect(info.hasH, "p already includes roads").toBeFalsy();
    expect(info.filter, "no artificial colorize").toMatch(/^(none)?$/i);
    expect(info.bg, "no sage fill").not.toMatch(/rgb\(\s*213,\s*222,\s*202\s*\)/i);

    const shot = path.join(OUT, "terrain-on.png");
    await withOverlayDecorHidden(page, async () => {
      await page.screenshot({ path: shot, fullPage: false });
    });

    // Structural check is the product rule. Native `p` colour varies by place
    // (Wuzhangyuan is pale/beige, not saturated green) — only reject empty/B&W.
    const color = pngRegionColorStats(shot, MAP_CROP);
    expect(color.meanSat, JSON.stringify(color)).toBeGreaterThan(4);
    expect(color.grayShare, JSON.stringify(color)).toBeLessThan(0.97);
  });
});
