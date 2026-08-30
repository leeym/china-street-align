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
    return cssArea >= 200000 || bufArea >= 200000;
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

  function inPenghuKinmenMatsu(lat, lon) {
    const la = Number(lat);
    const lo = Number(lon);
    return ROC_OFFSHORE_BOXES.some(([south, north, west, east]) =>
      inLatLonBox(la, lo, south, north, west, east)
    );
  }

  function outOfChina(lat, lon) {
    if (inTaiwanIsland(lat, lon)) return true;
    if (inPenghuKinmenMatsu(lat, lon)) return true;
    return !inChinaGcjBox(lat, lon);
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
    inChinaGcjBox,
    inTaiwanIsland,
    inPenghuKinmenMatsu,
    outOfChina,
    dataParam,
    mapDisplayType,
    mapLayerIds,
    isNativeOnlyView,
    overlaySpec,
    parseMapHref
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
