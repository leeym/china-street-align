(() => {
  "use strict";

  let VERSION = "dev";
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
  const DEFAULT_ALIGN_MODE = "hybrid";
  // "hybrid" (On) aligns when possible; "off" is native Maps.
  let alignMode = DEFAULT_ALIGN_MODE;
  let alignModeLoaded = false;
  let alignModeReadId = 0;
  const BASEMAP_SWITCH_MAX_TRIES = 6;
  let hybridRewindTries = 0;
  let directionsLatchUntil = 0;
  let lastDirectionsOpen = false;
  let root = null;
  let panEl = null;
  let statusEl = null;
  let timer = null;
  let pollTimer = null;
  let lastKey = "";
  let lastStatusSig = "";
  let lastHref = "";
  let lastPoiKey = "";
  let lastHost = null;
  let hoveredPoiKey = "";
  let alive = true;
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
  let syncTimer = null;
  const obs = new MutationObserver(() => {
    if (!alive || gestureBusy()) return;
    if (noteDirectionsStateChange()) {
      lastKey = "";
      clearTimeout(timer);
      clearTimeout(syncTimer);
      timer = setTimeout(redraw, 80);
      return;
    }
    if (location.href === lastHref) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        syncPoisIfVisible();
        if (hybridAlign() && inChina(parseMapState()) && directionsPanelOpen() && hybridStillOnSatelliteBasemap()) {
          maybeHybridRewindToMap();
        }
      }, 80);
      return;
    }
    lastHref = location.href;
    lastKey = "";
    lastPoiKey = "";
    clearTimeout(syncTimer);
    clearTimeout(timer);
    timer = setTimeout(redraw, 120);
  });

  function noteDirectionsStateChange() {
    const open = directionsPanelOpen();
    const changed = open !== lastDirectionsOpen;
    if (changed) {
      lastDirectionsOpen = open;
      if (open) hybridRewindTries = 0;
    }
    return changed;
  }

  function armDirectionsLatch() {
    directionsLatchUntil = Date.now() + 120000;
    hybridRewindTries = 0;
    lastDirectionsOpen = true;
    lastKey = "";
    setTimeout(redraw, 0);
    setTimeout(redraw, 120);
    setTimeout(redraw, 450);
    setTimeout(redraw, 1200);
  }

  function isDirectionsActivator(el) {
    if (!el || el.closest("#gcj02-aligner-root")) return false;
    if (el.getAttribute?.("data-item-id") === "directions") return true;
    const blob = [
      el.getAttribute?.("aria-label"),
      el.getAttribute?.("data-tooltip"),
      el.getAttribute?.("data-value"),
      el.getAttribute?.("jsaction"),
      el.textContent
    ].filter(Boolean).join(" ");
    if (/directions|規劃路線|规划路线|路线|路線|導航|导航|get directions/i.test(blob)) return true;
    const href = el.getAttribute?.("href") || "";
    return /\/maps\/dir\//i.test(href);
  }

  function onDirectionsActivatorPointer(ev) {
    const el = ev.target instanceof Element
      ? ev.target.closest("button, a, [role='button'], [role='tab'], [jsaction]")
      : null;
    if (!isDirectionsActivator(el)) return;
    if (!inChina(parseMapState())) return;
    armDirectionsLatch();
  }

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
    clearTimeout(satGateNoticeTimer);
    clearInterval(pollTimer);
    endZoomAnim(true);
    panDrag = null;
    gestureHold = null;
    try { root?.remove(); } catch (_e) {}
    try { lastHost && (lastHost.style.clipPath = ""); lastHost.style.maskImage = ""; lastHost.style.webkitMaskImage = ""; } catch (_e) {}
    lastHost = null;
    setNativeMapHidden(false);
    clearSatelliteBasemapGate();
    root = null;
    panEl = null;
    statusEl = null;
  }

  function outOfChina(lat, lon) {
    return globalThis.Gcj02Aligner.outOfChina(lat, lon);
  }

  function satellitePhotoBasemap() {
    return globalThis.Gcj02Aligner.mapDisplayType(
      globalThis.Gcj02Aligner.dataParam(location.href)
    ) === 3;
  }

  // Photo satellite basemap lists aerial providers (CNES/Airbus/Maxar). Vector maps
  // may still show a generic "Imagery ©" line without those names.
  function nativeMapShowsSatelliteImagery() {
    const blob = document.body?.innerText || "";
    if (/Imagery\s*©[^©\n]{0,120}(CNES|Airbus|Maxar)/i.test(blob)) return true;
    if (/©\d{4}\s*(CNES|Airbus|Maxar)/i.test(blob)) return true;
    return false;
  }

  function requestPageWorldMapSwitch() {
    window.postMessage({ source: "gcj02-aligner", type: "switchToMapBasemap" }, location.origin);
  }

  const NATIVE_ONLY_SPEC = {
    nativeOnly: true,
    label: "native",
    baseLyrs: [],
    roadLyrs: "",
    shadeLyrs: [],
    extraLyrs: [],
    hideNative: false,
    blendNative: false
  };

  function overlaySpec() {
    if (hybridYieldsNativeCanvas()) return NATIVE_ONLY_SPEC;
    const placeAligned = placeAlignedOverlaySpec();
    if (placeAligned) return placeAligned;
    if (hybridCrispSatellite()) {
      return {
        nativeOnly: false,
        label: "satellite",
        baseLyrs: ["s"],
        roadLyrs: "h",
        shadeLyrs: [],
        extraLyrs: [],
        hideNative: true,
        blendNative: false
      };
    }
    return NATIVE_ONLY_SPEC;
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

  function publishAlignMode() {
    document.documentElement.dataset.gcj02AlignMode = alignMode;
    if (root) root.dataset.alignMode = alignMode;
  }

  function hybridAlign() {
    return alignMode === "hybrid";
  }

  function hybridNeedsNativeLayers() {
    if (!hybridAlign()) return false;
    if (directionsPanelOpen()) return true;
    return globalThis.Gcj02Aligner.hybridNeedsNativeLayers(location.href, false);
  }

  function directionsPanelOpen() {
    if (directionsLatchUntil > Date.now()) return true;
    if (/\/maps\/dir(?:\/|$|[?#])/i.test(location.pathname)) return true;
    if (globalThis.Gcj02Aligner.hasDirectionsRouteData(location.href)) return true;
    if (document.querySelector(
      "[data-trip-index], [data-section-id='directions'], [jsaction*='pane.directions'], #directions"
    )) return true;
    for (const el of document.querySelectorAll("button, [role='tab']")) {
      // Layers panel quick toggles (traffic/transit/bike) use the same labels as
      // directions travel modes — do not treat layerswitcher chips as directions.
      if (el.getAttribute("role") === "menuitemcheckbox") continue;
      if (/layerswitcher/i.test(el.getAttribute("jsaction") || "")) continue;
      const label = basemapControlLabel(el).trim();
      if (!/^(driving|transit|walking|bicycling|開車|开车|驾车|大眾運輸|公共交通|步行|騎車|骑车|摩托車|摩托车)$/i.test(label)) {
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.left < window.innerWidth * 0.45) return true;
    }
    for (const el of document.querySelectorAll("input")) {
      const meta = [
        el.getAttribute("aria-label"),
        el.getAttribute("placeholder"),
        el.getAttribute("aria-placeholder")
      ].filter(Boolean).join(" ");
      if (!/(origin|destination|starting|start point|choose|起點|起点|目的地|你的位置|your location|location)/i.test(meta)) {
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width > 48 && r.height > 6 && r.left < window.innerWidth * 0.45) return true;
    }
    return false;
  }

  function hybridCrispSatellite() {
    return hybridAlign() && !hybridNeedsNativeLayers() && satellitePhotoBasemap();
  }

  // Hybrid yields to Google's native canvas when overlay cannot paint crisply
  // or must not redraw Google layers (search, directions, terrain, traffic, etc.).
  function hybridYieldsNativeCanvas() {
    if (!hybridAlign()) return false;
    if (hybridNeedsNativeLayers()) return true;
    if (placeAlignedPinActive()) return false;
    if (!satellitePhotoBasemap()) return true;
    if (globalThis.Gcj02Aligner.isPlaceView(location.href)) {
      return !globalThis.Gcj02Aligner.placeNeedsAlignedPin(
        location.href,
        satellitePhotoBasemap()
      );
    }
    return false;
  }

  function placeAlignedPinActive() {
    if (effectiveMode(parseMapState()) === "off") return false;
    if (globalThis.Gcj02Aligner.hybridNeedsNativeLayers(location.href, false)) return false;
    if (directionsPanelOpen()) return false;
    return globalThis.Gcj02Aligner.placeNeedsAlignedPin(
      location.href,
      satellitePhotoBasemap()
    );
  }

  function hybridPlaceAlignedOverlay() {
    return hybridAlign() && placeAlignedPinActive();
  }

  function placeAlignedOverlaySpec() {
    if (!placeAlignedPinActive()) return null;
    const base = satellitePhotoBasemap()
      ? {
          nativeOnly: false,
          label: "satellite",
          baseLyrs: ["s"],
          roadLyrs: "h",
          shadeLyrs: [],
          extraLyrs: [],
          hideNative: true,
          blendNative: false
        }
      : {
          nativeOnly: false,
          label: "map",
          baseLyrs: [],
          roadLyrs: "m",
          shadeLyrs: [],
          extraLyrs: [],
          hideNative: true,
          blendNative: false
        };
    return base;
  }

  function satelliteBasemapGateActive() {
    if (!alive || !hybridAlign()) return false;
    if (satellitePhotoBasemap()) return false;
    if (!hybridNeedsNativeLayers()) return false;
    const st = parseMapState();
    return effectiveMode(st) === "on";
  }

  function basemapControlLabel(el) {
    return String(
      el.getAttribute("aria-label")
      || el.getAttribute("title")
      || el.textContent
      || ""
    ).replace(/\s+/g, " ").trim();
  }

  function basemapToggleWouldEnableSatellite(sig) {
    const s = String(sig || "");
    if (basemapLabelIsSat(s)) return true;
    return /(interactive map|互動式地圖|互动地图)/i.test(s);
  }

  function clearSatelliteBasemapGate() {
    delete document.documentElement.dataset.gcj02SatGate;
    for (const el of document.querySelectorAll("[data-gcj02-sat-gated]")) {
      el.removeAttribute("data-gcj02-sat-gated");
      el.classList.remove("gcj02-sat-gated");
      el.removeAttribute("aria-hidden");
    }
  }

  function markSatelliteBasemapGated(el) {
    if (!el) return;
    el.setAttribute("data-gcj02-sat-gated", "1");
    el.classList.add("gcj02-sat-gated");
    el.setAttribute("aria-hidden", "true");
  }

  function gateSatelliteBasemapPickerItems() {
    for (const el of document.querySelectorAll(
      '[role="menuitemradio"], [role="menuitem"], [role="radio"], button, [role="button"], label'
    )) {
      if (el.closest("#gcj02-aligner-root")) continue;
      if (!isBasemapLayerPicker(el)) continue;
      if (!basemapLabelIsSat(basemapControlLabel(el))) continue;
      markSatelliteBasemapGated(el);
    }
  }

  function gateSatelliteBasemapToggles() {
    const found = overlayHost();
    if (!found) return;
    const cr = found.canvas.getBoundingClientRect();
    const isToggle = globalThis.Gcj02Aligner.isBasemapToggleBox;
    const stripPath = /\/maps\/(dir|place|search)\//.test(location.pathname);
    for (const el of document.querySelectorAll("button, [role='button'], label")) {
      if (el.closest("#gcj02-aligner-root")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 55 || r.width > 110 || r.height < 55 || r.height > 110) continue;
      const sig = basemapToggleSignature(el);
      if (!sig || !basemapToggleWouldEnableSatellite(sig)) continue;
      const corner = isToggle(r, cr);
      const strip = stripPath && r.bottom <= cr.bottom + 8 && r.bottom >= cr.bottom - 180;
      if (!corner && !strip) continue;
      markSatelliteBasemapGated(resolveBasemapButton(el) || el);
    }
  }

  function syncSatelliteBasemapGate() {
    if (!satelliteBasemapGateActive()) {
      clearSatelliteBasemapGate();
      return;
    }
    document.documentElement.dataset.gcj02SatGate = "1";
    gateSatelliteBasemapPickerItems();
    gateSatelliteBasemapToggles();
  }

  let satGateNoticeUntil = 0;
  let satGateNoticeTimer = 0;

  function flashSatelliteGateNotice() {
    satGateNoticeUntil = Date.now() + 2800;
    if (statusEl) {
      statusEl.textContent = `${datumStatusLabel()} · v${VERSION}`;
      statusEl.style.display = "";
    }
    clearTimeout(satGateNoticeTimer);
    satGateNoticeTimer = setTimeout(() => {
      satGateNoticeUntil = 0;
      if (alive && !gestureBusy()) redraw();
    }, 2900);
  }

  function onSatelliteBasemapGatePointer(ev) {
    if (!alive || !ev.isTrusted || !satelliteBasemapGateActive()) return;
    const el = ev.target instanceof Element ? ev.target : null;
    if (el) {
      const hit = el.closest(
        '[role="menuitemradio"], [role="menuitem"], [role="radio"], button, [role="button"]'
      );
      if (hit && isBasemapLayerPicker(hit) && basemapLabelIsSat(basemapControlLabel(hit))) {
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
        flashSatelliteGateNotice();
        return;
      }
    }
    const toggle = basemapToggleAtPoint(ev.clientX, ev.clientY);
    if (!toggle) return;
    if (!basemapToggleWouldEnableSatellite(basemapToggleSignature(toggle))) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    flashSatelliteGateNotice();
  }

  function hybridStillOnSatelliteBasemap() {
    if (satellitePhotoBasemap()) return true;
    if (/!3m\d+!1e3|%213m\d+%211e3/i.test(location.href)) return true;
    if (hybridAlign() && hybridNeedsNativeLayers() && nativeMapShowsSatelliteImagery()) return true;
    return false;
  }

  function rewindHybridToVectorMap() {
    if (!hybridStillOnSatelliteBasemap()) return false;
    requestPageWorldMapSwitch();
    if (clickBasemapViaLayersMenu(true) && !hybridStillOnSatelliteBasemap()) return true;
    const chip = mapBasemapChip(true);
    if (chip) {
      clickNativeBasemapToggle(chip);
      if (!hybridStillOnSatelliteBasemap()) return true;
    }
    const toggle = nativeBasemapToggle();
    if (toggle) {
      const sig = basemapToggleSignature(toggle);
      if (basemapChipSwitchesToMap(sig)) {
        clickNativeBasemapToggle(toggle);
        if (!hybridStillOnSatelliteBasemap()) return true;
      }
    }
    tryStripSatelliteBasemapUrl();
    return false;
  }

  // Switch satellite → map when Hybrid must keep Google's native canvas (directions,
  // search, terrain, traffic, …). Never skip overlay teardown while retrying.
  function maybeHybridRewindToMap() {
    if (!inChina(parseMapState())) return;
    if (!hybridAlign() || !hybridNeedsNativeLayers()) {
      hybridRewindTries = 0;
      return;
    }
    if (!hybridStillOnSatelliteBasemap()) {
      hybridRewindTries = 0;
      return;
    }
    const cap = directionsPanelOpen()
      ? (nativeMapShowsSatelliteImagery() ? 160 : 48)
      : BASEMAP_SWITCH_MAX_TRIES;
    if (hybridRewindTries >= cap) return;
    rewindHybridToVectorMap();
    hybridRewindTries += 1;
  }

  function datumStatusLabel() {
    if (alignMode === "off") return "Off · native Google Maps";
    if (satGateNoticeUntil > Date.now()) {
      return "GCJ-02 → WGS-84 · satellite blocked while layers active";
    }
    if (hybridPlaceAlignedOverlay()) return "GCJ-02 → WGS-84 · place pin";
    if (hybridYieldsNativeCanvas()) return "GCJ-02 labels · native map layers";
    if (hybridNeedsNativeLayers()) return "GCJ-02 · native map layers";
    return "GCJ-02 streets → WGS-84 satellite";
  }

  function updateIdleStatus() {
    if (!statusEl) return;
    const st = parseMapState();
    if (effectiveMode(st) === "off") {
      statusEl.style.display = "none";
      return;
    }
    if (overlayIsVisible()) return;
    statusEl.textContent = `${datumStatusLabel()} · v${VERSION}`;
    statusEl.style.display = "";
  }

  function syncNativeLayersChrome() {
    if (!statusEl) {
      statusEl = document.createElement("div");
      statusEl.id = "gcj02-aligner-status";
      statusEl.style.zIndex = String(CHROME_Z);
      document.body.appendChild(statusEl);
    }
    statusEl.textContent = `${datumStatusLabel()} · v${VERSION}`;
    statusEl.style.display = "";
  }

  function isBasemapLayerPicker(el) {
    const menu = el.closest('[role="menu"], [role="listbox"], [role="radiogroup"]');
    if (!menu) return false;
    const blob = String(menu.textContent || "");
    const hasMap = /(map|地圖|地图|街道|road|預設|预设|default|roadmap)/i.test(blob);
    const hasSat = /(satellite|衛星|卫星)/i.test(blob);
    return hasMap && hasSat;
  }

  function basemapLabelIsSat(label) {
    const s = String(label || "");
    if (/satellite|衛星|卫星/i.test(s)) return true;
    return false;
  }

  // Chip/preview label for the basemap you switch TO (not the current mode).
  function basemapChipSwitchesToMap(sig) {
    const s = String(sig || "");
    if (/interactive map|互動式地圖|互动地图/i.test(s)) return true;
    return basemapLabelIsMap(s);
  }

  function basemapChipSwitchesToSat(sig) {
    const s = String(sig || "");
    if (/satellite|衛星|卫星/i.test(s)) return true;
    return false;
  }

  function minimapBasemapButton(el) {
    if (!el) return null;
    if (el.tagName === "BUTTON") return el;
    const root = el.closest("button[jsaction*='minimap']") || el.parentElement;
    if (root) {
      const btn = root.matches?.("button[jsaction*='minimap']")
        ? root
        : root.querySelector?.("button[jsaction*='minimap.main'], button[jsaction*='minimap']");
      if (btn) return btn;
    }
    return resolveBasemapButton(el) || el;
  }

  function basemapLabelIsMap(label) {
    const s = String(label || "");
    if (/satellite|衛星|卫星/i.test(s)) return false;
    if (/interactive map|互動式地圖|互动地图/i.test(s)) return true;
    return /(map|地圖|地图|街道|road|預設|预设|default|roadmap)/i.test(s);
  }

  function basemapLayersButton() {
    for (const el of document.querySelectorAll("button, [role='button']")) {
      if (el.closest("#gcj02-aligner-root")) continue;
      const aria = String(el.getAttribute("aria-label") || "").trim();
      if (/^(layers|map type|圖層|图层|地圖類型|地图类型)/i.test(aria)) return el;
      const labelled = el.getAttribute("aria-labelledby");
      if (labelled) {
        const labelEl = document.getElementById(labelled);
        const text = (labelEl?.textContent || "").trim();
        if (/^(layers|圖層|图层)$/i.test(text)) return el;
      }
      const text = String(el.textContent || "").replace(/\s+/g, " ").trim();
      if (/^(layers|圖層|图层)$/i.test(text)) return el;
    }
    return null;
  }

  function clickBasemapInOpenLayersMenu(wantMap) {
    for (const el of document.querySelectorAll(
      '[role="menuitemradio"], [role="menuitem"], [role="radio"], button, [role="button"], label'
    )) {
      if (el.closest("#gcj02-aligner-root")) continue;
      const label = String(
        el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || ""
      ).replace(/\s+/g, " ").trim();
      if (!label) continue;
      const inPicker = isBasemapLayerPicker(el);
      if (!inPicker && !/^(預設|预设|default|map|地圖|地图|街道|road ?map|roadmap)$/i.test(label)) continue;
      if (wantMap ? basemapLabelIsMap(label) : basemapLabelIsSat(label)) {
        clickNativeBasemapToggle(el);
        return true;
      }
    }
    return false;
  }

  // Place pages often hide the corner thumbnail; the Layers menu still works.
  function clickBasemapViaLayersMenu(wantMap) {
    if (clickBasemapInOpenLayersMenu(wantMap)) return true;
    const btn = basemapLayersButton();
    if (!btn) return false;
    clickNativeBasemapToggle(btn);
    return clickBasemapInOpenLayersMenu(wantMap);
  }

  // Place/search pages put the basemap chip in the bottom strip, not the corner.
  // Match the element under the pointer directly — nativeBasemapToggle() can
  // return a different widget than the one the user actually clicked.
  function basemapToggleAtPoint(x, y) {
    const found = overlayHost();
    if (!found) return null;
    const cr = found.canvas.getBoundingClientRect();
    if (y < cr.bottom - 180 || y > cr.bottom + 8) return null;
    const isToggle = globalThis.Gcj02Aligner.isBasemapToggleBox;
    for (const el of document.querySelectorAll("button, [role='button'], label")) {
      if (el.closest("#gcj02-aligner-root")) continue;
      const r = el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      if (r.width < 55 || r.width > 110 || r.height < 55 || r.height > 110) continue;
      if (!basemapToggleSignature(el)) continue;
      if (!isToggle(r, cr) && !/\/maps\/dir\//.test(location.pathname)) continue;
      return el.tagName === "BUTTON"
        ? el
        : el.closest("button, [role='button']")
        || el;
    }
    if (/\/maps\/(dir|place|search)\//.test(location.pathname)) {
      const onSatUrl = globalThis.Gcj02Aligner.mapDisplayType(
        globalThis.Gcj02Aligner.dataParam(location.href)
      ) === 3;
      const strip = bottomStripBasemapToggle(cr, onSatUrl);
      if (strip) {
        const r = strip.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return strip;
      }
    }
    return null;
  }

  function hybridOverlayActive() {
    const st = parseMapState();
    return hybridAlign() && effectiveMode(st) === "on" && !hybridYieldsNativeCanvas();
  }

  function effectiveMode(st) {
    if (alignMode === "off") return "off";
    return st && !outOfChina(st.lat, st.lon) ? "on" : "off";
  }

  function inChina(st) {
    return effectiveMode(st) === "on";
  }

  // Tear down overlay, gates, and latches when the map view leaves China.
  function standDownOutsideChina() {
    hybridRewindTries = 0;
    directionsLatchUntil = 0;
    lastDirectionsOpen = false;
    hideOverlay();
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

  function resolveBasemapButton(el) {
    return el.tagName === "BUTTON"
      ? el
      : el.closest("button, [role='button']")
      || el;
  }

  function mapBasemapChip(onSatUrl) {
    const found = overlayHost();
    if (!found) return null;
    const cr = found.canvas.getBoundingClientRect();
    const isToggle = globalThis.Gcj02Aligner.isBasemapToggleBox;
    for (const el of document.querySelectorAll(
      "button[jsaction*='minimap'], [aria-label], [title], button, [role='button'], label"
    )) {
      if (el.closest("#gcj02-aligner-root")) continue;
      const sig = basemapToggleSignature(el)
        || String(el.getAttribute("title") || "").trim();
      if (!sig) continue;
      if (onSatUrl ? !basemapChipSwitchesToMap(sig) : !basemapChipSwitchesToSat(sig)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 12) continue;
      const inBottomStrip = r.bottom >= cr.bottom - 220 && r.bottom <= cr.bottom + 40;
      const inCorner = isToggle ? isToggle(r, cr) : false;
      if (!inBottomStrip && !inCorner) continue;
      return minimapBasemapButton(el);
    }
    return null;
  }

  function bottomStripBasemapToggle(cr, onSatUrl) {
    const chip = mapBasemapChip(onSatUrl);
    if (chip) return chip;
    const candidates = [];
    for (const el of document.querySelectorAll(
      "button, [role='button'], label, [aria-label]"
    )) {
      if (el.closest("#gcj02-aligner-root")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 55 || r.width > 110 || r.height < 55 || r.height > 110) continue;
      if (r.bottom > cr.bottom + 8 || r.bottom < cr.bottom - 180) continue;
      const sig = basemapToggleSignature(el);
      if (!sig) continue;
      if (
        !basemapLabelIsSat(sig)
        && !basemapLabelIsMap(sig)
        && !basemapChipSwitchesToMap(sig)
        && !basemapChipSwitchesToSat(sig)
      ) continue;
      candidates.push(el);
    }
    // Place/search: one chip toggles map↔satellite; zh-TW keeps aria "互動式地圖"
    // in both directions so label matching alone cannot find the control on `!1e3`.
    if (
      /\/maps\/(place|search)\//.test(location.pathname)
      && candidates.length === 1
    ) {
      const sig = basemapToggleSignature(candidates[0]);
      if (onSatUrl ? basemapChipSwitchesToMap(sig) : basemapChipSwitchesToSat(sig)) {
        return resolveBasemapButton(candidates[0]);
      }
    }
    for (const el of candidates) {
      const sig = basemapToggleSignature(el);
      if (onSatUrl ? basemapChipSwitchesToMap(sig) : basemapChipSwitchesToSat(sig)) {
        return resolveBasemapButton(el);
      }
    }
    return null;
  }

  function nativeBasemapToggle() {
    const found = overlayHost();
    if (!found) return null;
    const cr = found.canvas.getBoundingClientRect();
    const onSatUrl = hybridStillOnSatelliteBasemap();
    const chip = mapBasemapChip(onSatUrl);
    if (chip) return chip;
    // Place/search/directions UIs park the basemap chip in the bottom strip, not
    // the corner thumbnail.
    if (/\/maps\/(place|search|dir)\//.test(location.pathname)) {
      const strip = bottomStripBasemapToggle(cr, onSatUrl);
      if (strip) return strip;
    }
    const isToggle = globalThis.Gcj02Aligner.isBasemapToggleBox;
    const hits = [];
    document.querySelectorAll("button, [role='button'], label").forEach((el) => {
      if (el.closest("#gcj02-aligner-root")) return;
      if (!isToggle(el.getBoundingClientRect(), cr)) return;
      // The toggle square carries an aria-label (localized) on itself or on a
      // sibling that renders the other basemap's thumbnail.
      if (!basemapToggleSignature(el)) return;
      hits.push(el);
    });
    // Hovering expands the widget, which puts a <label> over the button and
    // earlier in document order — and a synthetic click on that label does
    // nothing. The button is the element Maps binds the switch to.
    const corner = hits.find((el) => el.tagName === "BUTTON")
      || hits.find((el) => el.getAttribute("role") === "button")
      || hits[0];
    if (corner) return corner;
    return bottomStripBasemapToggle(cr, onSatUrl);
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
    const target = minimapBasemapButton(el) || el;
    const r = target.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const base = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: window.screenX + x,
      screenY: window.screenY + y,
      button: 0
    };
    const ptr = (type, extra = {}) => {
      target.dispatchEvent(new PointerEvent(type, {
        ...base,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        ...extra
      }));
    };
    const mouse = (type, extra = {}) => {
      target.dispatchEvent(new MouseEvent(type, { ...base, ...extra }));
    };
    ["pointerover", "mouseover", "mouseenter", "pointerenter", "mousemove"].forEach((t) => {
      ptr(t);
      mouse(t);
    });
    ptr("pointerdown", { buttons: 1 });
    mouse("mousedown", { buttons: 1 });
    ptr("pointerup", { buttons: 0 });
    mouse("mouseup", { buttons: 0 });
    mouse("click", { buttons: 0 });
    if (typeof target.click === "function") target.click();
  }

  function tryStripSatelliteBasemapUrl() {
    const href = location.href;
    if (!/!3m\d+!1e3|%213m\d+%211e3/i.test(href)) return false;
    let next = href
      .replace(/!3m(\d+)!1e3/g, "!3m$1!1e0")
      .replace(/%213m(\d+)%211e3/gi, (_m, n) => `%213m${n}%211e0`);
    next = next.replace(/([?&/])data=([^?&#]*)/, (m, pre, data) => {
      const raw = data.includes("%") ? decodeURIComponent(data) : data;
      if (!/!3m\d+!1e3/.test(raw)) return m;
      const stripped = raw.replace(/!3m(\d+)!1e3/g, "!3m$1!1e0");
      if (!stripped) return pre.slice(0, -1);
      return `${pre}data=${data.includes("%") ? encodeURIComponent(stripped) : stripped}`;
    });
    next = next.replace(/([?&/])data=(?=[?&#]|$)/, "$1").replace(/\?&/, "?");
    if (next === href) return false;
    history.replaceState(history.state, "", next);
    lastHref = "";
    lastKey = "";
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

  function alignStatusHow(spec) {
    if (hybridCrispSatellite()) return "GCJ-02 streets on WGS-84 satellite";
    if (placeAlignedPinActive()) {
      return satellitePhotoBasemap()
        ? "GCJ-02 place pin on WGS-84 satellite"
        : "GCJ-02 place pin on vector map";
    }
    if (hybridYieldsNativeCanvas()) return "GCJ-02 labels on native map";
    if (hybridNeedsNativeLayers()) return "GCJ-02 overlay on vector map";
    return "GCJ-02 labels on native map";
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
    const mark = document.createElement("div");
    mark.className = "gcj02-poi-mark";
    const ns = "http://www.w3.org/2000/svg";

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

    // Place / hover teardrop: baked Maps spotlight_pin_v4 (same art as Places).
    const pin = globalThis.Gcj02Aligner.nativeSpotlightPinSpec(2);
    const tear = document.createElement("div");
    tear.className = "gcj02-poi-teardrop";
    tear.setAttribute("aria-hidden", "true");
    tear.style.width = `${pin.width}px`;
    tear.style.height = `${pin.height}px`;
    const img = document.createElement("img");
    img.className = "gcj02-poi-teardrop-img";
    img.src = chrome.runtime.getURL(pin.path);
    img.alt = "";
    img.draggable = false;
    img.width = pin.width;
    img.height = pin.height;
    tear.appendChild(img);
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

  function primaryPlacePoi() {
    const coords = globalThis.Gcj02Aligner.parsePlaceCoords(location.href);
    if (!coords) return [];
    const key = poiCoordKey(coords.lat, coords.lon);
    const fromDoc = collectPoisFromDocument().find(
      (p) => poiCoordKey(p.lat, p.lon) === key
    );
    if (fromDoc) return [fromDoc];
    const rawPath = globalThis.Gcj02Aligner.placeNameFromHref(location.href) || "";
    const name = globalThis.Gcj02Aligner.shortPlaceTitleFromPath(rawPath)
      || globalThis.Gcj02Aligner.cleanPoiName(rawPath)
      || globalThis.Gcj02Aligner.cleanPoiName((document.querySelector("h1")?.textContent || "").trim())
      || "Place";
    return [{ lat: coords.lat, lon: coords.lon, name, kind: "place", description: "" }];
  }

  function paintPoiMarkers(st, w, h, pois, placePin) {
    const poiKey = [
      w, h, st.zoom.toFixed(3), st.lat.toFixed(5), st.lon.toFixed(5),
      placePin ? "place-pin" : "pois",
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
      if (placePin) el.classList.add("is-place-pin");
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
      el.style.transform = "translate(-50%, -100%)";
      if (hoveredPoiKey && el.dataset.key === hoveredPoiKey) el.classList.add("is-hover");
      appendPoiGlyph(el, poi.kind, poi.name, poi.description);
      panEl.appendChild(el);
    });
    root.dataset.poiCount = String(pois.length);
    root.dataset.poiKinds = pois.map((p) => p.kind).join(",");
  }

  // Placement lives in overlayPoiScreenPx, which does its own GCJ→WGS camera
  // step (unless the place path is an explicit WGS lat/lon query).
  function syncPois(st, w, h) {
    if (!root || !panEl) return;
    if (hybridYieldsNativeCanvas() || !placeAlignedPinActive()) {
      panEl.querySelectorAll(".gcj02-poi").forEach((e) => e.remove());
      lastPoiKey = "";
      return;
    }
    paintPoiMarkers(st, w, h, primaryPlacePoi(), true);
  }

  function syncPoisIfVisible() {
    if (!alive || !root || root.style.display === "none") return;
    if (!hybridOverlayActive()) return;
    const st = parseMapState();
    if (!st) return;
    const w = Math.max(root.clientWidth || root.getBoundingClientRect().width, 1);
    const h = Math.max(root.clientHeight || root.getBoundingClientRect().height, 1);
    syncPois(st, w, h);
  }

  function hideOverlay() {
    panDrag = null;
    gestureHold = null;
    endZoomAnim(true);
    clearPanVisual();
    // Hidden must mean nothing painted — out of China or native-only views
    // must leave no tiles of ours in the DOM.
    if (panEl) {
      panEl.querySelectorAll(".gcj02-tile,.gcj02-road,.gcj02-shade,.gcj02-poi,.gcj02-route")
        .forEach((e) => e.remove());
      lastKey = "";
    }
    if (root) {
      root.style.display = "none";
      root.dataset.mode = "off";
      root.dataset.tileOk = "0";
      root.dataset.tileError = "0";
      root.dataset.poiCount = "0";
    }
    lastPoiKey = "";
    clearSatelliteBasemapGate();
    if (statusEl) statusEl.style.display = "none";
    if (lastHost) {
      try { lastHost.style.clipPath = ""; lastHost.style.maskImage = ""; lastHost.style.webkitMaskImage = ""; } catch (_e) {}
    }
    setNativeMapHidden(false);
    updateIdleStatus();
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
    const st = parseMapState();
    if (!inChina(st)) {
      standDownOutsideChina();
      return;
    }
    if (hybridAlign() && hybridNeedsNativeLayers()) {
      maybeHybridRewindToMap();
      setNativeMapHidden(false);
      hideOverlay();
      syncSatelliteBasemapGate();
      syncNativeLayersChrome();
      return;
    }
    const spec = overlaySpec();
    const active = effectiveMode(st);
    if (spec.nativeOnly || active === "off" || !st || st.zoom < 5 || st.zoom > 21) {
      if (hybridYieldsNativeCanvas()) setNativeMapHidden(false);
      hideOverlay();
      return;
    }

    if (!ensureRoot()) return;
    if (root.style.display === "none") root.style.display = "";
    const box = root.getBoundingClientRect();
    const w = root.clientWidth || box.width;
    const h = root.clientHeight || box.height;
    if (!(w >= 32) || !(h >= 32)) return;

    setNativeMapHidden(true);
    root.dataset.hybridLayer = placeAlignedPinActive()
      ? (satellitePhotoBasemap() ? "place-satellite" : "place-map")
      : hybridNeedsNativeLayers()
        ? "map"
        : "photo";
    root.dataset.satGate = satelliteBasemapGateActive() ? "1" : "0";
    syncSatelliteBasemapGate();
    root.style.display = "";
    if (statusEl) statusEl.style.display = "";

    const zTile = Math.min(21, Math.max(0, Math.round(st.zoom)));
    const scale = 2 ** (st.zoom - zTile);
    const tileSize = TILE * scale;
    const cam = globalThis.Gcj02Aligner.overlayCamera(st.lat, st.lon, urlCoordOpts());
    const center = worldPixel(cam.lat, cam.lon, st.zoom);
    const tl = { x: center.x - w / 2, y: center.y - h / 2 };
    const pad = Math.max(4, Math.ceil(Math.max(w, h) / tileSize) + 1);
    const x0 = Math.floor(tl.x / tileSize) - pad;
    const y0 = Math.floor(tl.y / tileSize) - pad;
    const x1 = Math.floor((tl.x + w) / tileSize) + pad;
    const y1 = Math.floor((tl.y + h) / tileSize) + pad;
    const max = 2 ** zTile;
    const key = [
      active, spec.label, spec.roadLyrs, spec.baseLyrs.join("+"), (spec.shadeLyrs || []).join("+"),
      spec.extraLyrs.join("+"), urlCoordOpts()?.wgs84 ? "wgs" : "gcj",
      "overlay",
      zTile, scale.toFixed(4), x0, y0, x1, y1, Math.round(center.x), Math.round(center.y),
      Math.round(w), Math.round(h)
    ].join(",");
    const sample = globalThis.Gcj02Aligner.overlayShiftPx(cam.lat, cam.lon, st.zoom);
    const offsetPx = sample.hypot;
    const extras = spec.extraLyrs.length ? `+${spec.extraLyrs.join("+")}` : "";
    const how = alignStatusHow(spec);
    const statusSig = `${spec.label}${extras}:${how}:${st.zoom.toFixed(2)}`;
    if (statusSig !== lastStatusSig) {
      lastStatusSig = statusSig;
      setStatus(`Aligning · ${spec.label}${extras} · ${how} · v${VERSION} · z=${st.zoom.toFixed(2)}`, {
        mode: "on",
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
    }
    if (key !== lastKey) {
      lastKey = key;
      lastPoiKey = "";
      clearPanVisual();
      if (panEl) panEl.querySelectorAll(".gcj02-tile,.gcj02-road,.gcj02-shade").forEach((e) => e.remove());
      else root.querySelectorAll(".gcj02-tile,.gcj02-road,.gcj02-shade").forEach((e) => e.remove());

      const shift = (rdx, rdy) => `translate3d(${rdx}px,${rdy}px,0)`;
      const hasBase = spec.baseLyrs.length > 0;
      const roadShift = shift(sample.dx, sample.dy);

      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const wx = ((tx % max) + max) % max;
          if (ty < 0 || ty >= max) continue;

          const ll = tileCenterLatLon(wx, ty, zTile);
          const pW = worldPixel(ll.lat, ll.lon, st.zoom);
          const left = pW.x - center.x + w / 2 - tileSize / 2;
          const top = pW.y - center.y + h / 2 - tileSize / 2;

          for (const lyrs of spec.baseLyrs) {
            placeTile("gcj02-tile", lyrs, left, top, tileSize, "", wx, ty, zTile);
          }
          if (spec.roadLyrs) {
            placeTile(
              hasBase ? "gcj02-road" : "gcj02-tile",
              spec.roadLyrs, left, top, tileSize, roadShift, wx, ty, zTile
            );
          }
          for (const lyrs of spec.shadeLyrs || []) {
            placeTile("gcj02-shade", lyrs, left, top, tileSize, "", wx, ty, zTile);
          }
          if (spec.topLyrs) {
            placeTile(
              "gcj02-road",
              spec.topLyrs, left, top, tileSize, roadShift, wx, ty, zTile
            );
          }
          for (const lyrs of spec.extraLyrs) {
            placeTile("gcj02-road", lyrs, left, top, tileSize, roadShift, wx, ty, zTile);
          }
        }
      }
    }
    syncPois(st, w, h);
  }

  function setMode(v) {
    if (!alive) return;
    const next = normalizeMode(v);
    if (next === alignMode) {
      publishAlignMode();
      return;
    }
    alignMode = next;
    publishAlignMode();
    setNativeMapHidden(false);
    setHoveredPoi("");
    if (panEl) {
      panEl.querySelectorAll(".gcj02-tile,.gcj02-road,.gcj02-shade,.gcj02-poi,.gcj02-route")
        .forEach((e) => e.remove());
    }
    lastKey = "";
    lastPoiKey = "";
    hybridRewindTries = 0;
    redraw();
  }

  function applyStoredAlignMode(v) {
    alignModeLoaded = true;
    if (normalizeMode(v) === alignMode) {
      publishAlignMode();
      lastKey = "";
      redraw();
      return;
    }
    setMode(v);
  }

  function readStoredAlignMode(cb) {
    const readId = ++alignModeReadId;
    const finish = (v) => {
      if (readId !== alignModeReadId) return;
      try { cb(v); } catch (_e) {}
    };
    try {
      chrome.storage.local.get({ [ALIGN_MODE_KEY]: DEFAULT_ALIGN_MODE }, (got) => {
        try { void chrome.runtime.lastError; } catch (_e) {}
        finish(got?.[ALIGN_MODE_KEY] ?? DEFAULT_ALIGN_MODE);
      });
    } catch (_e) {
      finish(DEFAULT_ALIGN_MODE);
    }
  }

  function loadAlignMode() {
    try {
      readStoredAlignMode((v) => {
        if (alignModeLoaded) return;
        applyStoredAlignMode(v);
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes[ALIGN_MODE_KEY]) return;
        alignModeReadId += 1;
        applyStoredAlignMode(changes[ALIGN_MODE_KEY].newValue);
      });
    } catch (_e) {
      applyStoredAlignMode(alignMode);
    }
  }

  addEventListener("message", (ev) => {
    if (!alive || ev.source !== window) return;
    if (ev.data?.source !== "gcj02-aligner") return;
    if (ev.data?.type === "setMode") setMode(ev.data.mode);
    if (ev.data?.type === "getBasemapToggleBox") {
      const toggle = nativeBasemapToggle();
      const box = toggle
        ? (() => {
          const r = toggle.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()
        : null;
      window.postMessage({ source: "gcj02-aligner", type: "basemapToggleBox", box }, location.origin);
    }
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
  // Smooth zoom preview for wheel and the corner +/- controls.
  document.addEventListener("wheel", onMapWheel, { capture: true, passive: true });
  document.addEventListener("pointerdown", onZoomButtonDown, true);
  document.addEventListener("pointerdown", onSatelliteBasemapGatePointer, true);
  document.addEventListener("click", onSatelliteBasemapGatePointer, true);
  document.addEventListener("pointerdown", onDirectionsActivatorPointer, true);
  document.addEventListener("click", onDirectionsActivatorPointer, true);
  addEventListener("blur", () => {
    endPanDrag(null);
    endZoomAnim(false);
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
    const st = parseMapState();
    if (!inChina(st)) {
      if (root && root.style.display !== "none") standDownOutsideChina();
      return;
    }
    if (noteDirectionsStateChange()) {
      lastKey = "";
      redraw();
      return;
    }
    if (location.href !== lastHref) {
      lastHref = location.href;
      lastKey = "";
      redraw();
      return;
    }
    if (hybridAlign() && directionsPanelOpen()) {
      if (hybridStillOnSatelliteBasemap()) maybeHybridRewindToMap();
      if (root && root.style.display !== "none") {
        lastKey = "";
        redraw();
        return;
      }
    }
    const spec = overlaySpec();
    if (spec.nativeOnly) {
      if (hybridAlign() && hybridNeedsNativeLayers() && hybridStillOnSatelliteBasemap()) {
        maybeHybridRewindToMap();
      }
      if (root && root.style.display !== "none") {
        lastKey = "";
        redraw();
      }
      return;
    }
    if (!root || root.style.display === "none" || !root.querySelector("img")) {
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
      if (hybridOverlayActive()) setNativeMapHidden(true);
      if (!lastKey) redraw();
      else syncPoisIfVisible();
    }
  }, 400);

  publishAlignMode();
  loadAlignMode();
  // If storage never answers (no permission, disabled profile), still draw.
  setTimeout(() => {
    if (!alignModeLoaded) applyStoredAlignMode(alignMode);
  }, 300);
})();
