const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { chromeClusterVisible, isHybridRoadPixel } = require("../helpers/bmp-luma");

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
});
