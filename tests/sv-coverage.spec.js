const { test, expect } = require("@playwright/test");
const {
  launchExtensionContext,
  dismissConsent,
  waitForOverlay,
  setPegmanCover,
  waitForOverlaySvvPb,
  overlaySvvCyanPixels
} = require("./helpers/maps-e2e");

// Forbidden City — photo-sphere / path coverage exists inside the palace grounds.
const MAP = "https://www.google.com/maps/@39.9167135,116.3868853,16z";
const MAP_SV_LAYER =
  "https://www.google.com/maps/@39.9167135,116.3868853,16z/data=!5m1!1e5";
const SAT_SV_LAYER =
  "https://www.google.com/maps/@39.9167135,116.3868853,16z/data=!3m1!1e3!5m1!1e5";

test.describe("Street View coverage blue lines on the overlay", () => {
  /** @type {import('@playwright/test').BrowserContext} */
  let context;
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async () => {
    context = await launchExtensionContext();
    page = context.pages()[0] || (await context.newPage());
    if (!context.serviceWorkers()[0]) {
      await context.waitForEvent("serviceworker", { timeout: 20000 }).catch(() => {});
    }
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("pegman-cover hook loads vt/pb svv tiles with cyan pixels", async () => {
    await page.goto(MAP, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await waitForOverlay(page);

    const before = await page.evaluate(
      () => !!document.querySelector("#gcj02-aligner-root img[data-lyrs='svv']")
    );
    expect(before).toBe(false);

    await setPegmanCover(page, true);
    await waitForOverlaySvvPb(page);

    let cyan = 0;
    for (let i = 0; i < 20; i++) {
      const stats = await overlaySvvCyanPixels(page);
      expect(stats.pb, JSON.stringify(stats)).toBeGreaterThan(0);
      cyan = stats.cyan;
      if (cyan > 50) break;
      await page.waitForTimeout(500);
    }
    expect(cyan, "expected cyan Street View coverage pixels").toBeGreaterThan(50);

    await setPegmanCover(page, false);
    await page.waitForFunction(
      () => !document.querySelector("#gcj02-aligner-root img[data-lyrs='svv']"),
      null,
      { timeout: 15000 }
    );
  });

  test("Street View layer URL (!1e5) paints vt/pb svv on street map", async () => {
    await page.goto(MAP_SV_LAYER, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await waitForOverlay(page);
    await waitForOverlaySvvPb(page);

    let cyan = 0;
    for (let i = 0; i < 20; i++) {
      const stats = await overlaySvvCyanPixels(page);
      expect(stats.pb, JSON.stringify(stats)).toBeGreaterThan(0);
      cyan = stats.cyan;
      if (cyan > 50) break;
      await page.waitForTimeout(500);
    }
    expect(cyan).toBeGreaterThan(50);

    const badLyrs = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll("#gcj02-aligner-root img[data-lyrs='svv']")];
      return imgs.some((img) => /mt\d\.google\.com\/vt\/lyrs=svv/i.test(img.currentSrc || img.src || ""));
    });
    expect(badLyrs, "must not use empty mt*/lyrs=svv tiles").toBe(false);
  });

  test("Street View layer on satellite also paints cyan coverage", async () => {
    await page.goto(SAT_SV_LAYER, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await waitForOverlay(page);
    await waitForOverlaySvvPb(page);

    let cyan = 0;
    for (let i = 0; i < 20; i++) {
      const stats = await overlaySvvCyanPixels(page);
      expect(stats.pb, JSON.stringify(stats)).toBeGreaterThan(0);
      cyan = stats.cyan;
      if (cyan > 50) break;
      await page.waitForTimeout(500);
    }
    expect(cyan).toBeGreaterThan(50);
  });

  test("pointerdown on pegman control enables coverage tiles", async () => {
    await page.goto(MAP, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await waitForOverlay(page);

    const peg = page.locator(
      'button[aria-label*="街景"], button[aria-label*="Street View"], button[jsaction*="pegman"]'
    ).first();
    await expect(peg).toBeVisible({ timeout: 60000 });
    const box = await peg.boundingBox();
    expect(box, "pegman control bounding box").toBeTruthy();

    const vp = page.viewportSize() || { width: 1280, height: 800 };
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(vp.width * 0.55, vp.height * 0.45, { steps: 12 });

    await waitForOverlaySvvPb(page, 20000);
    const stats = await overlaySvvCyanPixels(page);
    expect(stats.pb, JSON.stringify(stats)).toBeGreaterThan(0);

    await page.mouse.up();
  });
});
