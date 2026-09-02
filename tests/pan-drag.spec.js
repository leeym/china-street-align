const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const {
  launchExtensionContext,
  dismissConsent,
  waitForOverlay
} = require("./helpers/maps-e2e");

const OUT = path.join(__dirname, "..", "test-results", "pan-drag");
const MAP_URL =
  "https://www.google.com/maps/@34.252884,107.6162031,15z/data=!3m1!1e3";

test.describe("overlay follows the pointer while dragging in China", () => {
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

  test("root translate3d tracks a pointer drag before release", async () => {
    await page.goto(MAP_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await waitForOverlay(page);
    await page.waitForTimeout(800);

    const box = await page.evaluate(() => {
      const root = document.getElementById("gcj02-aligner-root");
      const r = root.getBoundingClientRect();
      return { x: r.left + r.width * 0.6, y: r.top + r.height * 0.5 };
    });

    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 40, { steps: 8 });
    await page.waitForTimeout(100);

    const mid = await page.evaluate(() => {
      const root = document.getElementById("gcj02-aligner-root");
      const pan = document.getElementById("gcj02-aligner-pan");
      return {
        rootTransform: root?.style.transform || "",
        panTransform: pan?.style.transform || "",
        display: root?.style.display || "",
        hasPadTiles: !!root?.querySelector(".gcj02-tile, .gcj02-road")
      };
    });
    await page.screenshot({ path: path.join(OUT, "during-drag.png"), fullPage: false });

    expect(mid.display, JSON.stringify(mid)).not.toBe("none");
    expect(mid.rootTransform, "root must stay put").toBe("");
    expect(mid.panTransform, JSON.stringify(mid)).toMatch(/translate3d\(/);
    const m = mid.panTransform.match(/translate3d\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/);
    expect(m, mid.panTransform).toBeTruthy();
    expect(Number(m[1]), mid.panTransform).toBeGreaterThan(80);
    expect(Number(m[2]), mid.panTransform).toBeGreaterThan(20);

    await page.mouse.up();
    // Must not clear the preview on the same turn as release (that snaps back).
    const rightAfter = await page.evaluate(() => {
      const pan = document.getElementById("gcj02-aligner-pan");
      return pan?.style.transform || "";
    });
    expect(rightAfter, "hold translate until Maps commits").toMatch(/translate3d\(/);

    await page.waitForFunction(() => {
      const pan = document.getElementById("gcj02-aligner-pan");
      const t = pan?.style.transform || "";
      return t === "" || t === "none" || !/translate3d\(/.test(t);
    }, { timeout: 5000 });
    const after = await page.evaluate(() => {
      const pan = document.getElementById("gcj02-aligner-pan");
      return pan?.style.transform || "";
    });
    expect(after === "" || after === "none" || !/translate3d\(/.test(after), `clear after settle: ${after}`).toBeTruthy();
  });
});
