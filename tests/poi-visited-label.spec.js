const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const { WUZHANGYUAN } = require("./fixtures/overlay-landmarks");
const {
  launchExtensionContext,
  dismissConsent,
  setAlignerMode,
  waitForOverlay,
  waitForNativePois,
  ensureStreetLayer,
  overlayPoiScreen
} = require("./helpers/maps-e2e");

const OUT = path.join(__dirname, "..", "test-results", "visited-label");
const SEARCH_URL =
  "https://www.google.com/maps/search/%E4%BA%94%E4%B8%88%E5%8E%9F/@34.2820338,107.6089203,15z/data=!4m2!2m1!6e1!5m1!1e4";
const TOWN = WUZHANGYUAN.townPoi;
const VISITED_RE = /開啟過的連結|打开过的链接|Opened link|Previously visited/i;

// User flow: open 五丈原鎮, search 五丈原 again — Maps marks the town link as
// visited (aria often becomes「五丈原鎮：開啟過的連結」). Overlay must never
// paint that a11y suffix on the map pin.
test.describe("visited search hits keep clean POI names", () => {
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

  test("after opening 五丈原鎮 and re-searching, overlay labels stay clean", async () => {
    await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await setAlignerMode(context, page, "on");
    await waitForOverlay(page);
    await ensureStreetLayer(page);
    await waitForNativePois(page, WUZHANGYUAN.poiNeedles);
    await page.waitForTimeout(1200);

    // Open the town place (marks the result as visited in Maps).
    const opened = await page.evaluate((spec) => {
      const links = [...document.querySelectorAll('a[href*="/maps/place/"]')];
      const hit = links.find((a) => {
        const href = a.href || "";
        const m = href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
        if (m && Math.abs(+m[1] - spec.lat) < 1e-4 && Math.abs(+m[2] - spec.lon) < 1e-4) return true;
        return /五丈原鎮|Wuzhangyuanzhen/i.test(a.getAttribute("aria-label") || "");
      });
      if (!hit) return null;
      hit.click();
      return { href: hit.href, label: hit.getAttribute("aria-label") };
    }, TOWN);
    expect(opened, "town result link").toBeTruthy();
    await page.waitForTimeout(2800);

    // Search 五丈原 again (same framing the user reported).
    await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await setAlignerMode(context, page, "on");
    await waitForOverlay(page);
    await waitForNativePois(page, WUZHANGYUAN.poiNeedles);
    await page.waitForTimeout(1500);

    // Maps may already have set a visited aria-label; if the session did not,
    // apply the same strings Maps uses so the overlay collector is exercised.
    const applied = await page.evaluate((spec) => {
      const links = [...document.querySelectorAll('a[href*="/maps/place/"]')];
      const hit = links.find((a) => {
        const href = a.href || "";
        const m = href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
        if (m && Math.abs(+m[1] - spec.lat) < 1e-4 && Math.abs(+m[2] - spec.lon) < 1e-4) return true;
        return /%E9%8E%AE|五丈原鎮/.test(href + (a.getAttribute("aria-label") || ""));
      });
      if (!hit) return { ok: false };
      const before = hit.getAttribute("aria-label") || "";
      // Prefer keeping Maps' own visited label when present; otherwise inject it.
      if (!/開啟過的連結|Opened link/i.test(before)) {
        hit.setAttribute("aria-label", "五丈原鎮：開啟過的連結");
      }
      // Also poke a sibling-style no-colon form on a data attr the collector
      // does not read — the live aria is what matters. Force a mutation pass.
      hit.setAttribute("data-gcj02-visited-probe", String(Date.now()));
      return { ok: true, before, after: hit.getAttribute("aria-label") };
    }, TOWN);
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(VISITED_RE.test(applied.after), JSON.stringify(applied)).toBe(true);

    // Re-apply after any Maps re-render, then nudge the URL zoom so redraw
    // clears lastPoiKey and collectPoisFromDocument must re-read the dirty aria.
    await page.evaluate((spec) => {
      const links = [...document.querySelectorAll('a[href*="/maps/place/"]')];
      const hit = links.find((a) => {
        const href = a.href || "";
        const m = href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
        if (m && Math.abs(+m[1] - spec.lat) < 1e-4 && Math.abs(+m[2] - spec.lon) < 1e-4) return true;
        return /%E9%8E%AE|五丈原鎮/.test(href + (a.getAttribute("aria-label") || ""));
      });
      if (hit) hit.setAttribute("aria-label", "五丈原鎮：開啟過的連結");
      const href = location.href.replace(/,(\d+(?:\.\d+)?)z/, (_, z) => `,${(Number(z) + 0.01).toFixed(2)}z`);
      history.replaceState({}, "", href);
      window.dispatchEvent(new Event("popstate"));
    }, TOWN);
    await waitForOverlay(page);
    await page.waitForTimeout(1000);

    // Confirm the sidebar aria is still the visited form while overlay is clean.
    const sidebarAria = await page.evaluate((spec) => {
      const links = [...document.querySelectorAll('a[href*="/maps/place/"]')];
      const hit = links.find((a) => {
        const href = a.href || "";
        const m = href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
        return m && Math.abs(+m[1] - spec.lat) < 1e-4 && Math.abs(+m[2] - spec.lon) < 1e-4;
      });
      return hit?.getAttribute("aria-label") || "";
    }, TOWN);
    expect(VISITED_RE.test(sidebarAria), sidebarAria).toBe(true);

    const pins = await overlayPoiScreen(page);
    const labels = await page.locator(".gcj02-poi-label").allTextContents();
    const tips = await page.locator(".gcj02-poi-tooltip").allTextContents();
    const blob = [...pins.map((p) => p.text), ...labels, ...tips].join("\n");

    await page.screenshot({ path: path.join(OUT, "after-research.png"), fullPage: false });

    expect(pins.length, JSON.stringify(pins)).toBeGreaterThan(0);
    expect(blob, blob).not.toMatch(VISITED_RE);
    const townPin = pins.find((p) => /五丈原鎮|Wuzhangyuanzhen/i.test(p.text || ""));
    expect(townPin, JSON.stringify(pins)).toBeTruthy();
    expect(townPin.text, JSON.stringify(townPin)).not.toMatch(VISITED_RE);
    // Cleaned Chinese aria wins over an English /maps/place/Wuzhangyuanzhen/ slug.
    expect(townPin.text, JSON.stringify(townPin)).toMatch(/^五丈原鎮$/);
  });
});
