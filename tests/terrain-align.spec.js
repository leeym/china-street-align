const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const {
  launchExtensionContext,
  dismissConsent,
  waitForOverlay
} = require("./helpers/maps-e2e");

const OUT = path.join(__dirname, "..", "test-results", "terrain-align");
const TERRAIN_URL =
  "https://www.google.com/maps/search/%E8%AB%B8%E8%91%9B%E4%BA%AE%E5%BB%9F/@34.2601877,107.6251334,14.29z/data=!5m1!1e4";

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

  test("uses unshifted colored lyrs=p plus shifted lyrs=h", async () => {
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
      return {
        layer: root.dataset.layer || "",
        tiles,
        hasP: tiles.some((t) => t.lyrs === "p" && t.cls.includes("gcj02-tile")),
        hasH: tiles.some((t) => t.lyrs === "h"),
        pShifted: tiles.some((t) => t.lyrs === "p" && t.cls.includes("gcj02-tile") && /translate/i.test(t.transform)),
        hShifted: tiles.some((t) => t.lyrs === "h" && /translate/i.test(t.transform))
      };
    });
    await page.screenshot({ path: path.join(OUT, "terrain-on.png"), fullPage: false });

    expect(info, "overlay root missing").toBeTruthy();
    expect(info.layer, JSON.stringify(info)).toBe("terrain");
    expect(info.hasP, JSON.stringify(info)).toBeTruthy();
    expect(info.hasH, JSON.stringify(info)).toBeTruthy();
    expect(info.pShifted, "colored terrain basemap must not CSS-shift").toBeFalsy();
    expect(info.hShifted, "roads must CSS-shift").toBeTruthy();
  });
});
