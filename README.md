# China Street Align

[![Add to Chrome](docs/add-to-chrome.svg)](https://github.com/leeym/china-street-align/releases/latest/download/china-street-align.zip)

Download the latest Load-unpacked zip → see [Install](#install) below. (Chrome Web Store listing coming later; until then this is the install path.)

A Chrome extension that, **inside China**, aligns Google Maps **WGS-84 satellite imagery** with **GCJ-02 street labels** so the photo and the roads sit on the same ground.

The Chrome Web Store / toolbar name is **Google Maps China Street Align**. This repository is `china-street-align`.

## Why streets and satellite do not line up

Google Maps satellite tiles over China are typically **WGS-84** (the same datum as GPS). Street, label, and POI tiles are typically **GCJ-02**.

That split is not a Google bug. Public maps of China must use an approved national geodetic system:

- [Surveying and Mapping Law of the People’s Republic of China](https://ghzrzyw.beijing.gov.cn/zhengwuxinxi/zcfg/fl/201912/t20191213_1166995.html) (《中华人民共和国测绘法》, 2017 revision; official reprint)
- [Regulations on Map Management](https://www.gov.cn/zhengce/2015-12/14/content_5023591.htm) (《地图管理条例》, State Council Decree No. 664)

In practice, civilian internet maps implement that system as **GCJ-02** (often called “Mars coordinates”), a confidential offset from WGS-84 historically associated with the State Bureau of Surveying and Mapping (国测局). Satellite / aerial imagery is often still published in WGS-84. Plotting GCJ-02 streets on WGS-84 photos produces a consistent shift (on the order of hundreds of metres). Xinglin Bay Bridge in Xiamen is a clear example: the yellow highway and the physical bridge run as two parallel lines.

This project does **not** change Google’s servers. When enabled, it paints aligned satellite and label tiles where Hybrid mode can do so without breaking native Google features.

Outside China the extension stays off.

## Design principles

Hybrid mode follows three rules:

1. **Satellite and streets must coincide whenever both are visible.** On a clean satellite view the extension hides Google’s skewed photo and paints aligned WGS-84 `s` imagery with CSS-shifted hybrid `h` labels on top, so the roads sit on the features in the photo.
2. **Do not repaint Google’s layers — except one Place teardrop when needed.** Search pins, directions routes, terrain, traffic, transit, bicycling, Street View coverage, and similar features stay on Google’s native canvas. The only overlay glyph is a single aligned teardrop on Place pages when the URL pin datum does not match the current basemap (e.g. named「太和殿」on satellite, or a WGS DMS query on the street map).
3. **If rules 1 and 2 cannot both hold, turn off satellite and use the map basemap.** Hybrid detects views that need native layers (search, directions, terrain, traffic, pegman drag, etc.), tears down the aligned overlay, and switches Google Maps to the **Map** basemap. Rewriting the URL alone is not enough — Maps can keep painting satellite tiles until the Layers / minimap control is clicked; the extension does that for you when you open **Directions** (規劃路線) from satellite.

**Datum rules (still apply to the aligned tile stack):**

1. **Satellite base `lyrs=s` and terrain shade `lyrs=t` are WGS-84** — never CSS-shift them.
2. **The URL camera `@lat,lon` is usually GCJ-02** — the overlay centres on `gcjToWgs(@)`. **Exception:** `/maps/place/<DMS or decimal lat,lon>/` paths are WGS-84; do not run `gcjToWgs` on those coordinates or the pin slides west of the feature.
3. **Street / label tiles are GCJ-02** — CSS-shift them with one camera vector onto the WGS-84 stack.
4. **Tile anchors are tile centres** — corner math must subtract half a tile on both axes or roads and markers drift apart when zooming.

## Install

**One-click install** only works via the [Chrome Web Store](https://chrome.google.com/webstore). Chrome blocks installing extensions from arbitrary links or `.crx` downloads for regular users (outside enterprise policy). When this extension is listed, the store link will go here.

Until then, install from a GitHub Release zip (no `git` required) — same file as the **Add to Chrome** button at the top:

1. Download **[china-street-align.zip](https://github.com/leeym/china-street-align/releases/latest/download/china-street-align.zip)** (or the versioned `china-street-align-x.y.z.zip` on the [Releases](https://github.com/leeym/china-street-align/releases) page).
2. Unzip it. You should get a `china-street-align` folder that contains `manifest.json`.
3. Chrome → `chrome://extensions` → enable **Developer mode**.
4. **Load unpacked** and select that `china-street-align` folder (the one with `manifest.json` inside).
5. Open Google Maps. Alignment runs automatically inside China.
6. After you update the extension, **close the Maps tab and open it again** so the content script is not stale.

Developers packaging a release locally: `npm run pack` writes `dist/china-street-align-<version>.zip` and `dist/china-street-align.zip`.

Version follows [Semantic Versioning](https://semver.org/) in `manifest.json` (currently **0.8.0**).

### v0.8.0

- **Hybrid / Off only** — removed “Shift the streets” and “Shift the satellite”; one Hybrid mode aligns satellite + labels when safe, otherwise yields to Google’s map.
- **Directions from satellite** — opening route planning tears down the overlay and switches the basemap to Map (not just a URL token change).
- **Place pin** — single aligned teardrop when the URL pin datum does not match the basemap.
- E2E coverage for the 清永陵 satellite → 規劃路線 flow (`tests/directions-native.spec.js`).

## Usage

Inside China the extension aligns the two datums; outside China it stays off. Click the toolbar icon for the popup:

| Mode | What it does |
| --- | --- |
| **Hybrid** (default) | Crisp aligned satellite + shifted labels on a clean photo view. Search, directions, terrain, traffic, Street View coverage and similar layers force Google’s **Map** basemap so nothing is repainted. Opening **Directions** from satellite switches the basemap to Map automatically (overlay off, native routes visible). Place pages may show one aligned teardrop when the native pin would be wrong for the basemap. |
| **Off** | Native Google Maps. |

The mode is stored in `chrome.storage.sync` and applies live to open Maps tabs. The Maps tab also has a compact **Align** bar (top-right) with Hybrid and Off.

The toolbar icon is a status lamp:

- **Red** — the current Maps view is inside China (aligning)
- **Green** — outside China / idle

A small status line on the map shows layer, alignment state, version, and zoom when Hybrid is painting tiles.

Map zoom, search, layers, and other Google chrome stay clickable (overlay is `pointer-events: none` under them). Full Street View and 3D Earth stay on Google’s native view.

## Development

Requires Node.js 18+.

```bash
npm install
npx playwright install chromium
npm test
```

- `npm run test:unit` — Node test runner (`tests/unit`)
- `npm run test:e2e` — Playwright: extension chrome, Hybrid/Off popup, place pins, directions basemap handoff, pan/zoom smoke tests
- `npm run pack` — build `dist/china-street-align-<version>.zip` for GitHub Releases
- CI runs `npm run test:unit` on every push and pull request

## Limits

- Visual alignment only; it does not alter Google’s servers or URLs.
- GCJ-02 is not a published formula. The shift uses a common public approximation and is locally first-order (a translation per view).
- Google Maps DOM and tile URLs change. If controls or tiles break, reload the extension and reopen Maps.
- This is not legal advice. The statutes above govern mapping products in China; this extension is a personal overlay on Google’s existing tiles.

## License

[THE PEARL-TEA-WARE LICENSE](LICENSE) (based on Poul-Henning Kamp’s [Beer-ware License](https://people.freebsd.org/~phk/)). Keep the notice; do what you want with the code. If we meet and you think it was worth it, you can buy Yen-Ming Lee a pearl tea.
