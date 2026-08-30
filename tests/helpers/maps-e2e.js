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
  let sw = context.serviceWorkers()[0];
  if (!sw) {
    sw = await context.waitForEvent("serviceworker", { timeout: 15000 }).catch(() => null);
  }
  if (sw) {
    await sw.evaluate((m) => chrome.storage.local.set({ mode: m }), mode);
  }
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

function assertOverlayPoisMatchModel(snap, overlayPins, tolerance = 28) {
  const { expect } = require("@playwright/test");
  const st = lib.parseMapHref(snap.href);
  expect(st, snap.href).toBeTruthy();
  const pois = lib.collectPoisFromAnchors(snap.anchors);
  expect(overlayPins.length, JSON.stringify(overlayPins)).toBeGreaterThan(0);
  expect(pois.length, JSON.stringify(snap.anchors.slice(0, 4))).toBeGreaterThan(0);
  const expected = pois
    .map((p) => {
      const screen = lib.overlayPoiScreenPx(p.lat, p.lon, st.lat, st.lon, st.zoom, snap.width, snap.height);
      const raw = lib.worldPixel(p.lat, p.lon, st.zoom);
      const center = lib.worldPixel(st.lat, st.lon, st.zoom);
      return {
        text: p.name,
        left: screen.x,
        top: screen.y,
        lat: screen.lat,
        lon: screen.lon,
        rawLeft: raw.x - center.x + snap.width / 2,
        rawTop: raw.y - center.y + snap.height / 2
      };
    })
    .sort((a, b) => a.left - b.left || a.top - b.top);
  const got = overlayPins.slice().sort((a, b) => a.left - b.left || a.top - b.top);
  const n = Math.min(expected.length, got.length);
  for (let i = 0; i < n; i++) {
    expect(Math.abs(got[i].left - expected[i].left), JSON.stringify({ i, expected: expected[i], got: got[i] })).toBeLessThan(tolerance);
    expect(Math.abs(got[i].top - expected[i].top), JSON.stringify({ i, expected: expected[i], got: got[i] })).toBeLessThan(tolerance);
    expect(Math.abs(got[i].dx || 0), "POI must not extra-translate off the street tiles").toBeLessThan(2);
    expect(Math.abs(got[i].dy || 0)).toBeLessThan(2);
    // Same single GCJ→WGS vector as street tiles (EW and NS); never a 2× pixel hack.
    const shift = lib.overlayShiftPx(st.lat, st.lon, st.zoom);
    expect(Math.abs(expected[i].left - (expected[i].rawLeft + shift.dx))).toBeLessThan(4);
    expect(Math.abs(expected[i].top - (expected[i].rawTop + shift.dy))).toBeLessThan(4);
    expect(Math.abs(expected[i].left - (expected[i].rawLeft + 2 * shift.dx))).toBeGreaterThan(20);
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
    const sat = root?.querySelector(".gcj02-tile:not(.gcj02-road)");
    const road = root?.querySelector(".gcj02-road") || root?.querySelector(".gcj02-tile");
    let paired = null;
    if (sat && root) {
      const roads = [...root.querySelectorAll(".gcj02-road")];
      const match = roads.find((r) => r.style.left === sat.style.left && r.style.top === sat.style.top)
        || roads[0];
      if (match) paired = { sat: cssShift(sat), road: cssShift(match) };
    }
    return {
      layer: root?.dataset.layer || "",
      expectedDx: Number(root?.dataset.shiftDx || 0),
      expectedDy: Number(root?.dataset.shiftDy || 0),
      offsetPx: Number(root?.dataset.offsetPx || 0),
      sat: cssShift(sat),
      road: cssShift(road),
      paired
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
  assertOverlayPoisMatchModel,
  parseVtSrc,
  tileVt,
  assertStreetsShiftedOntoSatellite,
  ensureStreetLayer,
  ensureSatelliteLayer
};
