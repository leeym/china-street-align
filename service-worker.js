const cache = new Map();
const TILE_HOST = /^https:\/\/(mt[0-3]\.google\.com|mt[0-3]\.googleapis\.com|khms[0-3]\.google\.com|khms[0-3]\.googleapis\.com|www\.google\.com|maps\.googleapis\.com)\//;

const ICON_CACHE = new Map();

function statusIconImageData(color, size) {
  const key = `${color}:${size}`;
  if (ICON_CACHE.has(key)) return ICON_CACHE.get(key);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.38, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.stroke();
  const data = ctx.getImageData(0, 0, size, size);
  ICON_CACHE.set(key, data);
  return data;
}

function setActionLamp(inChina) {
  const color = inChina ? "#d93025" : "#1e8e3e";
  const title = inChina
    ? "China Street Align · shifting"
    : "China Street Align · idle";
  try {
    chrome.action.setIcon({
      imageData: {
        16: statusIconImageData(color, 16),
        32: statusIconImageData(color, 32)
      }
    });
    chrome.action.setTitle({ title });
  } catch (_e) {}
}

setActionLamp(false);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "setActionStatus") {
    setActionLamp(!!msg.inChina);
    return;
  }
  if (msg?.type !== "getTile") return;
  const url = msg.url;
  if (typeof url !== "string" || !TILE_HOST.test(url)) {
    sendResponse({ error: "invalid tile host" });
    return;
  }
  if (cache.has(url)) {
    sendResponse({ dataUrl: cache.get(url) });
    return;
  }
  (async () => {
    try {
      const r = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = await r.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const mime = r.headers.get("content-type") || "image/jpeg";
      const dataUrl = `data:${mime};base64,${btoa(binary)}`;
      cache.set(url, dataUrl);
      if (cache.size > 300) cache.delete(cache.keys().next().value);
      sendResponse({ dataUrl });
    } catch (e) {
      sendResponse({ error: String(e) });
    }
  })();
  return true;
});
