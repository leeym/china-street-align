const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const {
  launchExtensionContext,
  dismissConsent,
  waitForOverlay
} = require("./helpers/maps-e2e");

const OUT = path.join(__dirname, "..", "test-results", "zoom-smooth");
const MAP_URL =
  "https://www.google.com/maps/@34.252884,107.6162031,15z/data=!5m1!1e4";

test.describe("overlay scales smoothly while zooming in China", () => {
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

  test("wheel zoom applies scale() on the pan layer before redraw", async () => {
    await page.goto(MAP_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await waitForOverlay(page);
    await page.waitForTimeout(800);

    const box = await page.evaluate(() => {
      const root = document.getElementById("gcj02-aligner-root");
      const r = root.getBoundingClientRect();
      return { x: r.left + r.width * 0.55, y: r.top + r.height * 0.5 };
    });

    await page.mouse.move(box.x, box.y);
    await page.mouse.wheel(0, -480);
    await page.waitForTimeout(80);

    const mid = await page.evaluate(() => {
      const pan = document.getElementById("gcj02-aligner-pan");
      return {
        transform: pan?.style.transform || "",
        origin: pan?.style.transformOrigin || ""
      };
    });
    await page.screenshot({ path: path.join(OUT, "during-wheel.png"), fullPage: false });

    expect(mid.transform, JSON.stringify(mid)).toMatch(/scale\(/);
    const m = mid.transform.match(/scale\(\s*(-?[\d.]+)\s*\)/);
    expect(m, mid.transform).toBeTruthy();
    expect(Number(m[1]), mid.transform).toBeGreaterThan(1.05);

    await page.waitForTimeout(500);
    const after = await page.evaluate(() => {
      const pan = document.getElementById("gcj02-aligner-pan");
      return pan?.style.transform || "";
    });
    expect(after === "" || !/scale\(/.test(after), `cleared after settle: ${after}`).toBeTruthy();
  });

  test("zoom-in button scales the pan layer with a transition", async () => {
    await page.goto(MAP_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await waitForOverlay(page);
    await page.waitForTimeout(800);

    const zoomIn = page.locator('button[aria-label*="Zoom in"], button[aria-label*="放大"]').first();
    await expect(zoomIn).toBeVisible({ timeout: 15000 });
    await zoomIn.click({ timeout: 5000 });
    await page.waitForTimeout(100);

    const mid = await page.evaluate(() => {
      const pan = document.getElementById("gcj02-aligner-pan");
      return {
        transform: pan?.style.transform || "",
        transition: pan?.style.transition || ""
      };
    });
    await page.screenshot({ path: path.join(OUT, "during-button.png"), fullPage: false });

    expect(mid.transform, JSON.stringify(mid)).toMatch(/scale\(/);
    const m = mid.transform.match(/scale\(\s*(-?[\d.]+)\s*\)/);
    expect(m, mid.transform).toBeTruthy();
    expect(Number(m[1]), mid.transform).toBeGreaterThan(1.5);
    expect(mid.transition, JSON.stringify(mid)).toMatch(/transform/i);
  });
});
