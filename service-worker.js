const cache = new Map();
const pending = new Map();
const MAX_CACHE_BYTES = 20 * 1024 * 1024;
let cacheBytes = 0;
const TILE_HOST = /^https:\/\/(mt[0-3]\.google\.com|mt[0-3]\.googleapis\.com|khms[0-3]\.google\.com|khms[0-3]\.googleapis\.com|www\.google\.com|maps\.googleapis\.com)\//;

function evictIfNeeded() {
  while (cacheBytes > MAX_CACHE_BYTES && cache.size > 0) {
    const oldest = cache.keys().next().value;
    const entry = cache.get(oldest);
    cacheBytes -= entry.bytes;
    cache.delete(oldest);
  }
}

function arrayBufferToDataUrl(buf, mime) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function fetchTile(url) {
  if (cache.has(url)) return cache.get(url).dataUrl;
  if (pending.has(url)) return pending.get(url);

  const job = (async () => {
    const r = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    const mime = r.headers.get("content-type") || "image/jpeg";
    const dataUrl = arrayBufferToDataUrl(buf, mime);
    const bytes = buf.byteLength;
    cache.set(url, { dataUrl, bytes });
    cacheBytes += bytes;
    evictIfNeeded();
    return dataUrl;
  })();

  pending.set(url, job);
  try {
    return await job;
  } finally {
    pending.delete(url);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "getTile") return;
  const url = msg.url;
  if (typeof url !== "string" || !TILE_HOST.test(url)) {
    sendResponse({ error: "invalid tile host" });
    return;
  }
  if (cache.has(url)) {
    sendResponse({ dataUrl: cache.get(url).dataUrl });
    return;
  }
  fetchTile(url)
    .then((dataUrl) => sendResponse({ dataUrl }))
    .catch((e) => sendResponse({ error: String(e) }));
  return true;
});
