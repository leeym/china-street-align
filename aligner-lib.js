(function (root) {
  "use strict";

  // Overlay is position:absolute; z-index:0 inside the canvas host, after the canvas.
  // Positive z-index paints above auto-z Maps controls. position:fixed covers the viewport.
  const OVERLAY_Z = 0;
  const CHROME_Z = 1000010;

  function overlayWouldCoverMapsChrome(parentTag, position, zIndex) {
    const parent = String(parentTag || "").toUpperCase();
    const pos = String(position || "").toLowerCase();
    const z = Number(zIndex);
    if (parent === "HTML") return true;
    if (pos === "fixed") return true;
    if (z > 0) return true;
    return false;
  }

  function shouldHideNativeImage(src, inOverlay) {
    if (inOverlay) return false;
    const url = String(src || "");
    if (!url) return false;
    if (/maps\.gstatic\.com\/maps-api-v3\/mapfiles/i.test(url)) return false;
    if (/maps\.gstatic\.com\/mapfiles/i.test(url)) return false;
    if (/\/vt\//.test(url)) return true;
    if (/khms\d\.google\.com/i.test(url)) return true;
    return false;
  }

  function shouldHideNativeCanvas(cssW, cssH, bufW, bufH) {
    const cssArea = Math.max(0, cssW) * Math.max(0, cssH);
    const bufArea = Math.max(0, bufW) * Math.max(0, bufH);
    if (Math.min(cssW, cssH) < 96) return false;
    // Place pages leave a smaller map next to the sidebar (~400×320).
    return cssArea >= 80000 || bufArea >= 80000;
  }

  function defaultChromeHoles(hostW, hostH) {
    const w = Number(hostW);
    const h = Number(hostH);
    if (!(w > 0) || !(h > 0)) return [];
    return [
      { x: w - 80, y: h - 240, w: 72, h: 228 },
      { x: 8, y: 8, w: Math.min(480, w * 0.42), h: 64 },
      { x: 8, y: h - 400, w: Math.min(300, w * 0.28), h: 392 }
    ];
  }

  function chromeClipPath(hostW, hostH, _holes) {
    const w = Number(hostW);
    const h = Number(hostH);
    if (!(w > 0) || !(h > 0)) return "";
    const [zoom, search, layers] = defaultChromeHoles(w, h);
    const searchRight = search.x + search.w;
    const searchBottom = search.y + search.h;
    const zoomLeft = zoom.x;
    const zoomTop = zoom.y;
    const layerRight = layers.x + layers.w;
    const layerTop = layers.y;
    return `polygon(0px ${searchBottom}px, ${searchRight}px ${searchBottom}px, ${searchRight}px 0px, ${w}px 0px, ${w}px ${zoomTop}px, ${zoomLeft}px ${zoomTop}px, ${zoomLeft}px ${h}px, ${layerRight}px ${h}px, ${layerRight}px ${layerTop}px, 0px ${layerTop}px)`;
  }

  function chromeStacksAboveOverlay(chromeZ, overlayZ) {
    return Number(chromeZ) > Number(overlayZ);
  }

  const TILE = 256;
  const EARTH_CIRCUMFERENCE = 40075016.686;

  function worldPixel(lat, lon, z) {
    const n = 2 ** Number(z);
    const x = ((Number(lon) + 180) / 360) * n * TILE;
    const s = Math.sin((Number(lat) * Math.PI) / 180);
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * TILE;
    return { x, y };
  }

  function tileCenterLatLon(x, y, z) {
    const n = 2 ** Number(z);
    const lon = (Number(x) / n) * 360 - 180;
    const yy = (Number(y) + 0.5) / n;
    const lat = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - 2 * yy)));
    return { lat, lon };
  }

  // Pixel translation that moves a GCJ-02 tile onto the WGS-84 camera.
  function overlayShiftPx(lat, lon, zoom) {
    const wgs = worldPixel(lat, lon, zoom);
    const gcj = wgsToGcj(lat, lon);
    const shifted = worldPixel(gcj.lat, gcj.lon, zoom);
    const dx = wgs.x - shifted.x;
    const dy = wgs.y - shifted.y;
    return { dx, dy, hypot: Math.hypot(dx, dy) };
  }

  // Google street tiles are indexed in WGS mercator but drawn in GCJ-02.
  // Fetch the GCJ tile that belongs on this WGS slot and align the GCJ
  // feature at the tile center onto the WGS center (no CSS translate of a
  // WGS-indexed image — that Y slide is wrong near 105°E, 35°N / 五丈原).
  function overlayRoadTile(x, y, z) {
    const zTile = Number(z);
    const ll = tileCenterLatLon(x, y, zTile);
    const gcj = wgsToGcj(ll.lat, ll.lon);
    const p = worldPixel(gcj.lat, gcj.lon, zTile);
    const max = 2 ** zTile;
    const gx = ((Math.floor(p.x / TILE) % max) + max) % max;
    const gy = Math.floor(p.y / TILE);
    return {
      x: gx,
      y: gy,
      fracX: p.x - Math.floor(p.x / TILE) * TILE,
      fracY: p.y - gy * TILE
    };
  }

  // Maps !3d / sidebar coordinates are GCJ-02, same as the camera @.
  // Convert longitude onto the remapped street tiles (west, with X235) but
  // keep the GCJ latitude: at 五丈原 the public evil transform's northing
  // overshoots G310 even though Off places those pins south of the highway.
  function overlayPoiScreenPx(placeLat, placeLon, camLat, camLon, zoom, width, height) {
    const center = worldPixel(camLat, camLon, zoom);
    const wgs = gcjToWgs(placeLat, placeLon);
    const p = worldPixel(placeLat, wgs.lon, zoom);
    return {
      x: p.x - center.x + Number(width) / 2,
      y: p.y - center.y + Number(height) / 2,
      lat: Number(placeLat),
      lon: wgs.lon
    };
  }
  // Google Maps satellite URLs encode camera span as `Nm`, not `z`.
  // That meter value is the mercator ground width of a 5-tile (1280px) viewport,
  // not the browser window. Using innerWidth on a 1920–2560px display inflates
  // zoom by about one level vs the matching `15z` street URL.
  const MAPS_URL_METERS_VIEW_PX = TILE * 5;

  function metersPerPixelAtZoom0(lat) {
    return (EARTH_CIRCUMFERENCE / TILE) * Math.cos((Number(lat) * Math.PI) / 180);
  }

  function metersToZoom(lat, meters, viewPx) {
    const groundWidth = Math.max(Number(meters) || 0, 1);
    const width = Math.max(Number(viewPx) || MAPS_URL_METERS_VIEW_PX, 1);
    return Math.log2((metersPerPixelAtZoom0(lat) * width) / groundWidth);
  }

  function zoomToGroundMeters(lat, zoom, viewPx) {
    const width = Math.max(Number(viewPx) || MAPS_URL_METERS_VIEW_PX, 1);
    return (metersPerPixelAtZoom0(lat) * width) / 2 ** Number(zoom);
  }

  function overlayTileSize(zoom) {
    const z = Number(zoom);
    const zTile = Math.min(21, Math.max(0, Math.round(z)));
    return TILE * 2 ** (z - zTile);
  }

  // Classic WGS↔GCJ literature box. It is not a political border; it includes
  // Taiwan even though Google Maps there is WGS-84 on both layers.
  function inChinaGcjBox(lat, lon) {
    const la = Number(lat);
    const lo = Number(lon);
    return lo >= 72.004 && lo <= 137.8347 && la >= 0.8293 && la <= 55.8271;
  }

  function inLatLonBox(lat, lon, south, north, west, east) {
    return lat >= south && lat <= north && lon >= west && lon <= east;
  }

  // Taiwan main island (Formosa). West of 120.03°E stays on the Fujian side
  // of the strait (Xiamen ~118.07°E, Pingtan ~119.8°E).
  function inTaiwanIsland(lat, lon) {
    return inLatLonBox(Number(lat), Number(lon), 21.88, 25.32, 120.03, 122.01);
  }

  // Penghu, Kinmen (incl. Lieyu / Wuqiu), and Matsu. Boxes stay east of
  // Xiamen (~118.07°E) and off the Fujian coast (Huangqi ~119.85°E).
  const ROC_OFFSHORE_BOXES = [
    [23.18, 23.80, 119.30, 119.70], // Penghu
    [24.392, 24.527, 118.295, 118.46], // Greater Kinmen
    [24.408, 24.452, 118.215, 118.275], // Lieyu
    [24.365, 24.395, 118.148, 118.185], // Dadan / Erdan
    [24.977, 25.005, 119.443, 119.479], // Wuqiu
    [26.135, 26.18, 119.905, 119.965], // Nangan
    [26.21, 26.255, 119.965, 120.025], // Beigan
    [26.355, 26.39, 120.465, 120.515], // Dongyin
    [25.945, 25.995, 119.915, 120.0] // Juguang
  ];

  // Xiamen island, Jimei, and Huli west of the Kinmen channel.
  // 兑山村 (24.606°N, 118.084°E) is Jimei, PRC — not Kinmen.
  // South of 24.40°N keeps Dadan/Erdan (ROC) out of this box.
  // East of 118.20°E keeps Lieyu out.
  function inXiamenMainland(lat, lon) {
    return inLatLonBox(Number(lat), Number(lon), 24.40, 24.72, 117.88, 118.20);
  }

  function inPenghuKinmenMatsu(lat, lon) {
    const la = Number(lat);
    const lo = Number(lon);
    return ROC_OFFSHORE_BOXES.some(([south, north, west, east]) =>
      inLatLonBox(la, lo, south, north, west, east)
    );
  }

  function outOfChina(lat, lon) {
    if (inXiamenMainland(lat, lon)) return false;
    if (inTaiwanIsland(lat, lon)) return true;
    if (inPenghuKinmenMatsu(lat, lon)) return true;
    return !inChinaGcjBox(lat, lon);
  }

  const A = 6378245.0;
  const EE = 0.00669342162296594323;

  function transformLat(x, y) {
    let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    r += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
    r += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
    return r;
  }

  function transformLon(x, y) {
    let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    r += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
    r += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
    return r;
  }

  function wgsToGcj(lat, lon) {
    if (outOfChina(lat, lon)) return { lat, lon };
    let dLat = transformLat(lon - 105, lat - 35);
    let dLon = transformLon(lon - 105, lat - 35);
    const rad = lat * Math.PI / 180;
    const magic = 1 - EE * Math.sin(rad) ** 2;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180) / ((A * (1 - EE)) / (magic * sqrtMagic) * Math.PI);
    dLon = (dLon * 180) / (A / sqrtMagic * Math.cos(rad) * Math.PI);
    return { lat: lat + dLat, lon: lon + dLon };
  }

  function gcjToWgs(lat, lon) {
    if (outOfChina(lat, lon)) return { lat, lon };
    let wgsLat = lat;
    let wgsLon = lon;
    for (let i = 0; i < 4; i++) {
      const g = wgsToGcj(wgsLat, wgsLon);
      wgsLat += lat - g.lat;
      wgsLon += lon - g.lon;
    }
    return { lat: wgsLat, lon: wgsLon };
  }

  function parsePlaceCoords(href) {
    const url = String(href || "");
    const d = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (d) return { lat: +d[1], lon: +d[2] };
    const placeAt = url.match(/\/maps\/place\/[^/@]*\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (placeAt) return { lat: +placeAt[1], lon: +placeAt[2] };
    return null;
  }

  function classifyPoiKind(blob, name) {
    const s = String(blob || "");
    const n = String(name || "").trim();
    let slice = s;
    if (n) {
      const i = s.indexOf(n);
      if (i >= 0) slice = s.slice(i, i + 200);
    }
    const attr = slice.search(/旅遊景點|旅游景点|Tourist attraction|Scenic|風景區|风景区/i);
    const hist = slice.search(/歷史遺址|历史遗址|歷史古跡|历史古迹|Historical landmark|Historic site|Heritage site|Castle|城樓|城楼|午門|午门|遺址博物館|遗址博物馆/i);
    if (attr >= 0 && (hist < 0 || attr <= hist)) return "attraction";
    if (hist >= 0) return "historic";
    if (/博物館|博物院|Museum/i.test(slice)) return "historic";
    return "place";
  }

  // Google Maps draws these as vector glyphs on the native canvas (camera =
  // tourist attraction, gate tower = historic site). Overlay recreates them.
  function poiMarkerSpec(kind) {
    const k = String(kind || "place");
    if (k === "historic") {
      return {
        kind: "historic",
        fill: "#C48A5A",
        path: "M5 19h14v1.4H5zm1.4-1.2h11.2V10.4L12 5.8 6.4 10.4zm3.2-7.2h1.6v7.2H9.6zm3.2 0h1.6v7.2h-1.6zM8 10.1l4-3.2 4 3.2V8.4L12 5.2 8 8.4z"
      };
    }
    if (k === "attraction") {
      return {
        kind: "attraction",
        fill: "#F28B82",
        path: "M8.2 8.1h1.3l.9-1.3h3.2l.9 1.3h1.3c.9 0 1.7.8 1.7 1.7v5.1c0 .9-.8 1.7-1.7 1.7H8.2c-.9 0-1.7-.8-1.7-1.7V9.8c0-.9.8-1.7 1.7-1.7zm3.8 6.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8zm0-1.5a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8z"
      };
    }
    return {
      kind: "place",
      fill: "#EA4335",
      path: "M12 4.2c-2.7 0-4.9 2.1-4.9 4.8 0 3.6 4.9 8.8 4.9 8.8s4.9-5.2 4.9-8.8c0-2.7-2.2-4.8-4.9-4.8zm0 6.5a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4z"
    };
  }

  function collectPoisFromAnchors(anchors) {
    const seen = new Set();
    const out = [];
    for (const a of anchors || []) {
      const href = String(a.href || "");
      if (!/\/maps\/place\//.test(href)) continue;
      const c = parsePlaceCoords(href);
      if (!c) continue;
      const key = `${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const name = String(a.label || "").replace(/\s+/g, " ").trim().split(" · ")[0].slice(0, 48);
      const kind = classifyPoiKind(`${a.label || ""} ${a.category || ""}`, name);
      out.push({ lat: c.lat, lon: c.lon, name, kind });
      if (out.length >= 24) break;
    }
    return out;
  }

  function dataParam(href) {
    const m = String(href || "").match(/[?&/]data=([^&#]*)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  function mapDisplayType(data) {
    const m = String(data || "").match(/!3m\d+!1e(\d+)/);
    return m ? Number(m[1]) : 0;
  }

  function mapLayerIds(data) {
    const ids = [];
    const re = /!5m\d+((?:!1e\d+)+)/g;
    let m;
    while ((m = re.exec(String(data || "")))) {
      for (const e of m[1].matchAll(/!1e(\d+)/g)) ids.push(Number(e[1]));
    }
    return ids;
  }

  function isNativeOnlyView(href) {
    const url = String(href || "");
    if (/@-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,[\d.]+a,/.test(url)) return true;
    const type = mapDisplayType(dataParam(url));
    return type === 1 || type === 2;
  }

  function overlaySpec(href) {
    const url = String(href || "");
    if (isNativeOnlyView(url)) {
      return {
        nativeOnly: true,
        label: "native",
        baseLyrs: [],
        roadLyrs: "",
        extraLyrs: []
      };
    }
    const data = dataParam(url);
    const type = mapDisplayType(data);
    const layers = mapLayerIds(data);
    const extras = layers.filter((id) => id !== 4);
    const satellite = type === 3;
    const terrain = !satellite && layers.includes(4);
    const extraLyrs = [];
    if (extras.includes(1)) extraLyrs.push("h,traffic");
    if (extras.includes(2)) extraLyrs.push("m,transit");
    if (extras.includes(3)) extraLyrs.push("h,bike");
    if (extras.includes(5)) extraLyrs.push("svv");
    if (satellite) {
      return { nativeOnly: false, label: "satellite", baseLyrs: ["s"], roadLyrs: "h", extraLyrs };
    }
    if (terrain) {
      // Native terrain is the colored roadmap plus hillshade (`lyrs=p`).
      // `lyrs=t` is grayscale relief only; stacking it with satellite `h`
      // labels made the overlay look black-and-white.
      return { nativeOnly: false, label: "terrain", baseLyrs: [], roadLyrs: "p", extraLyrs };
    }
    return { nativeOnly: false, label: "map", baseLyrs: [], roadLyrs: "m", extraLyrs };
  }

  function parseMapHref(href) {
    const url = String(href || "");
    const zMatch = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z\b/);
    const mMatch = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)m\b/);
    if (zMatch) {
      return { lat: +zMatch[1], lon: +zMatch[2], zoom: +zMatch[3] };
    }
    if (mMatch) {
      return { lat: +mMatch[1], lon: +mMatch[2], zoom: metersToZoom(+mMatch[1], +mMatch[3]) };
    }
    return null;
  }

  root.Gcj02Aligner = {
    OVERLAY_Z,
    CHROME_Z,
    TILE,
    EARTH_CIRCUMFERENCE,
    MAPS_URL_METERS_VIEW_PX,
    overlayWouldCoverMapsChrome,
    shouldHideNativeImage,
    shouldHideNativeCanvas,
    chromeStacksAboveOverlay,
    chromeClipPath,
    defaultChromeHoles,
    metersToZoom,
    zoomToGroundMeters,
    overlayTileSize,
    worldPixel,
    tileCenterLatLon,
    overlayShiftPx,
    overlayRoadTile,
    overlayPoiScreenPx,
    inChinaGcjBox,
    inTaiwanIsland,
    inXiamenMainland,
    inPenghuKinmenMatsu,
    outOfChina,
    wgsToGcj,
    gcjToWgs,
    parsePlaceCoords,
    classifyPoiKind,
    poiMarkerSpec,
    collectPoisFromAnchors,
    dataParam,
    mapDisplayType,
    mapLayerIds,
    isNativeOnlyView,
    overlaySpec,
    parseMapHref
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
