"use strict";

/**
 * Dense border / region-gate scan. Reports points that disagree with curated
 * expectations, plus a coarse grid of “unexpected IN” outside a China bbox
 * and “unexpected OUT” inside known PRC prefecture samples.
 *
 * Usage: node scripts/scan-border-coverage.js
 */
require("../aligner-lib.js");
const { BORDER_POINTS } = require("../tests/fixtures/china-border-points");
const L = global.Gcj02Aligner;

const PRC_SPOT_CHECKS = [
  // Daxinganling
  ["Jiagedaqi", 50.411, 124.118, false],
  ["Tahe", 52.34, 124.71, false],
  ["Xinlin", 51.70, 124.40, false],
  ["Huzhong", 52.03, 123.60, false],
  ["Huma", 51.73, 126.65, false],
  ["Mohe", 53.48, 122.37, false],
  ["Songling", 50.78, 124.22, false],
  // Other easy-to-miss interior / border PRC
  ["Heihe", 50.25, 127.49, false],
  ["Xunke", 49.564, 128.476, false],
  ["Fuyuan", 48.37, 134.28, false],
  ["Kashgar", 39.47, 75.99, false],
  ["Urumqi", 43.825, 87.617, false],
  ["Turpan", 42.951, 89.189, false],
  ["Hami", 42.819, 93.515, false],
  ["Yining-Ili", 43.917, 81.324, false],
  ["Khorgas", 44.214, 80.418, false],
  ["Bole-Bortala", 44.85, 82.07, false],
  ["Purang", 30.29, 81.17, false],
  ["Gyirong-county", 28.855, 85.298, false],
  ["Gyirong-town", 28.393, 85.325, false],
  ["Gyirong-port", 28.278, 85.370, false],
  ["Zhangmu", 27.975, 85.968, false],
  ["Ruili", 24.01, 97.85, false],
  ["Hekou", 22.53, 103.96, false],
  ["Dongxing", 21.547717, 107.9690085, false],
  ["Erenhot", 43.668, 111.977, false],
  ["Manzhouli", 49.6, 117.43, false],
  ["Hulunbuir", 49.212, 119.765, false],
  ["Huangqi-tip", 26.3575, 119.930278, false],
  ["Hainan-Dongfang", 19.1, 108.65, false],
  ["Wangcungang", 21.4368, 110.9414, false],
  ["Beihai-GoldenCoast-BBQ", 21.44681, 109.04915, false]
];

const FOREIGN_SPOT_CHECKS = [
  ["Kathmandu", 27.717, 85.324, true],
  ["Pokhara", 28.21, 83.99, true],
  ["Mustang", 29.18, 83.96, true],
  ["Hilsa", 30.15, 81.35, true],
  ["Almaty", 43.238, 76.945, true],
  ["Zharkent", 44.16, 80.00, true],
  ["Blagoveshchensk", 50.29, 127.54, true],
  ["Vladivostok", 43.115, 131.885, true],
  ["Ulaanbaatar", 47.8864, 106.9057, true],
  ["Sainshand", 44.882, 110.137, true],
  ["Zamyn-Uud", 43.728, 111.902, true],
  ["Dalanzadgad", 43.57, 104.426, true],
  ["Choibalsan", 48.078, 114.535, true],
  ["Baruun-Urt", 46.681, 113.279, true],
  ["Dehradun", 30.3165, 78.0322, true],
  ["Aligarh-UP", 27.88, 78.08, true],
  ["Hanoi", 21.028, 105.854, true],
  ["Pyongyang", 39.039, 125.762, true],
  ["Seoul", 37.566, 126.978, true],
  ["Naha", 26.2124, 127.6809, true],
  ["Narai-juku", 35.964, 137.571, true],
  ["Bangkok", 13.75, 100.5, true],
  ["Maldives-Male", 4.175, 73.509, true],
  ["ECS-mid", 28.0, 125.0, true],
  ["NK-east-gap", 39.75, 129.5, true]
];

function checkList(label, list) {
  const bad = [];
  for (const [name, lat, lon, wantOut] of list) {
    const out = L.outOfChina(lat, lon);
    if (out !== wantOut) {
      bad.push({
        name,
        lat,
        lon,
        wantOut,
        gotOut: out,
        land: L.inChinaLandApprox(lat, lon),
        excl: L.inExcludedNeighborRegion(lat, lon)
      });
    }
  }
  console.log(`\n== ${label}: ${bad.length ? "FAIL " + bad.length : "OK"} ==`);
  for (const b of bad) console.log(JSON.stringify(b));
  return bad.length;
}

let failures = 0;
failures += checkList("BORDER_POINTS", BORDER_POINTS.map((p) => [p.name, p.lat, p.lon, p.out]));
failures += checkList("PRC_SPOT_CHECKS", PRC_SPOT_CHECKS);
failures += checkList("FOREIGN_SPOT_CHECKS", FOREIGN_SPOT_CHECKS);

// Coarse surprise IN: clearly foreign oceans / far abroad should never paint.
const surpriseIn = [];
for (let lat = 0; lat <= 56; lat += 1) {
  for (let lon = 68; lon <= 138; lon += 1) {
    if (!L.outOfChina(lat, lon)) {
      const weird =
        lat < 17.5 // open SCS / SE Asia
        || lon < 73
        || lon > 135.2
        || (lat < 20 && lon < 107) // Gulf of Thailand / Indochina west
        || (lat >= 20 && lat <= 30 && lon >= 123 && lon <= 130) // ECS / Ryukyu belt
        || (lat >= 33 && lat <= 40 && lon >= 124.5 && lon <= 130); // Yellow Sea / Korea
      if (weird) surpriseIn.push([lat, lon]);
    }
  }
}
console.log(`\n== surprise IN on coarse grid: ${surpriseIn.length} ==`);
if (surpriseIn.length) {
  console.log(surpriseIn.slice(0, 40).map((p) => p.join(",")).join(" | "));
}

// Dense Daxinganling grid — every 0.25° must stay IN (PRC forest belt).
const daxOut = [];
for (let lat = 50.2; lat <= 53.6; lat += 0.25) {
  for (let lon = 121.5; lon <= 126.8; lon += 0.25) {
    // Skip Amur Russian bank NE corner samples (east of ~127 is foreign; keep west).
    if (L.outOfChina(lat, lon)) daxOut.push([+lat.toFixed(2), +lon.toFixed(2)]);
  }
}
console.log(`\n== Daxinganling dense OUT (should be 0): ${daxOut.length} ==`);
if (daxOut.length) console.log(daxOut.slice(0, 30).map((p) => p.join(",")).join(" | "));
failures += daxOut.length ? 1 : 0;
failures += surpriseIn.length ? 1 : 0;

console.log(failures ? `\nTOTAL FAILURES: ${failures}` : "\nALL CURATED CHECKS PASSED");
process.exit(failures ? 1 : 0);
