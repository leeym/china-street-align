const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  chromeClusterVisible,
  isHybridRoadPixel,
  bmpColorStats
} = require("../helpers/bmp-luma");

describe("chrome screenshot luma", () => {
  it("requires both dark and bright pixels in the zoom cluster", () => {
    assert.equal(chromeClusterVisible({ darkShare: 0.2, brightShare: 0.02 }), true);
    assert.equal(chromeClusterVisible({ darkShare: 0.01, brightShare: 0.5 }), false);
    assert.equal(chromeClusterVisible({ darkShare: 0.5, brightShare: 0 }), false);
  });

  it("counts Google gold overlay highways, not only saturated yellow", () => {
    assert.equal(isHybridRoadPixel(203, 161, 145), true);
    assert.equal(isHybridRoadPixel(180, 140, 40), true);
    assert.equal(isHybridRoadPixel(20, 40, 50), false);
    assert.equal(isHybridRoadPixel(250, 250, 250), false);
  });

  it("scores green terrain colour vs near-gray", () => {
    // Minimal 2x2 24-bit BMP: gray and green pixels (bottom-up rows).
    const wh = Buffer.alloc(14);
    wh.write("BM");
    const dib = Buffer.alloc(40);
    dib.writeInt32LE(40, 0);
    dib.writeInt32LE(2, 4);
    dib.writeInt32LE(2, 8);
    dib.writeUInt16LE(1, 12);
    dib.writeUInt16LE(24, 14);
    const row = Buffer.alloc(8);
    row[0] = 128; row[1] = 128; row[2] = 128;
    row[3] = 40; row[4] = 180; row[5] = 60;
    const row2 = Buffer.alloc(8);
    row2[0] = 128; row2[1] = 128; row2[2] = 128;
    row2[3] = 50; row2[4] = 190; row2[5] = 70;
    const pixels = Buffer.concat([row, row2]);
    const off = 14 + 40;
    wh.writeUInt32LE(off + pixels.length, 2);
    wh.writeUInt32LE(off, 10);
    const bmpPath = path.join(os.tmpdir(), `gcj02-color-${Date.now()}.bmp`);
    fs.writeFileSync(bmpPath, Buffer.concat([wh, dib, pixels]));
    const stats = bmpColorStats(bmpPath);
    assert.ok(stats.greenBias > 20, JSON.stringify(stats));
    assert.ok(stats.greenishShare > 0.4, JSON.stringify(stats));
    assert.ok(stats.grayShare < 0.6, JSON.stringify(stats));
    fs.unlinkSync(bmpPath);
  });
});
