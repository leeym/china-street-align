const { test, expect } = require("@playwright/test");
const {
  launchExtensionContext,
  dismissConsent,
  waitForOverlay,
  waitForOverlaySvvPb,
  overlaySvvCyanPixels,
  setPegmanCover
} = require("./helpers/maps-e2e");

const SAT = "https://www.google.com/maps/@39.9167135,116.3868853,15z/data=!3m1!1e3";
const SAT_SV_URL =
  "https://www.google.com/maps/@39.9167135,116.3868853,15z/data=!3m1!1e3!5m1!1e5";

async function setStreetViewCover(page, on) {
  await page.evaluate((v) => {
    window.postMessage({ source: "gcj02-aligner", type: "setStreetViewCover", on: v }, "*");
  }, !!on);
  await page.waitForTimeout(400);
}

async function expectCyanSvv(page) {
  await waitForOverlaySvvPb(page, 30000);
  let cyan = 0;
  let last = {};
  for (let i = 0; i < 24; i++) {
    last = await overlaySvvCyanPixels(page);
    cyan = last.cyan;
    if (cyan > 50) break;
    await page.waitForTimeout(500);
  }
  expect(last.pb, JSON.stringify(last)).toBeGreaterThan(0);
  expect(cyan).toBeGreaterThan(50);
  await expect(page.locator("#gcj02-aligner-status")).toContainText("+svv");
}

test.describe("Street View coverage on aligned satellite", () => {
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

  test("URL !1e5 paints vt/pb svv with cyan pixels", async () => {
    await page.goto(SAT_SV_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await waitForOverlay(page);
    await expectCyanSvv(page);
  });

  test("Layers UI latch (no !1e5) paints svv on satellite", async () => {
    await page.goto(SAT, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await waitForOverlay(page);

    // Maps' Layers → Street View often omits !1e5; the content script latches
    // that state. Drive the same latch the UI click / aria-checked path uses.
    await setStreetViewCover(page, true);
    await expectCyanSvv(page);
  });

  test("aria-checked Street View control is picked up by the poll", async () => {
    await page.goto(SAT, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await waitForOverlay(page);

    await page.evaluate(() => {
      const el = document.createElement("button");
      el.setAttribute("jsaction", "layerswitcher.intent.streetview");
      el.setAttribute("aria-checked", "true");
      el.id = "gcj02-test-sv-layer";
      document.body.appendChild(el);
    });

    await page.waitForFunction(() => {
      const status = document.getElementById("gcj02-aligner-status")?.textContent || "";
      return /\+svv/.test(status);
    }, null, { timeout: 10000 });

    await page.evaluate(() => document.getElementById("gcj02-test-sv-layer")?.remove());
  });

  test("pegman-cover hook loads vt/pb svv tiles", async () => {
    await page.goto(SAT, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await waitForOverlay(page);
    await setPegmanCover(page, true);
    await expectCyanSvv(page);
    await setPegmanCover(page, false);
  });
});
