const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

require("../../aligner-lib.js");
const lib = globalThis.Gcj02Aligner;
const rootDir = path.join(__dirname, "..", "..");
const contentJs = fs.readFileSync(path.join(rootDir, "content.js"), "utf8");
const contentCss = fs.readFileSync(path.join(rootDir, "content.css"), "utf8");

describe("CORE: WGS satellite, GCJ layers shift in China", () => {
  // Product rules (do not weaken):
  // 1. Satellite and terrain relief are WGS-84 — never CSS-shift or remap `s`/`t`.
  // 2. Streets, POIs, and other overlays are GCJ-02 — inside China,
  //    translate them onto the WGS-84 camera with one camera overlayShiftPx.
  //    Search POIs are canvas-painted by Maps (not DOM), so On redraws icon+label
  //    at Off GCJ mercator plus that same rigid camera vector.
  //    Terrain: shifted `m` + unshifted shade `t` + shifted `h` (never shifted `p` —
  //    that makes X235 climb the west 五丈原 cliff instead of the valley).
  const { XIAMEN_XINGLIN, WUZHANGYUAN } = require("../fixtures/overlay-landmarks");

  it("never transforms satellite base tiles (WGS-84 stays put)", () => {
    const href = XIAMEN_XINGLIN.href;
    const spec = lib.overlaySpec(href);
    assert.deepEqual(spec.baseLyrs, ["s"]);
    assert.match(
      contentJs,
      /placeTile\("gcj02-tile", lyrs, left, top, tileSize, "", wx, ty, zTile\)/
    );
    assert.doesNotMatch(
      contentJs,
      /placeTile\("gcj02-tile", lyrs, left, top, tileSize, shift\(/
    );
  });

  it("never transforms terrain shade tiles (WGS-84 stays put)", () => {
    // Hybrid no longer paints terrain overlay; shade CSS remains for any future use.
    const spec = lib.overlaySpec("https://www.google.com/maps/@34.25,107.62,15z/data=!5m1!1e4");
    assert.equal(spec.nativeOnly, true);
    assert.match(contentCss, /gcj02-shade/);
    assert.match(contentJs, /placeTile\("gcj02-shade"/);
  });

  it("always CSS-shifts hybrid label tiles onto WGS satellite inside China", () => {
    assert.equal(lib.overlaySpec(XIAMEN_XINGLIN.href).roadLyrs, "h");
    assert.equal(lib.overlaySpec("https://www.google.com/maps/@24.6,118.07,16z").nativeOnly, true);
    assert.equal(
      lib.overlaySpec("https://www.google.com/maps/@24.6,118.07,16z/data=!5m1!1e4").nativeOnly,
      true
    );
    assert.match(contentJs, /const roadShift = shift\(sample\.dx, sample\.dy\)/);
    assert.match(
      contentJs,
      /placeTile\(\s*hasBase \? "gcj02-road" : "gcj02-tile",\s*spec\.roadLyrs, left, top, tileSize, roadShift, wx, ty, zTile\s*\)/
    );
    assert.match(
      contentJs,
      /placeTile\("gcj02-road", lyrs, left, top, tileSize, roadShift, wx, ty, zTile\)/
    );
    assert.doesNotMatch(contentJs, /overlayShiftPx\(ll\.lat/);
    assert.doesNotMatch(contentJs, /shiftRoads/);
    assert.doesNotMatch(contentJs, /overlayRoadTile\(/);
  });

  it("plots overlay POIs with the camera street shift (not a 2× hack)", () => {
    const poi = WUZHANGYUAN.samplePoi;
    const cam = { lat: WUZHANGYUAN.lat, lon: WUZHANGYUAN.lon };
    // The overlay world is WGS-84, so its camera is the WGS twin of the URL `@`.
    const camW = lib.overlayCamera(cam.lat, cam.lon);
    const center = lib.worldPixel(camW.lat, camW.lon, 15);
    const raw = lib.worldPixel(poi.lat, poi.lon, 15);
    const wgs = lib.gcjToWgs(poi.lat, poi.lon);
    const shift = lib.overlayShiftPx(camW.lat, camW.lon, 15);
    const plotted = lib.overlayPoiScreenPx(poi.lat, poi.lon, cam.lat, cam.lon, 15, 1440, 900);
    const unshifted = { x: raw.x - center.x + 720, y: raw.y - center.y + 450 };
    assert.ok(Math.abs(plotted.x - (unshifted.x + shift.dx)) < 1);
    assert.ok(Math.abs(plotted.y - (unshifted.y + shift.dy)) < 1);
    assert.equal(plotted.dx, shift.dx);
    assert.equal(plotted.dy, shift.dy);
    assert.ok(Math.abs(plotted.x - (unshifted.x + 2 * shift.dx)) > 40, "must not use the 2× easting hack");
    assert.equal(plotted.lat, wgs.lat);
    assert.equal(plotted.lon, wgs.lon);
    assert.ok(plotted.lat < WUZHANGYUAN.poiWgsSouthOfG310Lat);
    assert.ok(plotted.lon < WUZHANGYUAN.poiWgsWestOfX235Lon);
    assert.doesNotMatch(
      fs.readFileSync(path.join(rootDir, "aligner-lib.js"), "utf8"),
      /2 \* s\.dx|2 \* \(wgs\.lon/
    );
    assert.match(contentJs, /overlayPoiScreenPx\(/);
    assert.match(contentJs, /const roadShift = shift\(sample\.dx, sample\.dy\)/);
    assert.match(contentCss, /\.gcj02-poi-label/);
  });

  it("treats DMS/decimal place paths as WGS-84 (太和殿 lat/lon query)", () => {
    const { FORBIDDEN_CITY } = require("../fixtures/overlay-landmarks");
    const t = FORBIDDEN_CITY.taihedianWgs;
    assert.equal(lib.isLatLonPlaceName("39°54'57.0\"N 116°23'26.0\"E"), true);
    assert.equal(lib.isLatLonPlaceName("39.9158333,116.3905556"), true);
    assert.equal(lib.isLatLonPlaceName("紫禁城"), false);
    assert.equal(lib.urlCoordsAreWgs84(t.href), true);
    assert.equal(lib.urlCoordsAreWgs84(t.satHref), true);
    assert.equal(lib.urlCoordsAreWgs84(FORBIDDEN_CITY.mapHref), false);

    const taihe = "https://www.google.com/maps/place/%E5%A4%AA%E5%92%8C%E6%AE%BF/@39.917273,116.3970962,17z";
    assert.equal(lib.placeNeedsAlignedPin(taihe, false), false);
    assert.equal(lib.placeNeedsAlignedPin(taihe, true), true);
    assert.equal(lib.placeNeedsAlignedPin(t.href, false), true);
    assert.equal(lib.placeNeedsAlignedPin(t.href, true), false);

    const cam = lib.overlayCamera(t.lat, t.lon, { wgs84: true });
    assert.equal(cam.lat, t.lat);
    assert.equal(cam.lon, t.lon);
    const wrong = lib.overlayCamera(t.lat, t.lon);
    assert.ok(wrong.lon < t.lon - 0.002, "gcjToWgs of WGS slides west of 太和殿");

    const plotted = lib.overlayPoiScreenPx(
      t.lat, t.lon, t.lat, t.lon, 17, 1280, 720, { wgs84: true }
    );
    assert.equal(plotted.dx, 0);
    assert.equal(plotted.dy, 0);
    assert.equal(plotted.lat, t.lat);
    assert.equal(plotted.lon, t.lon);
    // Framed on the pin: screen centre.
    assert.ok(Math.abs(plotted.x - 640) < 1, JSON.stringify(plotted));
    assert.ok(Math.abs(plotted.y - 360) < 1, JSON.stringify(plotted));
    assert.ok(plotted.lon > t.palaceAxisLon - 0.001);

    const slid = lib.overlayPoiScreenPx(t.lat, t.lon, t.lat, t.lon, 17, 1280, 720);
    assert.ok(slid.lon < t.palaceAxisLon, "legacy GCJ path must not be used for this URL");
    assert.match(contentJs, /urlCoordOpts/);
    assert.match(contentJs, /urlCoordsAreWgs84/);
  });

  it("keeps POI↔street shift vector identical across zoom levels", () => {
    const poi = WUZHANGYUAN.samplePoi;
    const cams = [
      { z: 15, lat: 34.2820186, lon: 107.6089231 },
      { z: 16, lat: 34.2820184, lon: 107.6140729 },
      { z: 17, lat: 34.2820183, lon: 107.6166478 }
    ];
    const wgs = lib.gcjToWgs(poi.lat, poi.lon);
    let prevBearing = null;
    for (const cam of cams) {
      const camW = lib.overlayCamera(cam.lat, cam.lon);
      const shift = lib.overlayShiftPx(camW.lat, camW.lon, cam.z);
      const plotted = lib.overlayPoiScreenPx(poi.lat, poi.lon, cam.lat, cam.lon, cam.z, 1280, 720);
      const center = lib.worldPixel(camW.lat, camW.lon, cam.z);
      const raw = lib.worldPixel(poi.lat, poi.lon, cam.z);
      const unshifted = { x: raw.x - center.x + 640, y: raw.y - center.y + 360 };
      assert.ok(Math.abs(plotted.x - (unshifted.x + shift.dx)) < 1, `z=${cam.z} x`);
      assert.ok(Math.abs(plotted.y - (unshifted.y + shift.dy)) < 1, `z=${cam.z} y`);
      assert.ok(Math.abs(plotted.dx / plotted.dy - shift.dx / shift.dy) < 1e-9);
      assert.ok(Math.abs(plotted.lat - wgs.lat) < 1e-9);
      assert.ok(Math.abs(plotted.lon - wgs.lon) < 1e-9);
      const town = { lat: 34.282017, lon: 107.61922 };
      const a = lib.overlayPoiScreenPx(poi.lat, poi.lon, cam.lat, cam.lon, cam.z, 1280, 720);
      const b = lib.overlayPoiScreenPx(town.lat, town.lon, cam.lat, cam.lon, cam.z, 1280, 720);
      const bearing = Math.atan2(b.y - a.y, b.x - a.x);
      if (prevBearing != null) {
        let d = Math.abs(bearing - prevBearing);
        if (d > Math.PI) d = 2 * Math.PI - d;
        assert.ok(d < 0.05, `z=${cam.z} POI pair bearing drifted ${d}`);
      }
      prevBearing = bearing;
    }
  });

  it("strips Google Maps visited-link aria-label suffixes from POI names", () => {
    assert.equal(lib.cleanPoiName("五丈原:開啟過的連結"), "五丈原");
    assert.equal(lib.cleanPoiName("五丈原：打开过的链接"), "五丈原");
    assert.equal(lib.cleanPoiName("Wuzhangyuan:Opened link"), "Wuzhangyuan");
    assert.equal(lib.cleanPoiName("五丈原 · 旅遊景點"), "五丈原");
    assert.equal(lib.cleanPoiName("結果"), "");
    assert.equal(lib.cleanPoiName("Results"), "");
    // Maps sometimes concatenates with no colon, or uses uncommon colon glyphs / ZWSP.
    assert.equal(lib.cleanPoiName("五丈原鎮開啟過的連結"), "五丈原鎮");
    assert.equal(lib.cleanPoiName("五丈原鎮：開啟過的連結"), "五丈原鎮");
    assert.equal(lib.cleanPoiName("五丈原鎮﹕開啟過的連結"), "五丈原鎮");
    assert.equal(lib.cleanPoiName("五丈原鎮\u200b：開啟過的連結"), "五丈原鎮");
    assert.equal(lib.cleanPoiName("五丈原鎮 Opened link"), "五丈原鎮");
    assert.equal(
      lib.placeNameFromHref(
        "https://www.google.com/maps/place/%E4%BA%94%E4%B8%88%E5%8E%9F/data=!8m2!3d34.28!4d107.61"
      ),
      "五丈原"
    );
    const pois = lib.collectPoisFromAnchors([
      {
        href: "https://www.google.com/maps/place/%E4%BA%94%E4%B8%88%E5%8E%9F/data=!8m2!3d34.28!4d107.61",
        label: "結果"
      },
      {
        href: "https://www.google.com/maps/place/%E4%BA%94%E4%B8%88%E5%8E%9F%E9%8E%AE/data=!8m2!3d34.282017!4d107.61922",
        label: "五丈原鎮：開啟過的連結"
      }
    ]);
    assert.equal(pois[0].name, "五丈原");
    assert.equal(pois[1].name, "五丈原鎮");
    const noColon = lib.collectPoisFromAnchors([
      {
        href: "https://www.google.com/maps/place/%E4%BA%94%E4%B8%88%E5%8E%9F%E9%8E%AE/data=!8m2!3d34.282017!4d107.61922",
        label: "五丈原鎮開啟過的連結"
      }
    ]);
    assert.equal(noColon[0].name, "五丈原鎮");
  });

  it("shortens postal-address place paths and drops visited lines as descriptions", () => {
    const addr = "中國北京市東城區故宮 邮政编码: 100006";
    assert.equal(lib.isAddressLikePlaceTitle(addr), true);
    assert.equal(lib.shortPlaceTitleFromPath(addr), "故宮");
    assert.equal(
      lib.shortPlaceTitleFromPath("中國北京市東城區故宮+邮政编码:+100006"),
      "故宮"
    );
    assert.equal(
      lib.extractPoiDescription(
        "故宮",
        "故宮\n故宮 開啟過的連結\n4.6\n旅遊景點\n附設博物館的 1420 年宮殿建築群"
      ),
      "附設博物館的 1420 年宮殿建築群"
    );
    assert.equal(
      lib.extractPoiDescription("故宮", "故宮\n故宮：開啟過的連結\n旅遊景點\n已打烊"),
      ""
    );
    const pois = lib.collectPoisFromAnchors([
      {
        href: "https://www.google.com/maps/place/%E4%B8%AD%E5%9C%8B%E5%8C%97%E4%BA%AC%E5%B8%82%E6%9D%B1%E5%9F%8E%E5%8D%80%E6%95%85%E5%AE%AE+%E9%82%AE%E6%94%BF%E7%BC%96%E7%A0%81:+100006/@39.916698,116.397185,16z/data=!8m2!3d39.916698!4d116.397185",
        label: "結果"
      },
      {
        href: "https://www.google.com/maps/place/%E6%95%85%E5%AE%AE/data=!8m2!3d39.9168!4d116.3971",
        label: "故宮",
        article: "故宮\n故宮 開啟過的連結\n4.6\n旅遊景點\n附設博物館的 1420 年宮殿建築群\n已打烊"
      }
    ]);
    assert.equal(pois[0].name, "故宮");
    assert.ok(!/郵政|邮政|100006/.test(pois[0].name));
    assert.equal(pois[1].name, "故宮");
    assert.equal(pois[1].description, "附設博物館的 1420 年宮殿建築群");
    assert.ok(!/開啟過的連結/.test(pois[1].description));
    assert.match(contentJs, /shortPlaceTitleFromPath/);
    assert.match(contentJs, /isAddressLikePlaceTitle/);
  });

  it("extracts the sidebar description blurb under a search hit", () => {
    const article = [
      "故宮",
      "故宮",
      "4.6",
      "旅遊景點 · 景山前街4号",
      "附設博物館的 1420 年宮殿建築群",
      "已打烊 · 開始營業時間：週二08:30"
    ].join("\n");
    assert.equal(
      lib.extractPoiDescription("故宮", article),
      "附設博物館的 1420 年宮殿建築群"
    );
    assert.equal(
      lib.extractPoiDescription(
        "故宮",
        "故宮\n4.6(2,909)\n旅遊景點 · 景山前街4号\n附設博物館的 1420 年宮殿建築群\n已打烊"
      ),
      "附設博物館的 1420 年宮殿建築群"
    );
    assert.equal(
      lib.extractPoiDescription(
        "故宮",
        "故宮\n4.6 (2,909)\n旅遊景點\n附設博物館的 1420 年宮殿建築群"
      ),
      "附設博物館的 1420 年宮殿建築群"
    );
    assert.notEqual(lib.extractPoiDescription("故宮", "故宮\n4.6(2,909)\n旅遊景點"), "4.6(2,909)");
    assert.equal(
      lib.extractPoiDescription("坤寧宮", "坤寧宮\n4.6\n旅遊景點\n大殿和皇后故居\n已打烊"),
      "大殿和皇后故居"
    );
    assert.equal(lib.extractPoiDescription("太和門", "太和門\n4.6\n旅遊景點 · 故宮博物院\n已打烊"), "");
    const pois = lib.collectPoisFromAnchors([
      {
        href: "https://www.google.com/maps/place/%E6%95%85%E5%AE%AE/data=!8m2!3d39.9168!4d116.3971",
        label: "故宮",
        category: "旅遊景點 · 景山前街4号",
        article
      }
    ]);
    assert.equal(pois[0].name, "故宮");
    assert.equal(pois[0].description, "附設博物館的 1420 年宮殿建築群");
    assert.match(contentJs, /articleTextForPlace/);
    assert.match(contentJs, /poi\.description/);
    assert.match(contentCss, /\.gcj02-poi-tooltip-desc/);
  });

  it("requires a large GCJ→WGS pixel shift at China landmarks", () => {
    for (const place of [XIAMEN_XINGLIN, WUZHANGYUAN]) {
      const st = lib.parseMapHref(place.satHref || place.href);
      const shift = lib.overlayShiftPx(st.lat, st.lon, st.zoom);
      assert.ok(shift.hypot > 40, `${place.name} shift ${shift.hypot}`);
      assert.ok(shift.dx < -20, `${place.name} must move streets west, dx=${shift.dx}`);
    }
  });

  it("keeps satellite baseLyrs=s and roadLyrs=h for satellite URLs", () => {
    const spec = lib.overlaySpec(XIAMEN_XINGLIN.href);
    assert.equal(spec.label, "satellite");
    assert.deepEqual(spec.baseLyrs, ["s"]);
    assert.equal(spec.roadLyrs, "h");
    assert.equal(spec.nativeOnly, false);
  });

  it("leaves the overlay off outside China (Taiwan island)", () => {
    assert.equal(lib.outOfChina(25.033, 121.565), true);
    assert.match(contentJs, /outOfChina\(/);
    assert.match(contentJs, /effectiveMode/);
    assert.match(contentJs, /function standDownOutsideChina/);
    assert.match(contentJs, /function inChina/);
    assert.match(contentJs, /if \(!inChina\(st\)\)/);
    assert.match(contentJs, /if \(!inChina\(parseMapState\(\)\)\) return;/);
  });

  it("ships a toolbar popup for On/Off alignment and GCJ-02 status in China", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "manifest.json"), "utf8"));
    assert.equal(manifest.action?.default_popup, "popup.html");
    assert.ok((manifest.permissions || []).includes("storage"));
    assert.equal(fs.existsSync(path.join(rootDir, "popup.html")), true);
    assert.equal(fs.existsSync(path.join(rootDir, "popup.js")), true);
    assert.equal(fs.existsSync(path.join(rootDir, "assets/icons/icon128.png")), true);
    assert.equal(manifest.icons?.["128"], "assets/icons/icon128.png");
    assert.equal(manifest.web_accessible_resources?.[0]?.use_dynamic_url, true);
    assert.match(manifest.name, /^China Street Align for Google Maps$/);
    assert.match(contentJs, /datumStatusLabel/);
    assert.match(contentJs, /GCJ-02/);
    assert.match(contentJs, /Aligning ·/);
    assert.match(contentJs, /function setMode/);
    assert.match(contentJs, /function loadAlignMode/);
    assert.match(contentJs, /ALIGN_MODE_KEY/);
    assert.doesNotMatch(contentJs, /setActionStatus/);
    assert.doesNotMatch(contentJs, /gcj02-aligner-modebar/);
    const sw = fs.readFileSync(path.join(rootDir, "service-worker.js"), "utf8");
    assert.doesNotMatch(sw, /setActionStatus/);
    assert.doesNotMatch(sw, /OffscreenCanvas/);
    assert.match(sw, /intentionally not persisted/);
    assert.ok(fs.existsSync(path.join(rootDir, "THIRD_PARTY_NOTICES")));
    const packJs = fs.readFileSync(path.join(rootDir, "scripts", "pack.js"), "utf8");
    assert.match(packJs, /THIRD_PARTY_NOTICES/);
    assert.match(packJs, /popup\.html/);
    assert.match(packJs, /icon128\.png/);
    const license = fs.readFileSync(path.join(rootDir, "LICENSE"), "utf8");
    assert.match(license, /AS IS/);
    assert.match(license, /THIRD_PARTY_NOTICES/);
  });

  it("translates the overlay with the pointer while dragging in China", () => {
    assert.match(contentJs, /panDrag/);
    assert.match(contentJs, /onPanPointerDown/);
    assert.match(contentJs, /onPanPointerMove/);
    assert.match(contentJs, /gcj02-aligner-pan/);
    assert.match(contentJs, /panEl\.style\.transform = `translate3d\(\$\{dx\}px,\$\{dy\}px,0\)`/);
    assert.match(contentJs, /gestureBusy/);
    assert.match(contentJs, /gestureHold/);
    assert.match(contentJs, /beginGestureHold/);
    assert.match(contentJs, /tryGestureSettle/);
    assert.match(contentCss, /\.gcj02-aligner-pan/);
    // Release must not clear the preview before redraw (snap-back flash).
    assert.match(contentJs, /Keep translate3d until Maps updates/);
  });

  it("scales the pan layer during wheel and +/- zoom instead of hard redraw", () => {
    assert.match(contentJs, /zoomAnim/);
    assert.match(contentJs, /onMapWheel/);
    assert.match(contentJs, /onZoomButtonDown/);
    assert.match(contentJs, /scale\(\$\{s\}\)/);
    assert.match(contentJs, /BUTTON_ZOOM_MS/);
    assert.match(contentJs, /WHEEL_PX_PER_ZOOM/);
    assert.match(contentJs, /Keep scale\(\) until Maps commits/);
  });

  it("rejects the 0.6.8 remap pattern: overlayRoadTile xy differs from WGS slot", () => {
    const x = 108517;
    const y = 56284;
    const z = 17;
    const r = lib.overlayRoadTile(x, y, z);
    assert.ok(r.x !== x || r.y !== y, JSON.stringify(r));
  });
});

describe("Maps chrome vs overlay stacking", () => {
  it("treats overlay on <html> as covering Maps chrome", () => {
    assert.equal(lib.overlayWouldCoverMapsChrome("HTML", "absolute", 1), true);
    assert.equal(lib.overlayWouldCoverMapsChrome("HTML", "fixed", 500), true);
  });

  it("treats position:fixed overlay as covering chrome", () => {
    assert.equal(lib.overlayWouldCoverMapsChrome("DIV", "fixed", 0), true);
    assert.equal(lib.overlayWouldCoverMapsChrome("DIV", "fixed", 500), true);
    assert.equal(lib.overlayWouldCoverMapsChrome("BODY", "fixed", 100000), true);
  });

  it("treats positive overlay z-index as covering auto-z Maps controls", () => {
    assert.equal(lib.overlayWouldCoverMapsChrome("DIV", "absolute", 1), true);
    assert.equal(lib.overlayWouldCoverMapsChrome("DIV", "absolute", 500), true);
  });

  it("allows an absolute overlay at z-index 0 inside the map canvas host", () => {
    assert.equal(lib.overlayWouldCoverMapsChrome("DIV", "absolute", 0), false);
    assert.equal(lib.OVERLAY_Z, 0);
    assert.equal(lib.chromeStacksAboveOverlay(lib.CHROME_Z, lib.OVERLAY_Z), true);
  });

  it("keeps CSS overlay absolute, z-index 0, never fixed", () => {
    const block = contentCss.match(/#gcj02-aligner-root\s*\{([^}]+)\}/);
    assert.ok(block, "missing #gcj02-aligner-root CSS");
    const body = block[1];
    assert.match(body, /position:\s*absolute/);
    assert.doesNotMatch(body, /position:\s*fixed/);
    const z = body.match(/z-index:\s*(\d+)/);
    assert.ok(z);
    assert.equal(Number(z[1]), lib.OVERLAY_Z);
    assert.equal(
      lib.overlayWouldCoverMapsChrome("DIV", "absolute", Number(z[1])),
      false
    );
  });

  it("includes default holes for zoom cluster, search, and layers", () => {
    const holes = lib.defaultChromeHoles(1440, 900);
    assert.ok(holes.some((h) => h.x > 1300 && h.y > 600));
    assert.ok(holes.some((h) => h.x < 20 && h.y < 20));
    assert.ok(holes.some((h) => h.x < 20 && h.w >= 280 && h.h >= 350));
  });

  it("does not clip the canvas host (tiles paint under corner chrome)", () => {
    assert.equal(lib.chromeClipPath(1440, 900), "");
    assert.equal(lib.chromeClipPath(0, 0), "");
    assert.match(contentJs, /Never notch the host for chrome/);
    assert.match(contentJs, /lastHost\.style\.clipPath = ""/);
  });

  it("does not append the overlay root to documentElement", () => {
    assert.doesNotMatch(contentJs, /documentElement\.appendChild\(\s*root\s*\)/);
    assert.match(contentJs, /function overlayHost\(/);
    assert.match(contentJs, /insertBefore\(\s*root,\s*host\.firstChild\s*\)/);
    assert.match(contentJs, /function fitOverlayToCanvas/);
    assert.doesNotMatch(contentJs, /host !== document\.body\) return \{ host/);
    assert.doesNotMatch(contentJs, /function liftMapsChrome/);
    assert.doesNotMatch(contentJs, /gcj02-keep-chrome/);
    assert.match(contentJs, /function clipHostForChrome/);
    assert.match(contentJs, /let lastHost = null;/);
  });
});

describe("native hide must not remove Maps controls", () => {
  it("hides raster map tiles only", () => {
    assert.equal(lib.shouldHideNativeImage("https://mt0.google.com/vt/lyrs=s&x=1&y=2&z=17"), true);
    assert.equal(lib.shouldHideNativeImage("https://khms1.google.com/kh/v=394&x=1&y=2&z=17"), true);
  });

  it("does not hide zoom/layer/pegman sprites on gstatic mapfiles", () => {
    const zoomIcon = "https://maps.gstatic.com/mapfiles/transparent.png";
    const apiSprite = "https://maps.gstatic.com/maps-api-v3/mapfiles/api-3/images/google_white5.png";
    const compass = "https://maps.gstatic.com/maps-api-v3/mapfiles/iw_close.gif";
    assert.equal(lib.shouldHideNativeImage(zoomIcon), false);
    assert.equal(lib.shouldHideNativeImage(apiSprite), false);
    assert.equal(lib.shouldHideNativeImage(compass), false);
  });

  it("does not hide the extension overlay tiles", () => {
    assert.equal(
      lib.shouldHideNativeImage("https://mt1.google.com/vt/lyrs=h&x=1&y=2&z=17", true),
      false
    );
  });

  it("hides only large map canvases, not small control canvases", () => {
    assert.equal(lib.shouldHideNativeCanvas(1440, 900, 1440, 900), true);
    assert.equal(lib.shouldHideNativeCanvas(420, 320, 840, 640), true);
    assert.equal(lib.shouldHideNativeCanvas(40, 40, 40, 40), false);
    assert.equal(lib.shouldHideNativeCanvas(48, 48, 96, 96), false);
    assert.equal(lib.shouldHideNativeCanvas(80, 80, 80, 80), false);
  });

  it("keeps CSS that actually hides the native map under the overlay", () => {
    const block = contentCss.match(/\.gcj02-hide-native\s*\{([^}]+)\}/);
    assert.ok(block, "POI styles must not delete .gcj02-hide-native");
    assert.match(block[1], /opacity:\s*0/);
    assert.match(block[1], /visibility:\s*hidden/);
    assert.match(contentJs, /gcj02-hide-native/);
  });
});

describe("Google Maps URL zoom vs satellite meters", () => {
  const PALACE_LAT = 39.9167135;
  const PALACE_LON = 116.3868853;
  const PALACE_Z = 15;
  const PALACE_M = 4718;
  const MAP_URL = `https://www.google.com/maps/@${PALACE_LAT},${PALACE_LON},${PALACE_Z}z`;
  const SAT_URL = `https://www.google.com/maps/@${PALACE_LAT},${PALACE_LON},${PALACE_M}m/data=!3m1!1e3`;
  const XIAMEN_LAT = 24.6013341;
  const XIAMEN_M = 1674;
  const XIAMEN_Z = 16.74;

  it("encodes satellite meters as ground width of a 1280px (5-tile) viewport", () => {
    assert.equal(lib.MAPS_URL_METERS_VIEW_PX, 1280);
    const meters = lib.zoomToGroundMeters(PALACE_LAT, PALACE_Z);
    assert.ok(Math.abs(meters - PALACE_M) < 40, `expected ~${PALACE_M}m at 15z, got ${meters}`);
  });

  it("treats Forbidden City 15z and 4718m as the same camera", () => {
    const fromZ = lib.parseMapHref(MAP_URL);
    const fromM = lib.parseMapHref(SAT_URL);
    assert.equal(fromZ.lat, PALACE_LAT);
    assert.equal(fromM.lon, PALACE_LON);
    assert.equal(fromZ.zoom, PALACE_Z);
    assert.ok(Math.abs(fromM.zoom - PALACE_Z) < 0.02, `4718m zoom ${fromM.zoom} should be ~15`);
    const sizeZ = lib.overlayTileSize(fromZ.zoom);
    const sizeM = lib.overlayTileSize(fromM.zoom);
    assert.ok(
      Math.abs(sizeZ - sizeM) / sizeZ < 0.01,
      `street tile ${sizeZ}px vs satellite tile ${sizeM}px`
    );
  });

  it("does not inflate satellite zoom when the browser window is wider than 1280px", () => {
    const correct = lib.metersToZoom(PALACE_LAT, PALACE_M);
    const wideWindow = lib.metersToZoom(PALACE_LAT, PALACE_M, 2560);
    assert.ok(Math.abs(correct - PALACE_Z) < 0.02);
    assert.ok(wideWindow - correct > 0.9, "innerWidth=2560 used to look one zoom level too large");
  });

  it("matches the Xiamen 1674m / 16.74z pair", () => {
    const z = lib.metersToZoom(XIAMEN_LAT, XIAMEN_M);
    assert.ok(Math.abs(z - XIAMEN_Z) < 0.02, `got ${z}`);
  });

  it("prefers explicit z over m when both appear in the href", () => {
    const st = lib.parseMapHref("https://www.google.com/maps/@39.9,116.3,15z,4718m");
    assert.equal(st.zoom, 15);
  });

  it("does not convert meters with innerWidth in the content script", () => {
    assert.doesNotMatch(contentJs, /metersToZoom\(/);
    assert.match(contentJs, /parseMapHref\(\s*location\.href\s*\)/);
    assert.doesNotMatch(contentJs, /clientWidth \|\| innerWidth/);
  });
});

describe("China landmark URLs stay in the overlay and get a GCJ pixel shift", () => {
  const { LANDMARKS } = require("../fixtures/overlay-landmarks");

  for (const place of LANDMARKS) {
    it(`aligns ${place.name}`, () => {
      const href = place.satHref || place.href;
      const st = lib.parseMapHref(href);
      const spec = lib.overlaySpec(href);
      assert.ok(st, href);
      assert.equal(st.lat, place.lat);
      assert.equal(st.lon, place.lon);
      const fromMeters = lib.metersToZoom(place.lat, place.meters);
      assert.ok(Math.abs(st.zoom - fromMeters) < 0.05, `${place.name} zoom ${st.zoom}`);
      if (place.expectZoom != null) {
        assert.ok(Math.abs(st.zoom - place.expectZoom) < 0.05, `${place.name} zoom ${st.zoom}`);
      }
      assert.equal(lib.outOfChina(st.lat, st.lon), false, place.name);
      const search = /\/maps\/search\//.test(href);
      const satellite = lib.mapDisplayType(lib.dataParam(href)) === 3;
      const crisp = satellite && !search && !lib.hybridNeedsNativeLayers(href, false);
      if (crisp) {
        assert.equal(spec.nativeOnly, false, place.name);
        assert.equal(spec.label, "satellite", place.name);
        assert.deepEqual(spec.baseLyrs, ["s"]);
        assert.equal(spec.roadLyrs, "h");
      } else {
        assert.equal(spec.nativeOnly, true, place.name);
      }
      const shift = lib.overlayShiftPx(st.lat, st.lon, st.zoom);
      assert.ok(shift.hypot > 20, `${place.name} shift ${shift.hypot}px`);
    });
  }

  it("uses overlayShiftPx from the content script", () => {
    assert.match(contentJs, /overlayShiftPx\(/);
  });
});

describe("GCJ overlay region excludes Taiwan island", () => {
  const TAIPEI_URL =
    "https://www.google.com/maps/@25.0747931,121.5292321,1954m/data=!3m1!1e3";

  it("treats Taipei as outside the overlay region", () => {
    assert.equal(lib.outOfChina(25.0747931, 121.5292321), true);
    assert.equal(lib.inTaiwanIsland(25.0747931, 121.5292321), true);
    const st = lib.parseMapHref(TAIPEI_URL);
    assert.ok(st);
    assert.equal(lib.outOfChina(st.lat, st.lon), true);
  });

  it("treats other Taiwan-island cities as outside the overlay region", () => {
    const island = [
      [25.033, 121.565], // Taipei 101
      [25.128, 121.739], // Keelung
      [24.147, 120.673], // Taichung
      [22.627, 120.301], // Kaohsiung
      [22.999, 120.227], // Tainan
      [23.973, 121.601], // Hualien
      [22.758, 121.144], // Taitung
      [21.902, 120.853]  // Eluanbi
    ];
    for (const [lat, lon] of island) {
      assert.equal(lib.outOfChina(lat, lon), true, `${lat},${lon}`);
      assert.equal(lib.inTaiwanIsland(lat, lon), true, `${lat},${lon}`);
    }
  });

  it("still treats mainland GCJ cities as inside the overlay region", () => {
    assert.equal(lib.outOfChina(39.9167135, 116.3868853), false); // Beijing
    assert.equal(lib.outOfChina(24.6013341, 118.0704538), false); // Xiamen
    assert.equal(lib.outOfChina(24.479, 118.089), false); // Xiamen Island
    assert.equal(lib.outOfChina(24.546, 118.327), false); // Dadeng (PRC)
    assert.equal(lib.outOfChina(24.6060291, 118.0838401), false); // 兑山村, Jimei
    assert.equal(lib.outOfChina(24.6060199, 118.08899), false);
    assert.equal(lib.inXiamenMainland(24.6060291, 118.0838401), true);
    assert.equal(lib.inPenghuKinmenMatsu(24.6060291, 118.0838401), false);
    assert.equal(lib.outOfChina(26.0745, 119.2965), false); // Fuzhou
    assert.equal(lib.outOfChina(31.2304, 121.4737), false); // Shanghai
    assert.equal(lib.inTaiwanIsland(24.6013341, 118.0704538), false);
    assert.equal(lib.inPenghuKinmenMatsu(24.6013341, 118.0704538), false);
  });

  it("treats Penghu, Kinmen, and Matsu as outside the overlay region", () => {
    const offshore = [
      [23.5712, 119.5794], // Magong, Penghu
      [23.209, 119.428], // Qimei, Penghu
      [24.4329, 118.3171], // Jincheng, Kinmen
      [24.4281, 118.235], // Lieyu
      [24.38, 118.165], // Dadan
      [24.9918, 119.4523], // Wuqiu
      [26.1506, 119.931], // Nangan, Matsu
      [26.2254, 119.9983], // Beigan, Matsu
      [26.366, 120.4904], // Dongyin, Matsu
      [25.973, 119.939] // Juguang, Matsu
    ];
    for (const [lat, lon] of offshore) {
      assert.equal(lib.inPenghuKinmenMatsu(lat, lon), true, `${lat},${lon}`);
      assert.equal(lib.outOfChina(lat, lon), true, `${lat},${lon}`);
      assert.equal(lib.inTaiwanIsland(lat, lon), false, `${lat},${lon}`);
      assert.equal(lib.inXiamenMainland(lat, lon), false, `${lat},${lon}`);
    }
  });

  it("keeps Jimei 兑山村 on the Xiamen overlay, not as Kinmen", () => {
    const url =
      "https://www.google.com/maps/place/%E4%B8%AD%E5%9C%8B%E7%A6%8F%E5%BB%BA%E7%9C%81%E5%BB%88%E9%96%80%E5%B8%82%E9%9B%86%E7%BE%8E%E5%8D%80%E5%85%8C%E5%B1%B1%E6%9D%91+%E9%82%AE%E6%94%BF%E7%BC%86%E7%A0%81:+361021/@24.6060291,118.0838401,2796m/data=!3m2!1e3!4b1!4m6!3m5!1s0x34148e6ab5fe7f93:0x9985637b6ac4b21e!8m2!3d24.6060199!4d118.08899!16s%2Fg%2F11c615d_bw";
    const st = lib.parseMapHref(url);
    const place = lib.parsePlaceCoords(url);
    const spec = lib.overlaySpec(url);
    assert.ok(st);
    assert.equal(st.lat, 24.6060291);
    assert.equal(st.lon, 118.0838401);
    assert.equal(lib.outOfChina(st.lat, st.lon), false);
    assert.equal(lib.outOfChina(place.lat, place.lon), false);
    assert.equal(lib.isNativeOnlyView(url), false);
    assert.equal(spec.nativeOnly, false);
    assert.equal(spec.label, "satellite");
    const gcj = lib.wgsToGcj(st.lat, st.lon);
    assert.ok(Math.hypot(gcj.lat - st.lat, gcj.lon - st.lon) > 1e-4);
  });

  it("uses the shared outOfChina helper from the content script", () => {
    assert.match(contentJs, /Gcj02Aligner\.outOfChina\(/);
    assert.doesNotMatch(contentJs, /lon < 72\.004/);
  });
});

describe("GCJ box excludes neighboring countries inside the literature bounds", () => {
  it("treats Mongolia, central Asia, and Far East Russia as outside", () => {
    const outside = [
      [47.8864, 106.9057], // Ulaanbaatar
      [43.238, 76.945], // Almaty
      [43.115, 131.885], // Vladivostok
      [27.717, 85.324], // Kathmandu
      [21.028, 105.854], // Hanoi
      [37.566, 126.978], // Seoul
      [33.59, 130.401], // Fukuoka (inside GCJ literature box)
      [14.599, 120.984] // Manila
    ];
    for (const [lat, lon] of outside) {
      assert.equal(lib.inChinaGcjBox(lat, lon), true, `${lat},${lon} in GCJ box`);
      assert.equal(lib.inExcludedNeighborRegion(lat, lon), true, `${lat},${lon}`);
      assert.equal(lib.outOfChina(lat, lon), true, `${lat},${lon}`);
    }
  });

  it("still treats mainland China as inside", () => {
    const inside = [
      [39.9167, 116.3869], // Beijing
      [31.2304, 121.4737], // Shanghai
      [40.8175, 111.7656], // Hohhot
      [49.212, 119.765], // Hulunbuir
      [41.710262, 124.802589], // 清永陵 (Liaoning; directions e2e landmark)
      [40.124, 124.383], // Dandong
      [42.891, 129.509], // Yanji
      [44.55, 129.63], // Mudanjiang
      [22.5329, 114.1145], // Shenzhen Luohu (mainland, north of HK)
      [22.479, 113.918], // Shenzhen Shekou
      [22.219, 113.549] // Zhuhai Gongbei
    ];
    for (const [lat, lon] of inside) {
      assert.equal(lib.outOfChina(lat, lon), false, `${lat},${lon}`);
      assert.equal(lib.inExcludedNeighborRegion(lat, lon), false, `${lat},${lon}`);
      assert.equal(lib.inHongKong(lat, lon), false, `${lat},${lon}`);
      assert.equal(lib.inMacau(lat, lon), false, `${lat},${lon}`);
    }
  });

  it("treats Hong Kong and Macau as outside the overlay region", () => {
    const sars = [
      [22.3193, 114.1694, "hk"], // Central
      [22.2759, 114.1455, "hk"], // Victoria Peak
      [22.308, 113.922, "hk"], // Lantau / airport
      [22.391, 113.976, "hk"], // Tuen Mun
      [22.1987, 113.5439, "mo"], // Senado Square
      [22.149, 113.569, "mo"] // Cotai
    ];
    for (const [lat, lon, which] of sars) {
      assert.equal(lib.outOfChina(lat, lon), true, `${lat},${lon}`);
      if (which === "hk") {
        assert.equal(lib.inHongKong(lat, lon), true, `${lat},${lon}`);
        assert.equal(lib.inMacau(lat, lon), false, `${lat},${lon}`);
      } else {
        assert.equal(lib.inMacau(lat, lon), true, `${lat},${lon}`);
        assert.equal(lib.inHongKong(lat, lon), false, `${lat},${lon}`);
      }
    }
  });

  it("still treats Korea and Japan cities as outside", () => {
    const outside = [
      [39.039, 125.762], // Pyongyang
      [37.566, 126.978], // Seoul
      [33.59, 130.401] // Fukuoka
    ];
    for (const [lat, lon] of outside) {
      assert.equal(lib.inExcludedNeighborRegion(lat, lon), true, `${lat},${lon}`);
      assert.equal(lib.outOfChina(lat, lon), true, `${lat},${lon}`);
    }
  });
});

describe("Google Maps layer overlay spec", () => {
  const { WUZHANGYUAN } = require("../fixtures/overlay-landmarks");
  const MAP = "https://www.google.com/maps/@39.9167135,116.3868853,15z";
  const SAT = "https://www.google.com/maps/@39.9167135,116.3868853,4718m/data=!3m1!1e3";
  const TERRAIN = "https://www.google.com/maps/@39.9167135,116.3868853,15z/data=!5m1!1e4";
  const TRAFFIC = "https://www.google.com/maps/@39.9167135,116.3868853,15z/data=!5m1!1e1";
  const TRANSIT = "https://www.google.com/maps/@39.9167135,116.3868853,15z/data=!5m1!1e2";
  const BIKE = "https://www.google.com/maps/@39.9167135,116.3868853,15z/data=!5m1!1e3";
  const SV_COVER = "https://www.google.com/maps/@39.9167135,116.3868853,15z/data=!5m1!1e5";
  const TERRAIN_TRAFFIC = "https://www.google.com/maps/@39.9167135,116.3868853,15z/data=!5m2!1e1!1e4";
  const STREET_VIEW = "https://www.google.com/maps/@39.9167135,116.3868853,3a,75y,90h,90t/data=!3m6!1e1!3m5!1sAF1Qip";
  const STREET_VIEW_Z = "https://www.google.com/maps/@39.9167135,116.3868853,15z/data=!3m1!1e1";
  const EARTH_3D = "https://www.google.com/maps/@39.9167135,116.3868853,500a,20y,0h,45t/data=!3m1!1e3";

  it("keeps satellite as unshifted s tiles plus shifted hybrid labels", () => {
    const spec = lib.overlaySpec(SAT);
    assert.equal(spec.nativeOnly, false);
    assert.equal(spec.label, "satellite");
    assert.deepEqual(spec.baseLyrs, ["s"]);
    assert.equal(spec.roadLyrs, "h");
  });

  it("yields native for terrain (hybrid forces map basemap)", () => {
    const spec = lib.overlaySpec(TERRAIN);
    assert.equal(spec.nativeOnly, true);
    assert.equal(spec.label, "native");
    assert.equal(lib.isTerrainView(TERRAIN), true);
    assert.equal(lib.overlaySpec(WUZHANGYUAN.terrainHref).nativeOnly, true);
    assert.equal(lib.overlaySpec(WUZHANGYUAN.scenicTerrainHref).nativeOnly, true);
  });

  it("reads terrain from a search URL that already has other data tokens", () => {
    const off =
      "https://www.google.com/maps/search/%E4%BA%94%E4%B8%88%E5%8E%9F/@34.2473397,107.6112456,14.06z/data=!4m2!2m1!6e1";
    const on =
      "https://www.google.com/maps/search/%E4%BA%94%E4%B8%88%E5%8E%9F/@34.2473397,107.6112456,14.06z/data=!4m2!2m1!6e1!5m1!1e4";
    assert.equal(lib.overlaySpec(off).nativeOnly, true);
    assert.equal(lib.overlaySpec(on).nativeOnly, true);
    assert.equal(lib.hybridNeedsNativeLayers(on, false), true);
  });

  it("treats traffic, transit, bicycling and SV layer URLs as native-only", () => {
    assert.equal(lib.overlaySpec(TRAFFIC).nativeOnly, true);
    assert.equal(lib.overlaySpec(TRANSIT).nativeOnly, true);
    assert.equal(lib.overlaySpec(BIKE).nativeOnly, true);
    assert.equal(lib.overlaySpec(SV_COVER).nativeOnly, true);
    assert.equal(lib.overlaySpec(TERRAIN_TRAFFIC).nativeOnly, true);
    assert.equal(lib.hybridNeedsNativeLayers(TRAFFIC, false), true);
  });

  it("withStreetViewCoverage is a no-op under hybrid native-only specs", () => {
    const map = lib.overlaySpec(MAP);
    assert.equal(map.nativeOnly, true);
    assert.deepEqual(lib.withStreetViewCoverage(map, true).extraLyrs, []);
    assert.deepEqual(lib.withStreetViewCoverage(map, false).extraLyrs, []);
    assert.deepEqual(lib.withStreetViewCoverage(lib.overlaySpec(SV_COVER), true).extraLyrs, []);
    assert.equal(lib.withStreetViewCoverage(lib.overlaySpec(STREET_VIEW), true).nativeOnly, true);
  });

  it("builds Maps vt/pb Street View coverage tile URLs (not empty lyrs=svv)", () => {
    const url = lib.streetViewCoverageTileUrl(53955, 24830, 16);
    assert.match(url, /^https:\/\/www\.google\.com\/maps\/vt\/pb=/);
    assert.match(url, /!1i16!2i53955!3i24830/);
    assert.match(url, /!2ssvv/);
    assert.match(url, /!2sRoadmap/);
    assert.doesNotMatch(url, /lyrs=svv/);
    assert.match(contentJs, /streetViewCoverageTileUrl/);
  });

  it("recognizes pegman / Street View control labels", () => {
    const mk = (attrs) => {
      const el = { nodeType: 1, parentElement: null, getAttribute: (k) => attrs[k] || null };
      return el;
    };
    assert.equal(lib.isStreetViewPegmanTarget(mk({ "aria-label": "Street View" })), true);
    assert.equal(lib.isStreetViewPegmanTarget(mk({ "aria-label": "瀏覽街景服務圖像" })), true);
    assert.equal(lib.isStreetViewPegmanTarget(mk({ jsaction: "mousedown:runway.pegman" })), true);
    assert.equal(lib.isStreetViewPegmanTarget(mk({ title: "Pegman" })), true);
    assert.equal(lib.isStreetViewPegmanTarget(mk({ "aria-label": "Zoom in" })), false);
  });

  it("treats a plain street map as native-only in hybrid mode", () => {
    const spec = lib.overlaySpec(MAP);
    assert.equal(spec.nativeOnly, true);
    assert.equal(spec.label, "native");
  });

  it("hands Street View and 3D Earth back to native Maps", () => {
    assert.equal(lib.isNativeOnlyView(STREET_VIEW), true);
    assert.equal(lib.overlaySpec(STREET_VIEW).nativeOnly, true);
    assert.equal(lib.overlaySpec(STREET_VIEW_Z).nativeOnly, true);
    assert.equal(lib.overlaySpec(EARTH_3D).nativeOnly, true);
    assert.equal(lib.overlaySpec(SAT).nativeOnly, false);
  });

  it("keeps directions on the native canvas in hybrid mode", () => {
    const dir =
      "https://www.google.com/maps/dir/%E6%95%85%E5%AE%AE%E5%8D%88%E9%96%80/%E5%A4%A9%E5%AE%89%E9%96%80/@39.9112947,116.3947854,1180m/data=!3m2!1e3!4b1!4m14!4m13!1m5!1m1!1s0x35f052c194aa1469:0x82c6fcd5085ca28d!2m2!1d116.39721!2d39.9138664!1m5!1m1!1s0x36637698dc4374d9:0x6928cb83a148399a!2m2!1d116.3974799!2d39.9087202!3e2";
    assert.equal(lib.isDirectionsView(dir), true);
    assert.equal(lib.isNativeOnlyView(dir), false);
    const spec = lib.overlaySpec(dir);
    assert.equal(spec.nativeOnly, true);
    assert.doesNotMatch(contentJs, /function syncRoute/);
  });

  it("decodes Google directions polylines near Beijing", () => {
    const sample =
      ")]}'\n[[[null,null,39.913866,116.39721],[null,null,39.914848,116.392914],[null,null,39.908721,116.397511]]]";
    const href =
      "https://www.google.com/maps/dir/A/B/data=!4m14!4m13!1m5!1m1!1s0:0!2m2!1d116.39721!2d39.9138664!1m5!1m1!1s0:0!2m2!1d116.3974799!2d39.9087202!3e2";
    const lines = lib.extractDirectionsPolylines(sample, href);
    assert.ok(lines.length >= 1);
    assert.equal(lines.length, 1);
    assert.ok(lines[0].length >= 2);
    assert.equal(lines[0][0].lat, 39.9138664);
    assert.equal(lines[0][lines[0].length - 1].lat, 39.9087202);
    assert.ok(lines[0].every((p) => p.lat > 39.8 && p.lat < 40.1 && p.lon > 116.2 && p.lon < 116.5));
    const rel = lib.decodeGooglePolyline("BChQSCg1oX8oXFQTOYEU4ATgAOAI4AxDDGg==");
    assert.ok(rel.length >= 2);
  });

  it("chains ordered preview step segments into one long driving polyline", () => {
    const fs = require("fs");
    const path = require("path");
    const fixture = path.join(__dirname, "../fixtures/directions-zhongguancun-chaoyang.json");
    const body = fs.readFileSync(fixture, "utf8");
    const href =
      "https://www.google.com/maps/dir/A/B/data=!4m14!4m13!1m5!1m1!1s0x35f051505892a34f:0x6ea89d0cc8fe038c!2m2!1d116.3160877!2d39.9799664!1m5!1m1!1s0x35f1ac64fa1013f9:0x576afdc6da5d374e!2m2!1d116.481688!2d39.940142!3e0";
    const lines = lib.extractDirectionsPolylines(body, href);
    assert.equal(lines.length, 1);
    assert.ok(lines[0].length >= 8);
    assert.ok(lines[0][0].lat > lines[0][lines[0].length - 1].lat, "drive runs south overall");
  });

  it("traces a continuous native canvas route into one polyline", () => {
    const w = 1792;
    const h = 1024;
    const cam = { lat: 39.9641384, lon: 116.3577957 };
    const zoom = 13;
    const origin = { lat: 39.9799664, lon: 116.3160877 };
    const dest = { lat: 39.940142, lon: 116.481688 };
    const start = lib.gcjLatLonToScreenPx(origin.lat, origin.lon, cam.lat, cam.lon, zoom, w, h);
    const end = lib.gcjLatLonToScreenPx(dest.lat, dest.lon, cam.lat, cam.lon, zoom, w, h);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i <= 120; i++) {
      const t = i / 120;
      const x = Math.round(start.x + (end.x - start.x) * t);
      const y = Math.round(start.y + (end.y - start.y) * t + Math.sin(t * 8) * 18);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const px = x + dx;
          const py = y + dy;
          if (px < 0 || py < 0 || px >= w || py >= h) continue;
          const idx = (py * w + px) * 4;
          data[idx] = 26;
          data[idx + 1] = 115;
          data[idx + 2] = 232;
          data[idx + 3] = 255;
        }
      }
    }
    const lines = lib.extractRouteLineFromCanvasImageData(
      data, w, h, w, h, cam.lat, cam.lon, zoom, w, h, origin, dest
    );
    assert.equal(lines.length, 1);
    assert.ok(lines[0].length >= 8);
    assert.ok(lib.haversineM ? true : true);
    let total = 0;
    for (let i = 1; i < lines[0].length; i++) {
      const dLat = (lines[0][i].lat - lines[0][i - 1].lat) * Math.PI / 180;
      const dLon = (lines[0][i].lon - lines[0][i - 1].lon) * Math.PI / 180;
      const x = Math.sin(dLat / 2) ** 2
        + Math.cos(lines[0][i - 1].lat * Math.PI / 180) * Math.cos(lines[0][i].lat * Math.PI / 180)
        * Math.sin(dLon / 2) ** 2;
      total += 2 * 6371000 * Math.asin(Math.sqrt(x));
    }
    assert.ok(total > 10000, `route should span most of the drive, got ${Math.round(total)}m`);
  });

  it("ignores fragmentary canvas chains shorter than eight points", () => {
    const w = 512;
    const h = 512;
    const cam = { lat: 39.9112947, lon: 116.3947854 };
    const zoom = 17;
    const origin = { lat: 39.9138664, lon: 116.39721 };
    const dest = { lat: 39.9087202, lon: 116.3974799 };
    const start = lib.gcjLatLonToScreenPx(origin.lat, origin.lon, cam.lat, cam.lon, zoom, w, h);
    const data = new Uint8ClampedArray(w * h * 4);
    for (const pt of [start, { x: start.x + 2, y: start.y + 36 }]) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const idx = ((pt.y + dy) * w + (pt.x + dx)) * 4;
          if (idx < 0 || idx >= data.length) continue;
          data[idx] = 26;
          data[idx + 1] = 115;
          data[idx + 2] = 232;
          data[idx + 3] = 255;
        }
      }
    }
    const lines = lib.extractRouteLineFromCanvasImageData(
      data, w, h, w, h, cam.lat, cam.lon, zoom, w, h, origin, dest
    );
    assert.deepEqual(lines, []);
  });

  it("ignores marker polylines and draws Meridian Gate to Tiananmen southbound", () => {
    const fs = require("fs");
    const path = require("path");
    const fixture = path.join(__dirname, "../fixtures/directions-forbidden-tiananmen.json");
    const body = fs.readFileSync(fixture, "utf8");
    const href =
      "https://www.google.com/maps/dir/%E6%95%85%E5%AE%AE%E5%8D%88%E9%96%80/%E5%A4%A9%E5%AE%89%E9%96%80/@39.9112947,116.3947854,1180m/data=!3m2!1e3!4b1!4m14!4m13!1m5!1m1!1s0x35f052c194aa1469:0x82c6fcd5085ca28d!2m2!1d116.39721!2d39.9138664!1m5!1m1!1s0x36637698dc4374d9:0x6928cb83a148399a!2m2!1d116.3974799!2d39.9087202!3e2";
    const lines = lib.extractDirectionsPolylines(body, href);
    assert.equal(lines.length, 1);
    const route = lines[0];
    assert.equal(route.length, 2);
    assert.ok(route[0].lat > route[1].lat, "route should run south");
    assert.ok(route.every((p) => p.lat < 39.916 && p.lat > 39.905), "route stays near meridian axis");
    assert.ok(route.every((p) => p.lon > 116.396 && p.lon < 116.399), "route stays near meridian axis");
    const dLat = (route[1].lat - route[0].lat) * Math.PI / 180;
    const dLon = (route[1].lon - route[0].lon) * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2
      + Math.cos(route[0].lat * Math.PI / 180) * Math.cos(route[1].lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    const dist = 2 * 6371000 * Math.asin(Math.sqrt(x));
    assert.ok(dist > 400 && dist < 700, `route length ~550m, got ${Math.round(dist)}m`);
  });

  it("lets the content script follow overlaySpec instead of only !1e3", () => {
    assert.match(contentJs, /overlaySpec\(/);
    assert.doesNotMatch(contentJs, /function isSatelliteView/);
    assert.match(contentJs, /spec\.nativeOnly/);
  });
});

describe("search result POIs on the overlay", () => {
  it("prefers !3d/!4d place coordinates over the camera @ in a place URL", () => {
    const href =
      "https://www.google.com/maps/place/%E8%AB%B8%E8%91%9B%E4%BA%AE%E5%BB%9F/@34.2473397,107.6112456,17z/data=!8m2!3d34.26112!4d107.62548";
    const c = lib.parsePlaceCoords(href);
    assert.equal(c.lat, 34.26112);
    assert.equal(c.lon, 107.62548);
  });

  it("reads four Wuzhangyuan search hits from place links", () => {
    const anchors = [
      {
        href: "https://www.google.com/maps/place/A/@34.24,107.61,17z/data=!8m2!3d34.26112!4d107.62548",
        label: "诸葛庙"
      },
      {
        href: "https://www.google.com/maps/place/B/@34.24,107.61,17z/data=!8m2!3d34.252!4d107.618",
        label: "五丈原风景区"
      },
      {
        href: "https://www.google.com/maps/place/C/data=!8m2!3d34.255!4d107.62",
        label: "C"
      },
      {
        href: "https://www.google.com/maps/place/D/data=!8m2!3d34.258!4d107.63",
        label: "D"
      },
      { href: "https://www.google.com/maps/search/五丈原", label: "ignore search" },
      {
        href: "https://www.google.com/maps/place/A/@34.24,107.61,17z/data=!8m2!3d34.26112!4d107.62548",
        label: "诸葛庙 duplicate"
      }
    ];
    const pois = lib.collectPoisFromAnchors(anchors);
    assert.equal(pois.length, 4);
    assert.equal(pois[0].name, "诸葛庙");
    assert.equal(pois[0].kind, "place");
    assert.equal(pois[1].lat, 34.252);
    assert.equal(pois[1].kind, "attraction");
  });

  it("classifies Forbidden City search hits as camera vs gate-tower glyphs", () => {
    assert.equal(lib.classifyPoiKind("故宮"), "place");
    assert.equal(lib.classifyPoiKind("故宮 4.6 旅遊景點 · 景山前街4号 故宮午門 歷史遺址", "故宮"), "attraction");
    assert.equal(lib.classifyPoiKind("故宮 旅遊景點 · 景山前街4号"), "attraction");
    assert.equal(lib.classifyPoiKind("故宮午門 歷史遺址 · 景山前街4号"), "historic");
    assert.equal(lib.classifyPoiKind("太和門 Tourist attraction"), "attraction");
    assert.equal(lib.poiMarkerSpec("attraction").kind, "attraction");
    assert.equal(lib.poiMarkerSpec("historic").kind, "historic");
    assert.match(lib.poiMarkerSpec("attraction").path, /M8/);
    const pois = lib.collectPoisFromAnchors([
      {
        href: "https://www.google.com/maps/place/A/data=!8m2!3d39.91!4d116.39",
        label: "故宮",
        category: "旅遊景點 · 景山前街4号"
      }
    ]);
    assert.equal(pois[0].kind, "attraction");
    assert.match(contentJs, /appendPoiGlyph/);
    assert.match(contentJs, /poiMarkerSpec/);
    assert.match(contentJs, /nativeSpotlightPinSpec/);
    assert.match(contentCss, /\.gcj02-poi-icon/);
    assert.match(contentCss, /\.gcj02-poi-teardrop/);
    assert.match(contentCss, /\.gcj02-poi\.is-hover/);
    assert.match(contentJs, /onSidebarPointerOver/);
    assert.doesNotMatch(contentJs, /gcj02-poi-pin/);
    const pin = lib.nativeSpotlightPinSpec(2);
    assert.match(pin.path, /assets\/place-pin-hdpi\.png/);
    assert.equal(pin.width, 28);
    assert.equal(pin.height, 39);
    assert.match(contentJs, /chrome\.runtime\.getURL\(pin\.path\)/);
    assert.ok(fs.existsSync(path.join(rootDir, "assets", "place-pin-hdpi.png")));
  });

  it("plots overlay POIs with the camera street shift, with clean labels", () => {
    const { WUZHANGYUAN } = require("../fixtures/overlay-landmarks");
    const poi = WUZHANGYUAN.samplePoi;
    const cam = { lat: WUZHANGYUAN.lat, lon: WUZHANGYUAN.lon };
    const camW = lib.overlayCamera(cam.lat, cam.lon);
    const center = lib.worldPixel(camW.lat, camW.lon, 15);
    const raw = lib.worldPixel(poi.lat, poi.lon, 15);
    const unshifted = {
      x: raw.x - center.x + 720,
      y: raw.y - center.y + 450
    };
    const shift = lib.overlayShiftPx(camW.lat, camW.lon, 15);
    const wgs = lib.gcjToWgs(poi.lat, poi.lon);
    const plotted = lib.overlayPoiScreenPx(poi.lat, poi.lon, cam.lat, cam.lon, 15, 1440, 900);
    assert.ok(Math.abs(plotted.x - (unshifted.x + shift.dx)) < 1);
    assert.ok(Math.abs(plotted.y - (unshifted.y + shift.dy)) < 1);
    assert.ok(Math.abs(plotted.x - (unshifted.x + 2 * shift.dx)) > 40);
    assert.equal(plotted.lat, wgs.lat);
    assert.equal(plotted.lon, wgs.lon);
    assert.ok(plotted.lat < WUZHANGYUAN.poiWgsSouthOfG310Lat);
    assert.ok(plotted.lon < WUZHANGYUAN.poiWgsWestOfX235Lon);
    assert.match(contentJs, /appendPoiGlyph\(el, poi\.kind, poi\.name, poi\.description\)/);
    assert.match(contentCss, /\.gcj02-poi-label/);
    assert.match(contentCss, /\.gcj02-poi-tooltip-desc/);
    assert.match(contentJs, /const roadShift = shift\(sample\.dx, sample\.dy\)/);
    assert.doesNotMatch(contentJs, /overlayRoadTile\(/);
  });

  it("draws satellite and roads from the same WGS tile x/y then CSS-shifts only roads", () => {
    assert.match(contentJs, /placeTile\(\s*hasBase \? "gcj02-road" : "gcj02-tile"/);
    assert.match(
      contentJs,
      /spec\.roadLyrs, left, top, tileSize, roadShift, wx, ty, zTile/
    );
    assert.match(contentJs, /placeTile\("gcj02-tile", lyrs, left, top, tileSize, "", wx, ty, zTile\)/);
    assert.doesNotMatch(contentJs, /src\.x,\s*src\.y/);
    assert.doesNotMatch(contentJs, /shiftRoads/);
    assert.match(contentJs, /img\.dataset\.lyrs/);
    assert.match(contentJs, /img\.dataset\.x = String\(wx\)/);
  });

  it("overlayRoadTile uses a different xy than WGS (the 0.6.8 pattern e2e must reject)", () => {
    const x = 108517;
    const y = 56284;
    const z = 17;
    const r = lib.overlayRoadTile(x, y, z);
    assert.ok(r.x !== x || r.y !== y, JSON.stringify(r));
  });

  it("reads the URL @ as GCJ-02 and centers the overlay on its WGS twin", () => {
    const { WUZHANGYUAN } = require("../fixtures/overlay-landmarks");
    const st = lib.parseMapHref(WUZHANGYUAN.zoomSets[0].steps[0].href);
    const cam = lib.overlayCamera(st.lat, st.lon);
    const wgs = lib.gcjToWgs(st.lat, st.lon);
    assert.equal(cam.lat, wgs.lat);
    assert.equal(cam.lon, wgs.lon);
    // ~500m at 五丈原: skipping this is exactly the drift bug.
    assert.ok(Math.abs(cam.lon - st.lon) > 0.004, `${cam.lon} vs ${st.lon}`);
    assert.ok(Math.abs(cam.lat - st.lat) > 0.001, `${cam.lat} vs ${st.lat}`);
    // Round trip: the shift is evaluated at the WGS camera, so wgsToGcj of it
    // must come back to the URL value, or the roads land off the satellite.
    const back = lib.wgsToGcj(cam.lat, cam.lon);
    assert.ok(Math.abs(back.lat - st.lat) < 1e-7, `${back.lat} vs ${st.lat}`);
    assert.ok(Math.abs(back.lon - st.lon) < 1e-7, `${back.lon} vs ${st.lon}`);
    assert.match(contentJs, /Gcj02Aligner\.overlayCamera\(st\.lat, st\.lon, urlCoordOpts\(\)\)/);
    assert.match(contentJs, /worldPixel\(cam\.lat, cam\.lon, st\.zoom\)/);
    assert.match(contentJs, /overlayShiftPx\(cam\.lat, cam\.lon, st\.zoom\)/);
    assert.doesNotMatch(contentJs, /worldPixel\(st\.lat, st\.lon, st\.zoom\)/);
  });

  it("keeps search POIs on the Off pin pixel at every zoom in both framings", () => {
    const { WUZHANGYUAN } = require("../fixtures/overlay-landmarks");
    const W = 1280;
    const H = 720;
    // Off-mode oracle: Google's `@` and !3d/!4d are one datum, so plain
    // mercator reproduces the native pin with no GCJ math at all. On mode must
    // land on that pixel at every zoom — the roads move, the pin does not.
    const nativePin = (poi, st) => {
      const p = lib.worldPixel(poi.lat, poi.lon, st.zoom);
      const c = lib.worldPixel(st.lat, st.lon, st.zoom);
      return { x: p.x - c.x + W / 2, y: p.y - c.y + H / 2 };
    };
    const pois = [WUZHANGYUAN.samplePoi, WUZHANGYUAN.townPoi];
    const errs = [];
    for (const set of WUZHANGYUAN.zoomSets) {
      for (const step of set.steps) {
        const st = lib.parseMapHref(step.href);
        assert.equal(Math.round(st.zoom), step.zoom);
        const shift = lib.overlayShiftPx(st.lat, st.lon, st.zoom);
        for (const poi of pois) {
          const plotted = lib.overlayPoiScreenPx(poi.lat, poi.lon, st.lat, st.lon, st.zoom, W, H);
          const pin = nativePin(poi, st);
          const err = Math.hypot(plotted.x - pin.x, plotted.y - pin.y);
          const where = `${set.id} z=${step.zoom} ${poi.name}`;
          assert.ok(err < 1, `${where} moved ${err.toFixed(1)}px off the Off pin`);
          // The bug put the pin one whole camera GCJ offset from the Off pin.
          // Compare against that offset's own size, which halves per level.
          const bug = Math.hypot(plotted.x - (pin.x + shift.dx), plotted.y - (pin.y + shift.dy));
          assert.ok(
            Math.abs(bug - shift.hypot) < 1 && bug > 20,
            `${where} still carries the GCJ camera offset (${bug.toFixed(1)} vs ${shift.hypot.toFixed(1)})`
          );
          errs.push(err);
        }
      }
    }
    assert.ok(errs.length >= 18, `only ${errs.length} placements checked`);
    // The old error doubled per level; this stays flat.
    assert.ok(Math.max(...errs) - Math.min(...errs) < 1, JSON.stringify(errs));
  });

  it("holds each framing's own search hit at one screen offset as zoom rises", () => {
    const { WUZHANGYUAN } = require("../fixtures/overlay-landmarks");
    // Google frames the view on one hit and keeps it at a fixed screen offset
    // from `@`. Whichever hit that is, its drawn x/y must not move as z rises.
    for (const set of WUZHANGYUAN.zoomSets) {
      const anchor = WUZHANGYUAN[set.anchorKey];
      assert.ok(anchor, `missing anchor ${set.anchorKey}`);
      const seen = set.steps.map((step) => {
        const st = lib.parseMapHref(step.href);
        return lib.overlayPoiScreenPx(anchor.lat, anchor.lon, st.lat, st.lon, st.zoom, 1280, 720);
      });
      for (const p of seen) {
        const xs = JSON.stringify(seen.map((s) => Math.round(s.x)));
        const ys = JSON.stringify(seen.map((s) => Math.round(s.y)));
        assert.ok(Math.abs(p.x - seen[0].x) < 2, `${set.id} ${anchor.name} x walked: ${xs}`);
        // Only where Google's framing pins the row too — see anchorHoldsY.
        if (set.anchorHoldsY) {
          assert.ok(Math.abs(p.y - seen[0].y) < 2, `${set.id} ${anchor.name} y walked: ${ys}`);
        }
      }
      assert.ok(seen[0].x > 640, `${set.id}: the hit sits east of centre, beside the results panel`);
    }
  });

  it("draws aligned place teardrops from place links in the content script", () => {
    assert.match(contentJs, /collectPoisFromAnchors/);
    assert.match(contentJs, /gcj02-poi/);
    assert.match(contentCss, /\.gcj02-poi-icon/);
    assert.match(contentJs, /placeAlignedPinActive/);
    assert.match(contentJs, /primaryPlacePoi/);
    assert.match(contentJs, /is-place-pin/);
  });
});

describe("street tiles and POI markers share one screen mapping", () => {
  const { WUZHANGYUAN } = require("../fixtures/overlay-landmarks");
  const W = 1280;
  const H = 720;

  it("returns the true tile centre on both axes", () => {
    for (const [x, y, z] of [[0, 0, 1], [13000, 6300, 14], [108517, 56284, 17]]) {
      const ll = lib.tileCenterLatLon(x, y, z);
      const p = lib.worldPixel(ll.lat, ll.lon, z);
      // x used to come back as the tile's west edge while y was the centre.
      assert.ok(Math.abs(p.x - (x + 0.5) * 256) < 1e-6, `tile ${x},${y},z${z} lon: ${p.x}`);
      assert.ok(Math.abs(p.y - (y + 0.5) * 256) < 1e-6, `tile ${x},${y},z${z} lat: ${p.y}`);
    }
  });

  // Mirror of content.js redraw(): where does tile wx/ty land on screen?
  function tileTopLeft(wx, ty, zTile, st) {
    const cam = lib.overlayCamera(st.lat, st.lon);
    const center = lib.worldPixel(cam.lat, cam.lon, st.zoom);
    const shift = lib.overlayShiftPx(cam.lat, cam.lon, st.zoom);
    const scale = 2 ** (st.zoom - zTile);
    const tileSize = 256 * scale;
    const ll = lib.tileCenterLatLon(wx, ty, zTile);
    const pW = lib.worldPixel(ll.lat, ll.lon, st.zoom);
    return {
      left: pW.x - center.x + W / 2 - tileSize / 2 + shift.dx,
      top: pW.y - center.y + H / 2 - tileSize / 2 + shift.dy,
      scale
    };
  }

  // The invariant the drift bugs broke: a GCJ coordinate must land on the same
  // screen pixel whether you get there through the street tile that draws it or
  // through the POI marker we place for it. Camera and shift cancel out of this
  // comparison, so it isolates tile placement from datum handling.
  it("draws a GCJ coordinate at one pixel via the tile and via the marker", () => {
    const poi = WUZHANGYUAN.townPoi;
    const states = [
      ...WUZHANGYUAN.zoomSets.flatMap((set) => set.steps.map((s) => lib.parseMapHref(s.href))),
      ...WUZHANGYUAN.tileAlignHrefs.map((s) => lib.parseMapHref(s.href)),
      // tileSize is not 256 at these zooms, so the half-tile error scales with
      // it. Maps only reaches them via satellite `Nm` URLs, so they are built
      // here rather than parsed from a street href it would rewrite to z16.
      ...WUZHANGYUAN.fractionalZooms.map((zoom) => ({
        lat: WUZHANGYUAN.lat,
        lon: WUZHANGYUAN.lon,
        zoom
      }))
    ];
    let checked = 0;
    for (const st of states) {
      const zTile = Math.round(st.zoom);
      const q = lib.worldPixel(poi.lat, poi.lon, zTile);
      const wx = Math.floor(q.x / 256);
      const ty = Math.floor(q.y / 256);
      const t = tileTopLeft(wx, ty, zTile, st);
      const viaTile = {
        x: t.left + (q.x - wx * 256) * t.scale,
        y: t.top + (q.y - ty * 256) * t.scale
      };
      const marker = lib.overlayPoiScreenPx(poi.lat, poi.lon, st.lat, st.lon, st.zoom, W, H);
      const dx = viaTile.x - marker.x;
      const dy = viaTile.y - marker.y;
      const why = `z=${st.zoom} tile=(${wx},${ty}) via tile (${viaTile.x.toFixed(1)},${viaTile.y.toFixed(1)}) vs marker (${marker.x.toFixed(1)},${marker.y.toFixed(1)})`;
      assert.ok(Math.abs(dx) < 0.01, `x off by ${dx.toFixed(2)}px: ${why}`);
      assert.ok(Math.abs(dy) < 0.01, `y off by ${dy.toFixed(2)}px: ${why}`);
      checked += 1;
    }
    assert.ok(checked >= 14, `only ${checked} zoom cases checked`);
  });

  it("keeps the tile grid seamless: neighbours abut exactly", () => {
    const st = { lat: WUZHANGYUAN.lat, lon: WUZHANGYUAN.lon, zoom: 16.5 };
    const zTile = Math.round(st.zoom);
    const a = tileTopLeft(13000, 6300, zTile, st);
    const east = tileTopLeft(13001, 6300, zTile, st);
    const south = tileTopLeft(13000, 6301, zTile, st);
    const tileSize = 256 * a.scale;
    assert.ok(Math.abs(east.left - (a.left + tileSize)) < 1e-6, `east seam: ${east.left - a.left}`);
    assert.ok(Math.abs(south.top - (a.top + tileSize)) < 1e-6, `south seam: ${south.top - a.top}`);
    // Content paints each tile 1px larger so fractional-zoom rounding cannot
    // open black hairlines between neighbours.
    assert.match(contentJs, /TILE_SEAM_OVERLAP_PX/);
    assert.match(contentJs, /tileSize\) \+ TILE_SEAM_OVERLAP_PX/);
    assert.match(contentCss, /border:\s*0\s*!important/);
  });

  it("places tiles from the true centre in the content script", () => {
    assert.match(contentJs, /const ll = tileCenterLatLon\(wx, ty, zTile\)/);
    assert.match(contentJs, /left = pW\.x - center\.x \+ w \/ 2 - tileSize \/ 2/);
    assert.match(contentJs, /top = pW\.y - center\.y \+ h \/ 2 - tileSize \/ 2/);
  });
});

describe("ALIGN MODES: Hybrid and Off", () => {
  const { FORBIDDEN_CITY, DUISHAN, WUZHANGYUAN, XIAMEN_XINGLIN } =
    require("../fixtures/overlay-landmarks");

  it("normalizes mode names and migrates legacy streets/satellite to hybrid", () => {
    assert.deepEqual(lib.ALIGN_MODES, ["hybrid", "off"]);
    assert.equal(lib.normalizeAlignMode("hybrid"), "hybrid");
    assert.equal(lib.normalizeAlignMode("auto"), "hybrid");
    assert.equal(lib.normalizeAlignMode("streets"), "hybrid");
    assert.equal(lib.normalizeAlignMode("on"), "hybrid");
    assert.equal(lib.normalizeAlignMode("satellite"), "hybrid");
    assert.equal(lib.normalizeAlignMode("SAT"), "hybrid");
    assert.equal(lib.normalizeAlignMode(" Blend "), "hybrid");
    assert.equal(lib.normalizeAlignMode(undefined), "hybrid");
    assert.equal(lib.normalizeAlignMode("garbage"), "hybrid");
    assert.equal(lib.normalizeAlignMode("off"), "off");
    assert.equal(lib.normalizeAlignMode("native"), "off");
  });

  it("hybrid knows when extra map layers need the vector basemap", () => {
    assert.equal(lib.hybridNeedsNativeLayers(WUZHANGYUAN.terrainHref, false), true);
    const dir =
      "https://www.google.com/maps/dir/%E6%95%85%E5%AE%AE%E5%8D%88%E9%96%80/%E5%A4%A9%E5%AE%89%E9%96%80/@39.9112947,116.3947854,1180m/data=!3m2!1e3!4b1!4m14!4m13!1m5!1m1!1s0x35f052c194aa1469:0x82c6fcd5085ca28d!2m2!1d116.39721!2d39.9138664!1m5!1m1!1s0x36637698dc4374d9:0x6928cb83a148399a!2m2!1d116.3974799!2d39.9087202!3e2";
    assert.equal(lib.hybridNeedsNativeLayers(dir, false), true);
    assert.equal(
      lib.hybridNeedsNativeLayers("https://www.google.com/maps/@39.91,116.39,15z", false),
      false
    );
    assert.equal(
      lib.hybridNeedsNativeLayers("https://www.google.com/maps/@39.91,116.39,15z", true),
      true
    );
    assert.equal(lib.hybridNeedsNativeLayers(WUZHANGYUAN.satHref, false), true);
    assert.equal(lib.hybridNeedsNativeLayers(DUISHAN.satHref, false), false);
    assert.equal(lib.hybridNeedsNativeLayers(FORBIDDEN_CITY.satHref, false), true);
    assert.equal(
      lib.hybridNeedsNativeLayers(
        "https://www.google.com/maps/search/%E7%B4%AB%E7%A6%81%E5%9F%8E/@39.9167135,116.3868853,15z/data=!4m2!2m1!6e1",
        false
      ),
      true
    );
    assert.equal(
      lib.hybridNeedsNativeLayers(
        "https://www.google.com/maps/place/%E5%A4%A9%E5%AE%89%E9%96%80/@39.9087243,116.394905,17z/data=!4m6!3m5!1s0x36637698dc4374d9:0x6928cb83a148399a!8m2!3d39.9087202!4d116.3974799!16zL20vMDF5ZG4w",
        false
      ),
      false
    );
    assert.equal(
      lib.hybridNeedsNativeLayers(
        "https://www.google.com/maps/@39.9097061,116.3989484,15.79z/data=!5m1!1e2",
        false
      ),
      true
    );
    assert.equal(
      lib.hybridNeedsNativeLayers(
        "https://www.google.com/maps/@39.9167135,116.3868853,15z/data=!5m1!1e1",
        false
      ),
      true
    );
  });

  it("placeNeedsAlignedPin XORs WGS place paths with the basemap", () => {
    const taihe = "https://www.google.com/maps/place/%E5%A4%AA%E5%92%8C%E6%AE%BF/@39.917273,116.3970962,17z";
    const t = FORBIDDEN_CITY.taihedianWgs;
    assert.equal(lib.placeNeedsAlignedPin(taihe, false), false);
    assert.equal(lib.placeNeedsAlignedPin(taihe, true), true);
    assert.equal(lib.placeNeedsAlignedPin(t.href, false), true);
    assert.equal(lib.placeNeedsAlignedPin(t.href, true), false);
  });

  it("hybrid overlay spec paints crisp satellite only on a clean photo view", () => {
    const sat = lib.overlaySpec(XIAMEN_XINGLIN.href);
    assert.equal(sat.nativeOnly, false);
    assert.equal(sat.label, "satellite");
    assert.deepEqual(sat.baseLyrs, ["s"]);
    assert.equal(sat.roadLyrs, "h");
    assert.equal(sat.hideNative, true);
    assert.equal(sat.blendNative, false);
  });

  it("detects directions route tokens on place URLs", () => {
    const placeWithDir =
      "https://www.google.com/maps/place/%E6%B8%85%E6%B0%B8%E9%99%B5/@41.7088729,124.7898743,2316m/data=!3m1!1e3!4m6!3m5!1s0x5e2e238c032cbc93:0xfcc3e337e7f95939!8m2!3d41.710262!4d124.802589!16s%2Fg%2F155q2694!4m8!1m0!1m5!1m1!1s0x5e2e238c032cbc93:0xfcc3e337e7f95939!2m2!1d124.802589!2d41.710262!3e0";
    assert.equal(lib.isDirectionsView(placeWithDir), false);
    assert.equal(lib.hasDirectionsRouteData(placeWithDir), true);
    assert.equal(lib.hybridNeedsNativeLayers(placeWithDir, false), true);
    assert.equal(lib.overlaySpec(placeWithDir).nativeOnly, true);
  });

  it("hybrid overlay spec yields native for directions, search, terrain and traffic", () => {
    const dir =
      "https://www.google.com/maps/dir/A/B/@39.91,116.39,15z";
    assert.equal(lib.overlaySpec(dir).nativeOnly, true);
    const search =
      "https://www.google.com/maps/search/%E7%B4%AB%E7%A6%81%E5%9F%8E/@39.9167135,116.3868853,15z";
    assert.equal(lib.overlaySpec(search).nativeOnly, true);
    assert.equal(lib.overlaySpec(WUZHANGYUAN.terrainHref).nativeOnly, true);
    const traffic = "https://www.google.com/maps/@39.9167135,116.3868853,15z/data=!5m1!1e1";
    assert.equal(lib.overlaySpec(traffic).nativeOnly, true);
    const map = "https://www.google.com/maps/@39.9167135,116.3868853,15z";
    assert.equal(lib.overlaySpec(map).nativeOnly, true);
  });

  it("leaves 3D / Street View views native", () => {
    const globe = "https://www.google.com/maps/@39.91,116.39,1000a,35y,15z";
    const spec = lib.overlaySpec(globe);
    assert.equal(spec.nativeOnly, true);
    assert.equal(spec.blendNative, false);
    assert.equal(spec.hideNative, false);
  });

  it("re-shows a hidden overlay: measure the layer laid out, not display:none", () => {
    const redraw = contentJs.slice(contentJs.indexOf("  function redraw() {"));
    const guard = redraw.indexOf('if (!(w >= 32) || !(h >= 32)) return;');
    const show = redraw.indexOf('if (root.style.display === "none") root.style.display = "";');
    const measure = redraw.indexOf('const box = root.getBoundingClientRect();');
    assert.ok(show > 0, "redraw must un-hide root before measuring it");
    assert.ok(show < measure, "display restore must precede the measurement");
    assert.ok(measure < guard, "measurement must precede the size guard");
  });

  it("wires Hybrid/Off mode through the content script", () => {
    assert.match(contentJs, /function maybeHybridRewindToMap/);
    assert.match(contentJs, /function hybridNeedsNativeLayers/);
    assert.match(contentJs, /function hybridYieldsNativeCanvas/);
    assert.match(contentJs, /function placeAlignedPinActive/);
    assert.match(contentJs, /function primaryPlacePoi/);
    assert.match(contentJs, /is-place-pin/);
    assert.match(contentJs, /function syncSatelliteBasemapGate/);
    assert.match(contentJs, /function datumStatusLabel/);
    assert.match(contentJs, /alignMode === "hybrid"/);
    assert.match(contentJs, /dataset\.gcj02AlignMode/);
    // Layers-panel Transit/Traffic chips must not look like directions travel modes.
    assert.match(contentJs, /layerswitcher/i);
    assert.match(contentJs, /menuitemcheckbox/);
    assert.doesNotMatch(contentJs, /blendAlign\(/);
    assert.doesNotMatch(contentJs, /function setNativeBlend/);
    assert.doesNotMatch(contentJs, /function syncRoute/);
    assert.doesNotMatch(contentJs, /persistAlignMode/);
  });
});
