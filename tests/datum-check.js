const { chromium } = require("@playwright/test");
const path = require("path");
const fs = require("fs");

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
  let dLat = transformLat(lon - 105, lat - 35);
  let dLon = transformLon(lon - 105, lat - 35);
  const rad = lat * Math.PI / 180;
  const magic = 1 - EE * Math.sin(rad) ** 2;
  const s = Math.sqrt(magic);
  dLat = (dLat * 180) / ((A * (1 - EE)) / (magic * s) * Math.PI);
  dLon = (dLon * 180) / (A / s * Math.cos(rad) * Math.PI);
  return { lat: lat + dLat, lon: lon + dLon };
}

const OUT = path.join(__dirname, "..", "test-results", "datum-check");
fs.mkdirSync(OUT, { recursive: true });

const pearlWgs = { name: "oriental-pearl", lat: 31.239665, lon: 121.499758 };
const pearlGcj = wgsToGcj(pearlWgs.lat, pearlWgs.lon);

function mapsUrl(lat, lon) {
  return `https://www.google.com/maps/@${lat},${lon},18z/data=!3m1!1e3`;
}

async function dismissConsent(page) {
  const candidates = [
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Accept")'
  ];
  for (const sel of candidates) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click().catch(() => {});
      break;
    }
  }
}

async function addCrosshair(page, label) {
  await page.evaluate((text) => {
    const old = document.getElementById("datum-cross");
    if (old) old.remove();
    const wrap = document.createElement("div");
    wrap.id = "datum-cross";
    wrap.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646";
    wrap.innerHTML = `
      <div style="position:absolute;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;background:red;opacity:.85"></div>
      <div style="position:absolute;top:50%;left:0;right:0;height:2px;margin-top:-1px;background:red;opacity:.85"></div>
      <div style="position:absolute;left:50%;top:50%;width:28px;height:28px;margin:-14px 0 0 -14px;border:3px solid red;border-radius:50%;background:transparent"></div>
      <div style="position:absolute;left:12px;bottom:12px;background:rgba(0,0,0,.82);color:#fff;padding:8px 10px;font:13px monospace;max-width:520px">${text}</div>
    `;
    document.documentElement.appendChild(wrap);
  }, label);
}

(async () => {
  const context = await chromium.launchPersistentContext(path.join(OUT, "user"), {
    headless: true,
    viewport: { width: 1280, height: 900 }
  });
  const page = context.pages()[0] || await context.newPage();

  const shots = [
    {
      file: "pearl-WGS-center.png",
      lat: pearlWgs.lat,
      lon: pearlWgs.lon,
      label: `WGS-84 of Oriental Pearl Tower<br>${pearlWgs.lat}, ${pearlWgs.lon}<br>If SAT is WGS: tower under crosshair. If ROADS are WGS: roads under crosshair.`
    },
    {
      file: "pearl-GCJ-center.png",
      lat: pearlGcj.lat,
      lon: pearlGcj.lon,
      label: `GCJ-02 of same physical tower<br>${pearlGcj.lat.toFixed(7)}, ${pearlGcj.lon.toFixed(7)}<br>If SAT is GCJ: tower under crosshair. If ROADS are GCJ: roads under crosshair.`
    }
  ];

  for (const s of shots) {
    await page.goto(mapsUrl(s.lat, s.lon), { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(page);
    await page.waitForTimeout(8000);
    await addCrosshair(page, s.label);
    await page.screenshot({ path: path.join(OUT, s.file), fullPage: false });
    console.log("wrote", s.file, page.url());
  }

  await context.close();
  console.log("GCJ", pearlGcj);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
