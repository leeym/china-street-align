"use strict";

/**
 * Cases for Google Maps hybrid-offset e2e.
 * Each row is [lat, lon, expectGoogleHybridOffset].
 * Lat first (matches the numeric samples). Prefer points well inside a region
 * so a ~1000m viewport does not straddle a GCJ / WGS border.
 */
module.exports = {
  METERS: 1000,
  CASES: [
    [22.2821282, 114.1546681, false], // 香港中環
    [22.6020029, 114.1163371, true], // 深圳東站
    [24.4889002, 118.3110772, false], // 金門 北山播音牆
    [24.5251258, 118.1910153, true], // 廈門 五通客运码头
    [26.1585506, 119.9168831, false], // 馬祖天后宮
    [26.2751866, 119.7930114, true], // 福建連江 观海酒楼
    [21.547717, 107.9690085, true], // 东兴市人民政府
    [21.5307043, 107.9581901, false], // 芒街長途客運站
    [22.1418427, 113.5726407, false], // 澳門東亞運動會體育館
    [22.100475, 113.5460551, true] // 横琴湾水世界
  ]
};
