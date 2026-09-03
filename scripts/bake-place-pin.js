#!/usr/bin/env node
"use strict";

/**
 * Bake assets/place-pin*.png from Google Maps' spotlight_pin_v4 templates.
 *
 * Maps loads cyan/magenta vt/icon templates and recolors them in WebGL. We
 * recolor with the same reds sampled from a native Places pin on canvas, then
 * composite outline → fill → center dot.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "assets");
const BASE = "https://www.google.com/maps/vt/icon/name=assets/icons/spotlight/";
const LAYERS = {
  outline: `${BASE}spotlight_pin_v4_outline-2-medium.png&scale=2`,
  fill: `${BASE}spotlight_pin_v4-2-medium.png&scale=2`,
  dot: `${BASE}spotlight_pin_v4_dot-2-medium.png&scale=2`
};
// Sampled from native Places teardrop on Maps canvas (太和殿).
const FILL = [233, 66, 53];
const DARK = [178, 13, 13];

async function fetchB64(url) {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  return buf.toString("base64");
}

(async () => {
  const layers = {
    outline: await fetchB64(LAYERS.outline),
    fill: await fetchB64(LAYERS.fill),
    dot: await fetchB64(LAYERS.dot)
  };
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const out = await page.evaluate(async ({ layers, FILL, DARK }) => {
    function load(b64) {
      return new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = `data:image/png;base64,${b64}`;
      });
    }
    function recolor(img, rgb) {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const id = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < id.data.length; i += 4) {
        if (!id.data[i + 3]) continue;
        id.data[i] = rgb[0];
        id.data[i + 1] = rgb[1];
        id.data[i + 2] = rgb[2];
      }
      ctx.putImageData(id, 0, 0);
      return c;
    }
    const outline = recolor(await load(layers.outline), DARK);
    const fill = recolor(await load(layers.fill), FILL);
    const dot = recolor(await load(layers.dot), DARK);
    const hdpi = document.createElement("canvas");
    hdpi.width = fill.width;
    hdpi.height = fill.height;
    const ctx = hdpi.getContext("2d");
    ctx.drawImage(outline, 0, 0);
    ctx.drawImage(fill, 0, 0);
    ctx.drawImage(dot, 0, 0);
    const css = document.createElement("canvas");
    css.width = Math.round(fill.width / 2);
    css.height = Math.round(fill.height / 2);
    css.getContext("2d").drawImage(hdpi, 0, 0, css.width, css.height);
    return {
      hdpi: hdpi.toDataURL("image/png"),
      css: css.toDataURL("image/png"),
      width: css.width,
      height: css.height
    };
  }, { layers, FILL, DARK });
  await browser.close();

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "place-pin-hdpi.png"), Buffer.from(out.hdpi.split(",")[1], "base64"));
  fs.writeFileSync(path.join(OUT, "place-pin.png"), Buffer.from(out.css.split(",")[1], "base64"));
  console.log(`Wrote assets/place-pin.png (${out.width}x${out.height}) and place-pin-hdpi.png`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
