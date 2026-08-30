(() => {
  "use strict";

  let VERSION = "0.6.0";
  try {
    VERSION = chrome.runtime.getManifest().version;
  } catch (_e) {}
  const TILE = globalThis.Gcj02Aligner?.TILE ?? 256;
  const A = 6378245.0;
  const EE = 0.00669342162296594323;
  const OVERLAY_Z = globalThis.Gcj02Aligner?.OVERLAY_Z ?? 0;
  const CHROME_Z = globalThis.Gcj02Aligner?.CHROME_Z ?? 1000010;

  let mode = "on";
  let root = null;
  let statusEl = null;
  let timer = null;
  let pollTimer = null;
  let lastKey = "";
  let lastHref = "";
  let lastHost = null;
  let alive = true;
  const obs = new MutationObserver(() => {
    if (!alive) return;
    if (location.href === lastHref) return;
    lastHref = location.href;
    lastKey = "";
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

  function overlaySpec() {
    return globalThis.Gcj02Aligner.overlaySpec(location.href);
  }

  function parseMapState() {
    return globalThis.Gcj02Aligner.parseMapHref(location.href);
  }

  function worldPixel(lat, lon, z) {
    const n = 2 ** z;
    const x = ((lon + 180) / 360) * n * TILE;
    const s = Math.sin((lat * Math.PI) / 180);
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * TILE;
    return { x, y };
  }

  function tileCenterLatLon(x, y, z) {
    const n = 2 ** z;
    const lon = (x / n) * 360 - 180;
    const yy = (y + 0.5) / n;
    const lat = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - 2 * yy)));
    return { lat, lon };
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
    const hideCanvas = globalThis.Gcj02Aligner?.shouldHideNativeCanvas
      || ((cssW, cssH, bufW, bufH) => cssW * cssH >= 200000 || bufW * bufH >= 200000);
    let best = null;
    let bestArea = 0;
    document.querySelectorAll("canvas").forEach((c) => {
      const r = c.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea && hideCanvas(r.width, r.height, c.width, c.height)) {
        bestArea = area;
        best = c;
      }
    });
    const host = best?.parentElement;
    if (host && host !== document.documentElement && host !== document.body) return { host, canvas: best };
    return null;
  }

  function clipHostForChrome(host) {
    if (!host) return;
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
      || ((cssW, cssH, bufW, bufH) => cssW * cssH >= 200000 || bufW * bufH >= 200000);
    const hideImg = globalThis.Gcj02Aligner?.shouldHideNativeImage
      || ((src, inOverlay) => !inOverlay && /\/vt\/|khms\d\.google\.com/i.test(src || ""));
    const host = root?.parentElement;
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
  }

  function ensureRoot() {
    const found = overlayHost();
    if (!found) return false;
    const { host } = found;
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
    img.style.width = `${tileSize}px`;
    img.style.height = `${tileSize}px`;
    img.style.left = `${left}px`;
    img.style.top = `${top}px`;
    if (transform) img.style.transform = transform;
    root.appendChild(img);
    bindTile(img, tileUrl(lyrs, wx, ty, zTile));
  }

  function hideOverlay() {
    if (root) {
      root.style.display = "none";
      root.dataset.mode = "off";
      root.dataset.tileOk = "0";
      root.dataset.tileError = "0";
    }
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
    const w = Math.max(root.clientWidth || innerWidth, 1);
    const h = Math.max(root.clientHeight || innerHeight, 1);
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
      zTile, scale.toFixed(4), x0, y0, x1, y1, Math.round(center.x), Math.round(center.y)
    ].join(",");
    if (key === lastKey) return;
    lastKey = key;

    root.querySelectorAll(".gcj02-tile,.gcj02-road").forEach((e) => e.remove());

    const sample = wgsToGcj(st.lat, st.lon);
    const samplePx = worldPixel(sample.lat, sample.lon, st.zoom);
    const offsetPx = Math.hypot(samplePx.x - center.x, samplePx.y - center.y);
    const extras = spec.extraLyrs.length ? `+${spec.extraLyrs.join("+")}` : "";
    setStatus(`On · ${spec.label}${extras} · streets shifted GCJ→WGS · v${VERSION} · z=${st.zoom.toFixed(2)}`, {
      mode: "on",
      layer: spec.label,
      version: VERSION,
      zoom: st.zoom.toFixed(3),
      zTile: String(zTile),
      offsetPx: offsetPx.toFixed(2),
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
        const gcj = wgsToGcj(ll.lat, ll.lon);
        const pG = worldPixel(gcj.lat, gcj.lon, st.zoom);
        const rdx = pW.x - pG.x;
        const rdy = pW.y - pG.y;
        const left = pW.x - center.x + w / 2 - tileSize / 2;
        const top = pW.y - center.y + h / 2 - tileSize / 2;

        for (const lyrs of spec.baseLyrs) {
          placeTile("gcj02-tile", lyrs, left, top, tileSize, "", wx, ty, zTile);
        }
        if (spec.roadLyrs) {
          placeTile(
            hasBase ? "gcj02-road" : "gcj02-tile",
            spec.roadLyrs, left, top, tileSize, shift(rdx, rdy), wx, ty, zTile
          );
        }
        for (const lyrs of spec.extraLyrs) {
          placeTile("gcj02-road", lyrs, left, top, tileSize, shift(rdx, rdy), wx, ty, zTile);
        }
      }
    }
  }

  function setMode(v) {
    if (!alive) return;
    mode = normalizeMode(v);
    lastKey = "";
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
      clipHostForChrome(root.parentElement);
      setNativeMapHidden(true);
    }
  }, 400);

  storageGet({ mode: "on" }, (stored) => {
    mode = normalizeMode(stored.mode);
    redraw();
  });
})();
