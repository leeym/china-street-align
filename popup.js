"use strict";

const ALIGN_MODE_KEY = "alignMode";
const DEFAULT_ALIGN_MODE = "hybrid";
const MODES = ["hybrid", "off"];
const MODE_LABELS = {
  hybrid: "Hybrid",
  off: "Off"
};

function normalize(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  if (s === "off" || s === "native") return "off";
  if (s === "hybrid" || s === "auto" || s === "smart") return "hybrid";
  if (
    s === "satellite" || s === "sat" || s === "imagery" || s === "blend"
    || s === "on" || s === "streets" || s === "street"
  ) {
    return "hybrid";
  }
  return DEFAULT_ALIGN_MODE;
}

function select(mode) {
  const m = normalize(mode);
  MODES.forEach((v) => {
    const el = document.querySelector(`input[value="${v}"]`);
    if (el) el.checked = v === m;
  });
  const current = document.getElementById("current");
  if (current) current.textContent = MODE_LABELS[m] || m;
}

function showError(msg) {
  const el = document.getElementById("error");
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

function storageGet(keys, cb) {
  const done = (got, err) => {
    try { cb(got, err); } catch (_e) {}
  };
  const readSync = (localGot) => {
    try {
      chrome.storage.sync.get(keys, (sync) => {
        try {
          const err = chrome.runtime.lastError?.message || "";
          const merged = { ...keys, ...sync, ...localGot };
          const key = Object.keys(keys)[0];
          if (
            key
            && localGot?.[key] != null
            && sync?.[key] != null
            && localGot[key] !== sync[key]
          ) {
            merged[key] = localGot[key];
          }
          done(merged, err);
        } catch (e) {
          done(localGot, String(e));
        }
      });
    } catch (e) {
      done(localGot, String(e));
    }
  };
  try {
    chrome.storage.local.get(keys, (local) => {
      try {
        if (chrome.runtime.lastError) {
          readSync(keys);
          return;
        }
        readSync(local);
      } catch (e) {
        readSync(keys);
      }
    });
  } catch (e) {
    readSync(keys);
  }
}

function storageSet(obj, cb) {
  const done = typeof cb === "function" ? cb : () => {};
  let pending = 2;
  let err = "";
  const finish = (e) => {
    if (e) err = e;
    pending -= 1;
    if (pending <= 0) done(err);
  };
  try {
    chrome.storage.sync.set(obj, () => {
      try { finish(chrome.runtime.lastError?.message || ""); } catch (e) { finish(String(e)); }
    });
  } catch (e) {
    finish(String(e));
  }
  try {
    chrome.storage.local.set(obj, () => {
      try { finish(chrome.runtime.lastError?.message || ""); } catch (e) { finish(String(e)); }
    });
  } catch (e) {
    finish(String(e));
  }
}

function loadMode() {
  storageGet({ [ALIGN_MODE_KEY]: DEFAULT_ALIGN_MODE }, (got, err) => {
    if (err) showError(err);
    else showError("");
    const mode = normalize(got?.[ALIGN_MODE_KEY]);
    select(mode);
    if (got?.[ALIGN_MODE_KEY] !== mode) storageSet({ [ALIGN_MODE_KEY]: mode });
  });
}

function bind() {
  const form = document.getElementById("modes");
  const ver = document.getElementById("version");
  if (ver) {
    try {
      ver.textContent = `v${chrome.runtime.getManifest().version}`;
    } catch (_e) {
      ver.textContent = "";
    }
  }
  if (!form) {
    showError("Popup failed to load. Reload the extension.");
    return;
  }
  form.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!t || t.name !== "alignMode") return;
    const mode = normalize(t.value);
    select(mode);
    storageSet({ [ALIGN_MODE_KEY]: mode }, (err) => showError(err || ""));
  });
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" && area !== "local") return;
      if (!changes[ALIGN_MODE_KEY]) return;
      select(changes[ALIGN_MODE_KEY].newValue);
    });
  } catch (_e) {}
  loadMode();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bind);
} else {
  bind();
}
