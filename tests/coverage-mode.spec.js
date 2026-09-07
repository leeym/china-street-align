"use strict";

const { test, expect } = require("@playwright/test");
const {
  launchExtensionContext,
  extensionId,
  dismissConsent,
  setModeViaPopup,
  waitForAlignMode,
  waitForCoverageMask,
  coverageTintStats
} = require("./helpers/maps-e2e");

// Bare @ URLs (no search/dir) so Maps keeps a plain street view while we tint.
const BEIJING_Z15 = "https://www.google.com/maps/@39.9042,116.4074,15z";
// 海門島 at ~z9.5: inside the China region gate but GCJ shift below visibility.
const HAIMEN_Z95 = "https://www.google.com/maps/@24.4064,117.9585,9.5z";
// Taipei: outside the China region gate — tint must stay clear.
const TAIPEI_Z14 = "https://www.google.com/maps/@25.033,121.5654,14z";

test.describe.serial("coverage mode tint", () => {
  test.setTimeout(180000);

  let context;
  let extId;
  let page;

  test.beforeAll(async () => {
    context = await launchExtensionContext();
    extId = await extensionId(context);
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("paints teal tint above the native map inside China", async () => {
    await page.goto(BEIJING_Z15, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await page.waitForTimeout(2000);

    await setModeViaPopup(context, extId, "coverage");
    await waitForAlignMode(page, "coverage");
    await waitForCoverageMask(page);

    const stats = await coverageTintStats(page);
    expect(stats.mode, JSON.stringify(stats)).toBe("coverage");
    expect(stats.zIndex, JSON.stringify(stats)).toBeGreaterThan(0);
    expect(stats.teal, JSON.stringify(stats)).toBeGreaterThan(1000);
    expect(stats.activeCells, JSON.stringify(stats)).toBeGreaterThan(100);
    // Native map stays visible — coverage must not hide canvases.
    const nativeHidden = await page.evaluate(
      () => document.querySelectorAll("canvas.gcj02-hide-native").length
    );
    expect(nativeHidden, "coverage must leave the native map visible").toBe(0);
  });

  test("paints amber where the region gate passes but shift is invisible", async () => {
    await page.goto(HAIMEN_Z95, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await page.waitForTimeout(1500);
    await waitForAlignMode(page, "coverage");
    await waitForCoverageMask(page);

    const stats = await coverageTintStats(page);
    expect(stats.mode, JSON.stringify(stats)).toBe("coverage");
    expect(stats.amber, JSON.stringify(stats)).toBeGreaterThan(500);
    expect(stats.regionCells, JSON.stringify(stats)).toBeGreaterThan(50);
    // At this zoom the visible-shift gate should dominate the center.
    expect(stats.amber, JSON.stringify(stats)).toBeGreaterThan(stats.teal);
  });

  test("stays clear over Taiwan (out of China region)", async () => {
    await page.goto(TAIPEI_Z14, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await page.waitForTimeout(1500);
    await waitForAlignMode(page, "coverage");
    await waitForCoverageMask(page);

    const stats = await coverageTintStats(page);
    expect(stats.mode, JSON.stringify(stats)).toBe("coverage");
    expect(stats.opaque, JSON.stringify(stats)).toBeLessThan(200);
    expect(stats.teal + stats.amber, JSON.stringify(stats)).toBeLessThan(200);
  });
});
