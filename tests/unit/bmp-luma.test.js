const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { chromeClusterVisible } = require("../helpers/bmp-luma");

describe("chrome screenshot luma", () => {
  it("requires both dark and bright pixels in the zoom cluster", () => {
    assert.equal(chromeClusterVisible({ darkShare: 0.2, brightShare: 0.02 }), true);
    assert.equal(chromeClusterVisible({ darkShare: 0.01, brightShare: 0.5 }), false);
    assert.equal(chromeClusterVisible({ darkShare: 0.5, brightShare: 0 }), false);
  });
});
