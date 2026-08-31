const { chromium } = require("@playwright/test");
const path = require("path");
require("../../aligner-lib.js");
const lib = globalThis.Gcj02Aligner;
const { parseVtSrc, tileVt } = require("./vt-src");

const EXT_PATH = path.resolve(__dirname, "..", "..");

async function launchExtensionContext() {
  const userDataDir = path.join(EXT_PATH, "test-results", `.pw-user-${Date.now()}`);
  return chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      "--disable-blink-features=AutomationControlled"
    ]
  });
}

async function dismissConsent(page) {
  const candidates = [
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Agree")',
    'button:has-text("Accept")',
    'button:has-text("同意")',
    'button:has-text("接受全部")'
  ];
  for (const sel of candidates) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 2500 }).catch(() => false)) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      break;
    }
  }
}

async function setAlignerMode(context, page, mode) {
  // Test-only hook: product builds are always-on (no popup / storage toggle).
  void context;
  await page.evaluate((m) => {
    window.postMessage({ source: "gcj02-aligner", type: "setMode", mode: m }, "*");
  }, mode).catch(() => {});
  await page.waitForTimeout(500);
}

async function waitForOverlay(page) {
  await page.waitForFunction(() => {
    const root = document.getElementById("gcj02-aligner-root");
    if (!root || root.style.display === "none") return false;
    const tiles = [...root.querySelectorAll(".gcj02-tile")];
    return tiles.length > 0 && tiles.some((img) => img.complete && img.naturalWidth >= 256);
  }, { timeout: 120000 });
}

async function waitForOverlayOff(page) {
  await page.waitForFunction(() => {
    const root = document.getElementById("gcj02-aligner-root");
    return !root || root.style.display === "none" || root.dataset.mode === "off";
  }, { timeout: 30000 });
}

async function waitForNativePois(page, needles) {
  const list = Array.isArray(needles) ? needles : [needles];
  await page.waitForFunction((texts) => {
    const links = [...document.querySelectorAll('a[href*="/maps/place/"]')];
    const blob = links
      .map((a) => a.getAttribute("aria-label") || a.textContent || "")
      .join("\n");
    let href = location.href;
    try { href += " " + decodeURIComponent(location.href); } catch (_e) {}
    const extra = (document.body.innerText || "") + " " + (document.title || "");
    return texts.some((t) => blob.includes(t) || extra.includes(t) || href.includes(t));
  }, list, { timeout: 90000 });
}

async function overlayAlignmentStats(page) {
  return page.evaluate(() => {
    const root = document.getElementById("gcj02-aligner-root");
    const road = document.querySelector(".gcj02-road") || document.querySelector(".gcj02-tile");
    const t = road ? getComputedStyle(road).transform : "";
    const m = t.match(/matrix\(([^)]+)\)/);
    const p = m ? m[1].split(",").map((x) => Number(x.trim())) : [];
    const roadShift = p.length === 6 ? Math.hypot(p[4], p[5]) : 0;
    const hidden = [...document.querySelectorAll("canvas.gcj02-hide-native")];
    const pois = [...document.querySelectorAll(".gcj02-poi")].map((el) => el.getAttribute("aria-label") || "");
    return {
      href: location.href,
      mode: root?.dataset.mode || "",
      layer: root?.dataset.layer || "",
      display: root?.style.display || "",
      offsetPx: Number(root?.dataset.offsetPx || 0),
      shiftDx: Number(root?.dataset.shiftDx || 0),
      shiftDy: Number(root?.dataset.shiftDy || 0),
      poiCount: Number(root?.dataset.poiCount || 0),
      overlayPoiLabels: pois,
      status: document.getElementById("gcj02-aligner-status")?.textContent || "",
      tileCount: root ? root.querySelectorAll(".gcj02-tile").length : 0,
      roadShift,
      nativeHidden: hidden.length,
      nativeOpacity: hidden[0] ? getComputedStyle(hidden[0]).opacity : "",
      nativeVisibility: hidden[0] ? getComputedStyle(hidden[0]).visibility : ""
    };
  });
}

async function overlayPoiScreen(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll(".gcj02-poi")].map((el) => {
      const t = el.style.transform || "";
      const m = t.match(/translate3d\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px/);
      return {
        text: el.getAttribute("aria-label") || el.textContent || "",
        kind: el.dataset.kind || "",
        left: parseFloat(el.style.left) || 0,
        top: parseFloat(el.style.top) || 0,
        dx: m ? Number(m[1]) : 0,
        dy: m ? Number(m[2]) : 0,
        wgsLat: Number(el.dataset.wgsLat || 0),
        wgsLon: Number(el.dataset.wgsLon || 0)
      };
    });
  });
}

