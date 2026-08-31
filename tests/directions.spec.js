const { test, expect } = require("@playwright/test");
const {
  launchExtensionContext,
  dismissConsent,
  waitForOverlay
} = require("./helpers/maps-e2e");

// Forbidden City Meridian Gate → Tiananmen, walking, satellite (user report).
const DIRECTIONS =
  "https://www.google.com/maps/dir/%E6%95%85%E5%AE%AE%E5%8D%88%E9%96%80+%E4%B8%AD%E5%9C%8B%E5%8C%97%E4%BA%AC%E5%B8%82%E4%B8%9C%E5%9F%8E%E5%8C%BA%E6%99%AF%E5%B1%B1%E5%89%8D%E8%A1%974%E5%8F%B7+%E9%82%AE%E6%94%BF%E7%BC%86%E7%A0%81:+100006/%E5%A4%A9%E5%AE%89%E9%96%80+%E4%B8%AD%E5%9C%8B%E5%8C%97%E4%BA%AC%E5%B8%82%E4%B8%9C%E5%9F%8E%E5%8C%BA+%E9%82%AE%E6%94%BF%E7%BC%86%E7%A0%81:+100051/@39.9112947,116.3947854,1180m/data=!3m2!1e3!4b1!4m14!4m13!1m5!1m1!1s0x35f052c194aa1469:0x82c6fcd5085ca28d!2m2!1d116.39721!2d39.9138664!1m5!1m1!1s0x36637698dc4374d9:0x6928cb83a148399a!2m2!1d116.3974799!2d39.9087202!3e2";

test.describe("directions with aligned satellite overlay", () => {
  test("keeps overlay on and paints a shifted blue route polyline", async () => {
    const context = await launchExtensionContext();
    const page = await context.newPage();
    await page.goto(DIRECTIONS, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await waitForOverlay(page);

    await page.waitForFunction(
      () => {
        const root = document.getElementById("gcj02-aligner-root");
        if (!root || root.style.display === "none") return false;
        if (root.dataset.layer !== "satellite") return false;
        const tiles = root.querySelectorAll(".gcj02-tile[data-lyrs='s'], .gcj02-road[data-lyrs='h']");
        if (tiles.length < 4) return false;
        const poly = root.querySelector(".gcj02-route polyline");
        const pts = poly?.getAttribute("points") || "";
        return pts.split(/\s+/).length >= 4;
      },
      null,
      { timeout: 45000 }
    );

    const info = await page.evaluate(() => {
      const root = document.getElementById("gcj02-aligner-root");
      const canvas = [...document.querySelectorAll("canvas")].find((c) => c.width > 500);
      const poly = root?.querySelector(".gcj02-route polyline");
      return {
        layer: root?.dataset.layer || "",
        routeSegments: root?.dataset.routeSegments || "0",
        pointCount: (poly?.getAttribute("points") || "").split(/\s+/).filter(Boolean).length,
        canvasHidden: canvas?.classList.contains("gcj02-hide-native") || false
      };
    });

    expect(info.layer).toBe("satellite");
    expect(Number(info.routeSegments)).toBeGreaterThan(0);
    expect(info.pointCount).toBeGreaterThan(3);
    expect(info.canvasHidden).toBe(true);

    await context.close();
  });
});
