const { test, expect } = require("@playwright/test");
const {
  launchExtensionContext,
  dismissConsent,
  setAlignerMode
} = require("./helpers/maps-e2e");
const { XIAMEN_XINGLIN, DUISHAN } = require("./fixtures/overlay-landmarks");
require("../aligner-lib.js");
const lib = globalThis.Gcj02Aligner;

// "satellite" mode: keep the native Maps canvas — so POIs, labels, routes,
// terrain and hit-testing stay exactly as they are outside China — and slide the
// WGS-84 photo under it instead of repainting the GCJ world ourselves.
const MAP_URL = DUISHAN.mapHref;

async function extensionId(context) {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 30000 });
  return new URL(sw.url()).host;
}

async function setModeViaPopup(context, id, mode) {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator(`input[value="${mode}"]`).check();
  await expect(popup.locator(`input[value="${mode}"]`)).toBeChecked();
  await popup.waitForTimeout(300);
  await popup.close();
}

async function waitForImageryLayer(page) {
  await page.waitForFunction(() => {
    const root = document.getElementById("gcj02-aligner-root");
    if (!root || root.style.display === "none") return false;
    if (root.dataset.alignMode !== "satellite") return false;
    const tiles = [...root.querySelectorAll('.gcj02-tile[data-lyrs="s"]')];
    return tiles.length > 0 && tiles.some((img) => img.complete && img.naturalWidth >= 256);
  }, null, { timeout: 120000 });
}

async function blendStats(page) {
  // The content script lives in an isolated world, so Gcj02Aligner is not
  // reachable from page.evaluate — read the DOM here, do the math in Node.
  const raw = await page.evaluate(() => {
    const root = document.getElementById("gcj02-aligner-root");
    const blended = [...document.querySelectorAll("canvas.gcj02-blend-native")];
    return {
      href: location.href,
      alignMode: root?.dataset.alignMode || "",
      layer: root?.dataset.layer || "",
      mode: root?.dataset.mode || "",
      camLat: Number(root?.dataset.camLat || NaN),
      camLon: Number(root?.dataset.camLon || NaN),
      offsetPx: Number(root?.dataset.offsetPx || 0),
      satTiles: root ? root.querySelectorAll('.gcj02-tile[data-lyrs="s"]').length : 0,
      loadedSatTiles: root
        ? [...root.querySelectorAll('.gcj02-tile[data-lyrs="s"]')]
          .filter((i) => i.complete && i.naturalWidth >= 256).length
        : 0,
      // Everything below must be zero: it is all native in this mode.
      overlayRoads: root ? root.querySelectorAll(".gcj02-road").length : 0,
      overlayShade: root ? root.querySelectorAll(".gcj02-shade").length : 0,
      overlayPois: root ? root.querySelectorAll(".gcj02-poi").length : 0,
      overlayRoutes: root ? root.querySelectorAll(".gcj02-route").length : 0,
      hiddenNative: document.querySelectorAll(".gcj02-hide-native").length,
      blendedCanvases: blended.length,
      blendModes: blended.map((c) => getComputedStyle(c).mixBlendMode),
      blendBackgrounds: blended.map((c) => getComputedStyle(c).backgroundColor),
      panFilter: root ? getComputedStyle(root.querySelector(".gcj02-aligner-pan")).filter : "",
      nativeCanvasesVisible: [...document.querySelectorAll("canvas")].filter((c) => {
        const r = c.getBoundingClientRect();
        const cs = getComputedStyle(c);
        return r.width * r.height > 80000 && cs.visibility !== "hidden" && cs.opacity !== "0";
      }).length
    };
  });
  const st = lib.parseMapHref(raw.href);
  const cam = st ? lib.imageryCamera(st.lat, st.lon) : null;
  return Object.assign(raw, {
    expectCamLat: cam ? cam.lat : NaN,
    expectCamLon: cam ? cam.lon : NaN
  });
}

