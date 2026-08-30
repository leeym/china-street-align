const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

require("../../aligner-lib.js");
const lib = globalThis.Gcj02Aligner;
const rootDir = path.join(__dirname, "..", "..");
const contentJs = fs.readFileSync(path.join(rootDir, "content.js"), "utf8");
const contentCss = fs.readFileSync(path.join(rootDir, "content.css"), "utf8");

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

  it("builds a single polygon that notches out zoom, search, and layers", () => {
    const p = lib.chromeClipPath(1440, 900);
    assert.match(p, /^polygon\(/);
    assert.match(p, /1360px/);
    assert.match(p, /660px/);
    assert.equal(lib.chromeClipPath(0, 0), "");
  });

  it("does not append the overlay root to documentElement", () => {
    assert.doesNotMatch(contentJs, /documentElement\.appendChild\(\s*root\s*\)/);
    assert.match(contentJs, /function overlayHost\(/);
    assert.match(contentJs, /insertBefore\(\s*root,\s*host\.firstChild\s*\)/);
    assert.match(contentJs, /host !== document\.body\) return \{ host/);
    assert.doesNotMatch(contentJs, /function liftMapsChrome/);
    assert.doesNotMatch(contentJs, /gcj02-keep-chrome/);
    assert.match(contentJs, /function clipHostForChrome/);
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
    assert.equal(lib.shouldHideNativeCanvas(40, 40, 40, 40), false);
    assert.equal(lib.shouldHideNativeCanvas(48, 48, 96, 96), false);
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
    }
  });

  it("uses the shared outOfChina helper from the content script", () => {
    assert.match(contentJs, /Gcj02Aligner\.outOfChina\(/);
    assert.doesNotMatch(contentJs, /lon < 72\.004/);
  });
});

describe("Google Maps layer overlay spec", () => {
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

  it("uses terrain raster tiles instead of the default roadmap", () => {
    const spec = lib.overlaySpec(TERRAIN);
    assert.equal(spec.nativeOnly, false);
    assert.equal(spec.label, "terrain");
    assert.deepEqual(spec.baseLyrs, ["t"]);
    assert.equal(spec.roadLyrs, "h");
  });

  it("adds traffic, transit, bicycling, and Street View coverage tiles", () => {
    assert.deepEqual(lib.overlaySpec(TRAFFIC).extraLyrs, ["h,traffic"]);
    assert.deepEqual(lib.overlaySpec(TRANSIT).extraLyrs, ["m,transit"]);
    assert.deepEqual(lib.overlaySpec(BIKE).extraLyrs, ["h,bike"]);
    assert.deepEqual(lib.overlaySpec(SV_COVER).extraLyrs, ["svv"]);
    const both = lib.overlaySpec(TERRAIN_TRAFFIC);
    assert.equal(both.label, "terrain");
    assert.deepEqual(both.extraLyrs, ["h,traffic"]);
  });

  it("does not treat the default map as native-only", () => {
    const spec = lib.overlaySpec(MAP);
    assert.equal(spec.nativeOnly, false);
    assert.equal(spec.label, "map");
    assert.equal(spec.roadLyrs, "m");
    assert.deepEqual(spec.baseLyrs, []);
  });

  it("hands Street View and 3D Earth back to native Maps", () => {
    assert.equal(lib.isNativeOnlyView(STREET_VIEW), true);
    assert.equal(lib.overlaySpec(STREET_VIEW).nativeOnly, true);
    assert.equal(lib.overlaySpec(STREET_VIEW_Z).nativeOnly, true);
    assert.equal(lib.overlaySpec(EARTH_3D).nativeOnly, true);
    assert.equal(lib.overlaySpec(SAT).nativeOnly, false);
  });

  it("lets the content script follow overlaySpec instead of only !1e3", () => {
    assert.match(contentJs, /overlaySpec\(/);
    assert.doesNotMatch(contentJs, /function isSatelliteView/);
    assert.match(contentJs, /spec\.nativeOnly/);
  });
});
