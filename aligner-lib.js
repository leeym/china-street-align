(function (root) {
  "use strict";

  // Overlay is position:absolute; z-index:0 inside the canvas host, after the canvas.
  // Positive z-index paints above auto-z Maps controls. position:fixed covers the viewport.
  const OVERLAY_Z = 0;
  const CHROME_Z = 1000010;

  function overlayWouldCoverMapsChrome(parentTag, position, zIndex) {
    const parent = String(parentTag || "").toUpperCase();
    const pos = String(position || "").toLowerCase();
    const z = Number(zIndex);
    if (parent === "HTML") return true;
    if (pos === "fixed") return true;
    if (z > 0) return true;
    return false;
  }

  function shouldHideNativeImage(src, inOverlay) {
    if (inOverlay) return false;
    const url = String(src || "");
    if (!url) return false;
    if (/maps\.gstatic\.com\/maps-api-v3\/mapfiles/i.test(url)) return false;
    if (/maps\.gstatic\.com\/mapfiles/i.test(url)) return false;
    if (/\/vt\//.test(url)) return true;
    if (/khms\d\.google\.com/i.test(url)) return true;
    return false;
  }

  function shouldHideNativeCanvas(cssW, cssH, bufW, bufH) {
    const cssArea = Math.max(0, cssW) * Math.max(0, cssH);
    const bufArea = Math.max(0, bufW) * Math.max(0, bufH);
    return cssArea >= 200000 || bufArea >= 200000;
  }

  function defaultChromeHoles(hostW, hostH) {
    const w = Number(hostW);
    const h = Number(hostH);
    if (!(w > 0) || !(h > 0)) return [];
    return [
      { x: w - 80, y: h - 240, w: 72, h: 228 },
      { x: 8, y: 8, w: Math.min(480, w * 0.42), h: 64 },
      { x: 8, y: h - 96, w: 88, h: 88 }
    ];
  }

  function chromeClipPath(hostW, hostH, _holes) {
    const w = Number(hostW);
    const h = Number(hostH);
    if (!(w > 0) || !(h > 0)) return "";
    const [zoom, search, layers] = defaultChromeHoles(w, h);
    const searchRight = search.x + search.w;
    const searchBottom = search.y + search.h;
    const zoomLeft = zoom.x;
    const zoomTop = zoom.y;
    const layerRight = layers.x + layers.w;
    const layerTop = layers.y;
    return `polygon(0px ${searchBottom}px, ${searchRight}px ${searchBottom}px, ${searchRight}px 0px, ${w}px 0px, ${w}px ${zoomTop}px, ${zoomLeft}px ${zoomTop}px, ${zoomLeft}px ${h}px, ${layerRight}px ${h}px, ${layerRight}px ${layerTop}px, 0px ${layerTop}px)`;
  }

  function chromeStacksAboveOverlay(chromeZ, overlayZ) {
    return Number(chromeZ) > Number(overlayZ);
  }

  root.Gcj02Aligner = {
    OVERLAY_Z,
    CHROME_Z,
    overlayWouldCoverMapsChrome,
    shouldHideNativeImage,
    shouldHideNativeCanvas,
    chromeStacksAboveOverlay,
    chromeClipPath,
    defaultChromeHoles
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
