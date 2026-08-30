const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const { pngRedPinStats, pngNewRedPinStats } = require("./helpers/bmp-luma");
const { WUZHANGYUAN } = require("./fixtures/overlay-landmarks");
const {
  launchExtensionContext,
  dismissConsent,
  setAlignerMode,
  waitForOverlay,
  waitForOverlayOff,
  waitForNativePois,
  hoverSearchResult,
  clearSearchHover,
  ensureStreetLayer,
  MAP_CROP
} = require("./helpers/maps-e2e");

const OUT = path.join(__dirname, "..", "test-results", "poi-hover");
const PLAIN = WUZHANGYUAN.samplePoi;
const TOWN = WUZHANGYUAN.townPoi;

function poiKey(p) {
  return `${Number(p.lat).toFixed(5)},${Number(p.lon).toFixed(5)}`;
}

// Off: hovering a sidebar hit paints a classic red teardrop + name tooltip on
// the native canvas. On hides that canvas, so the overlay must mirror it.
test.describe("sidebar hover shows red teardrop + tooltip", () => {
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

  test("1 off: hover 五丈原 paints a tall red teardrop on the map", async () => {
    await page.goto(WUZHANGYUAN.mapHref, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await setAlignerMode(context, page, "off");
    await waitForOverlayOff(page);
    await waitForNativePois(page, WUZHANGYUAN.poiNeedles);
    await page.waitForTimeout(2000);

    await clearSearchHover(page);
    const idlePath = path.join(OUT, "off-idle.png");
    await page.screenshot({ path: idlePath, fullPage: false });
    const idle = pngRedPinStats(idlePath, MAP_CROP);

    await hoverSearchResult(page, { name: "五丈原", lat: PLAIN.lat, lon: PLAIN.lon });
    const hoverPath = path.join(OUT, "off-hover-wuzhangyuan.png");
    await page.screenshot({ path: hoverPath, fullPage: false });
    const hover = pngRedPinStats(hoverPath, MAP_CROP);
    const neu = pngNewRedPinStats(idlePath, hoverPath, MAP_CROP);

    expect(hover.redCount, JSON.stringify({ idle, hover, neu })).toBeGreaterThan(idle.redCount + 40);
    expect(neu.redCount, JSON.stringify(neu)).toBeGreaterThan(80);
    expect(neu.tallPin, JSON.stringify(neu)).toBe(true);

    await hoverSearchResult(page, { name: "五丈原鎮", lat: TOWN.lat, lon: TOWN.lon });
    const townPath = path.join(OUT, "off-hover-town.png");
    await page.screenshot({ path: townPath, fullPage: false });
    const townNew = pngNewRedPinStats(idlePath, townPath, MAP_CROP);
    expect(townNew.tallPin, JSON.stringify(townNew)).toBe(true);
    expect(townNew.redCount, JSON.stringify(townNew)).toBeGreaterThan(80);
  });

  test("2 on: hover swaps the overlay glyph for a teardrop + tooltip", async () => {
    await page.goto(WUZHANGYUAN.mapHref, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await setAlignerMode(context, page, "on");
    await waitForOverlay(page);
    await ensureStreetLayer(page);
    await waitForOverlay(page);
    await waitForNativePois(page, WUZHANGYUAN.poiNeedles);
    await page.waitForTimeout(1500);

    await clearSearchHover(page);
    expect(await page.locator(".gcj02-poi.is-hover").count()).toBe(0);

    const plainKey = poiKey(PLAIN);
    await hoverSearchResult(page, { name: "五丈原", lat: PLAIN.lat, lon: PLAIN.lon });
    // Dispatch a synthetic mouseover in case Maps intercepts the real one.
    await page.evaluate((key) => {
      const links = [...document.querySelectorAll('a[href*="/maps/place/"]')];
      const hit = links.find((a) => {
        const m = (a.href || "").match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
        if (!m) return false;
        return `${Number(m[1]).toFixed(5)},${Number(m[2]).toFixed(5)}` === key;
      });
      if (hit) hit.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
    }, plainKey);

    const hovered = page.locator(`.gcj02-poi.is-hover[data-key="${plainKey}"]`);
    await expect(hovered).toHaveCount(1, { timeout: 5000 });
    await expect(hovered.locator(".gcj02-poi-teardrop")).toBeVisible();
    await expect(hovered.locator(".gcj02-poi-tooltip")).toBeVisible();
    const tip = (await hovered.locator(".gcj02-poi-tooltip").textContent()) || "";
    expect(tip.length, tip).toBeGreaterThan(0);
    expect(await hovered.getAttribute("aria-label")).toBe(tip);
    await expect(hovered.locator(".gcj02-poi-icon")).toBeHidden();
    await expect(hovered.locator(".gcj02-poi-label")).toBeHidden();
    await page.screenshot({ path: path.join(OUT, "on-hover-wuzhangyuan.png"), fullPage: false });

    const townKey = poiKey(TOWN);
    await hoverSearchResult(page, { name: "五丈原鎮", lat: TOWN.lat, lon: TOWN.lon });
    await page.evaluate((key) => {
      const links = [...document.querySelectorAll('a[href*="/maps/place/"]')];
      const hit = links.find((a) => {
        const m = (a.href || "").match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
        if (!m) return false;
        return `${Number(m[1]).toFixed(5)},${Number(m[2]).toFixed(5)}` === key;
      });
      if (hit) hit.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
    }, townKey);
    const town = page.locator(`.gcj02-poi.is-hover[data-key="${townKey}"]`);
    await expect(town).toHaveCount(1, { timeout: 5000 });
    await expect(town.locator(".gcj02-poi-tooltip")).toBeVisible();
    await page.screenshot({ path: path.join(OUT, "on-hover-town.png"), fullPage: false });

    await clearSearchHover(page);
    await page.evaluate(() => {
      document.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, cancelable: true, view: window }));
    });
    // Move off the sidebar so pointerout clears the hover class.
    await page.mouse.move(700, 400);
    await page.waitForTimeout(400);
    expect(await page.locator(".gcj02-poi.is-hover").count()).toBe(0);
  });
});
