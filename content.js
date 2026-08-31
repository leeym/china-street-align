(() => {
  "use strict";

  let VERSION = "0.6.38";
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

  // Always on for users. postMessage setMode is only for automated tests.
  let mode = "on";
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
  // While the user drags, Maps updates the camera only on release (URL `@`).
  // Native canvas is hidden, so translate the overlay with the pointer so tiles
  // follow the cursor the way Off does outside China.
  let panDrag = null;
  // Smooth zoom: scale the pan layer during wheel / +/- ; redraw when settled.
  let zoomAnim = null;
  let zoomRaf = 0;
  const obs = new MutationObserver(() => {
    if (!alive || gestureBusy()) return;
    if (location.href === lastHref) {
      syncPoisIfVisible();
      return;
    }
    lastHref = location.href;
    lastKey = "";
    lastPoiKey = "";
    clearTimeout(timer);
    timer = setTimeout(redraw, 120);
  });

  function gestureBusy() {
    return !!(panDrag || zoomAnim);
  }

  function clearPanVisual() {
    if (!panEl) return;
    panEl.style.transition = "";
    panEl.style.transform = "";
    panEl.style.transformOrigin = "";
  }

  function teardown() {
    if (!alive) return;
    alive = false;
    try { obs.disconnect(); } catch (_e) {}
    clearTimeout(timer);
    clearInterval(pollTimer);
    endZoomAnim(true);
    panDrag = null;
    try { root?.remove(); } catch (_e) {}
    try { lastHost && (lastHost.style.clipPath = ""); lastHost.style.maskImage = ""; lastHost.style.webkitMaskImage = ""; } catch (_e) {}
    lastHost = null;
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
    return globalThis.Gcj02Aligner.overlaySpec(location.href);
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
    const s = ((x + y) % 4 + 4) % 4;
    return `https://mt${s}.google.com/vt/lyrs=${lyrs}&x=${x}&y=${y}&z=${z}`;
  }

  function normalizeMode(v) {
    return v === "off" ? "off" : "on";
  }

  function effectiveMode(st) {
    if (normalizeMode(mode) === "off") return "off";
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
    if (!host || host === document.body || host === document.documentElement) {
      if (lastHost && lastHost !== host) {
        try { lastHost.style.clipPath = ""; } catch (_e) {}
      }
      return;
    }
    if (lastHost && lastHost !== host) {
      try { lastHost.style.clipPath = ""; } catch (_e) {}
    }
    lastHost = host;
    const clip = globalThis.Gcj02Aligner?.chromeClipPath;
    const hr = host.getBoundingClientRect();
    const value = clip ? clip(hr.width, hr.height) : "";
    host.style.clipPath = value;
    host.style.webkitClipPath = value;
    host.style.maskImage = "";
    host.style.webkitMaskImage = "";
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

  // Placement lives in overlayPoiScreenPx, which does its own GCJ→WGS camera
  // step, so this takes the raw URL state and no precomputed center.
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
        poi.lat, poi.lon, st.lat, st.lon, st.zoom, w, h
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

  function syncPoisIfVisible() {
    if (!alive || !root || root.style.display === "none") return;
    const st = parseMapState();
    if (!st) return;
    const w = Math.max(root.clientWidth || root.getBoundingClientRect().width, 1);
    const h = Math.max(root.clientHeight || root.getBoundingClientRect().height, 1);
    syncPois(st, w, h);
  }

  function hideOverlay() {
    panDrag = null;
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
    zoomAnim = null;
    if (zoomRaf) {
      cancelAnimationFrame(zoomRaf);
      zoomRaf = 0;
    }
    clearPanVisual();
    if (silent || !alive) return;
    lastKey = "";
    lastHref = "";
    clearTimeout(timer);
    timer = setTimeout(redraw, 50);
  }

  function beginWheelZoom(clientX, clientY) {
    if (!overlayIsVisible() || !panEl || !root || panDrag) return;
    const st = parseMapState();
    if (!st) return;
    const box = root.getBoundingClientRect();
    if (!zoomAnim) {
      zoomAnim = {
        startZoom: st.zoom,
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
    if (t.closest("#gcj02-aligner-status, input, textarea, button, select, [role='slider']")) return;
    if (!pointInOverlay(ev.clientX, ev.clientY)) return;
    if (zoomAnim) endZoomAnim(true);
    panDrag = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY };
  }

  function onPanPointerMove(ev) {
    if (!panDrag || ev.pointerId !== panDrag.id || !panEl) return;
    const dx = ev.clientX - panDrag.x0;
    const dy = ev.clientY - panDrag.y0;
    // Translate the inner pan layer only — root stays put with overflow:hidden
    // so padded off-screen tiles slide into view instead of exposing a black gap.
    panEl.style.transition = "";
    panEl.style.transformOrigin = "";
    panEl.style.transform = `translate3d(${dx}px,${dy}px,0)`;
  }

  function endPanDrag(ev) {
    if (!panDrag) return;
    if (ev && ev.pointerId != null && ev.pointerId !== panDrag.id) return;
    panDrag = null;
    clearPanVisual();
    lastKey = "";
    lastHref = "";
    clearTimeout(timer);
    timer = setTimeout(redraw, 80);
  }

  function redraw() {
    if (!alive || gestureBusy()) return;
    const spec = overlaySpec();
    const st = parseMapState();
    reportActionStatus(st);
    const active = effectiveMode(st);
    if (spec.nativeOnly || active === "off" || !st || st.zoom < 5 || st.zoom > 21) {
      hideOverlay();
      return;
    }

    if (!ensureRoot()) return;
    setNativeMapHidden(true);
    root.style.display = "";
    if (statusEl) statusEl.style.display = "";

    const zTile = Math.min(21, Math.max(0, Math.round(st.zoom)));
    const scale = 2 ** (st.zoom - zTile);
    const tileSize = TILE * scale;
    const box = root.getBoundingClientRect();
    const w = root.clientWidth || box.width;
    const h = root.clientHeight || box.height;
    if (!(w >= 32) || !(h >= 32)) return;
    // URL `@` is GCJ-02 here; the overlay world is WGS-84. Center on the same
    // real place so toggling On never slides the view (see overlayCamera).
    const cam = globalThis.Gcj02Aligner.overlayCamera(st.lat, st.lon);
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
      active, spec.label, spec.roadLyrs, spec.baseLyrs.join("+"), (spec.shadeLyrs || []).join("+"),
      spec.extraLyrs.join("+"),
      zTile, scale.toFixed(4), x0, y0, x1, y1, Math.round(center.x), Math.round(center.y),
      Math.round(w), Math.round(h)
    ].join(",");
    if (key !== lastKey) {
      lastKey = key;
      lastPoiKey = "";
      if (panEl) panEl.querySelectorAll(".gcj02-tile,.gcj02-road,.gcj02-shade").forEach((e) => e.remove());
      else root.querySelectorAll(".gcj02-tile,.gcj02-road,.gcj02-shade").forEach((e) => e.remove());

      const sample = globalThis.Gcj02Aligner.overlayShiftPx(cam.lat, cam.lon, st.zoom);
      const offsetPx = sample.hypot;
      const extras = spec.extraLyrs.length ? `+${spec.extraLyrs.join("+")}` : "";
      setStatus(`Aligning · ${spec.label}${extras} · streets shifted GCJ→WGS · v${VERSION} · z=${st.zoom.toFixed(2)}`, {
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
    syncPois(st, w, h);
  }

  function setMode(v) {
    if (!alive) return;
    mode = normalizeMode(v);
    lastKey = "";
    lastPoiKey = "";
    if (mode === "off") setHoveredPoi("");
    redraw();
  }

  // Test-only: Playwright posts setMode to force native Maps for On-vs-Off checks.
  addEventListener("message", (ev) => {
    if (!alive || ev.source !== window) return;
    if (ev.data?.source !== "gcj02-aligner" || ev.data?.type !== "setMode") return;
    setMode(ev.data.mode);
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
      setNativeMapHidden(true);
      if (!lastKey) redraw();
      else syncPoisIfVisible();
    }
  }, 400);

  redraw();
})();
