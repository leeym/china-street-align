const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const { FORBIDDEN_CITY } = require("./fixtures/overlay-landmarks");
const {
  launchExtensionContext,
  dismissConsent,
  setAlignerMode,
  waitForOverlay,
  waitForNativePois,
  clearSearchHover,
  ensureStreetLayer
} = require("./helpers/maps-e2e");

const OUT = path.join(__dirname, "..", "test-results", "poi-desc");
const SEARCH_URL =
  "https://www.google.com/maps/search/%E7%B4%AB%E7%A6%81%E5%9F%8E/@39.9167135,116.3868853,15z/data=!4m2!2m1!6e1!5m1!1e4";

// Off hover tooltips show title + description (e.g. 故宮 / 附設博物館的 1420 年宮殿建築群).
// On must mirror both lines — never the star rating like「4.6(2,909)」.
test.describe("POI hover tooltip includes description", () => {
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

  test("on: 故宮 tooltip is title + description, not the star rating", async () => {
    await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await setAlignerMode(context, page, "on");
    await waitForOverlay(page);
    await ensureStreetLayer(page);
    await waitForOverlay(page);
    await waitForNativePois(page, FORBIDDEN_CITY.poiNeedles);
    await page.waitForFunction(() => {
      return [...document.querySelectorAll(".gcj02-poi-tooltip-desc")].some((el) => {
        const t = el.textContent || "";
        return /附設|宮殿|博物館|占地|佔地|大殿|palace|museum|complex|entrance/i.test(t)
          && !/^\d+(\.\d+)?/.test(t);
      });
    }, { timeout: 60000 });

    await clearSearchHover(page);
    const cards = await page.evaluate(() =>
      [...document.querySelectorAll(".gcj02-poi")].map((el) => ({
        title: el.querySelector(".gcj02-poi-tooltip-title")?.textContent || "",
        desc: el.querySelector(".gcj02-poi-tooltip-desc")?.textContent || "",
        aria: el.getAttribute("aria-label") || ""
      }))
    );
    const gugong = cards.filter((c) => /故宮|故宫|Palace/i.test(c.title));
    expect(gugong.length, JSON.stringify(cards)).toBeGreaterThan(0);
    expect(
      gugong.some((c) => c.desc && !/^\d+(\.\d+)?/.test(c.desc) && c.desc.length >= 6),
      JSON.stringify(gugong)
    ).toBeTruthy();
    expect(
      gugong.every((c) => !c.desc || !/^\d+(\.\d+)?\s*\(?[\d,]*\)?$/.test(c.desc.trim())),
      JSON.stringify(gugong)
    ).toBeTruthy();

    await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href*="/maps/place/"]')];
      const hit = links.find((a) => /故宮|故宫|Palace/i.test(a.getAttribute("aria-label") || ""));
      hit?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
    });
    await page.waitForTimeout(400);

    const hovered = page.locator(".gcj02-poi.is-hover").filter({
      has: page.locator(".gcj02-poi-tooltip-desc")
    }).first();
    await expect(hovered).toBeVisible({ timeout: 5000 });
    await expect(hovered.locator(".gcj02-poi-tooltip-title")).toHaveText(/故宮|故宫|Palace/i);
    const desc = ((await hovered.locator(".gcj02-poi-tooltip-desc").textContent()) || "").trim();
    expect(desc.length).toBeGreaterThan(5);
    expect(desc).not.toMatch(/^\d+(\.\d+)?/);
    expect(desc).not.toMatch(/^\d+(\.\d+)?\s*\([\d,]+\)$/);
    await page.screenshot({ path: path.join(OUT, "on-hover-gugong.png"), fullPage: false });
  });
});
