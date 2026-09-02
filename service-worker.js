const cache = new Map();
const TILE_HOST = /^https:\/\/(mt[0-3]\.google\.com|mt[0-3]\.googleapis\.com|khms[0-3]\.google\.com|khms[0-3]\.googleapis\.com|www\.google\.com|maps\.googleapis\.com)\//;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
