const { test, expect } = require("@playwright/test");
const path = require("path");
require("../aligner-lib.js");
const lib = globalThis.Gcj02Aligner;
const { WUZHANGYUAN } = require("./fixtures/overlay-landmarks");
const {
  launchExtensionContext,
  dismissConsent,
  setAlignerMode,
  waitForOverlay,
  waitForOverlayOff,
  waitForNativePois,
  overlayAlignmentStats,
  overlayPoiScreen,
  collectPlaceSnapshot,
  nativePinScreenPx,
  ensureStreetLayer
} = require("./helpers/maps-e2e");

// Off mode leaves every search hit at the same screen pixel as you zoom in,
// because Google's `@` and its !3d/!4d pins are one datum. On mode used to
// center the overlay on the raw GCJ `@`, which slid the whole view — roads and
// pins together — by one GCJ offset. That offset is a pixel quantity, so it
// doubled per zoom level (107px at z15, 428px at z17) and the pins walked off
// toward the top-left. These tests measure On against a plain-mercator oracle
// so the overlay cannot grade its own homework.
test.describe("POIs hold their pixel across zoom", () => {
  /** @type {import('@playwright/test').BrowserContext} */
  let context;
  /** @type {import('@playwright/test').Page} */
  let page;
  /** @type {Array<{label:string, zoom:number, errors:Array<{name:string, err:number}>}>} */
  const perZoom = [];
  // Both framings, every zoom the user reported, flattened into one sweep.
  const STEPS = WUZHANGYUAN.zoomSets.flatMap((set) =>
    set.steps.map((step) => ({ ...step, label: `${set.id}-z${step.zoom}` }))
  );

  test.beforeAll(async () => {
    context = await launchExtensionContext();
    page = context.pages()[0] || await context.newPage();
    if (!context.serviceWorkers()[0]) {
      await context.waitForEvent("serviceworker", { timeout: 20000 }).catch(() => {});
    }
  });

  test.afterAll(async () => {
    await context?.close();
  });

  for (const step of STEPS) {
    test(`${step.label} On POIs land on the Off pin pixel`, async () => {
      await page.goto("about:blank");
      await page.goto(step.href, { waitUntil: "domcontentloaded", timeout: 120000 });
      await dismissConsent(page);
      await setAlignerMode(context, page, "off");
      await waitForOverlayOff(page);
      await ensureStreetLayer(page);
      await waitForNativePois(page, WUZHANGYUAN.poiNeedles);

      await setAlignerMode(context, page, "on");
      await waitForOverlay(page);
      await page.waitForTimeout(1500);

      const stats = await overlayAlignmentStats(page);
      expect(stats.mode, JSON.stringify(stats)).toBe("on");
      expect(stats.layer).toBe("map");

      const snap = await collectPlaceSnapshot(page);
      const st = lib.parseMapHref(snap.href);
      expect(st, snap.href).toBeTruthy();
      expect(Math.round(st.zoom)).toBe(step.zoom);

      // The overlay must be centered on the WGS-84 twin of the URL `@`, not on
      // the raw GCJ value. At 五丈原 that is ~0.0046° of longitude.
      const wgsCam = lib.gcjToWgs(st.lat, st.lon);
      expect(
        Math.abs(snap.camLon - wgsCam.lon),
        `overlay camera must be gcjToWgs(@): ${JSON.stringify({ snap, wgsCam })}`
      ).toBeLessThan(1e-5);
      expect(Math.abs(snap.camLon - st.lon)).toBeGreaterThan(1e-4);

      const pois = lib.collectPoisFromAnchors(snap.anchors);
      expect(pois.length, JSON.stringify(snap.anchors.slice(0, 2))).toBeGreaterThan(0);
      const drawn = await overlayPoiScreen(page);
      expect(drawn.length).toBeGreaterThan(0);

      const shift = lib.overlayShiftPx(st.lat, st.lon, st.zoom);
      const errors = [];
      const measured = [];
      for (const poi of pois) {
        const el = drawn.find((d) => d.text === poi.name);
        if (!el) continue;
        const oracle = nativePinScreenPx(poi.lat, poi.lon, st, snap.width, snap.height);
        errors.push({
          name: poi.name,
          err: Math.hypot(el.left - oracle.x, el.top - oracle.y),
          // Distance from the pre-fix placement: one whole camera GCJ offset.
          fromBug: Math.hypot(el.left - (oracle.x + shift.dx), el.top - (oracle.y + shift.dy)),
          why: JSON.stringify({ zoom: step.zoom, poi, el, oracle, shift })
        });
        measured.push(poi.name);
      }
      // Record before asserting so the growth test still has data on failure.
      perZoom.push({ label: step.label, zoom: step.zoom, errors });
      expect(measured.length, JSON.stringify({ pois, drawn })).toBeGreaterThan(0);
      for (const e of errors) {
        expect(e.err, `On pin must not move off the Off pin: ${e.why}`).toBeLessThan(12);
        expect(e.fromBug, `On pin carries the camera GCJ offset: ${e.why}`).toBeGreaterThan(20);
      }

      await page.screenshot({
        path: path.join(__dirname, "..", "test-results", `wuzhangyuan-on-${step.label}.png`),
        fullPage: false
      });
    });
  }

  test("the placement error does not grow with zoom", async () => {
    expect(perZoom.length, "zoom cases must have run").toBe(STEPS.length);
    const worst = (r) => Math.max(...r.errors.map((e) => e.err));
    const summary = perZoom.map((r) => ({ label: r.label, worst: Number(worst(r).toFixed(2)) }));
    const spread = Math.max(...summary.map((s) => s.worst)) - Math.min(...summary.map((s) => s.worst));
    // The old bug doubled the error every level; a camera-datum regression shows
    // up here even if a loose per-zoom tolerance were to let it pass.
    expect(spread, `placement error varies with zoom: ${JSON.stringify(summary)}`).toBeLessThan(6);
  });
});
