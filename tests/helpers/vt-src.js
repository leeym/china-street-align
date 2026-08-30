/** Parse Google Maps raster tile URLs such as `/vt/lyrs=s&x=1&y=2&z=17`. */
function parseVtSrc(src) {
  const q = String(src || "");
  return {
    x: Number((/[?&]x=(\d+)/.exec(q) || [])[1] || NaN),
    y: Number((/[?&]y=(\d+)/.exec(q) || [])[1] || NaN),
    z: Number((/[?&]z=(\d+)/.exec(q) || [])[1] || NaN),
    lyrs: decodeURIComponent((/lyrs=([^&]+)/.exec(q) || [])[1] || "")
  };
}

function tileVt(info) {
  if (!info) return { x: NaN, y: NaN, z: NaN, lyrs: "" };
  if (info.lyrs && info.vx != null && info.vx !== "") {
    return {
      x: Number(info.vx),
      y: Number(info.vy),
      z: Number(info.vz),
      lyrs: String(info.lyrs)
    };
  }
  return parseVtSrc(info.src);
}

module.exports = { parseVtSrc, tileVt };
