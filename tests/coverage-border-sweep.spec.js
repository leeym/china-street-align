"use strict";

const { test, expect } = require("@playwright/test");
const { BORDER_SWEEPS } = require("./fixtures/china-border-points");
const {
  launchExtensionContext,
  extensionId,
  dismissConsent,
  setModeViaPopup,
  waitForAlignMode,
  waitForCoverageMask,
  coverageTintStats
} = require("./helpers/maps-e2e");

// aligner-lib attaches to globalThis in Node — same gate the content script uses.
require("../aligner-lib.js");
const G = global.Gcj02Aligner;

async function coveragePaintStats(page) {
  return coverageTintStats(page);
}

test.describe.serial("coverage border sweep z>=7", () => {
  test.setTimeout(300000);

  let context;
  let extId;
  let page;

  test.beforeAll(async () => {
    context = await launchExtensionContext();
    extId = await extensionId(context);
    page = await context.newPage();
    await page.goto("https://www.google.com/maps/@35.0,110.0,5z", {
      waitUntil: "domcontentloaded",
      timeout: 120000
    });
    await dismissConsent(page);
    await page.waitForTimeout(1500);
    await setModeViaPopup(context, extId, "coverage");
    await waitForAlignMode(page, "coverage");
  });

  test.afterAll(async () => {
    await context?.close();
  });

  for (const sweep of BORDER_SWEEPS) {
    test(`${sweep.id}: region gate at z=7`, async () => {
      // Gate checks run in Node against the shared library (content-script world
      // does not expose Gcj02Aligner on window for page.evaluate).
      for (const s of sweep.clearSamples) {
        expect(
          G.outOfChina(s.lat, s.lon),
          `${sweep.id} clear ${s.lat},${s.lon}`
        ).toBe(true);
        expect(G.coverageClass(s.lat, s.lon, 7)).toBe("out");
      }
      for (const s of sweep.tintSamples) {
        expect(
          G.outOfChina(s.lat, s.lon),
          `${sweep.id} tint ${s.lat},${s.lon}`
        ).toBe(false);
        expect(G.coverageClass(s.lat, s.lon, 7)).not.toBe("out");
      }

      await page.goto(sweep.href, { waitUntil: "domcontentloaded", timeout: 120000 });
      await dismissConsent(page);
      await waitForAlignMode(page, "coverage");
      await waitForCoverageMask(page);

      const zoom = await page.evaluate(() => {
        const m = location.href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/);
        return m ? Number(m[3]) : 0;
      });
      expect(zoom, sweep.href).toBeGreaterThanOrEqual(7);

      const paint = await coveragePaintStats(page);
      expect(paint.mode).toBe("coverage");
      expect(paint.zIndex).toBeGreaterThan(0);

      if (sweep.expectTeal) {
        expect(
          paint.teal + paint.amber,
          JSON.stringify({ sweep: sweep.id, paint })
        ).toBeGreaterThan(500);
      }

      // Frames aimed at open sea / foreign land: the map center must stay clear
      // (z=7 still shows PRC coast on the western edge of a wide ECS view).
      if (sweep.id === "bengal-india" || sweep.id === "east-china-sea"
        || sweep.id === "philippine-sea" || sweep.id === "japan-narai") {
        const centerClear = await page.evaluate(() => {
          const root = document.getElementById("gcj02-aligner-root");
          const canvas = root && root.querySelector("canvas.gcj02-coverage");
          if (!canvas) return false;
          const ctx = canvas.getContext("2d");
          const x0 = Math.floor(canvas.width * 0.45);
          const x1 = Math.floor(canvas.width * 0.55);
          const y0 = Math.floor(canvas.height * 0.45);
          const y1 = Math.floor(canvas.height * 0.55);
          const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
          let opaque = 0;
          for (let i = 3; i < data.length; i += 4) {
            if (data[i] >= 8) opaque += 1;
          }
          const area = Math.max(1, (x1 - x0) * (y1 - y0));
          return opaque / area < 0.05;
        });
        expect(centerClear, JSON.stringify({ sweep: sweep.id, paint })).toBe(true);
      }
    });
  }
});
