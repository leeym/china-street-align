const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { parseVtSrc, tileVt } = require("../helpers/vt-src");

describe("Google vt URL parse", () => {
  it("reads lyrs from /vt/lyrs=s&x= path (no ? before lyrs)", () => {
    const u = "https://mt0.google.com/vt/lyrs=s&x=108517&y=56284&z=17";
    assert.deepEqual(parseVtSrc(u), { x: 108517, y: 56284, z: 17, lyrs: "s" });
  });

  it("reads hybrid roads from /vt/lyrs=h&x=", () => {
    const u = "https://mt1.google.com/vt/lyrs=h&x=108517&y=56284&z=17";
    const v = parseVtSrc(u);
    assert.equal(v.lyrs, "h");
    assert.equal(v.x, 108517);
    assert.equal(v.y, 56284);
  });

  it("prefers data-* tile index over currentSrc", () => {
    const v = tileVt({
      src: "https://mt0.google.com/vt/lyrs=s&x=1&y=2&z=3",
      lyrs: "h",
      vx: "108517",
      vy: "56284",
      vz: "17"
    });
    assert.deepEqual(v, { x: 108517, y: 56284, z: 17, lyrs: "h" });
  });
});
