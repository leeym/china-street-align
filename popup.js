"use strict";

const ALIGN_MODE_KEY = "alignMode";
const DEFAULT_ALIGN_MODE = "hybrid";
const MODES = ["hybrid", "off"];
const MODE_LABELS = {
  hybrid: "On",
  off: "Off"
};

function normalize(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  if (s === "off" || s === "native") return "off";
  if (s === "hybrid" || s === "auto" || s === "smart" || s === "on") return "hybrid";
  if (
    s === "satellite" || s === "sat" || s === "imagery" || s === "blend"
    || s === "streets" || s === "street"
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

function storageGet(cb) {
  try {
    chrome.storage.local.get({ [ALIGN_MODE_KEY]: DEFAULT_ALIGN_MODE }, (got) => {
      const err = chrome.runtime.lastError?.message || "";
      try { cb(got, err); } catch (_e) {}
    });
  } catch (e) {
    try { cb({ [ALIGN_MODE_KEY]: DEFAULT_ALIGN_MODE }, String(e)); } catch (_e) {}
  }
}

function storageSet(mode, cb) {
  const done = typeof cb === "function" ? cb : () => {};
  try {
    chrome.storage.local.set({ [ALIGN_MODE_KEY]: normalize(mode) }, () => {
      done(chrome.runtime.lastError?.message || "");
    });
  } catch (e) {
    done(String(e));
  }
}

function loadMode() {
  storageGet((got, err) => {
    if (err) showError(err);
    else showError("");
    const mode = normalize(got?.[ALIGN_MODE_KEY]);
    select(mode);
    if (got?.[ALIGN_MODE_KEY] !== mode) storageSet(mode);
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
    storageSet(mode, (err) => showError(err || ""));
  });
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[ALIGN_MODE_KEY]) return;
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
