(() => {
  "use strict";

  let VERSION = "0.6.16";
  try {
    VERSION = chrome.runtime.getManifest().version;
  } catch (_e) {}
  const TILE = globalThis.Gcj02Aligner?.TILE ?? 256;
  const OVERLAY_Z = globalThis.Gcj02Aligner?.OVERLAY_Z ?? 0;
  const CHROME_Z = globalThis.Gcj02Aligner?.CHROME_Z ?? 1000010;

  let mode = "on";
  let root = null;
  let statusEl = null;
  let timer = null;
  let pollTimer = null;
  let lastKey = "";
  let lastHref = "";
  let lastPoiKey = "";
  let lastHost = null;
  let alive = true;
  const obs = new MutationObserver(() => {
    if (!alive) return;
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

  function teardown() {
    if (!alive) return;
    alive = false;
    try { obs.disconnect(); } catch (_e) {}
    clearTimeout(timer);
    clearInterval(pollTimer);
    try { root?.remove(); } catch (_e) {}
    try { lastHost && (lastHost.style.clipPath = ""); lastHost.style.maskImage = ""; lastHost.style.webkitMaskImage = ""; } catch (_e) {}
    lastHost = null;
    setNativeMapHidden(false);
    root = null;
    statusEl = null;
  }

  function storageGet(defaults, cb) {
    if (!alive) return;
    try {
      chrome.storage.local.get(defaults, (stored) => {
        try {
          if (!alive) return;
          if (chrome.runtime.lastError) return;
          cb(stored);
        } catch (_e) {
          teardown();
        }
      });
    } catch (_e) {
      teardown();
    }
  }

  function storageSet(obj) {
    if (!alive) return;
    try {
      chrome.storage.local.set(obj, () => {
        try {
          void chrome.runtime.lastError;
        } catch (_e) {
          teardown();
        }
      });
    } catch (_e) {
      teardown();
    }
  }

  function outOfChina(lat, lon) {
    return globalThis.Gcj02Aligner.outOfChina(lat, lon);
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
    const img = document.createElement("img");
    img.className = className;
    img.draggable = false;
    img.alt = "loading";
    img.dataset.ok = "";
    img.dataset.lyrs = String(lyrs || "");
    img.dataset.x = String(wx);
    img.dataset.y = String(ty);
    img.dataset.z = String(zTile);
    img.style.width = `${tileSize}px`;
    img.style.height = `${tileSize}px`;
    img.style.left = `${left}px`;
    img.style.top = `${top}px`;
    if (transform) img.style.transform = transform;
    root.appendChild(img);
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

  function collectPoisFromDocument() {
    const anchors = [...document.querySelectorAll('a[href*="/maps/place/"]')].map((a) => {
      const label = a.getAttribute("aria-label") || a.textContent || "";
      return {
        href: a.href || a.getAttribute("href") || "",
        label,
        category: categoryBlobForPlace(label.trim().split(" · ")[0], a)
      };
    });
    if (/\/maps\/place\//.test(location.href)) {
      const heading = (document.querySelector("h1")?.textContent || "").trim();
      const fromPath = decodeURIComponent(location.pathname).split("/").filter(Boolean).pop() || "";
      const label = heading || fromPath.replace(/\+/g, " ");
      const category = (document.body.innerText || "").slice(0, 400);
      anchors.unshift({ href: location.href, label, category });
    }
    return globalThis.Gcj02Aligner.collectPoisFromAnchors(anchors);
  }

  function appendPoiGlyph(el, kind, name) {
    const spec = globalThis.Gcj02Aligner.poiMarkerSpec(kind);
    const mark = document.createElement("div");
    mark.className = "gcj02-poi-mark";
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "gcj02-poi-icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "26");
    svg.setAttribute("height", "26");
    svg.setAttribute("aria-hidden", "true");
    const bg = document.createElementNS(ns, "circle");
    bg.setAttribute("cx", "12");
    bg.setAttribute("cy", "12");
    bg.setAttribute("r", "12");
    bg.setAttribute("fill", spec.fill);
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", spec.path);
    path.setAttribute("fill", "#fff");
    svg.appendChild(bg);
    svg.appendChild(path);
    mark.appendChild(svg);
    el.appendChild(mark);
    const labelText = String(name || "").trim();
    if (labelText) {
      const label = document.createElement("span");
      label.className = "gcj02-poi-label";
      label.textContent = labelText;
      el.appendChild(label);
    }
  }

  function syncPois(st, w, h, center) {
    if (!root) return;
    const pois = collectPoisFromDocument();
    const poiKey = [
      w, h, st.zoom.toFixed(3), st.lat.toFixed(5), st.lon.toFixed(5),
      pois.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)},${p.kind},${p.name}`).join("|")
    ].join(";");
    if (poiKey === lastPoiKey) return;
    lastPoiKey = poiKey;
    root.querySelectorAll(".gcj02-poi").forEach((e) => e.remove());
    pois.forEach((poi) => {
      const screen = globalThis.Gcj02Aligner.overlayPoiScreenPx(
        poi.lat, poi.lon, st.lat, st.lon, st.zoom, w, h
      );
      const el = document.createElement("div");
      el.className = "gcj02-poi";
      el.dataset.wgsLat = String(screen.lat);
      el.dataset.wgsLon = String(screen.lon);
      el.dataset.kind = poi.kind || "place";
      el.setAttribute("aria-label", poi.name || poi.kind);
      el.style.left = `${screen.x}px`;
      el.style.top = `${screen.y}px`;
      el.style.transform = "translate(-13px, -100%)";
      appendPoiGlyph(el, poi.kind, poi.name);
      root.appendChild(el);
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
    syncPois(st, w, h, worldPixel(st.lat, st.lon, st.zoom));
  }

  function hideOverlay() {
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
  }

  function redraw() {
    if (!alive) return;
    const spec = overlaySpec();
    const st = parseMapState();
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
    const center = worldPixel(st.lat, st.lon, st.zoom);
    const tl = { x: center.x - w / 2, y: center.y - h / 2 };
    const pad = 3;
    const x0 = Math.floor(tl.x / tileSize) - pad;
    const y0 = Math.floor(tl.y / tileSize) - pad;
    const x1 = Math.floor((tl.x + w) / tileSize) + pad;
    const y1 = Math.floor((tl.y + h) / tileSize) + pad;
    const max = 2 ** zTile;
    const key = [
      active, spec.label, spec.roadLyrs, spec.baseLyrs.join("+"), spec.extraLyrs.join("+"),
      zTile, scale.toFixed(4), x0, y0, x1, y1, Math.round(center.x), Math.round(center.y),
      Math.round(w), Math.round(h)
    ].join(",");
    if (key !== lastKey) {
      lastKey = key;
      lastPoiKey = "";
      root.querySelectorAll(".gcj02-tile,.gcj02-road").forEach((e) => e.remove());

      const sample = globalThis.Gcj02Aligner.overlayShiftPx(st.lat, st.lon, st.zoom);
      const offsetPx = sample.hypot;
      const extras = spec.extraLyrs.length ? `+${spec.extraLyrs.join("+")}` : "";
      setStatus(`On · ${spec.label}${extras} · streets shifted GCJ→WGS · v${VERSION} · z=${st.zoom.toFixed(2)}`, {
        mode: "on",
        layer: spec.label,
        version: VERSION,
        zoom: st.zoom.toFixed(3),
        zTile: String(zTile),
        offsetPx: offsetPx.toFixed(2),
        shiftDx: sample.dx.toFixed(2),
        shiftDy: sample.dy.toFixed(2),
        lat: st.lat.toFixed(6),
        lon: st.lon.toFixed(6)
      });

      const shift = (rdx, rdy) => `translate3d(${rdx}px,${rdy}px,0)`;
      const hasBase = spec.baseLyrs.length > 0;

      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const wx = ((tx % max) + max) % max;
          if (ty < 0 || ty >= max) continue;

          const ll = tileCenterLatLon(wx, ty, zTile);
          const pW = worldPixel(ll.lat, ll.lon, st.zoom);
          const s = globalThis.Gcj02Aligner.overlayShiftPx(ll.lat, ll.lon, st.zoom);
          const left = pW.x - center.x + w / 2 - tileSize / 2;
          const top = pW.y - center.y + h / 2 - tileSize / 2;

          // Satellite `s` stays on WGS. Streets (`h`/`m`/`p`) use the same WGS
          // tile index then CSS-shift GCJ drawing onto that satellite.
          for (const lyrs of spec.baseLyrs) {
            placeTile("gcj02-tile", lyrs, left, top, tileSize, "", wx, ty, zTile);
          }
          if (spec.roadLyrs) {
            placeTile(
              hasBase ? "gcj02-road" : "gcj02-tile",
              spec.roadLyrs, left, top, tileSize, shift(s.dx, s.dy), wx, ty, zTile
            );
          }
          for (const lyrs of spec.extraLyrs) {
            placeTile("gcj02-road", lyrs, left, top, tileSize, shift(s.dx, s.dy), wx, ty, zTile);
          }
        }
      }
    }
    syncPois(st, w, h, center);
  }

  function setMode(v) {
    if (!alive) return;
    mode = normalizeMode(v);
    lastKey = "";
    lastPoiKey = "";
    storageSet({ mode });
    redraw();
  }

  try {
    chrome.runtime.onMessage.addListener((m) => {
      if (!alive) return;
      try {
        if (m?.type === "setMode") setMode(m.mode);
      } catch (_e) {
        teardown();
      }
    });
  } catch (_e) {
    teardown();
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (!alive || area !== "local" || !changes.mode) return;
      const next = normalizeMode(changes.mode.newValue);
      if (next === mode) return;
      mode = next;
      lastKey = "";
      lastPoiKey = "";
      redraw();
    });
  } catch (_e) {}

  addEventListener("message", (ev) => {
    if (!alive || ev.source !== window) return;
    if (ev.data?.source !== "gcj02-aligner" || ev.data?.type !== "setMode") return;
    setMode(ev.data.mode);
  });

  obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true });

  addEventListener("resize", () => {
    if (!alive) return;
    lastKey = "";
    redraw();
  });
  addEventListener("popstate", () => {
    if (!alive) return;
    lastKey = "";
    setTimeout(redraw, 200);
  });
  ["pushState", "replaceState"].forEach((name) => {
    const orig = history[name];
    history[name] = function historyHook() {
      const ret = orig.apply(this, arguments);
      if (alive) {
        lastKey = "";
        lastHref = "";
        setTimeout(redraw, 80);
      }
      return ret;
    };
  });
  pollTimer = setInterval(() => {
    if (!alive) return;
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

  storageGet({ mode: "on" }, (stored) => {
    mode = normalizeMode(stored.mode);
    redraw();
  });
})();
