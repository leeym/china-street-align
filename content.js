(() => {
  "use strict";

  let VERSION = "0.7.1";
  try {
    VERSION = chrome.runtime.getManifest().version;
  } catch (_e) {}
  const TILE = globalThis.Gcj02Aligner?.TILE ?? 256;
  const OVERLAY_Z = globalThis.Gcj02Aligner?.OVERLAY_Z ?? 0;
  const CHROME_Z = globalThis.Gcj02Aligner?.CHROME_Z ?? 1000010;
  // Fractional zoom makes tileSize non-integer; browsers round edges and leave
  // hairline gaps (reads as black seams). Paint each tile 1px larger so neighbours overlap.
  const TILE_SEAM_OVERLAP_PX = 1;
  // Wheel deltaY (CSS px) per one zoom level — matches Maps-ish feel for the preview scale.
  const WHEEL_PX_PER_ZOOM = 420;
  const ZOOM_SETTLE_MS = 200;
  const BUTTON_ZOOM_MS = 280;
  const GESTURE_SETTLE_MAX_MS = 1500;
  const PAN_MOVE_PX = 3;

  const ALIGN_MODE_KEY = "alignMode";
  const DEFAULT_ALIGN_MODE = "streets";
  // Alignment mode, from the popup (chrome.storage.sync) or the postMessage test
  // hook. "streets" hides the native canvas and repaints the GCJ world onto WGS
  // satellite; "satellite" leaves the native canvas alone and slides the WGS
  // satellite raster under it; "off" is native Maps.
  let alignMode = DEFAULT_ALIGN_MODE;
  let alignModeLoaded = false;
  // Blended mode needs Maps' vector basemap; these track the switch away from
  // Maps' own satellite and the streets fallback when the toggle is unreachable.
  // Maps paints the corner widget late, and after a click it takes a moment to
  // rewrite the URL, so be patient before standing down.
  const BASEMAP_SWITCH_MAX_TRIES = 6;
  const BASEMAP_SWITCH_RETRY_MS = 1200;
  // A toggle click flips the basemap, so a second click too soon flips it back.
  const BASEMAP_SWITCH_SETTLE_MS = 2500;
  // How long a flipped toggle label buys before we try clicking again.
  const BASEMAP_SWITCH_LAND_MS = 6000;
  let basemapSwitchTries = 0;
  let basemapClickAt = 0;
  let basemapToggleSig = "";
  let blendFallbackStreets = false;
  let lastDisplayType = null;
  let root = null;
  let panEl = null;
  let statusEl = null;
  let timer = null;
  let pollTimer = null;
  let lastKey = "";
  let lastHref = "";
  let lastPoiKey = "";
  let lastHost = null;
  let lastActionInChina = null;
  let hoveredPoiKey = "";
  let alive = true;
  // Pegman drag: Maps paints SV coverage on the (hidden) native canvas without
  // `!1e5` in the URL — keep overlay `svv` tiles while the drag is active.
  let pegmanCover = false;
  // Directions routes are canvas-painted; fetch /preview/directions polylines and redraw.
  let directionsPolylines = [];
  let lastRouteKey = "";
  let lastDirectionsPreviewUrl = "";
  let directionsFetchTimer = null;
  let directionsRouteCaptureKey = "";
  let directionsRouteCaptureTimer = null;
  let directionsRouteCaptureAttempts = 0;
  let directionsBootstrapTimer = null;
  let directionsCaptureWaitTicks = 0;
  const MIN_CANVAS_ROUTE_PTS = 8;
  // While the user drags, Maps updates the camera only on release (URL `@`).
  // Native canvas is hidden, so translate the overlay with the pointer so tiles
  // follow the cursor the way Off does outside China.
  let panDrag = null;
  // Smooth zoom: scale the pan layer during wheel / +/- ; redraw when settled.
  let zoomAnim = null;
  let zoomRaf = 0;
  // After pointer-up / zoom settle, keep the preview transform until Maps commits
  // a new `@` and redraw paints matching tiles — clearing earlier snaps back.
  let gestureHold = null;
  const obs = new MutationObserver(() => {
    if (!alive || gestureBusy()) return;
    if (location.href === lastHref) {
      syncPoisIfVisible();
      return;
    }
    lastHref = location.href;
    lastKey = "";
    lastPoiKey = "";
    lastRouteKey = "";
    directionsPolylines = [];
    lastDirectionsPreviewUrl = "";
    directionsRouteCaptureKey = "";
    directionsRouteCaptureAttempts = 0;
    directionsCaptureWaitTicks = 0;
    clearTimeout(directionsRouteCaptureTimer);
    if (directionsBootstrapTimer) {
      clearInterval(directionsBootstrapTimer);
      directionsBootstrapTimer = null;
    }
    startDirectionsBootstrapCapture();
    clearTimeout(timer);
    timer = setTimeout(redraw, 120);
  });

  function gestureBusy() {
    return !!(panDrag || zoomAnim || gestureHold);
  }

  function clearPanVisual() {
    if (!panEl) return;
    panEl.style.transition = "";
    panEl.style.transform = "";
    panEl.style.transformOrigin = "";
  }

  function cameraSnapshot() {
    const st = parseMapState();
    return {
      href: location.href,
      lat: st ? st.lat : null,
      lon: st ? st.lon : null,
      zoom: st ? st.zoom : null
    };
  }

  function cameraChanged(from) {
    if (!from) return true;
    if (location.href !== from.href) return true;
    const st = parseMapState();
    if (!st || from.lat == null) return false;
    return (
      Math.abs(st.lat - from.lat) >= 1e-7
      || Math.abs(st.lon - from.lon) >= 1e-7
      || Math.abs(st.zoom - from.zoom) >= 0.001
    );
  }

  function scheduleGestureSettle() {
    clearTimeout(timer);
    timer = setTimeout(tryGestureSettle, 32);
  }

  function tryGestureSettle() {
    if (!alive) return;
    if (!gestureHold) {
      redraw();
      return;
    }
    const timedOut = Date.now() - gestureHold.since > GESTURE_SETTLE_MAX_MS;
    if (!cameraChanged(gestureHold) && !timedOut) {
      scheduleGestureSettle();
      return;
    }
    gestureHold = null;
    lastKey = "";
    lastHref = "";
    redraw();
  }

  function beginGestureHold(snap) {
    gestureHold = {
      href: snap.href,
      lat: snap.lat,
      lon: snap.lon,
      zoom: snap.zoom,
      since: Date.now()
    };
    scheduleGestureSettle();
  }

  function teardown() {
    if (!alive) return;
    alive = false;
    try { obs.disconnect(); } catch (_e) {}
    clearTimeout(timer);
    clearInterval(pollTimer);
    endZoomAnim(true);
    panDrag = null;
    gestureHold = null;
    try { root?.remove(); } catch (_e) {}
    try { lastHost && (lastHost.style.clipPath = ""); lastHost.style.maskImage = ""; lastHost.style.webkitMaskImage = ""; } catch (_e) {}
    lastHost = null;
    setNativeBlend(false);
    setNativeMapHidden(false);
    root = null;
    panEl = null;
    statusEl = null;
  }

  function outOfChina(lat, lon) {
    return globalThis.Gcj02Aligner.outOfChina(lat, lon);
  }

  function reportActionStatus(st) {
    if (!alive) return;
    const inChina = !!(st && !outOfChina(st.lat, st.lon));
    if (lastActionInChina === inChina) return;
    lastActionInChina = inChina;
    try {
      chrome.runtime.sendMessage({ type: "setActionStatus", inChina }, () => {
        try {
          void chrome.runtime.lastError;
        } catch (_e) {}
      });
    } catch (_e) {}
  }

  function overlaySpec() {
    const mode = blendAlign() && blendFallbackStreets ? "streets" : alignMode;
    const base = globalThis.Gcj02Aligner.overlaySpec(location.href, mode);
    return globalThis.Gcj02Aligner.withStreetViewCoverage(base, pegmanCover);
  }

  function setPegmanCover(on) {
    // Blended mode never hides the canvas, so Maps paints its own coverage.
    if (!streetsAlign()) return;
    const next = !!on;
    if (next === pegmanCover) return;
    pegmanCover = next;
    lastKey = "";
    if (!gestureBusy()) redraw();
  }

  function onPegmanPointerDown(ev) {
    if (!(ev.target instanceof Element)) return;
    if (!globalThis.Gcj02Aligner.isStreetViewPegmanTarget(ev.target)) return;
    setPegmanCover(true);
  }

  function onPegmanPointerUp() {
    if (!pegmanCover) return;
    setPegmanCover(false);
  }

  function parseMapState() {
    return globalThis.Gcj02Aligner.parseMapHref(location.href);
  }

  function worldPixel(lat, lon, z) {
    return globalThis.Gcj02Aligner.worldPixel(lat, lon, z);
  }

  function tileCenterLatLon(x, y, z) {
    return globalThis.Gcj02Aligner.tileCenterLatLon(x, y, z);
  }

  function tileUrl(lyrs, x, y, z) {
    if (lyrs === "svv" && globalThis.Gcj02Aligner?.streetViewCoverageTileUrl) {
      return globalThis.Gcj02Aligner.streetViewCoverageTileUrl(x, y, z);
    }
    const s = ((x + y) % 4 + 4) % 4;
    return `https://mt${s}.google.com/vt/lyrs=${lyrs}&x=${x}&y=${y}&z=${z}`;
  }

  function normalizeMode(v) {
    return globalThis.Gcj02Aligner.normalizeAlignMode(v);
  }

  function blendAlign() {
    return alignMode === "satellite";
  }

  // True whenever the streets machinery (POIs, routes, coverage, canvas hiding)
  // is what paints this view — either the streets mode, or blended mode standing
  // down because Maps would not give up its own satellite basemap.
  function streetsAlign() {
    return alignMode === "streets" || (blendAlign() && blendFallbackStreets);
  }

  function effectiveMode(st) {
    if (alignMode === "off") return "off";
    return st && !outOfChina(st.lat, st.lon) ? "on" : "off";
  }

  function overlayHost() {
    const isMap = globalThis.Gcj02Aligner?.shouldHideNativeCanvas
      || ((cssW, cssH, bufW, bufH) => cssW * cssH >= 80000 || bufW * bufH >= 80000);
    let best = null;
    let bestArea = 0;
    document.querySelectorAll("canvas").forEach((c) => {
      const r = c.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea && isMap(r.width, r.height, c.width, c.height)) {
        bestArea = area;
        best = c;
      }
    });
    if (!best) return null;
    const host = best.parentElement;
    if (!host) return null;
    return { host, canvas: best };
  }

  function fitOverlayToCanvas(host, canvas) {
    if (!root || !host || !canvas) return false;
    const cr = canvas.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    const left = `${cr.left - hr.left}px`;
    const top = `${cr.top - hr.top}px`;
    const width = `${Math.max(cr.width, 1)}px`;
    const height = `${Math.max(cr.height, 1)}px`;
    const changed =
      root.style.left !== left
      || root.style.top !== top
      || root.style.width !== width
      || root.style.height !== height;
    root.style.inset = "auto";
    root.style.left = left;
    root.style.top = top;
    root.style.width = width;
    root.style.height = height;
    root.style.right = "auto";
    root.style.bottom = "auto";
    return changed;
  }

  function clipHostForChrome(host) {
    // Never notch the host for chrome — that left white page background in the
    // corner holes after native canvases were hidden. Clear any prior clip.
    if (lastHost && lastHost !== host) {
      try {
        lastHost.style.clipPath = "";
        lastHost.style.webkitClipPath = "";
        lastHost.style.maskImage = "";
        lastHost.style.webkitMaskImage = "";
      } catch (_e) {}
    }
    lastHost = host && host !== document.body && host !== document.documentElement
      ? host
      : null;
    if (!lastHost) return;
    try {
      lastHost.style.clipPath = "";
      lastHost.style.webkitClipPath = "";
      lastHost.style.maskImage = "";
      lastHost.style.webkitMaskImage = "";
    } catch (_e) {}
  }

  function setNativeMapHidden(hidden) {
    document.documentElement.classList.toggle("gcj02-overlay-on", hidden);
    const hideCanvas = globalThis.Gcj02Aligner?.shouldHideNativeCanvas
      || ((cssW, cssH, bufW, bufH) => cssW * cssH >= 80000 || bufW * bufH >= 80000);
    const hideImg = globalThis.Gcj02Aligner?.shouldHideNativeImage
      || ((src, inOverlay) => !inOverlay && /\/vt\/|khms\d\.google\.com/i.test(src || ""));
    const host = root?.parentElement;
    if (host) {
      [...host.children].forEach((el) => {
        if (el === root) return;
        el.classList.toggle("gcj02-hide-native", hidden);
      });
    }
    document.querySelectorAll("canvas").forEach((c) => {
      const r = c.getBoundingClientRect();
      const inHost = !!(host && host.contains(c) && c.parentElement === host);
      if (!inHost && !hideCanvas(r.width, r.height, c.width, c.height)) return;
      c.classList.toggle("gcj02-hide-native", hidden);
    });
    document.querySelectorAll("img").forEach((img) => {
      const inOverlay = !!img.closest("#gcj02-aligner-root");
      const src = img.currentSrc || img.src || "";
      if (!hideImg(src, inOverlay)) {
        if (!hidden) img.classList.remove("gcj02-hide-native");
        return;
      }
      img.classList.toggle("gcj02-hide-native", hidden);
    });
    setNativePlaceMarkersHidden(hidden);
  }

  // Blended mode: keep every native layer on screen and let our WGS-84 imagery
  // show through it. Maps clears the map canvas opaque AND paints an opaque
  // black CSS background on it, so both have to go: `multiply` against a
  // transparent element gives the native vector map over our photo, with all
  // POIs, labels, routes, terrain and hit-testing still drawn by Maps.
  function setNativeBlend(on) {
    const isMap = globalThis.Gcj02Aligner?.shouldHideNativeCanvas
      || ((cssW, cssH, bufW, bufH) => cssW * cssH >= 80000 || bufW * bufH >= 80000);
    document.querySelectorAll("canvas").forEach((c) => {
      const r = c.getBoundingClientRect();
      if (!isMap(r.width, r.height, c.width, c.height)) {
        if (!on) c.classList.remove("gcj02-blend-native");
        return;
      }
      c.classList.toggle("gcj02-blend-native", !!on);
    });
    const host = root?.parentElement;
    if (host) {
      // Contain the blend so it cannot reach page chrome outside the map host.
      host.style.isolation = on ? "isolate" : "";
    }
  }

  // Blended mode owns the imagery, so Maps' own satellite basemap has to go:
  // multiplying our shifted photo under Maps' unshifted photo double-exposes it.
  // Maps keeps the basemap as a stored preference and re-adds `data=!3m1!1e3` on
  // the next navigation, so rewriting the URL and reloading just loses the race
  // (that left the blend showing Google's unshifted photo — the original bug).
  // Click Maps' own corner toggle instead: no reload, and the choice sticks.
  function nativeBasemapToggle() {
    const found = overlayHost();
    if (!found) return null;
    const cr = found.canvas.getBoundingClientRect();
    const isToggle = globalThis.Gcj02Aligner.isBasemapToggleBox;
    let btn = null;
    document.querySelectorAll("button, [role='button'], label").forEach((el) => {
      if (btn || el.closest("#gcj02-aligner-root")) return;
      if (!isToggle(el.getBoundingClientRect(), cr)) return;
      // The toggle square carries an aria-label (localized) on itself or on a
      // sibling that renders the other basemap's thumbnail.
      if (!basemapToggleSignature(el)) return;
      btn = el;
    });
    return btn;
  }

  // The aria-label the toggle carries for the basemap it would switch TO
  // ("Interactive map" in satellite view, "Satellite" in map view — localized).
  // Reading it is how we tell a click that landed from one that did not, in any
  // language. Deliberately aria-only: the widget's TEXT changes on hover
  // ("Layers" → "Map"), so including text reads our own hover as a flip.
  function basemapToggleSignature(el) {
    if (!el) return "";
    const near = [el, ...(el.parentElement ? [...el.parentElement.children] : [])];
    const parts = [];
    for (const n of near) {
      const aria = n.getAttribute?.("aria-label") || "";
      if (aria.length > 2) parts.push(aria);
    }
    return parts.join("|").slice(0, 120);
  }

  function clickNativeBasemapToggle(el) {
    const fire = (type) => el.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
    );
    // Maps expands the widget on hover and binds the switch via jsaction, so the
    // hover has to land before the click.
    ["pointerover", "mouseover", "mouseenter", "mousemove"].forEach(fire);
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(fire);
  }

  // Returns true when it took over this redraw: either a basemap switch is in
  // flight, or we gave up and the streets fallback needs a fresh redraw.
  function maybeSwitchToMapBasemap() {
    const lib = globalThis.Gcj02Aligner;
    if (lib.mapDisplayType(lib.dataParam(location.href)) !== 3) {
      basemapSwitchTries = 0;
      basemapToggleSig = "";
      return false;
    }
    // Never blend over Maps' own photo while the switch is pending.
    hideOverlay();
    ensureRoot();
    if (root) root.style.display = "none";
    const setDiag = (v) => {
      if (!root) return;
      root.dataset.blendBlocked = "satellite-basemap";
      root.dataset.blendSwitch = `${v}:${basemapSwitchTries}`;
    };
    const again = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(redraw, ms);
    };

    const toggle = nativeBasemapToggle();
    const sig = basemapToggleSignature(toggle);
    const sinceClick = basemapClickAt ? Date.now() - basemapClickAt : Infinity;
    // The toggle names the basemap it switches TO, so our click flips its label.
    // A flipped label with a stale URL means Maps accepted the switch and simply
    // has not rewritten `@`/`data=` yet — clicking again there would flip
    // straight back to satellite and leave the blend double-exposed. Both waits
    // are bounded so a misread label cannot wedge the mode.
    const flipped = !!(basemapToggleSig && sig && sig !== basemapToggleSig);
    if (sinceClick < BASEMAP_SWITCH_SETTLE_MS || (flipped && sinceClick < BASEMAP_SWITCH_LAND_MS)) {
      setDiag(flipped ? "landed" : "settling");
      again(BASEMAP_SWITCH_RETRY_MS);
      return true;
    }
    if (basemapSwitchTries >= BASEMAP_SWITCH_MAX_TRIES || (basemapSwitchTries > 0 && !toggle)) {
      // Cannot reach the toggle (moved, hidden, unknown skin). Alignment matters
      // more than staying native, so render this view the streets way instead.
      if (!blendFallbackStreets) {
        blendFallbackStreets = true;
        lastKey = "";
        setDiag("fallback-streets");
        again(0);
      }
      return true;
    }
    if (!toggle) {
      // Maps paints the corner widget late; wait for it before standing down.
      setDiag("waiting");
      again(BASEMAP_SWITCH_RETRY_MS);
      return true;
    }
    basemapSwitchTries += 1;
    basemapToggleSig = sig;
    basemapClickAt = Date.now();
    clickNativeBasemapToggle(toggle);
    setDiag("clicked");
    again(BASEMAP_SWITCH_RETRY_MS);
    return true;
  }

  function setNativePlaceMarkersHidden(hidden) {
    if (!hidden) {
      document.querySelectorAll("[data-gcj02-native-pin]").forEach((el) => {
        el.removeAttribute("data-gcj02-native-pin");
        el.classList.remove("gcj02-hide-native");
      });
      return;
    }
    const canvas = overlayHost()?.canvas;
    if (!canvas) return;
    const cr = canvas.getBoundingClientRect();
    document.querySelectorAll(".gm-style a, .gm-style button, .gm-style img, .gm-style [aria-label]").forEach((el) => {
      if (el.closest("#gcj02-aligner-root")) return;
      const r = el.getBoundingClientRect();
      if (r.width < 12 || r.width > 56 || r.height < 12 || r.height > 72) return;
      if (r.left < cr.left + 8 || r.top < cr.top + 8) return;
      if (r.right > cr.right - 8 || r.bottom > cr.bottom - 8) return;
      const text = (el.textContent || "").trim();
      const label = (el.getAttribute("aria-label") || "").trim();
      if (!/^\d{1,2}$/.test(text) && !/^\d{1,2}(\.|:|\s)/.test(label) && !/^\d{1,2}$/.test(label)) return;
      el.setAttribute("data-gcj02-native-pin", "1");
      el.classList.add("gcj02-hide-native");
    });
  }

  function ensureRoot() {
    const found = overlayHost();
    if (!found) return false;
    const { host, canvas } = found;
    if (!root) {
      root = document.createElement("div");
      root.id = "gcj02-aligner-root";
    }
    if (!panEl) {
      panEl = document.createElement("div");
      panEl.id = "gcj02-aligner-pan";
      panEl.className = "gcj02-aligner-pan";
    }
    if (panEl.parentElement !== root) root.appendChild(panEl);
    if (root.parentElement !== host || host.firstChild !== root) {
      host.insertBefore(root, host.firstChild);
    }
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    root.style.zIndex = String(OVERLAY_Z);
    if (!statusEl) {
      statusEl = document.createElement("div");
      statusEl.id = "gcj02-aligner-status";
      statusEl.style.zIndex = String(CHROME_Z);
    }
    if (statusEl.parentElement !== document.body) document.body.appendChild(statusEl);
    clipHostForChrome(host);
    fitOverlayToCanvas(host, canvas);
    return true;
  }

  function setStatus(text, extra) {
    if (!statusEl) return;
    statusEl.textContent = text;
    if (root && extra) {
      Object.entries(extra).forEach(([k, v]) => root.dataset[k] = String(v));
    }
  }

  function bindTile(img, url) {
    img.addEventListener("load", () => {
      img.alt = "ok";
      img.dataset.ok = "1";
    });
    img.addEventListener("error", () => {
      img.alt = "tile error";
      img.dataset.ok = "0";
    });
    img.src = url;
  }

  function placeTile(className, lyrs, left, top, tileSize, transform, wx, ty, zTile) {
    if (!panEl) return;
    const img = document.createElement("img");
    img.className = className;
    img.draggable = false;
    img.alt = "loading";
    img.dataset.ok = "";
    img.dataset.lyrs = String(lyrs || "");
    img.dataset.x = String(wx);
    img.dataset.y = String(ty);
    img.dataset.z = String(zTile);
    const draw = Number(tileSize) + TILE_SEAM_OVERLAP_PX;
    img.style.width = `${draw}px`;
    img.style.height = `${draw}px`;
    img.style.left = `${left}px`;
    img.style.top = `${top}px`;
    if (transform) img.style.transform = transform;
    panEl.appendChild(img);
    bindTile(img, tileUrl(lyrs, wx, ty, zTile));
  }

  function categoryBlobForPlace(name, startEl) {
    const row = startEl.closest("[role=article]");
    if (row) return (row.innerText || "").replace(/\s+/g, " ").trim().slice(0, 240);
    const keys = /旅遊景點|旅游景点|歷史遺址|历史遗址|Tourist attraction|Historic site|Museum|博物館|博物院|遺址博物館|風景區|风景区/;
    let node = startEl.parentElement;
    for (let i = 0; i < 6 && node && node !== document.body; i++) {
      const t = (node.innerText || "").replace(/\s+/g, " ").trim();
      if (t.length >= 8 && t.length < 220 && keys.test(t)) return t;
      node = node.parentElement;
    }
    return "";
  }

  function articleTextForPlace(startEl) {
    const row = startEl.closest("[role=article]");
    return row ? String(row.innerText || "") : "";
  }

  function collectPoisFromDocument() {
    const anchors = [...document.querySelectorAll('a[href*="/maps/place/"]')].map((a) => {
      const label = a.getAttribute("aria-label") || a.textContent || "";
      return {
        href: a.href || a.getAttribute("href") || "",
        label,
        category: categoryBlobForPlace(label.trim().split(" · ")[0], a),
        article: articleTextForPlace(a)
      };
    });
    if (/\/maps\/place\//.test(location.href)) {
      const parts = decodeURIComponent(location.pathname).split("/").filter(Boolean);
      const pi = parts.indexOf("place");
      const rawPath = globalThis.Gcj02Aligner.placeNameFromHref(location.href)
        || (pi >= 0 ? parts[pi + 1] || "" : "");
      const fromPath = globalThis.Gcj02Aligner.shortPlaceTitleFromPath(rawPath)
        || globalThis.Gcj02Aligner.cleanPoiName(rawPath);
      const heading = globalThis.Gcj02Aligner.cleanPoiName(
        (document.querySelector("h1")?.textContent || "").trim()
      );
      // Place pages often set h1 to "結果" and the path to a full postal address.
      // Prefer a short title; never paint「…郵政編碼: 100006」on the pin.
      const label = fromPath || heading;
      const category = (document.body.innerText || "").slice(0, 400);
      if (
        label
        && !globalThis.Gcj02Aligner.isAddressLikePlaceTitle(label)
        && !globalThis.Gcj02Aligner.isGenericPoiName(label)
      ) {
        anchors.unshift({ href: location.href, label, category, article: "" });
      }
    }
    return globalThis.Gcj02Aligner.collectPoisFromAnchors(anchors);
  }

  function appendPoiGlyph(el, kind, name, description) {
    const spec = globalThis.Gcj02Aligner.poiMarkerSpec(kind);
    const hover = globalThis.Gcj02Aligner.poiHoverTeardropSpec();
    const mark = document.createElement("div");
    mark.className = "gcj02-poi-mark";
    const ns = "http://www.w3.org/2000/svg";

    function makeSvg(className, fill, d, w, h, viewBox) {
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("class", className);
      svg.setAttribute("viewBox", viewBox);
      svg.setAttribute("width", String(w));
      svg.setAttribute("height", String(h));
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", fill);
      path.setAttribute("fill-rule", "evenodd");
      svg.appendChild(path);
      return svg;
    }

    const icon = document.createElementNS(ns, "svg");
    icon.setAttribute("class", "gcj02-poi-icon");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("width", "26");
    icon.setAttribute("height", "26");
    icon.setAttribute("aria-hidden", "true");
    const bg = document.createElementNS(ns, "circle");
    bg.setAttribute("cx", "12");
    bg.setAttribute("cy", "12");
    bg.setAttribute("r", "12");
    bg.setAttribute("fill", spec.fill);
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", spec.path);
    path.setAttribute("fill", "#fff");
    icon.appendChild(bg);
    icon.appendChild(path);
    mark.appendChild(icon);
    const tear = makeSvg("gcj02-poi-teardrop", hover.fill, hover.path, 28, 40, "0 0 24 24");
    const hole = document.createElementNS(ns, "circle");
    hole.setAttribute("cx", "12");
    hole.setAttribute("cy", "9");
    hole.setAttribute("r", "2.6");
    hole.setAttribute("fill", "#fff");
    tear.appendChild(hole);
    mark.appendChild(tear);
    el.appendChild(mark);
    const labelText = String(name || "").trim();
    const descText = String(description || "").trim();
    if (labelText) {
      const label = document.createElement("span");
      label.className = "gcj02-poi-label";
      label.textContent = labelText;
      el.appendChild(label);
      const tip = document.createElement("div");
      tip.className = "gcj02-poi-tooltip";
      const title = document.createElement("div");
      title.className = "gcj02-poi-tooltip-title";
      title.textContent = labelText;
      tip.appendChild(title);
      if (descText) {
        const desc = document.createElement("div");
        desc.className = "gcj02-poi-tooltip-desc";
        desc.textContent = descText;
        tip.appendChild(desc);
      }
      el.appendChild(tip);
    }
  }

  function poiCoordKey(lat, lon) {
    return `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
  }

  function setHoveredPoi(key) {
    const next = String(key || "");
    if (next === hoveredPoiKey) return;
    hoveredPoiKey = next;
    if (!root) return;
    root.querySelectorAll(".gcj02-poi").forEach((el) => {
      el.classList.toggle("is-hover", !!next && el.dataset.key === next);
    });
  }

  function placeLinkHoverKey(el) {
    if (!el || el.closest?.("#gcj02-aligner-root")) return "";
    const a = el.closest?.('a[href*="/maps/place/"]')
      || (el.matches?.('a[href*="/maps/place/"]') ? el : null);
    if (!a) return "";
    const href = a.href || a.getAttribute("href") || "";
    const c = globalThis.Gcj02Aligner.parsePlaceCoords(href);
    return c ? poiCoordKey(c.lat, c.lon) : "";
  }

  function onSidebarPointerOver(e) {
    if (!alive || !root || root.style.display === "none") return;
    const key = placeLinkHoverKey(e.target);
    if (key) setHoveredPoi(key);
  }

  function onSidebarPointerOut(e) {
    if (!alive || !hoveredPoiKey) return;
    const from = placeLinkHoverKey(e.target);
    if (!from) return;
    const rel = e.relatedTarget instanceof Element
      ? e.relatedTarget
      : (e.relatedTarget && e.relatedTarget.parentElement) || null;
    const to = placeLinkHoverKey(rel);
    if (to) {
      setHoveredPoi(to);
      return;
    }
    setHoveredPoi("");
  }

  function urlCoordOpts() {
    return globalThis.Gcj02Aligner.urlCoordsAreWgs84(location.href)
      ? { wgs84: true }
      : undefined;
  }

  // Placement lives in overlayPoiScreenPx, which does its own GCJ→WGS camera
  // step (unless the place path is an explicit WGS lat/lon query).
  function syncPois(st, w, h) {
    if (!root || !panEl) return;
    const pois = collectPoisFromDocument();
    const poiKey = [
      w, h, st.zoom.toFixed(3), st.lat.toFixed(5), st.lon.toFixed(5),
      pois.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)},${p.kind},${p.name},${p.description || ""}`).join("|")
    ].join(";");
    if (poiKey === lastPoiKey) {
      if (hoveredPoiKey) {
        panEl.querySelectorAll(".gcj02-poi").forEach((el) => {
          el.classList.toggle("is-hover", el.dataset.key === hoveredPoiKey);
        });
      }
      return;
    }
    lastPoiKey = poiKey;
    panEl.querySelectorAll(".gcj02-poi").forEach((e) => e.remove());
    pois.forEach((poi) => {
      const screen = globalThis.Gcj02Aligner.overlayPoiScreenPx(
        poi.lat, poi.lon, st.lat, st.lon, st.zoom, w, h, urlCoordOpts()
      );
      const el = document.createElement("div");
      el.className = "gcj02-poi";
      el.dataset.key = poiCoordKey(poi.lat, poi.lon);
      el.dataset.wgsLat = String(screen.lat);
      el.dataset.wgsLon = String(screen.lon);
      el.dataset.kind = poi.kind || "place";
      if (poi.description) el.dataset.description = poi.description;
      el.setAttribute(
        "aria-label",
        poi.description ? `${poi.name} - ${poi.description}` : (poi.name || poi.kind)
      );
      el.style.left = `${screen.x}px`;
      el.style.top = `${screen.y}px`;
      el.style.transform = "translate(-13px, -100%)";
      if (hoveredPoiKey && el.dataset.key === hoveredPoiKey) el.classList.add("is-hover");
      appendPoiGlyph(el, poi.kind, poi.name, poi.description);
      panEl.appendChild(el);
    });
    root.dataset.poiCount = String(pois.length);
    root.dataset.poiKinds = pois.map((p) => p.kind).join(",");
  }

  function directionsWaypointsKey() {
    return globalThis.Gcj02Aligner.parseDirectionsWaypoints(location.href)
      .map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`)
      .join(";");
  }

  function directionsCaptureSize() {
    const found = overlayHost();
    if (!found) return null;
    const br = found.canvas.getBoundingClientRect();
    return {
      w: Math.max(br.width || 0, found.canvas.clientWidth || 0, 1),
      h: Math.max(br.height || 0, found.canvas.clientHeight || 0, 1)
    };
  }

  function directionsOverlayReady() {
    if (canvasRouteUsable()) return true;
    if (directionsRoutePaintable()) return true;
    return directionsCaptureWaitTicks >= 100;
  }

  function startDirectionsBootstrapCapture() {
    if (directionsBootstrapTimer) return;
    if (!streetsAlign()) return;
    if (!globalThis.Gcj02Aligner.isDirectionsView(location.href)) return;
    directionsCaptureWaitTicks = 0;
    directionsBootstrapTimer = setInterval(() => {
      directionsCaptureWaitTicks++;
      if (
        !alive
        || !streetsAlign()
        || !globalThis.Gcj02Aligner.isDirectionsView(location.href)
        || directionsOverlayReady()
      ) {
        clearInterval(directionsBootstrapTimer);
        directionsBootstrapTimer = null;
        if (!gestureBusy()) redraw();
        return;
      }
      const st = parseMapState();
      const size = directionsCaptureSize();
      if (st && size) tryDirectionsRouteSources(st, size.w, size.h);
      if (directionsCaptureWaitTicks >= 100) {
        clearInterval(directionsBootstrapTimer);
        directionsBootstrapTimer = null;
        if (!gestureBusy()) redraw();
      }
    }, 250);
  }

  function directionsRoutePaintable() {
    return directionsPolylines.some((line) => line.length >= 2);
  }

  function canvasRouteUsable() {
    return (directionsPolylines[0]?.length || 0) >= MIN_CANVAS_ROUTE_PTS;
  }

  function tryDirectionsRouteSources(st, w, h) {
    if (!globalThis.Gcj02Aligner.isDirectionsView(location.href) || !st) return;
    const pre = overlayHost();
    if (pre && !canvasRouteUsable()) {
      const br = pre.canvas.getBoundingClientRect();
      captureDirectionsRouteFromCanvas(st, br.width || w, br.height || h);
    }
    if (!directionsRoutePaintable()) scanBufferedDirectionsResources(true);
  }

  function shouldHideNativeForDirections() {
    if (!globalThis.Gcj02Aligner.isDirectionsView(location.href)) return true;
    if (canvasRouteUsable()) return true;
    if (directionsRoutePaintable()) return true;
    return directionsCaptureWaitTicks >= 100;
  }

  function captureDirectionsRouteFromCanvas(st, w, h) {
    if (!globalThis.Gcj02Aligner.isDirectionsView(location.href) || !st) return false;
    const key = [
      directionsWaypointsKey(),
      st.zoom.toFixed(3),
      st.lat.toFixed(5),
      st.lon.toFixed(5),
      w,
      h
    ].join("|");
    if (key === directionsRouteCaptureKey && canvasRouteUsable()) return true;

    const found = overlayHost();
    const canvas = found?.canvas;
    if (!canvas) return false;
    let imageData;
    try {
      imageData = globalThis.Gcj02Aligner.readMapCanvasImageData(canvas);
    } catch (_e) {
      return false;
    }
    if (!imageData) return false;
    const waypoints = globalThis.Gcj02Aligner.parseDirectionsWaypoints(location.href);
    const lines = globalThis.Gcj02Aligner.extractRouteLineFromCanvasImageData(
      imageData.data,
      imageData.width,
      imageData.height,
      canvas.clientWidth || w,
      canvas.clientHeight || h,
      st.lat,
      st.lon,
      st.zoom,
      w,
      h,
      waypoints[0] || null,
      waypoints[waypoints.length - 1] || null
    );
    if (!lines.length || lines[0].length < MIN_CANVAS_ROUTE_PTS) return false;
    directionsPolylines = lines;
    directionsRouteCaptureKey = key;
    lastRouteKey = "";
    return true;
  }

  function scheduleDirectionsRouteCapture(st, w, h) {
    clearTimeout(directionsRouteCaptureTimer);
    if (directionsRouteCaptureAttempts > 40) return;
    directionsRouteCaptureTimer = setTimeout(() => {
      directionsRouteCaptureAttempts++;
      if (!alive || gestureBusy()) return;
      if (captureDirectionsRouteFromCanvas(st, w, h)) {
        directionsRouteCaptureAttempts = 0;
        if (!gestureBusy()) redraw();
        return;
      }
      scheduleDirectionsRouteCapture(st, w, h);
    }, 280);
  }

  function scanBufferedDirectionsResources(force) {
    if (!globalThis.Gcj02Aligner.isDirectionsView(location.href)) return;
    if (!force && directionsPolylines.length) return;
    for (const e of performance.getEntriesByType("resource")) {
      if (/\/maps\/preview\/directions/i.test(e.name)) {
        queueDirectionsFetch(e.name, !!force);
        return;
      }
    }
  }

  function queueDirectionsFetch(previewUrl, force) {
    const url = String(previewUrl || "");
    if (!url) return;
    if (!force && url === lastDirectionsPreviewUrl) return;
    lastDirectionsPreviewUrl = url;
    clearTimeout(directionsFetchTimer);
    directionsFetchTimer = setTimeout(() => {
      fetch(url)
        .then((r) => r.text())
        .then((body) => {
          const canvasPts = directionsPolylines[0]?.length || 0;
          const lines = globalThis.Gcj02Aligner.extractDirectionsPolylines(body, location.href);
          if (!lines.length) return;
          const previewPts = lines[0]?.length || 0;
          if (canvasPts >= MIN_CANVAS_ROUTE_PTS && canvasPts >= previewPts) return;
          directionsPolylines = lines;
          lastRouteKey = "";
          if (!gestureBusy()) redraw();
        })
        .catch(() => {});
    }, 120);
  }

  function syncRoute(st, w, h) {
    if (!panEl) return;
    if (!globalThis.Gcj02Aligner.isDirectionsView(location.href)) {
      panEl.querySelectorAll(".gcj02-route").forEach((e) => e.remove());
      lastRouteKey = "";
      directionsPolylines = [];
      directionsRouteCaptureKey = "";
      directionsRouteCaptureAttempts = 0;
      directionsCaptureWaitTicks = 0;
      clearTimeout(directionsRouteCaptureTimer);
      return;
    }
    if (!canvasRouteUsable()) {
      tryDirectionsRouteSources(st, w, h);
    }
    if (!directionsRoutePaintable()) {
      scheduleDirectionsRouteCapture(st, w, h);
    }
    const routeKey = [
      w, h, st.zoom.toFixed(3), st.lat.toFixed(5), st.lon.toFixed(5),
      directionsPolylines.map((line) => line.length).join(";")
    ].join(",");
    if (routeKey === lastRouteKey) return;
    lastRouteKey = routeKey;
    panEl.querySelectorAll(".gcj02-route").forEach((e) => e.remove());
    if (!directionsPolylines.length) return;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "gcj02-route");
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    svg.setAttribute("aria-hidden", "true");
    for (const line of directionsPolylines) {
      const pts = line.map((pt) => {
        const s = globalThis.Gcj02Aligner.overlayPoiScreenPx(
          pt.lat, pt.lon, st.lat, st.lon, st.zoom, w, h, urlCoordOpts()
        );
        return `${s.x},${s.y}`;
      }).join(" ");
      const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      poly.setAttribute("points", pts);
      poly.setAttribute("fill", "none");
      poly.setAttribute("stroke", "#1a73e8");
      poly.setAttribute("stroke-width", "6");
      poly.setAttribute("stroke-linecap", "round");
      poly.setAttribute("stroke-linejoin", "round");
      poly.setAttribute("opacity", "0.92");
      svg.appendChild(poly);
    }
    panEl.appendChild(svg);
    if (root) {
      root.dataset.routeSegments = String(directionsPolylines.length);
      root.dataset.routePoints = String(directionsPolylines.reduce((n, line) => n + line.length, 0));
    }
  }

  function syncPoisIfVisible() {
    if (!alive || !root || root.style.display === "none") return;
    // Blended mode leaves POIs and routes to Maps.
    if (!streetsAlign()) return;
    const st = parseMapState();
    if (!st) return;
    const w = Math.max(root.clientWidth || root.getBoundingClientRect().width, 1);
    const h = Math.max(root.clientHeight || root.getBoundingClientRect().height, 1);
    syncPois(st, w, h);
    syncRoute(st, w, h);
  }

  function hideOverlay() {
    panDrag = null;
    gestureHold = null;
    endZoomAnim(true);
    clearPanVisual();
    if (root) {
      root.style.display = "none";
      root.dataset.mode = "off";
      root.dataset.tileOk = "0";
      root.dataset.tileError = "0";
      root.dataset.poiCount = "0";
    }
    lastPoiKey = "";
    if (statusEl) statusEl.style.display = "none";
    if (lastHost) {
      try { lastHost.style.clipPath = ""; lastHost.style.maskImage = ""; lastHost.style.webkitMaskImage = ""; } catch (_e) {}
    }
    setNativeBlend(false);
    setNativeMapHidden(false);
    reportActionStatus(parseMapState());
  }

  function overlayIsVisible() {
    return !!(alive && root && root.style.display !== "none");
  }

  function pointInOverlay(clientX, clientY) {
    if (!root) return false;
    const box = root.getBoundingClientRect();
    return clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom;
  }

  function zoomScaleNow() {
    if (!zoomAnim) return 1;
    if (zoomAnim.buttonScale != null) return zoomAnim.buttonScale;
    const st = parseMapState();
    if (st && Math.abs(st.zoom - zoomAnim.startZoom) >= 0.001) {
      return 2 ** (st.zoom - zoomAnim.startZoom);
    }
    return zoomAnim.wheelScale;
  }

  function applyZoomVisual() {
    if (!zoomAnim || !panEl) return;
    const s = zoomScaleNow();
    panEl.style.transformOrigin = `${zoomAnim.ox}px ${zoomAnim.oy}px`;
    panEl.style.transform = `scale(${s})`;
  }

  function scheduleZoomTick() {
    if (zoomRaf || !zoomAnim || zoomAnim.buttonScale != null) return;
    zoomRaf = requestAnimationFrame(() => {
      zoomRaf = 0;
      if (!zoomAnim) return;
      applyZoomVisual();
      if (zoomAnim) scheduleZoomTick();
    });
  }

  function bumpZoomEndTimer() {
    if (!zoomAnim) return;
    clearTimeout(zoomAnim.endTimer);
    zoomAnim.endTimer = setTimeout(() => endZoomAnim(false), ZOOM_SETTLE_MS);
  }

  function endZoomAnim(silent) {
    if (!zoomAnim) return;
    clearTimeout(zoomAnim.endTimer);
    const startSnap = {
      href: zoomAnim.startHref || location.href,
      lat: zoomAnim.startLat,
      lon: zoomAnim.startLon,
      zoom: zoomAnim.startZoom
    };
    zoomAnim = null;
    if (zoomRaf) {
      cancelAnimationFrame(zoomRaf);
      zoomRaf = 0;
    }
    if (silent || !alive) {
      gestureHold = null;
      clearPanVisual();
      return;
    }
    // Keep scale() until Maps commits the new zoom and redraw paints it.
    beginGestureHold(startSnap);
  }

  function beginWheelZoom(clientX, clientY) {
    if (!overlayIsVisible() || !panEl || !root || panDrag) return;
    const st = parseMapState();
    if (!st) return;
    const box = root.getBoundingClientRect();
    if (!zoomAnim) {
      zoomAnim = {
        startZoom: st.zoom,
        startLat: st.lat,
        startLon: st.lon,
        startHref: location.href,
        ox: clientX - box.left,
        oy: clientY - box.top,
        wheelScale: 1,
        endTimer: 0,
        buttonScale: null
      };
      panEl.style.transition = "";
    }
    applyZoomVisual();
    scheduleZoomTick();
    bumpZoomEndTimer();
  }

  function onMapWheel(ev) {
    if (!overlayIsVisible()) return;
    if (!pointInOverlay(ev.clientX, ev.clientY)) return;
    beginWheelZoom(ev.clientX, ev.clientY);
    if (!zoomAnim || zoomAnim.buttonScale != null) return;
    let dy = ev.deltaY;
    if (ev.deltaMode === 1) dy *= 16;
    if (ev.deltaMode === 2) dy *= 64;
    zoomAnim.wheelScale *= 2 ** (-dy / WHEEL_PX_PER_ZOOM);
    zoomAnim.wheelScale = Math.min(4, Math.max(0.25, zoomAnim.wheelScale));
    applyZoomVisual();
    bumpZoomEndTimer();
  }

  function onZoomButtonDown(ev) {
    if (!overlayIsVisible() || !panEl || !root || panDrag) return;
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const btn = t.closest("button, [role='button']");
    if (!btn) return;
    const label = `${btn.getAttribute("aria-label") || ""} ${btn.getAttribute("title") || ""} ${btn.textContent || ""}`;
    if (!/zoom\s*in|zoom\s*out|放大|縮小|拉近|拉远/i.test(label)) return;
    const zoomOut = /zoom\s*out|縮小|拉远/i.test(label);
    const st = parseMapState();
    if (!st) return;
    endZoomAnim(true);
    const box = root.getBoundingClientRect();
    zoomAnim = {
      startZoom: st.zoom,
      startLat: st.lat,
      startLon: st.lon,
      startHref: location.href,
      ox: box.width / 2,
      oy: box.height / 2,
      wheelScale: 1,
      endTimer: 0,
      buttonScale: zoomOut ? 0.5 : 2
    };
    panEl.style.transition = `transform ${BUTTON_ZOOM_MS}ms ease-out`;
    applyZoomVisual();
    clearTimeout(zoomAnim.endTimer);
    zoomAnim.endTimer = setTimeout(() => endZoomAnim(false), BUTTON_ZOOM_MS + 40);
  }

  function onPanPointerDown(ev) {
    if (!overlayIsVisible()) return;
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    if (ev.isPrimary === false) return;
    const t = ev.target;
    if (!(t instanceof Element)) return;
    // Pegman drag must not steal the pan preview — coverage uses svv tiles.
    if (globalThis.Gcj02Aligner.isStreetViewPegmanTarget(t)) return;
    if (t.closest("#gcj02-aligner-status, input, textarea, button, select, [role='slider']")) return;
    if (!pointInOverlay(ev.clientX, ev.clientY)) return;
    if (zoomAnim) endZoomAnim(true);
    if (gestureHold) {
      gestureHold = null;
      clearPanVisual();
    }
    panDrag = {
      id: ev.pointerId,
      x0: ev.clientX,
      y0: ev.clientY,
      moved: false,
      snap: cameraSnapshot()
    };
  }

  function onPanPointerMove(ev) {
    if (!panDrag || ev.pointerId !== panDrag.id || !panEl) return;
    const dx = ev.clientX - panDrag.x0;
    const dy = ev.clientY - panDrag.y0;
    if (!panDrag.moved && Math.hypot(dx, dy) >= PAN_MOVE_PX) panDrag.moved = true;
    // Translate the inner pan layer only — root stays put with overflow:hidden
    // so padded off-screen tiles slide into view instead of exposing a black gap.
    panEl.style.transition = "";
    panEl.style.transformOrigin = "";
    panEl.style.transform = `translate3d(${dx}px,${dy}px,0)`;
  }

  function endPanDrag(ev) {
    if (!panDrag) return;
    if (ev && ev.pointerId != null && ev.pointerId !== panDrag.id) return;
    const { moved, snap } = panDrag;
    panDrag = null;
    if (!moved) {
      clearPanVisual();
      return;
    }
    // Keep translate3d until Maps updates `@` and redraw replaces tiles.
    beginGestureHold(snap || cameraSnapshot());
  }

  function redraw() {
    if (!alive || gestureBusy()) return;
    // Re-arm the basemap switch only when the display type itself changes —
    // panning rewrites `@` constantly and must not restart the click attempts.
    const displayType = globalThis.Gcj02Aligner.mapDisplayType(
      globalThis.Gcj02Aligner.dataParam(location.href)
    );
    if (displayType !== lastDisplayType) {
      lastDisplayType = displayType;
      basemapSwitchTries = 0;
      basemapToggleSig = "";
      blendFallbackStreets = false;
    }
    const spec = overlaySpec();
    const st = parseMapState();
    reportActionStatus(st);
    const active = effectiveMode(st);
    const blend = !!spec.blendNative;
    if (spec.nativeOnly || active === "off" || !st || st.zoom < 5 || st.zoom > 21) {
      hideOverlay();
      return;
    }
    if (blend && maybeSwitchToMapBasemap()) return;

    if (!blend && globalThis.Gcj02Aligner.isDirectionsView(location.href) && !directionsOverlayReady()) {
      const size = directionsCaptureSize();
      if (size) tryDirectionsRouteSources(st, size.w, size.h);
      if (!directionsOverlayReady()) {
        if (size) scheduleDirectionsRouteCapture(st, size.w, size.h);
        return;
      }
    }

    if (!ensureRoot()) return;
    // Measure with the layer laid out. A `display: none` root (hideOverlay ran
    // earlier in this document — out of China, a native-only view, a pending
    // basemap switch) reports 0x0, and the size guard below then returned before
    // anything could show it again, wedging the overlay off for good.
    if (root.style.display === "none") root.style.display = "";
    const box = root.getBoundingClientRect();
    const w = root.clientWidth || box.width;
    const h = root.clientHeight || box.height;
    if (!(w >= 32) || !(h >= 32)) return;
    if (blend) {
      // Nothing native gets hidden or repainted — Maps keeps drawing the GCJ
      // world and we only slide the WGS photo underneath it.
      setNativeMapHidden(false);
      setNativeBlend(true);
    } else {
      setNativeBlend(false);
      tryDirectionsRouteSources(st, w, h);
      if (shouldHideNativeForDirections()) setNativeMapHidden(true);
      else scheduleDirectionsRouteCapture(st, w, h);
    }
    root.dataset.alignMode = alignMode;
    delete root.dataset.blendBlocked;
    root.style.display = "";
    if (statusEl) statusEl.style.display = "";

    const zTile = Math.min(21, Math.max(0, Math.round(st.zoom)));
    const scale = 2 ** (st.zoom - zTile);
    const tileSize = TILE * scale;
    // URL `@` is usually GCJ-02; lat/lon place queries are already WGS-84.
    // Center the overlay on the WGS twin of that camera (see overlayCamera).
    // Blended mode: the native canvas is the GCJ world, so the imagery camera is
    // always gcjToWgs(@) — no WGS lat/lon place exception, Maps renders `@` in
    // its own GCJ frame on every URL shape.
    const cam = blend
      ? globalThis.Gcj02Aligner.imageryCamera(st.lat, st.lon)
      : globalThis.Gcj02Aligner.overlayCamera(st.lat, st.lon, urlCoordOpts());
    const center = worldPixel(cam.lat, cam.lon, st.zoom);
    const tl = { x: center.x - w / 2, y: center.y - h / 2 };
    // Enough off-screen tiles that a mid-drag translate does not expose a gap.
    const pad = Math.max(4, Math.ceil(Math.max(w, h) / tileSize) + 1);
    const x0 = Math.floor(tl.x / tileSize) - pad;
    const y0 = Math.floor(tl.y / tileSize) - pad;
    const x1 = Math.floor((tl.x + w) / tileSize) + pad;
    const y1 = Math.floor((tl.y + h) / tileSize) + pad;
    const max = 2 ** zTile;
    const key = [
      active, alignMode, spec.label, spec.roadLyrs, spec.baseLyrs.join("+"), (spec.shadeLyrs || []).join("+"),
      spec.extraLyrs.join("+"), urlCoordOpts()?.wgs84 ? "wgs" : "gcj",
      zTile, scale.toFixed(4), x0, y0, x1, y1, Math.round(center.x), Math.round(center.y),
      Math.round(w), Math.round(h)
    ].join(",");
    if (key !== lastKey) {
      lastKey = key;
      lastPoiKey = "";
      // Drop pan/zoom preview in the same turn as placing tiles for the new
      // camera so the frame never shows old tiles at identity transform.
      clearPanVisual();
      if (panEl) panEl.querySelectorAll(".gcj02-tile,.gcj02-road,.gcj02-shade").forEach((e) => e.remove());
      else root.querySelectorAll(".gcj02-tile,.gcj02-road,.gcj02-shade").forEach((e) => e.remove());

      const sample = globalThis.Gcj02Aligner.overlayShiftPx(cam.lat, cam.lon, st.zoom);
      const offsetPx = sample.hypot;
      const extras = spec.extraLyrs.length ? `+${spec.extraLyrs.join("+")}` : "";
      const how = blend
        ? "WGS satellite shifted under native GCJ layers"
        : "streets shifted GCJ→WGS";
      setStatus(`Aligning · ${spec.label}${extras} · ${how} · v${VERSION} · z=${st.zoom.toFixed(2)}`, {
        mode: "on",
        alignMode,
        layer: spec.label,
        version: VERSION,
        zoom: st.zoom.toFixed(3),
        zTile: String(zTile),
        offsetPx: offsetPx.toFixed(2),
        shiftDx: sample.dx.toFixed(2),
        shiftDy: sample.dy.toFixed(2),
        lat: st.lat.toFixed(6),
        lon: st.lon.toFixed(6),
        camLat: cam.lat.toFixed(6),
        camLon: cam.lon.toFixed(6)
      });

      const shift = (rdx, rdy) => `translate3d(${rdx}px,${rdy}px,0)`;
      const hasBase = spec.baseLyrs.length > 0;
      // One camera shift for every street tile. Per-tile evil shifts warped the
      // road layer so search pins (single vector) drifted vs X235 across zoom.
      const roadShift = shift(sample.dx, sample.dy);

      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const wx = ((tx % max) + max) % max;
          if (ty < 0 || ty >= max) continue;

          const ll = tileCenterLatLon(wx, ty, zTile);
          const pW = worldPixel(ll.lat, ll.lon, st.zoom);
          const left = pW.x - center.x + w / 2 - tileSize / 2;
          const top = pW.y - center.y + h / 2 - tileSize / 2;

          // Satellite `s` stays on WGS. Terrain: shifted colored streets `m`, then
          // unshifted WGS shade `t` on top (outside-China look). Never CSS-shift
          // combined `p` (X235 climbs the west 五丈原 face with the cliffs).
          for (const lyrs of spec.baseLyrs) {
            placeTile("gcj02-tile", lyrs, left, top, tileSize, "", wx, ty, zTile);
          }
          if (spec.roadLyrs) {
            placeTile(
              hasBase ? "gcj02-road" : "gcj02-tile",
              spec.roadLyrs, left, top, tileSize, roadShift, wx, ty, zTile
            );
          }
          for (const lyrs of spec.extraLyrs) {
            placeTile("gcj02-road", lyrs, left, top, tileSize, roadShift, wx, ty, zTile);
          }
          for (const lyrs of spec.shadeLyrs || []) {
            placeTile("gcj02-shade", lyrs, left, top, tileSize, "", wx, ty, zTile);
          }
        }
      }
    }
    if (!blend) {
      syncPois(st, w, h);
      syncRoute(st, w, h);
    }
  }

  function setMode(v) {
    if (!alive) return;
    const next = normalizeMode(v);
    if (next === alignMode) return;
    alignMode = next;
    // Switching modes must undo the other mode's side effects: streets hides the
    // native canvas and paints POIs/routes, satellite blends it and paints none.
    setNativeBlend(false);
    setNativeMapHidden(false);
    setHoveredPoi("");
    if (panEl) {
      panEl.querySelectorAll(".gcj02-tile,.gcj02-road,.gcj02-shade,.gcj02-poi,.gcj02-route")
        .forEach((e) => e.remove());
    }
    directionsPolylines = [];
    lastRouteKey = "";
    lastKey = "";
    lastPoiKey = "";
    basemapSwitchTries = 0;
    basemapClickAt = 0;
    basemapToggleSig = "";
    blendFallbackStreets = false;
    if (root) root.dataset.alignMode = alignMode;
    if (streetsAlign()) startDirectionsBootstrapCapture();
    redraw();
  }

  // Boot order matters: the first redraw waits for the stored mode, otherwise a
  // satellite-mode user sees the streets overlay hide the canvas for a frame.
  function applyStoredAlignMode(v) {
    alignModeLoaded = true;
    if (normalizeMode(v) === alignMode) {
      lastKey = "";
      redraw();
      return;
    }
    setMode(v);
  }

  function loadAlignMode() {
    try {
      chrome.storage.sync.get({ [ALIGN_MODE_KEY]: DEFAULT_ALIGN_MODE }, (got) => {
        try { void chrome.runtime.lastError; } catch (_e) {}
        applyStoredAlignMode(got?.[ALIGN_MODE_KEY]);
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "sync" || !changes[ALIGN_MODE_KEY]) return;
        setMode(changes[ALIGN_MODE_KEY].newValue);
      });
    } catch (_e) {
      applyStoredAlignMode(alignMode);
    }
  }

  // Test-only: Playwright posts setMode to force native Maps for On-vs-Off checks.
  addEventListener("message", (ev) => {
    if (!alive || ev.source !== window) return;
    if (ev.data?.source !== "gcj02-aligner") return;
    if (ev.data?.type === "setMode") setMode(ev.data.mode);
    if (ev.data?.type === "setPegmanCover") setPegmanCover(!!ev.data.on);
  });

  // Off paints the red teardrop+tooltip on the native canvas when the sidebar
  // result is hovered. On hides that canvas, so mirror the same hover here.
  document.addEventListener("pointerover", onSidebarPointerOver, true);
  document.addEventListener("pointerout", onSidebarPointerOut, true);
  document.addEventListener("mouseover", onSidebarPointerOver, true);
  document.addEventListener("mouseout", onSidebarPointerOut, true);

  // Live pan: overlay follows the pointer; Maps commits `@` on release.
  document.addEventListener("pointerdown", onPanPointerDown, true);
  document.addEventListener("pointermove", onPanPointerMove, true);
  document.addEventListener("pointerup", endPanDrag, true);
  document.addEventListener("pointercancel", endPanDrag, true);
  // Pegman drag: show shifted Street View coverage (`svv`) while native canvas is hidden.
  document.addEventListener("pointerdown", onPegmanPointerDown, true);
  document.addEventListener("pointerup", onPegmanPointerUp, true);
  document.addEventListener("pointercancel", onPegmanPointerUp, true);
  // Backup: Maps still requests /vt/pb=!2ssvv… while pegman is active even though we
  // hide the native canvas — mirror that by forcing our coverage tiles.
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!streetsAlign()) return;
        if (/\/maps\/vt\/pb=.*!2ssvv/i.test(e.name)) {
          setPegmanCover(true);
        }
        if (/\/maps\/preview\/directions/i.test(e.name)) {
          queueDirectionsFetch(e.name);
        }
      }
    });
    po.observe({ type: "resource", buffered: true });
  } catch (_e) {}
  // Smooth zoom preview for wheel and the corner +/- controls.
  document.addEventListener("wheel", onMapWheel, { capture: true, passive: true });
  document.addEventListener("pointerdown", onZoomButtonDown, true);
  addEventListener("blur", () => {
    endPanDrag(null);
    endZoomAnim(false);
    onPegmanPointerUp();
  });

  obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true });

  addEventListener("resize", () => {
    if (!alive || gestureBusy()) return;
    lastKey = "";
    redraw();
  });
  addEventListener("popstate", () => {
    if (!alive || gestureBusy()) return;
    lastKey = "";
    setTimeout(redraw, 200);
  });
  ["pushState", "replaceState"].forEach((name) => {
    const orig = history[name];
    history[name] = function historyHook() {
      const ret = orig.apply(this, arguments);
      if (alive && !gestureBusy()) {
        lastKey = "";
        lastHref = "";
        setTimeout(redraw, 80);
      }
      return ret;
    };
  });
  pollTimer = setInterval(() => {
    if (!alive || gestureBusy()) return;
    if (location.href !== lastHref) {
      lastHref = location.href;
      lastKey = "";
      redraw();
      return;
    }
    const spec = overlaySpec();
    if (spec.nativeOnly) {
      if (root && root.style.display !== "none") {
        lastKey = "";
        redraw();
      }
      return;
    }
    const st = parseMapState();
    if (effectiveMode(st) === "on" && (!root || root.style.display === "none" || !root.querySelector("img"))) {
      lastKey = "";
      redraw();
      return;
    }
    if (root && root.style.display !== "none") {
      const found = overlayHost();
      if (found) {
        if (root.parentElement !== found.host) {
          found.host.insertBefore(root, found.host.firstChild);
          lastKey = "";
        }
        clipHostForChrome(found.host);
        if (fitOverlayToCanvas(found.host, found.canvas)) lastKey = "";
      }
      if (streetsAlign()) {
        const stPoll = parseMapState();
        if (stPoll && root) {
          const pw = root.clientWidth || root.getBoundingClientRect().width;
          const ph = root.clientHeight || root.getBoundingClientRect().height;
          if (pw >= 32 && ph >= 32) tryDirectionsRouteSources(stPoll, pw, ph);
        }
        if (shouldHideNativeForDirections()) setNativeMapHidden(true);
      } else {
        setNativeBlend(true);
      }
      if (!lastKey) redraw();
      else syncPoisIfVisible();
    }
  }, 400);

  loadAlignMode();
  startDirectionsBootstrapCapture();
  // If storage never answers (no permission, disabled profile), still draw.
  setTimeout(() => {
    if (!alignModeLoaded) applyStoredAlignMode(alignMode);
  }, 300);
})();
