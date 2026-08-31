const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const {
  launchExtensionContext,
  dismissConsent,
  setAlignerMode,
  waitForOverlay
} = require("./helpers/maps-e2e");

const OUT = path.join(__dirname, "..", "test-results", "place-tooltip");
const PLACE_URL =
  "https://www.google.com/maps/place/%E4%B8%AD%E5%9C%8B%E5%8C%97%E4%BA%AC%E5%B8%82%E6%9D%B1%E5%9F%8E%E5%8D%80%E6%95%85%E5%AE%AE+%E9%82%AE%E6%94%BF%E7%BC%96%E7%A0%81:+100006/@39.9167053,116.3874432,16z/data=!4m11!1m3!2m2!1z57Sr56aB5Z-O!6e1!3m6!1s0x35f052c2676bdac5:0xf9f4cac0052a1c7f!8m2!3d39.916698!4d116.397185!15sCgnntKvnpoHln46SAQxuZWlnaGJvcmhvb2TgAQA!16s%2Fg%2F1tftv3pk!5m1!1e4";

test.describe("place-page POI titles stay short and clean", () => {
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

  test("postal-address place path does not become the pin title", async () => {
    await page.goto(PLACE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await setAlignerMode(context, page, "on");
    await waitForOverlay(page);
    await page.waitForFunction(() => {
      const root = document.getElementById("gcj02-aligner-root");
      return root && root.querySelectorAll(".gcj02-poi").length > 0;
    }, { timeout: 60000 });
    await page.waitForTimeout(1000);

    const cards = await page.evaluate(() =>
      [...document.querySelectorAll(".gcj02-poi")].map((el) => ({
        aria: el.getAttribute("aria-label") || "",
        title: el.querySelector(".gcj02-poi-tooltip-title")?.textContent || "",
        desc: el.querySelector(".gcj02-poi-tooltip-desc")?.textContent || ""
      }))
    );
    await page.screenshot({ path: path.join(OUT, "place-on.png"), fullPage: false });

    expect(cards.length, JSON.stringify(cards)).toBeGreaterThan(0);
    expect(
      cards.every((c) => !/郵政編碼|邮政编码|100006|開啟過的連結|Opened link/i.test(`${c.aria}\n${c.title}\n${c.desc}`)),
      JSON.stringify(cards)
    ).toBeTruthy();
    expect(
      cards.some((c) => /故宮|故宫|Palace/i.test(c.title)),
      JSON.stringify(cards)
    ).toBeTruthy();

    // Force a visited-style aria on a 故宮 result and rebuild.
    await page.evaluate(() => {
      const a = [...document.querySelectorAll('a[href*="/maps/place/"]')].find((el) =>
        /故宮|故宫/.test(el.getAttribute("aria-label") || "")
      );
      if (a) {
        a.setAttribute("aria-label", "故宮 開啟過的連結");
        const art = a.closest("[role=article]");
        if (art) {
          // Ensure article text also carries the visited form for description extract.
          art.setAttribute("data-gcj02-probe", "1");
        }
      }
      const href = location.href.replace(/,(\d+(?:\.\d+)?)z/, (_, z) => `,${(Number(z) + 0.01).toFixed(2)}z`);
      history.replaceState({}, "", href);
      window.dispatchEvent(new Event("popstate"));
    });
    await waitForOverlay(page);
    await page.waitForTimeout(1000);

    const after = await page.evaluate(() =>
      [...document.querySelectorAll(".gcj02-poi")].map((el) => ({
        aria: el.getAttribute("aria-label") || "",
        title: el.querySelector(".gcj02-poi-tooltip-title")?.textContent || "",
        desc: el.querySelector(".gcj02-poi-tooltip-desc")?.textContent || ""
      }))
    );
    expect(
      after.every((c) => !/開啟過的連結|Opened link|郵政編碼|邮政编码|100006/i.test(`${c.aria}\n${c.title}\n${c.desc}`)),
      JSON.stringify(after)
    ).toBeTruthy();
  });
});