test.describe.serial("satellite mode: shift the photo, keep native Maps", () => {
  let context;
  let page;
  let extId;

  test.beforeAll(async () => {
    context = await launchExtensionContext();
    extId = await extensionId(context);
    page = await context.newPage();
    // Count documents so a test can prove the basemap switch did not reload.
    await page.addInitScript(() => {
      const n = Number(sessionStorage.getItem("gcjDocSeq") || 0) + 1;
      sessionStorage.setItem("gcjDocSeq", String(n));
      window.__docSeq = n;
    });
    await page.goto(MAP_URL, { waitUntil: "domcontentloaded" });
    await dismissConsent(page);
    await page.waitForTimeout(4000);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("keeps every native layer on screen and blends aligned imagery under it", async () => {
    await setAlignerMode(context, page, "satellite");
    await waitForImageryLayer(page);
    const s = await blendStats(page);

    expect(s.alignMode).toBe("satellite");
    expect(s.layer).toBe("imagery");
    expect(s.mode).toBe("on");
    // The whole point: nothing native is hidden and nothing is repainted by us.
    expect(s.hiddenNative).toBe(0);
    expect(s.nativeCanvasesVisible).toBeGreaterThan(0);
    expect(s.overlayRoads).toBe(0);
    expect(s.overlayShade).toBe(0);
    expect(s.overlayPois).toBe(0);
    expect(s.overlayRoutes).toBe(0);
    // Only WGS-84 satellite raster, actually loaded.
    expect(s.satTiles).toBeGreaterThan(0);
    expect(s.loadedSatTiles).toBeGreaterThan(0);
    // Maps paints its canvas opaque and gives it an opaque black CSS
    // background; both have to go or the photo never shows through.
    expect(s.blendedCanvases).toBeGreaterThan(0);
    for (const m of s.blendModes) expect(m).toBe("multiply");
    for (const bg of s.blendBackgrounds) expect(bg).toBe("rgba(0, 0, 0, 0)");
    expect(s.panFilter).toContain("brightness");
    // Imagery camera is gcjToWgs(@) — that shift IS the alignment.
    expect(Math.abs(s.camLat - s.expectCamLat)).toBeLessThan(1e-5);
    expect(Math.abs(s.camLon - s.expectCamLon)).toBeLessThan(1e-5);
    expect(s.offsetPx).toBeGreaterThan(20);
  });

  test("switching back to streets mode restores the hidden-canvas overlay", async () => {
    await setAlignerMode(context, page, "streets");
    await page.waitForFunction(() => {
      const root = document.getElementById("gcj02-aligner-root");
      return !!root
        && root.dataset.alignMode === "streets"
        && document.querySelectorAll("canvas.gcj02-hide-native").length > 0;
    }, null, { timeout: 60000 });
    const s = await blendStats(page);
    expect(s.alignMode).toBe("streets");
    expect(s.blendedCanvases).toBe(0);
    expect(s.hiddenNative).toBeGreaterThan(0);
  });

  test("switches Maps off its own satellite basemap without a reload, and it sticks", async () => {
    // Maps stores the basemap as a user preference: it re-adds `data=!3m1!1e3`
    // on the next navigation, so rewriting the URL and reloading loses the race
    // and leaves our shifted photo multiplied under Google's unshifted one —
    // i.e. the misalignment this extension exists to remove. Clicking Maps' own
    // corner toggle switches the basemap AND updates the preference.
    await setModeViaPopup(context, extId, "satellite");
    await page.goto(XIAMEN_XINGLIN.href, { waitUntil: "domcontentloaded" });
    await dismissConsent(page);
    await page.waitForFunction(() => /!3m1!1e3|%213m1%211e3|1e3/.test(location.href), null, { timeout: 30000 })
      .catch(() => {});
    const seqBefore = await page.evaluate(() => window.__docSeq);

    await page.waitForFunction(
      () => !/!3m1!1e3|%213m1%211e3/.test(location.href),
      null,
      { timeout: 60000 }
    );
    // Same document: the basemap changed through Maps' UI, not a navigation.
    expect(await page.evaluate(() => window.__docSeq)).toBe(seqBefore);

    await waitForImageryLayer(page);
    const s = await blendStats(page);
    expect(s.href).not.toMatch(/!3m1!1e3/);
    expect(s.alignMode).toBe("satellite");
    expect(s.hiddenNative).toBe(0);
    expect(s.blendedCanvases).toBeGreaterThan(0);
    expect(s.loadedSatTiles).toBeGreaterThan(0);

    // And the preference stuck: a plain map URL must not come back as satellite.
    await page.goto(DUISHAN.mapHref, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(9000);
    expect(page.url()).not.toMatch(/!3m1!1e3/);
    await waitForImageryLayer(page);
    const after = await blendStats(page);
    expect(after.hiddenNative).toBe(0);
    expect(after.blendedCanvases).toBeGreaterThan(0);
  });

  test("the imagery layer follows a pointer drag so it stays glued to the canvas", async () => {
    // Maps pans its own canvas live and only commits `@` on release, so the
    // photo underneath has to travel with the pointer or it tears away from the
    // streets mid-drag.
    const box = await page.evaluate(() => {
      const r = document.getElementById("gcj02-aligner-root").getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x - 120, box.y - 80, { steps: 10 });
    const during = await page.evaluate(() => {
      const pan = document.querySelector("#gcj02-aligner-root .gcj02-aligner-pan");
      const m = new DOMMatrixReadOnly(getComputedStyle(pan).transform);
      return { dx: m.m41, dy: m.m42 };
    });
    await page.mouse.up();
    expect(Math.round(during.dx)).toBe(-120);
    expect(Math.round(during.dy)).toBe(-80);
    // After Maps commits the new camera the layer re-centres (no leftover shove).
    await page.waitForFunction(() => {
      const pan = document.querySelector("#gcj02-aligner-root .gcj02-aligner-pan");
      if (!pan) return false;
      const m = new DOMMatrixReadOnly(getComputedStyle(pan).transform);
      return Math.abs(m.m41) < 1 && Math.abs(m.m42) < 1;
    }, null, { timeout: 30000 });
    const s = await blendStats(page);
    expect(s.alignMode).toBe("satellite");
    expect(s.hiddenNative).toBe(0);
    expect(s.loadedSatTiles).toBeGreaterThan(0);
    expect(Math.abs(s.camLat - s.expectCamLat)).toBeLessThan(1e-5);
    expect(Math.abs(s.camLon - s.expectCamLon)).toBeLessThan(1e-5);
  });
});
