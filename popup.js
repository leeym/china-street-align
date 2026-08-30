function normalizeMode(v) {
  return v === "off" ? "off" : "on";
}

function markActive(mode) {
  document.getElementById("on").classList.toggle("active", mode === "on");
  document.getElementById("off").classList.toggle("active", mode === "off");
}

try {
  const manifest = chrome.runtime.getManifest();
  document.getElementById("version").textContent = `v${manifest.version}`;
} catch (_e) {
  document.getElementById("version").textContent = "";
}

try {
  chrome.storage.local.get({ mode: "on" }, (stored) => {
    if (chrome.runtime.lastError) return;
    markActive(normalizeMode(stored.mode));
  });
} catch (_e) {}

function send(mode) {
  markActive(mode);
  try {
    chrome.storage.local.set({ mode }, () => {
      void chrome.runtime.lastError;
    });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError || !tabs[0]?.id) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: "setMode", mode }, () => {
        void chrome.runtime.lastError;
      });
      window.close();
    });
  } catch (_e) {
    window.close();
  }
}

document.getElementById("on").onclick = () => send("on");
document.getElementById("off").onclick = () => send("off");
