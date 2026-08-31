const { test, expect } = require("@playwright/test");
const {
  launchExtensionContext,
  dismissConsent,
  waitForOverlay,
  setPegmanCover
} = require("./helpers/maps-e2e");

// Forbidden City — Street View coverage exists on nearby roads.
const MAP =
  "https://www.google.com/maps/@39.9167135,116.3868853,16z";

test.describe("Street View coverage while pegman is dragged", () => {
  test("paints shifted svv tiles when pegman cover is active", async () => {
    const context = await launchExtensionContext();
    const page = await context.newPage();
    await page.goto(MAP, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await waitForOverlay(page);

    const before = await page.evaluate(() =>
      !!document.querySelector("#gcj02-aligner-root img[data-lyrs='svv']")
    );
    expect(before).toBe(false);

    await setPegmanCover(page, true);
    await page.waitForFunction(
      () => !!document.querySelector("#gcj02-aligner-root img[data-lyrs='svv']"),
      null,
      { timeout: 15000 }
    );

    await setPegmanCover(page, false);
    await page.waitForFunction(
      () => !document.querySelector("#gcj02-aligner-root img[data-lyrs='svv']"),
      null,
      { timeout: 15000 }
    );

    await context.close();
  });
});
