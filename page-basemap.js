(() => {
  "use strict";

  const MAP_LABEL = /^(預設|预设|default|map|地圖|地图|街道|road ?map|roadmap|interactive map|互動式地圖|互动地图)$/i;
  const LAYERS_LABEL = /^(layers|圖層|图层|map type|地圖類型|地图类型)$/i;

  function controlLabel(el) {
    return String(el?.getAttribute?.("aria-label") || el?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function layersButton() {
    for (const el of document.querySelectorAll("button, [role='button']")) {
      const aria = controlLabel(el);
      if (LAYERS_LABEL.test(aria)) return el;
      const labelled = el.getAttribute("aria-labelledby");
      if (labelled) {
        const t = document.getElementById(labelled)?.textContent?.trim() || "";
        if (LAYERS_LABEL.test(t)) return el;
      }
    }
    return null;
  }

  function mapMenuItem() {
    for (const el of document.querySelectorAll(
      '[role="menuitemradio"], [role="menuitem"], [role="radio"], button, label'
    )) {
      const label = controlLabel(el);
      if (MAP_LABEL.test(label)) return el;
    }
    return null;
  }

  function minimapButton() {
    const btn = document.querySelector("button[jsaction*='minimap.main']");
    if (btn) return btn;
    for (const el of document.querySelectorAll("[aria-label]")) {
      if (!MAP_LABEL.test(el.getAttribute("aria-label") || "")) continue;
      const root = el.closest("button[jsaction*='minimap']") || el.parentElement?.querySelector("button");
      if (root) return root;
    }
    return null;
  }

  function switchToMapOnce() {
    const openItem = mapMenuItem();
    if (openItem) {
      openItem.click();
      return true;
    }
    const mini = minimapButton();
    if (mini) {
      mini.click();
      return true;
    }
    const layers = layersButton();
    if (!layers) return false;
    layers.click();
    const item = mapMenuItem();
    if (item) {
      item.click();
      return true;
    }
    return false;
  }

  function switchToMap() {
    if (switchToMapOnce()) return true;
    setTimeout(switchToMapOnce, 120);
    setTimeout(switchToMapOnce, 380);
    return false;
  }

  window.addEventListener("message", (ev) => {
    if (ev.data?.source !== "gcj02-aligner" || ev.data?.type !== "switchToMapBasemap") return;
    switchToMap();
  });
})();
