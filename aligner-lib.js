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

  function chromeClipPath(_hostW, _hostH, _holes) {
    // Empty on purpose: notching the canvas host exposed the page background
    // (white) once native tiles were hidden. Overlay is z-index 0 with
    // pointer-events:none, so Maps chrome stays above and clickable while
    // aligned tiles paint under the corner controls — same as outside China.
    return "";
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

  // Centre of tile x/y/z, both axes. The +0.5 on x used to be missing, so this
  // returned the tile's WEST EDGE longitude with its CENTRE latitude. Callers
  // that subtract tileSize/2 to get a top-left corner then placed every tile
  // half a tile (128px at scale 1) too far west, at every zoom — POIs sat on
  // the correct pixel while the roads under them did not.
  function tileCenterLatLon(x, y, z) {
    const n = 2 ** Number(z);
    const lon = ((Number(x) + 0.5) / n) * 360 - 180;
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

  // The URL `@lat,lon` is usually GCJ-02 in China — the same datum as sidebar
  // !3d/!4d for named places, which is why the Off pin sits on the Off street map.
  // Exception: `/maps/place/<DMS or decimal lat,lon>/` queries are WGS-84 (Off
  // satellite pins them on the true feature; treating them as GCJ slid 太和殿 west).
  // opts.wgs84: leave camera/place in WGS (still CSS-shift GCJ street tiles).
  function overlayCamera(camLat, camLon, opts) {
    if (opts && opts.wgs84) return { lat: Number(camLat), lon: Number(camLon) };
    return gcjToWgs(Number(camLat), Number(camLon));
  }

  // Sidebar !3d is GCJ-02 and matches Off pin mercator. Overlay street tiles all
  // take one camera overlayShiftPx (rigid) so POIs must use that same vector —
  // per-tile shifts made pins drift vs roads across zoom. Never multiply the
  // pixel shift; EW/NS follow overlayShiftPx at every z.
  // camLat/camLon are the raw URL `@` values; the GCJ→WGS step happens here
  // unless opts.wgs84 (lat/lon place query).
  function overlayPoiScreenPx(placeLat, placeLon, camLat, camLon, zoom, width, height, opts) {
    const cam = overlayCamera(camLat, camLon, opts);
    const center = worldPixel(cam.lat, cam.lon, zoom);
    if (opts && opts.wgs84) {
      const p = worldPixel(Number(placeLat), Number(placeLon), zoom);
      return {
        x: p.x - center.x + Number(width) / 2,
        y: p.y - center.y + Number(height) / 2,
        lat: Number(placeLat),
        lon: Number(placeLon),
        dx: 0,
        dy: 0
      };
    }
    const raw = worldPixel(placeLat, placeLon, zoom);
    const s = overlayShiftPx(cam.lat, cam.lon, zoom);
    const wgs = gcjToWgs(placeLat, placeLon);
    return {
      x: raw.x - center.x + Number(width) / 2 + s.dx,
      y: raw.y - center.y + Number(height) / 2 + s.dy,
      lat: wgs.lat,
      lon: wgs.lon,
      dx: s.dx,
      dy: s.dy
    };
  }

  // Two ways to satisfy the one rule that matters (WGS-84 satellite must line up
  // with every GCJ-02 layer):
  // "hybrid" — crisp aligned satellite when possible; force native map when extra
  // layers are needed. "off" is native Maps. Legacy streets/satellite/on map to hybrid.
  const ALIGN_MODES = ["hybrid", "off"];

  function normalizeAlignMode(v) {
    const s = String(v == null ? "" : v).trim().toLowerCase();
    if (s === "off" || s === "native") return "off";
    if (s === "hybrid" || s === "auto" || s === "smart") return "hybrid";
    if (
      s === "satellite" || s === "sat" || s === "imagery" || s === "blend"
      || s === "on" || s === "streets" || s === "street"
    ) {
      return "hybrid";
    }
    return "hybrid";
  }

  function isDirectionsView(href) {
    const url = String(href || "");
    return /\/maps\/dir(?:\/|$|[?#])/i.test(url);
  }

  // Directions opened from a Place page can keep `/maps/place/` while the `data=`
  // blob picks up route legs (`!1m0!1m5…`, `!4m14!4m13…`, …).
  function hasDirectionsRouteData(href) {
    const data = dataParam(href);
    if (!data) return false;
    if (/!1m0!1m5!1m1!1s/i.test(data)) return true;
    if (/!4m1[4-9]!4m1[0-9]/i.test(data)) return true;
    const legs = data.match(/!1m5!1m1!1s0x[a-f0-9]+:0x[a-f0-9]+/gi);
    return !!(legs && legs.length >= 2);
  }

  function isSearchView(href) {
    return /\/maps\/search\//i.test(String(href || ""));
  }

  function isPlaceView(href) {
    return /\/maps\/place\//i.test(String(href || ""));
  }

  // Hybrid mode: crisp satellite only on a clean map. Block satellite for views
  // where we must keep Google's native canvas (search pins, directions, terrain,
  // traffic, pegman). Place pages on the map basemap use native pins; on
  // satellite they use aligned WGS imagery under the native canvas (no repaint).
  function hybridNeedsNativeLayers(href, pegmanCover) {
    if (isTerrainView(href)) return true;
    if (isDirectionsView(href)) return true;
    if (hasDirectionsRouteData(href)) return true;
    if (isSearchView(href)) return true;
    if (pegmanCover) return true;
    const ids = mapLayerIds(dataParam(href));
    return ids.some((id) => id === 1 || id === 2 || id === 3 || id === 5);
  }

  // Blended mode camera. The native canvas keeps drawing the GCJ-02 world around
  // the URL `@`, so the WGS-84 imagery layer must be centred on gcjToWgs(@).
  // That includes `/maps/place/<lat,lon>/` queries: Maps still frames `@` in GCJ.
  function imageryCamera(camLat, camLon) {
    return gcjToWgs(Number(camLat), Number(camLon));
  }

  // Screen pixel of a WGS-84 feature on the blended imagery layer.
  function imageryScreenPx(wgsLat, wgsLon, camLat, camLon, zoom, width, height) {
    const cam = imageryCamera(camLat, camLon);
    return gcjLatLonToScreenPx(
      Number(wgsLat), Number(wgsLon), cam.lat, cam.lon, zoom, width, height
    );
  }

  // Place path is an explicit coordinate (DMS or decimal pair), not a named POI.
  function isLatLonPlaceName(name) {
    const s = String(name || "")
      .replace(/\+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!s) return false;
    // 39°54'57.0"N 116°23'26.0"E (and unicode degree / quote variants)
    if (
      /\d+\s*[°º]/.test(s)
      && /[NnSs]/.test(s)
      && /[EeWw]/.test(s)
    ) {
      return true;
    }
    // 39.9158333,116.3905556
    if (/^-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?$/.test(s)) return true;
    return false;
  }

  function urlCoordsAreWgs84(href) {
    return isLatLonPlaceName(placeNameFromHref(href));
  }

  // Named GCJ place pins match Off on the map; WGS lat/lon paths match Off on
  // satellite. The other basemap needs one aligned teardrop from the overlay.
  function placeNeedsAlignedPin(href, satelliteBasemap) {
    if (!isPlaceView(href)) return false;
    return urlCoordsAreWgs84(href) !== !!satelliteBasemap;
  }

  function placeNameFromHref(href) {
    const m = String(href || "").match(/\/maps\/place\/([^/@]+)/);
    if (!m) return "";
    try {
      const s = decodeURIComponent(m[1].replace(/\+/g, " "));
      if (!s || /^data=/i.test(s)) return "";
      return s;
    } catch (_e) {
      return "";
    }
  }

  function isGenericPoiName(name) {
    return /^(結果|结果|Results?|Map results?|Search results?)$/i.test(String(name || "").trim());
  }

  // aria-label often appends ":開啟過的連結" / "Opened link"; place pages use h1 "結果".
  // Maps may omit the colon, use uncommon colon glyphs, or insert ZWSP.
  const POI_VISITED_SUFFIX =
    "開啟過的連結|打开过的链接|已造訪的連結|已访问的链接|Opened link|Previously visited|Visited link";

  function cleanPoiName(label) {
    let s = String(label || "")
      .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    s = s.replace(
      new RegExp(`[:：﹕︰]\\s*(?:${POI_VISITED_SUFFIX})(?:\\s.*)?$`, "i"),
      ""
    );
    s = s.replace(
      new RegExp(`\\s*[–—\\-·•,]\\s*(?:${POI_VISITED_SUFFIX})(?:\\s.*)?$`, "i"),
      ""
    );
    s = s.replace(
      new RegExp(`\\s*[\\(（]\\s*(?:${POI_VISITED_SUFFIX})\\s*[\\)）]\\s*$`, "i"),
      ""
    );
    // No separator: "五丈原鎮開啟過的連結" / "五丈原鎮 Opened link"
    s = s.replace(new RegExp(`\\s*(?:${POI_VISITED_SUFFIX})\\s*$`, "i"), "");
    s = s.split(" · ")[0].trim();
    if (isGenericPoiName(s)) return "";
    return s.slice(0, 48);
  }

  function labelHasVisitedSuffix(label) {
    return new RegExp(POI_VISITED_SUFFIX, "i").test(String(label || ""));
  }

  // Place URLs often encode a full mailing address as the path segment, e.g.
  // 「中國北京市東城區故宮 邮政编码: 100006」. That must not become the pin title.
  function isAddressLikePlaceTitle(name) {
    const s = String(name || "").trim();
    if (!s) return false;
    if (/郵政編碼|邮政编码|Postal\s*code/i.test(s)) return true;
    // 「中國北京市東城區故宮」is still a mailing path after the postal suffix is
    // stripped — do not require length > 16 (that form is only ~10 chars).
    if (/(?:中國|中国).*(?:省|市).*(?:區|区|縣|县)/.test(s)) return true;
    return s.length > 16 && /(?:中國|中国).*(?:省|市|區|区|縣|县)/.test(s);
  }

  function shortPlaceTitleFromPath(pathName) {
    let s = cleanPoiName(String(pathName || "").replace(/\+/g, " "));
    if (!s) return "";
    s = s
      .replace(/\s*郵政編碼\s*[:：]?\s*\d+.*$/i, "")
      .replace(/\s*邮政编码\s*[:：]?\s*\d+.*$/i, "")
      .replace(/\s*Postal\s*code\s*[:：]?\s*\d+.*$/i, "")
      .trim();
    const known = s.match(/(紫禁城|故宮博物院|故宫博物院|故宮|故宫|天安門|天安门|五丈原鎮|五丈原)/);
    if (known) return known[1];
    // Prefer the last admin-unit segment (區/路/…) over an early 市 match.
    const tail = s.match(/(?:區|区|縣|县|鎮|镇|路|街)([\u4e00-\u9fffA-Za-z0-9]{2,12})$/);
    if (tail && !isAddressLikePlaceTitle(tail[1]) && !/(?:省|市|區|区|縣|县)/.test(tail[1])) {
      return cleanPoiName(tail[1]);
    }
    if (s && !isAddressLikePlaceTitle(s) && s.length <= 16) return s;
    return "";
  }

  // Sidebar articles list a short blurb under the category line, e.g.
  // 「附設博物館的 1420 年宮殿建築群」. Off paints it under the title in the
  // hover tooltip; On must do the same.
  function extractPoiDescription(name, articleText) {
    const n = String(name || "").trim();
    const lines = String(articleText || "")
      .split(/\n+/)
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const isName = (l) => {
      const t = cleanPoiName(l);
      return !!n && (
        l === n
        || t === n
        || l.startsWith(`${n} `)
        || l.startsWith(`${n}:`)
        || l.startsWith(`${n}：`)
        || t.startsWith(`${n} `)
      );
    };
    const isRating = (l) =>
      /^\d+(\.\d+)?$/.test(l)
      || /^\(\s*[\d,]+\s*\)/.test(l)
      // "4.6(2,909)" / "4.6 (2,909)" / "4.6 · (2,909)" — never a description.
      || /^\d+(\.\d+)?\s*[\(（]?\s*[\d,]+\s*[\)）]?/.test(l)
      || /^[\d,]+\s*(則|reviews?|個評分|ratings?)/i.test(l)
      || /^\d+(\.\d+)?\s*[★⭐]/.test(l);
    const isCategory = (l) => {
      if (/·|•/.test(l) && /旅遊景點|旅游景点|歷史|历史|遺址|遗址|Tourist|Historic|Museum|博物館|博物院|風景|风景|公园|公園|餐廳|饭店|Hotel|酒店/.test(l)) {
        return true;
      }
      return /^(旅遊景點|旅游景点|歷史遺址|历史遗址|遺址博物館|遗址博物馆|Tourist attraction|Historic site|Museum|博物館|博物院|風景區|风景区|公园|公園)$/i.test(l);
    };
    const isHours = (l) =>
      /已打烊|營業中|临时关闭|暫時關閉|Closed|Opens?\b|Closes?\b|開始營業|24\s*小時|Open 24|Hours?/i.test(l);

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (isName(line) || isRating(line) || isCategory(line) || isHours(line) || labelHasVisitedSuffix(line)) {
        i += 1;
        continue;
      }
      const cleaned = cleanPoiName(line);
      if (!cleaned || cleaned === n || isName(cleaned) || labelHasVisitedSuffix(cleaned)) {
        i += 1;
        continue;
      }
      if (isAddressLikePlaceTitle(cleaned) || /郵政編碼|邮政编码|Postal\s*code/i.test(cleaned)) {
        i += 1;
        continue;
      }
      if (cleaned.length < 4 || cleaned.length > 100) {
        i += 1;
        continue;
      }
      if (/^[\d,.\s()（）]+$/.test(cleaned)) {
        i += 1;
        continue;
      }
      return cleaned.slice(0, 90);
    }
    return "";
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
      // Search result links often use /maps/place/A/…; the real name is in aria-label.
      // Place pages set h1 to「結果」— cleanPoiName drops that so the path name wins.
      // Visited arias like「五丈原鎮：開啟過的連結」are stripped in cleanPoiName.
      let fromPath = cleanPoiName(placeNameFromHref(href));
      if (isAddressLikePlaceTitle(fromPath)) {
        fromPath = shortPlaceTitleFromPath(fromPath);
      }
      const fromLabel = cleanPoiName(a.label);
      let name = fromLabel || fromPath;
      // If cleaning failed and the name still carries a visited suffix, fall back
      // to the path — but never prefer a path over a successfully cleaned label
      // (Maps often uses an English slug in the href).
      if (labelHasVisitedSuffix(name) && fromPath && !labelHasVisitedSuffix(fromPath)) {
        name = fromPath;
      }
      if (isAddressLikePlaceTitle(name)) {
        name = shortPlaceTitleFromPath(name) || fromLabel || "";
      }
      if (!name || labelHasVisitedSuffix(name) || isAddressLikePlaceTitle(name)) continue;
      const kind = classifyPoiKind(`${a.label || ""} ${a.category || ""} ${a.article || ""} ${name}`, name);
      let description = extractPoiDescription(name, a.article || "");
      if (description === name || labelHasVisitedSuffix(description) || isAddressLikePlaceTitle(description)) {
        description = "";
      }
      out.push({ lat: c.lat, lon: c.lon, name, kind, description });
      if (out.length >= 24) break;
    }
    return out;
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

  // Inside the literature GCJ box but outside PRC / HK / Macau map territory.
  // Conservative lat/lon rectangles — not a political border.
  const GCJ_BOX_EXCLUSIONS = [
    [46.0, 52.5, 87.0, 107.0], // Mongolia (west / central, incl. Ulaanbaatar)
    [49.0, 52.5, 107.0, 116.5], // Mongolia (east; stops west of Hulunbuir ~119.8°E)
    [39.0, 55.0, 72.0, 82.5], // Kazakhstan / central Asia
    [35.0, 43.0, 72.0, 75.5], // Kyrgyzstan / Tajikistan / Afghanistan (far west)
    [26.3, 30.5, 80.0, 88.5], // Nepal
    [26.5, 28.5, 88.5, 92.0], // Bhutan
    [6.5, 35.5, 68.0, 78.5], // India (north / west of Himalayas)
    [9.0, 28.5, 92.0, 100.5], // Myanmar
    [13.5, 22.3, 100.0, 107.0], // Laos
    [8.0, 20.5, 102.0, 106.5], // Vietnam (south)
    [20.5, 22.5, 104.0, 106.8], // Vietnam (north, west of Guangxi / Yunnan)
    // North Korea — stepped edges so Liaoning / Jilin / Yanbian stay in.
    [37.5, 39.95, 124.25, 128.5], // southern / western NK (Pyongyang); south of Dandong
    [39.95, 42.2, 126.2, 130.5], // mid-north NK (Chongjin); south/west of Yanji / Hunchun
    [33.0, 39.5, 124.5, 132.0], // South Korea
    // Japan — keep west of Kyushu/Honshu; do not swallow Yanbian / Mudanjiang.
    [24.0, 37.0, 129.0, 137.8], // Ryukyu / Kyushu / Shikoku / south Honshu
    [37.0, 46.0, 130.5, 137.8], // north Honshu / west Hokkaido
    [0.8, 21.0, 117.0, 127.0], // Philippines
    [42.0, 55.0, 131.0, 137.8] // Russia (Far East, east of Heilongjiang)
  ];

  function inExcludedNeighborRegion(lat, lon) {
    const la = Number(lat);
    const lo = Number(lon);
    return GCJ_BOX_EXCLUSIONS.some(([south, north, west, east]) =>
      inLatLonBox(la, lo, south, north, west, east)
    );
  }

  function outOfChina(lat, lon) {
    if (inXiamenMainland(lat, lon)) return false;
    if (inTaiwanIsland(lat, lon)) return true;
    if (inPenghuKinmenMatsu(lat, lon)) return true;
    if (!inChinaGcjBox(lat, lon)) return true;
    if (inExcludedNeighborRegion(lat, lon)) return true;
    return false;
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

  // Classic Maps hover / place pin (red teardrop). SVG path is a fallback glyph;
  // Places overlay uses the baked spotlight_pin_v4 composite in assets/.
  const POI_HOVER_TEARDROP = {
    fill: "#EA4335",
    // Tip at bottom-centre so translate(-50%, -100%) parks the point on the place.
    path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"
  };

  // Exact Places teardrop: Maps' spotlight_pin_v4 outline+fill+dot templates,
  // recolored to native reds (see scripts/bake-place-pin.js). Not the older
  // maps.gstatic spotlight-poi2 sprite, which is a different shape.
  function nativeSpotlightPin(scale) {
    const hdpi = Number(scale) !== 1;
    return {
      path: hdpi ? "assets/place-pin-hdpi.png" : "assets/place-pin.png",
      width: 28,
      height: 39
    };
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

  function poiHoverTeardropSpec() {
    return { kind: "hover", fill: POI_HOVER_TEARDROP.fill, path: POI_HOVER_TEARDROP.path };
  }

  function nativeSpotlightPinSpec(scale) {
    return nativeSpotlightPin(scale);
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

  function isTerrainView(href) {
    const data = dataParam(href);
    return mapDisplayType(data) !== 3 && mapLayerIds(data).includes(4);
  }

  function terrainOverlaySpec(extraLyrs) {
    // Alignment first: shifted street `m`, unshifted WGS shade `t`, shifted hybrid `h`
    // on top for vivid roads. Never CSS-shift combined `p` — cliffs move with roads
    // (X235 climbs the west 五丈原 face). Native `p` looks brighter but breaks align.
    return {
      nativeOnly: false,
      label: "terrain",
      baseLyrs: [],
      roadLyrs: "m",
      topLyrs: "h",
      shadeLyrs: ["t"],
      extraLyrs,
      hideNative: true,
      blendNative: false
    };
  }

  function isNativeOnlyView(href) {
    const url = String(href || "");
    if (/@-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,[\d.]+a,/.test(url)) return true;
    const type = mapDisplayType(dataParam(url));
    return type === 1 || type === 2;
  }

  // Blended mode needs Maps' own basemap to be the vector map: in Maps' satellite
  // view the canvas paints its own unshifted WGS imagery, and multiplying our
  // shifted imagery under that double-exposes the photo. Drop the leading
  // display-type group (`!3m1!1e3`, `!3m2!1e3!4b1`) so Maps loads the map
  // basemap and our layer supplies the (aligned) imagery. Returns "" when the
  // view is not satellite or the data param is a shape we cannot edit safely —
  // Maps data params are length-prefixed, so a blind splice corrupts them.
  // Maps stores the basemap as a user preference, not just a URL parameter: it
  // re-adds `data=!3m1!1e3` on the next navigation, so rewriting the URL and
  // reloading cannot win. Blended mode flips the basemap through Maps' own
  // corner toggle instead (no reload, and the preference sticks).
  //
  // That toggle is a square control in the bottom-left corner of the map canvas
  // showing a thumbnail of the OTHER basemap. Matching on geometry keeps it
  // language-independent; Maps' class names are obfuscated and its aria-label is
  // localized ("Interactive map").
  const BASEMAP_TOGGLE_MIN_PX = 55;
  const BASEMAP_TOGGLE_MAX_PX = 110;
  const BASEMAP_TOGGLE_EDGE_PX = 16;

  function isBasemapToggleBox(box, canvasBox) {
    if (!box || !canvasBox) return false;
    const w = Number(box.width);
    const h = Number(box.height);
    if (!(w >= BASEMAP_TOGGLE_MIN_PX && w <= BASEMAP_TOGGLE_MAX_PX)) return false;
    if (!(h >= BASEMAP_TOGGLE_MIN_PX && h <= BASEMAP_TOGGLE_MAX_PX)) return false;
    // Inside the canvas, hugging its bottom-left corner but clear of the very
    // edge: the map canvas often starts at x=0, *under* the page's own left rail,
    // so `left >= canvas.left` alone still matches the rail's "Get app" button.
    // The real widget carries a margin from the map edge.
    if (Number(box.left) < Number(canvasBox.left) + BASEMAP_TOGGLE_EDGE_PX) return false;
    if (Number(box.left) > Number(canvasBox.left) + 140) return false;
    if (Number(box.bottom) > Number(canvasBox.bottom) + 8) return false;
    if (Number(box.bottom) < Number(canvasBox.bottom) - 180) return false;
    return true;
  }


  function decodeGooglePolyline(str) {
    const coords = [];
    let index = 0;
    let lat = 0;
    let lon = 0;
    const s = String(str || "");
    while (index < s.length) {
      let shift = 0;
      let result = 0;
      let b;
      do {
        b = s.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
      lat += dlat;
      shift = 0;
      result = 0;
      do {
        b = s.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
      lon += dlng;
      coords.push({ lat: lat / 1e5, lon: lon / 1e5 });
    }
    return coords;
  }

  // Google Maps /preview/directions embeds step polylines as encoded strings and
  // explicit [null,null,lat,lon] pairs. Encoded strings are often step-relative.
  function dedupeConsecutivePoints(pts) {
    const out = [];
    for (const p of pts) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.lat - p.lat) < 1e-8 && Math.abs(last.lon - p.lon) < 1e-8) {
        continue;
      }
      out.push(p);
    }
    return out;
  }

  function parseDirectionsWaypoints(href) {
    const data = dataParam(String(href || ""));
    const pts = [];
    const re = /!2m2!1d(-?\d+(?:\.\d+)?)!2d(-?\d+(?:\.\d+)?)/g;
    let m;
    while ((m = re.exec(data))) {
      pts.push({ lat: +m[2], lon: +m[1] });
    }
    return pts;
  }

  function isDirectionsLatLonPair(arr) {
    return Array.isArray(arr)
      && arr.length === 4
      && arr[0] == null
      && arr[1] == null
      && typeof arr[2] === "number"
      && typeof arr[3] === "number"
      && arr[2] >= 18
      && arr[2] <= 54
      && arr[3] >= 73
      && arr[3] <= 136;
  }

  function isDirectionsStepPolyline(arr) {
    return Array.isArray(arr)
      && arr.length >= 2
      && arr.every(isDirectionsLatLonPair);
  }

  function isDirectionsStepRow(node) {
    return isDirectionsStepPolyline(node?.[0]?.[7]?.[1]);
  }

  function stepRowPolyline(node) {
    return node[0][7][1].map((p) => ({ lat: p[2], lon: p[3] }));
  }

  function collectOrderedStepPolylines(node, out) {
    if (!Array.isArray(node)) return;
    if (isDirectionsStepRow(node)) {
      out.push(stepRowPolyline(node));
      return;
    }
    for (const child of node) collectOrderedStepPolylines(child, out);
  }

  function mergeStepPolylinesWithGapSplit(polylines, maxGapM) {
    const lines = [];
    let current = [];
    for (const poly of polylines) {
      for (const p of poly) {
        const last = current[current.length - 1];
        if (last && haversineM(last, p) > maxGapM) {
          if (current.length >= 2) lines.push(current);
          current = [p];
        } else if (!last || haversineM(last, p) > 0.5) {
          current.push(p);
        }
      }
    }
    if (current.length >= 2) lines.push(current);
    return lines;
  }

  function haversineM(a, b) {
    const R = 6371000;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLon = ((b.lon - a.lon) * Math.PI) / 180;
    const x = Math.sin(dLat / 2) ** 2
      + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function parseDirectionsPreviewJson(body) {
    const text = String(body || "").replace(/\\u003d/g, "=");
    try {
      return JSON.parse(text.trim().replace(/^\)\]\}'\n?/, ""));
    } catch (_e) {
      return null;
    }
  }

  function readMapCanvasImageData(canvas) {
    if (!canvas || !(canvas.width > 0) || !(canvas.height > 0)) return null;
    const w = canvas.width;
    const h = canvas.height;
    try {
      const ctx2d = canvas.getContext("2d");
      if (ctx2d) return ctx2d.getImageData(0, 0, w, h);
    } catch (_e) {}
    try {
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const ctx = off.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(canvas, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h);
    } catch (_e) {
      return null;
    }
  }

  function gcjLatLonToScreenPx(lat, lon, camLat, camLon, zoom, width, height) {
    const raw = worldPixel(lat, lon, zoom);
    const center = worldPixel(camLat, camLon, zoom);
    return {
      x: raw.x - center.x + Number(width) / 2,
      y: raw.y - center.y + Number(height) / 2
    };
  }

  function latLonFromWorldPixel(x, y, zoom) {
    const n = 2 ** Number(zoom);
    const lon = (Number(x) / (n * TILE)) * 360 - 180;
    const yy = Number(y) / (n * TILE);
    const lat = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - 2 * yy)));
    return { lat, lon };
  }

  function gcjScreenPxToLatLon(sx, sy, camLat, camLon, zoom, width, height) {
    const center = worldPixel(camLat, camLon, zoom);
    return latLonFromWorldPixel(
      center.x + Number(sx) - Number(width) / 2,
      center.y + Number(sy) - Number(height) / 2,
      zoom
    );
  }

  function isDirectionsRouteBlue(r, g, b, a) {
    return a > 128 && b > 150 && r < 100 && g < 200 && b > r + 40;
  }

  function screenPointKey(p) {
    return `${p.x},${p.y}`;
  }

  function chainRouteScreenPixels(pixels, start, dest, maxJumpPx) {
    if (!pixels.length) return [];
    const maxJump = Number(maxJumpPx) > 0 ? Number(maxJumpPx) : 28;
    const remaining = new Map(pixels.map((p) => [screenPointKey(p), p]));
    const startKey = screenPointKey(start);
    if (!remaining.has(startKey)) remaining.set(startKey, start);
    const out = [start];
    remaining.delete(startKey);
    let cur = start;
    const dirLen = Math.hypot(dest.x - start.x, dest.y - start.y) || 1;
    const dir = { x: (dest.x - start.x) / dirLen, y: (dest.y - start.y) / dirLen };
    while (remaining.size) {
      let best = null;
      let bestScore = Infinity;
      for (const p of remaining.values()) {
        const d = Math.hypot(p.x - cur.x, p.y - cur.y);
        if (d > maxJump || d < 0.5) continue;
        const forward = ((p.x - cur.x) * dir.x + (p.y - cur.y) * dir.y) / d;
        const score = d - forward * 10;
        if (score < bestScore) {
          bestScore = score;
          best = p;
        }
      }
      if (!best) break;
      out.push(best);
      remaining.delete(screenPointKey(best));
      cur = best;
    }
    return out;
  }

  function directionsRouteMaxJumpPx(zoom) {
    return Math.min(180, Math.max(24, 7 * 2 ** (Number(zoom) - 13)));
  }

  function simplifyLatLonRoute(points, minDistM) {
    if (points.length <= 2) return points.slice();
    const out = [points[0]];
    for (let i = 1; i < points.length; i++) {
      if (haversineM(out[out.length - 1], points[i]) >= minDistM) out.push(points[i]);
    }
    const last = points[points.length - 1];
    const tail = out[out.length - 1];
    if (Math.abs(tail.lat - last.lat) > 1e-7 || Math.abs(tail.lon - last.lon) > 1e-7) {
      out.push(last);
    }
    return out;
  }

  function nearestScreenPoint(pixels, target) {
    let best = pixels[0];
    let bestD = Infinity;
    for (const p of pixels) {
      const d = Math.hypot(p.x - target.x, p.y - target.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  function extractRouteLineFromCanvasImageData(
    data, bufW, bufH, cssW, cssH, camLat, camLon, zoom, overlayW, overlayH, origin, dest
  ) {
    if (!data || !(bufW > 0) || !(bufH > 0)) return [];
    const scaleX = Number(cssW || overlayW) / Number(bufW);
    const scaleY = Number(cssH || overlayH) / Number(bufH);
    const pixels = [];
    for (let y = 0; y < bufH; y += 2) {
      for (let x = 0; x < bufW; x += 2) {
        const i = (y * bufW + x) * 4;
        if (!isDirectionsRouteBlue(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
        pixels.push({ x: x * scaleX, y: y * scaleY });
      }
    }
    if (pixels.length < 8) return [];

    const originPx = origin ? gcjLatLonToScreenPx(origin.lat, origin.lon, camLat, camLon, zoom, overlayW, overlayH) : null;
    const destPx = dest ? gcjLatLonToScreenPx(dest.lat, dest.lon, camLat, camLon, zoom, overlayW, overlayH) : null;

    const start = originPx ? nearestScreenPoint(pixels, originPx) : pixels[0];
    const end = destPx ? nearestScreenPoint(pixels, destPx) : pixels[pixels.length - 1];
    const chain = chainRouteScreenPixels(pixels, start, end, directionsRouteMaxJumpPx(zoom));
    if (chain.length < 8) return [];

    let route = chain.map((p) => gcjScreenPxToLatLon(p.x, p.y, camLat, camLon, zoom, overlayW, overlayH));
    route = simplifyLatLonRoute(route, 12);
    if (route.length < 2) return [];

    if (origin && haversineM(route[0], origin) > 800) route.unshift({ lat: origin.lat, lon: origin.lon });
    if (dest && haversineM(route[route.length - 1], dest) > 800) route.push({ lat: dest.lat, lon: dest.lon });

    return [route];
  }

  function pathLengthM(pts) {
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += haversineM(pts[i - 1], pts[i]);
    return total;
  }

  function readAdvertisedDistanceM(leg) {
    let best = 0;
    function walk(node) {
      if (!Array.isArray(node)) return;
      if (typeof node[1] === "string" && /^\d+(?:\.\d+)?\s*m$/i.test(node[1]) && typeof node[0] === "number") {
        const meters = parseFloat(node[1]);
        if (meters > best) best = meters;
      }
      for (const child of node) walk(child);
    }
    walk(leg);
    return best;
  }

  function concatOrderedStepPolylines(polylines) {
    const out = [];
    for (const poly of polylines) {
      for (const p of poly) {
        const last = out[out.length - 1];
        if (!last || haversineM(last, p) > 0.5) out.push(p);
      }
    }
    return out.length >= 2 ? [out] : [];
  }

  function extractDirectionsPolylines(body, href) {
    const json = parseDirectionsPreviewJson(body);
    const waypoints = parseDirectionsWaypoints(href);
    const stepPolylines = [];
    const leg = json?.[0]?.[1]?.[0];
    // Step geometry lives under leg[1]; leg[0] holds overview bounds and marker art.
    if (Array.isArray(leg?.[1])) {
      collectOrderedStepPolylines(leg[1], stepPolylines);
    }

    if (waypoints.length >= 2) {
      const direct = haversineM(waypoints[0], waypoints[waypoints.length - 1]);
      const advertised = readAdvertisedDistanceM(leg);
      if (advertised > 0 && direct > 0 && Math.abs(advertised - direct) / direct < 0.12) {
        return [waypoints.slice()];
      }
    }

    let lines = mergeStepPolylinesWithGapSplit(stepPolylines, 2000);
    if (lines.length !== 1 && stepPolylines.length) {
      lines = concatOrderedStepPolylines(stepPolylines);
    }
    if (lines.length !== 1) lines = [];
    if (!lines.length && waypoints.length >= 2) {
      const direct = haversineM(waypoints[0], waypoints[waypoints.length - 1]);
      if (direct < 5000) lines = [waypoints.slice()];
    }
    return lines.filter((line) => line.length >= 2);
  }

  function overlaySpec(href, alignMode, opts) {
    const url = String(href || "");
    const mode = normalizeAlignMode(alignMode);
    if (mode === "off" || isNativeOnlyView(url)) {
      return {
        nativeOnly: true,
        label: "native",
        baseLyrs: [],
        roadLyrs: "",
        shadeLyrs: [],
        extraLyrs: [],
        hideNative: false,
        blendNative: false
      };
    }
    const data = dataParam(url);
    const layers = mapLayerIds(data);
    const extras = layers.filter((id) => id !== 4);
    const extraLyrs = [];
    if (extras.includes(1)) extraLyrs.push("h,traffic");
    if (extras.includes(2)) extraLyrs.push("m,transit");
    if (extras.includes(3)) extraLyrs.push("h,bike");
    if (extras.includes(5)) extraLyrs.push("svv");
    const type = mapDisplayType(data);
    const satelliteBasemap = type === 3;
    const terrain = !satelliteBasemap && layers.includes(4);

    // Hybrid: never repaint Google layers except crisp satellite + shifted labels.
    if (
      isDirectionsView(url)
      || isSearchView(url)
      || terrain
      || hybridNeedsNativeLayers(url, !!(opts && opts.pegmanCover))
    ) {
      return {
        nativeOnly: true,
        label: "native",
        baseLyrs: [],
        roadLyrs: "",
        shadeLyrs: [],
        extraLyrs: [],
        hideNative: false,
        blendNative: false
      };
    }
    if (satelliteBasemap) {
      return {
        nativeOnly: false, label: "satellite", baseLyrs: ["s"], roadLyrs: "h", shadeLyrs: [], extraLyrs,
        hideNative: true, blendNative: false
      };
    }
    return {
      nativeOnly: true,
      label: "native",
      baseLyrs: [],
      roadLyrs: "",
      shadeLyrs: [],
      extraLyrs: [],
      hideNative: false,
      blendNative: false
    };
  }

  // Legacy helper kept for tests that still reference takeover semantics.
  function blendWantsImagery(href, takeover) {
    return false;
  }

  // Pegman drag shows Street View coverage on the native canvas without putting
  // `!1e5` in the URL. While our overlay hides that canvas, force `svv` tiles.
  function withStreetViewCoverage(spec, want) {
    // Blended mode never hides the canvas, so Maps paints its own coverage.
    if (!want || !spec || spec.nativeOnly || spec.blendNative) return spec;
    const extras = spec.extraLyrs || [];
    if (extras.includes("svv")) return spec;
    return Object.assign({}, spec, { extraLyrs: extras.concat("svv") });
  }

  // Classic `mt*/vt/lyrs=svv` returns empty 1×1 PNGs. Maps loads coverage via
  // `/maps/vt/pb=…!2ssvv…` with the Street View coverage style block. Always use
  // the Roadmap footer — `!2sSatellite` yields blank tiles even on satellite view.
  function streetViewCoverageTileUrl(x, y, z) {
    const zz = Number(z);
    const xx = Number(x);
    const yy = Number(y);
    return (
      "https://www.google.com/maps/vt/pb="
      + `!1m4!1m3!1i${zz}!2i${xx}!3i${yy}`
      + "!2m8!1e2!2ssvv"
      + "!4m2!1scc!2s*211m3*211e2*212b1*213e2*211m3*211e10*212b1*213e2*211m3*211e9*212b1*213e2*212b1"
      + "!4m2!1ssvl!2s*211b1*212b1"
      + "!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmap!4e0!5m1!1e0"
    );
  }

  function isStreetViewPegmanTarget(el) {
    let n = el && el.nodeType === 1 ? el : null;
    for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
      const bits = [
        n.getAttribute("aria-label"),
        n.getAttribute("title"),
        n.getAttribute("data-tooltip"),
        n.getAttribute("jsaction"),
        n.id,
        typeof n.className === "string" ? n.className : ""
      ]
        .filter(Boolean)
        .join(" ");
      // zh-TW Maps: aria-label "瀏覽街景服務圖像", jsaction "runway.pegman".
      if (/street\s*view|pegman|街景|ストリートビュー|스트리트|runway\.pegman/i.test(bits)) {
        return true;
      }
      if (/\bstreetview\b|\bpegman\b/i.test(bits)) return true;
    }
    return false;
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
    overlayCamera,
    overlayPoiScreenPx,
    ALIGN_MODES,
    normalizeAlignMode,
    hybridNeedsNativeLayers,
    imageryCamera,
    imageryScreenPx,
    blendWantsImagery,
    isBasemapToggleBox,
    BASEMAP_TOGGLE_MIN_PX,
    BASEMAP_TOGGLE_MAX_PX,
    BASEMAP_TOGGLE_EDGE_PX,
    isLatLonPlaceName,
    urlCoordsAreWgs84,
    placeNeedsAlignedPin,
    cleanPoiName,
    labelHasVisitedSuffix,
    isAddressLikePlaceTitle,
    shortPlaceTitleFromPath,
    extractPoiDescription,
    placeNameFromHref,
    isGenericPoiName,
    inChinaGcjBox,
    inTaiwanIsland,
    inXiamenMainland,
    inPenghuKinmenMatsu,
    inExcludedNeighborRegion,
    outOfChina,
    wgsToGcj,
    gcjToWgs,
    parsePlaceCoords,
    classifyPoiKind,
    poiMarkerSpec,
    poiHoverTeardropSpec,
    nativeSpotlightPinSpec,
    collectPoisFromAnchors,
    dataParam,
    mapDisplayType,
    mapLayerIds,
    isTerrainView,
    isNativeOnlyView,
    isDirectionsView,
    hasDirectionsRouteData,
    isSearchView,
    isPlaceView,
    decodeGooglePolyline,
    parseDirectionsWaypoints,
    extractDirectionsPolylines,
    isDirectionsRouteBlue,
    extractRouteLineFromCanvasImageData,
    readMapCanvasImageData,
    gcjScreenPxToLatLon,
    gcjLatLonToScreenPx,
    latLonFromWorldPixel,
    overlaySpec,
    withStreetViewCoverage,
    streetViewCoverageTileUrl,
    isStreetViewPegmanTarget,
    parseMapHref
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