// Screenshot a map-only rectangle: right of the results panel, above the zoom
// cluster, so the crop holds street geometry and no Maps chrome.
const MAP_CROP = { x: 500, y: 100, width: 640, height: 380 };

// Hide the overlay's own markers/status for a screenshot so an image compare
// sees map content only, not decorations that exist in On and not in Off.
async function withOverlayDecorHidden(page, fn) {
  await page.addStyleTag({
    content: "#gcj02-aligner-root .gcj02-poi,#gcj02-aligner-status{visibility:hidden !important}"
  }).catch(() => {});
  try {
    return await fn();
  } finally {
    await page.evaluate(() => {
      [...document.querySelectorAll("style")]
        .filter((s) => /gcj02-poi\{|gcj02-aligner-status\{|\.gcj02-poi,/.test(s.textContent || ""))
        .forEach((s) => s.remove());
    }).catch(() => {});
  }
}

// href + overlay rect + the place anchors the overlay reads, in one round trip.
async function collectPlaceSnapshot(page) {
  return page.evaluate(() => {
    const root = document.getElementById("gcj02-aligner-root");
    const r = root ? root.getBoundingClientRect() : { width: 0, height: 0 };
    const anchors = [...document.querySelectorAll('a[href*="/maps/place/"]')].map((a) => {
      let category = "";
      let node = a;
      for (let i = 0; i < 10 && node; i++) {
        const t = (node.innerText || "").replace(/\s+/g, " ").trim();
        if (/旅遊景點|旅游景点|歷史|历史|Tourist|Historic|Museum|博物館|遺址/.test(t)) {
          category = t.slice(0, 240);
          break;
        }
        node = node.parentElement;
      }
      return { href: a.href || "", label: a.getAttribute("aria-label") || a.textContent || "", category };
    });
    if (/\/maps\/place\//.test(location.href)) {
      anchors.unshift({ href: location.href, label: document.querySelector("h1")?.textContent || "" });
    }
    return {
      href: location.href,
      width: root ? root.clientWidth || r.width : r.width,
      height: root ? root.clientHeight || r.height : r.height,
      camLat: Number(root?.dataset.camLat || 0),
      camLon: Number(root?.dataset.camLon || 0),
      anchors
    };
  });
}

async function hoverSearchResult(page, needle) {
  const spec = typeof needle === "string" ? { name: needle } : { ...(needle || {}) };
  const box = await page.evaluate((spec) => {
    const links = [...document.querySelectorAll('a[href*="/maps/place/"]')];
    const hit = links.find((a) => {
      const href = a.href || a.getAttribute("href") || "";
      const label = (a.getAttribute("aria-label") || a.textContent || "").trim();
      let pathName = "";
      try {
        pathName = decodeURIComponent((href.match(/\/maps\/place\/([^/@]+)/) || [])[1] || "");
      } catch (_e) {}
      if (spec.name) {
        const n = spec.name;
        if (label === n || pathName === n) return true;
        if (label.startsWith(`${n}:`) || label.startsWith(`${n}：`)) return true;
        // Path segment exact after decode; avoid 五丈原 matching 五丈原鎮.
        if (href.includes(`/place/${encodeURIComponent(n)}/` ) || href.includes(`/place/${encodeURIComponent(n)}?`)) return true;
      }
      if (spec.lat != null && spec.lon != null) {
        const m = href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
        if (m && Math.abs(+m[1] - spec.lat) < 1e-4 && Math.abs(+m[2] - spec.lon) < 1e-4) return true;
      }
      return false;
    });
    if (!hit) return null;
    const r = hit.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return null;
    return {
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      label: (hit.getAttribute("aria-label") || hit.textContent || "").trim().slice(0, 80),
      href: hit.href || ""
    };
  }, spec);
  if (!box) throw new Error(`search result not found: ${JSON.stringify(spec)}`);
  await page.mouse.move(box.x + Math.min(48, box.w / 2), box.y + Math.min(28, box.h / 2));
  await page.waitForTimeout(600);
  return box;
}

async function clearSearchHover(page) {
  await page.mouse.move(8, 8);
  await page.waitForTimeout(300);
}

async function ensureStreetLayer(page) {
  const sat = await page.evaluate(() => {
    const href = location.href;
    const layer = document.getElementById("gcj02-aligner-root")?.dataset.layer || "";
    return /!1e3/.test(href) || layer === "satellite";
  });
  if (!sat) return;
  const btn = page.getByRole("button", { name: /^Layers$/i }).first();
  if (await btn.isVisible({ timeout: 4000 }).catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(400);
    for (const name of ["Default", "Map", "Road map", "Roadmap"]) {
      const item = page.getByRole("button", { name }).or(page.getByText(name, { exact: true }));
      if (await item.first().isVisible({ timeout: 1200 }).catch(() => false)) {
        await item.first().click();
        break;
      }
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(1500);
  }
}

async function ensureSatelliteLayer(page) {
  const layer = () => page.evaluate(() => document.getElementById("gcj02-aligner-root")?.dataset.layer || "");
  if (await layer() === "satellite") return;
  const btn = page.locator('[aria-label="Layers"], [aria-label="Map type"]').first();
  if (await btn.isVisible({ timeout: 4000 }).catch(() => false)) {
    await btn.click();
    await page.getByText("Satellite", { exact: true }).click({ timeout: 4000 }).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(1500);
  }
}

async function collectNativeMapPins(page) {
  const scan = () => {
    const canvas = [...document.querySelectorAll("canvas")].sort(
      (a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height
        - a.getBoundingClientRect().width * a.getBoundingClientRect().height
    )[0];
    if (!canvas) return [];
    const cr = canvas.getBoundingClientRect();
    const seen = [];
    const nodes = document.querySelectorAll("div, span, button, a, img, label");
    for (const el of nodes) {
      if (el.closest("#gcj02-aligner-root") || el.closest("#gcj02-aligner-status")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 14 || r.width > 48 || r.height < 14 || r.height > 48) continue;
      if (r.x < Math.max(cr.left + 80, 420)) continue;
      if (r.left < cr.left || r.top < cr.top) continue;
      if (r.right > cr.right || r.bottom > cr.bottom) continue;
      const text = (el.textContent || "").replace(/\s+/g, "").trim();
      const label = (el.getAttribute("aria-label") || "").trim();
      if (!/^\d{1,2}$/.test(text) && !/^\d{1,2}$/.test(label)) continue;
      const x = r.x + r.width / 2 - cr.left;
      const y = r.bottom - cr.top;
      if (seen.some((p) => Math.hypot(p.x - x, p.y - y) < 12)) continue;
      seen.push({ text: text || label, x, y });
    }
    seen.sort((a, b) => a.x - b.x || a.y - b.y);
    return seen;
  };
  await page.waitForTimeout(1500);
  const fromDom = await page.evaluate(scan);
  if (fromDom.length) return fromDom;
  const snap = await page.evaluate(() => {
    const canvas = [...document.querySelectorAll("canvas")].sort(
      (a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height
        - a.getBoundingClientRect().width * a.getBoundingClientRect().height
    )[0];
    const cr = canvas
      ? canvas.getBoundingClientRect()
      : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const anchors = [...document.querySelectorAll('a[href*="/maps/place/"]')].map((a) => ({
      href: a.href || "",
      label: a.getAttribute("aria-label") || a.textContent || ""
    }));
    if (/\/maps\/place\//.test(location.href)) {
      anchors.unshift({ href: location.href, label: document.querySelector("h1")?.textContent || "" });
    }
    return {
      href: location.href,
      cr: { left: cr.left, top: cr.top, width: cr.width, height: cr.height },
      anchors
    };
  });
  const st = lib.parseMapHref(snap.href);
  if (!st) return [];
  const pois = lib.collectPoisFromAnchors(snap.anchors);
  const center = lib.worldPixel(st.lat, st.lon, st.zoom);
  return pois.map((p) => {
    const raw = lib.worldPixel(p.lat, p.lon, st.zoom);
      return {
        text: p.name,
        x: raw.x - center.x + snap.cr.width / 2,
        y: raw.y - center.y + snap.cr.height / 2,
        synthetic: true
      };
  });
}

// Plain WGS mercator, deliberately not routed through aligner-lib: this is the
// oracle the overlay is measured against, so it must not share code with it.
function mercatorPx(lat, lon, zoom) {
  const n = 2 ** Number(zoom) * 256;
  const s = Math.sin((Number(lat) * Math.PI) / 180);
  return {
    x: ((Number(lon) + 180) / 360) * n,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n
  };
}

// Google's !3d/!4d and the URL `@` are one datum (GCJ-02 in China), which is
// why the Off-mode pin sits on the Off-mode street map. So plain mercator from
// the URL camera reproduces the Off pin pixel with no GCJ math at all, and On
// mode must land on that same pixel: toggling the extension moves the roads
// under the pin, never the pin across the screen.
function nativePinScreenPx(placeLat, placeLon, st, width, height) {
  const p = mercatorPx(placeLat, placeLon, st.zoom);
  const c = mercatorPx(st.lat, st.lon, st.zoom);
  return { x: p.x - c.x + Number(width) / 2, y: p.y - c.y + Number(height) / 2 };
}

function assertOverlayPoisMatchModel(snap, overlayPins, tolerance = 12) {
  const { expect } = require("@playwright/test");
  const st = lib.parseMapHref(snap.href);
  expect(st, snap.href).toBeTruthy();
  const pois = lib.collectPoisFromAnchors(snap.anchors);
  expect(overlayPins.length, JSON.stringify(overlayPins)).toBeGreaterThan(0);
  expect(pois.length, JSON.stringify(snap.anchors.slice(0, 4))).toBeGreaterThan(0);
  const expected = pois
    .map((p) => {
      const native = nativePinScreenPx(p.lat, p.lon, st, snap.width, snap.height);
      return { text: p.name, left: native.x, top: native.y };
    })
    .sort((a, b) => a.left - b.left || a.top - b.top);
  const got = overlayPins.slice().sort((a, b) => a.left - b.left || a.top - b.top);
  const n = Math.min(expected.length, got.length);
  // The pre-fix bug centered the overlay on the raw GCJ `@`, so every pin sat
  // one overlayShiftPx away from the Off pin — 107px at z15 doubling per level.
  const shift = lib.overlayShiftPx(st.lat, st.lon, st.zoom);
  for (let i = 0; i < n; i++) {
    const why = JSON.stringify({ i, expected: expected[i], got: got[i], shift });
    expect(Math.abs(got[i].left - expected[i].left), why).toBeLessThan(tolerance);
    expect(Math.abs(got[i].top - expected[i].top), why).toBeLessThan(tolerance);
    expect(Math.abs(got[i].dx || 0), "POI must not extra-translate off the street tiles").toBeLessThan(2);
    expect(Math.abs(got[i].dy || 0)).toBeLessThan(2);
    expect(
      Math.hypot(got[i].left - (expected[i].left + shift.dx), got[i].top - (expected[i].top + shift.dy)),
      `POI must not carry the camera GCJ offset on top of the Off pin: ${why}`
    ).toBeGreaterThan(20);
  }
}

async function assertStreetsShiftedOntoSatellite(page) {
  const { expect } = require("@playwright/test");
  const s = await page.evaluate(() => {
    function cssShift(el) {
      if (!el) return { dx: 0, dy: 0, hypot: 0, left: "", top: "", src: "", ok: false };
      const t = getComputedStyle(el).transform;
      const m = t.match(/matrix\(([^)]+)\)/);
      const p = m ? m[1].split(",").map((x) => Number(x.trim())) : [];
      return {
        dx: p.length === 6 ? p[4] : 0,
        dy: p.length === 6 ? p[5] : 0,
        hypot: p.length === 6 ? Math.hypot(p[4], p[5]) : 0,
        left: el.style.left || "",
        top: el.style.top || "",
        src: el.currentSrc || el.src || "",
        lyrs: el.dataset.lyrs || "",
        vx: el.dataset.x || "",
        vy: el.dataset.y || "",
        vz: el.dataset.z || "",
        ok: !!(el.complete && el.naturalWidth >= 64)
      };
    }
    const root = document.getElementById("gcj02-aligner-root");
    const layer = root?.dataset.layer || "";
    let sat = root?.querySelector(".gcj02-tile:not(.gcj02-road)");
    let road = root?.querySelector(".gcj02-road") || root?.querySelector(".gcj02-tile");
    let paired = null;
    if (layer === "terrain" && root) {
      // Colored street `m` under unshifted shade `t`.
      const shade = root.querySelector(".gcj02-shade[data-lyrs='t'], img[data-lyrs='t']");
      const mapTile =
        root.querySelector(".gcj02-tile[data-lyrs='m'], .gcj02-road[data-lyrs='m']")
        || [...root.querySelectorAll(".gcj02-tile,.gcj02-road")].find((el) => el.dataset.lyrs === "m");
      sat = shade;
      road = mapTile;
      if (shade && mapTile) paired = { sat: cssShift(shade), road: cssShift(mapTile) };
    } else if (sat && root) {
      const roads = [...root.querySelectorAll(".gcj02-road")];
      const match = roads.find((r) => r.style.left === sat.style.left && r.style.top === sat.style.top)
        || roads[0];
      if (match) paired = { sat: cssShift(sat), road: cssShift(match) };
    }
    return {
      layer,
      expectedDx: Number(root?.dataset.shiftDx || 0),
      expectedDy: Number(root?.dataset.shiftDy || 0),
      offsetPx: Number(root?.dataset.offsetPx || 0),
      sat: cssShift(sat),
      road: cssShift(road),
      paired,
      shadeBlend: (() => {
        const sh = root?.querySelector(".gcj02-shade[data-lyrs='t']");
        return sh ? getComputedStyle(sh).mixBlendMode : "";
      })()
    };
  });
  expect(s.offsetPx, JSON.stringify(s)).toBeGreaterThan(20);
  expect(s.road.hypot, JSON.stringify(s)).toBeGreaterThan(20);
  expect(s.road.ok, JSON.stringify(s)).toBe(true);
  expect(Math.abs(s.road.dx - s.expectedDx), JSON.stringify(s)).toBeLessThan(48);
  expect(Math.abs(s.road.dy - s.expectedDy), JSON.stringify(s)).toBeLessThan(48);
  if (s.layer === "satellite") {
    expect(s.sat.hypot, "satellite tiles must stay unshifted").toBeLessThan(3);
    expect(s.paired, JSON.stringify(s)).toBeTruthy();
    expect(s.paired.sat.left, JSON.stringify(s.paired)).toBe(s.paired.road.left);
    expect(s.paired.sat.top, JSON.stringify(s.paired)).toBe(s.paired.road.top);
    expect(s.paired.road.hypot).toBeGreaterThan(20);
    expect(s.paired.sat.hypot).toBeLessThan(3);
    const satVt = tileVt(s.paired.sat);
    const roadVt = tileVt(s.paired.road);
    expect(satVt.lyrs, JSON.stringify(satVt)).toMatch(/s/);
    expect(roadVt.lyrs, JSON.stringify(roadVt)).toMatch(/^h/);
    expect(roadVt.x, "roads must use the same WGS tile index as satellite").toBe(satVt.x);
    expect(roadVt.y, JSON.stringify({ satVt, roadVt })).toBe(satVt.y);
    expect(roadVt.z).toBe(satVt.z);
  }
  if (s.layer === "terrain") {
    // Street `m` CSS-shifts; WGS shade `t` stays put (not combined shifted `p`).
    expect(s.sat.hypot, "terrain shade must stay unshifted").toBeLessThan(3);
    expect(s.paired, JSON.stringify(s)).toBeTruthy();
    expect(s.paired.sat.left, JSON.stringify(s.paired)).toBe(s.paired.road.left);
    expect(s.paired.sat.top, JSON.stringify(s.paired)).toBe(s.paired.road.top);
    expect(s.paired.road.hypot).toBeGreaterThan(20);
    expect(s.paired.sat.hypot).toBeLessThan(3);
    const reliefVt = tileVt(s.paired.sat);
    const roadVt = tileVt(s.paired.road);
    expect(reliefVt.lyrs, JSON.stringify(reliefVt)).toBe("t");
    expect(roadVt.lyrs, JSON.stringify(roadVt)).toMatch(/^m/);
    expect(roadVt.x, "streets must use the same WGS tile index as shade").toBe(reliefVt.x);
    expect(roadVt.y, JSON.stringify({ reliefVt, roadVt })).toBe(reliefVt.y);
    expect(roadVt.z).toBe(reliefVt.z);
    expect(s.shadeBlend, "shade should multiply onto streets").toMatch(/multiply/i);
  }
}

module.exports = {
  EXT_PATH,
  launchExtensionContext,
  dismissConsent,
  setAlignerMode,
  waitForOverlay,
  waitForOverlayOff,
  waitForNativePois,
  overlayAlignmentStats,
  overlayPoiScreen,
  collectNativeMapPins,
  collectPlaceSnapshot,
  MAP_CROP,
  withOverlayDecorHidden,
  assertOverlayPoisMatchModel,
  mercatorPx,
  nativePinScreenPx,
  parseVtSrc,
  tileVt,
  assertStreetsShiftedOntoSatellite,
  hoverSearchResult,
  clearSearchHover,
  ensureStreetLayer,
  ensureSatelliteLayer
};
