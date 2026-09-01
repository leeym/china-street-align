"use strict";

const ALIGN_MODE_KEY = "alignMode";
const DEFAULT_ALIGN_MODE = "streets";
const MODES = ["streets", "satellite", "off"];

function normalize(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  if (s === "off" || s === "native") return "off";
  if (s === "satellite" || s === "sat" || s === "imagery" || s === "blend") return "satellite";
  return DEFAULT_ALIGN_MODE;
}

function select(mode) {
  const m = normalize(mode);
  MODES.forEach((v) => {
    const el = document.querySelector(`input[value="${v}"]`);
    if (el) el.checked = v === m;
  });
}

chrome.storage.sync.get({ [ALIGN_MODE_KEY]: DEFAULT_ALIGN_MODE }, (got) => {
  select(got?.[ALIGN_MODE_KEY]);
});

document.getElementById("modes").addEventListener("change", (ev) => {
  const t = ev.target;
  if (!t || t.name !== "alignMode") return;
  const mode = normalize(t.value);
  select(mode);
  chrome.storage.sync.set({ [ALIGN_MODE_KEY]: mode });
});
