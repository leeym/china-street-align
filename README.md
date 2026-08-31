# China Street Align

[![Add to Chrome](docs/add-to-chrome.svg)](https://github.com/leeym/china-street-align/releases/latest/download/china-street-align.zip)

Download the latest Load-unpacked zip → see [Install](#install) below. (Chrome Web Store listing coming later; until then this is the install path.)

A Chrome extension that, **inside China**, shifts Google Maps **street tiles onto satellite imagery** so roads sit on the physical features you see in photos.

The Chrome Web Store / toolbar name is **Google Maps China Street Align**. This repository is `china-street-align`.

## Why streets and satellite do not line up

Google Maps satellite tiles over China are typically **WGS-84** (the same datum as GPS). Street, label, and POI tiles are typically **GCJ-02**.

That split is not a Google bug. Public maps of China must use an approved national geodetic system:

- [Surveying and Mapping Law of the People’s Republic of China](https://ghzrzyw.beijing.gov.cn/zhengwuxinxi/zcfg/fl/201912/t20191213_1166995.html) (《中华人民共和国测绘法》, 2017 revision; official reprint)
- [Regulations on Map Management](https://www.gov.cn/zhengce/2015-12/14/content_5023591.htm) (《地图管理条例》, State Council Decree No. 664)

In practice, civilian internet maps implement that system as **GCJ-02** (often called “Mars coordinates”), a confidential offset from WGS-84 historically associated with the State Bureau of Surveying and Mapping (国测局). Satellite / aerial imagery is often still published in WGS-84. Plotting GCJ-02 streets on WGS-84 photos produces a consistent shift (on the order of hundreds of metres). Xinglin Bay Bridge in Xiamen is a clear example: the yellow highway and the physical bridge run as two parallel lines.

This project does **not** change the satellite layer. When enabled, it overlays street tiles and **translates them GCJ-02 → WGS-84** so they match the satellite.

**Datum rules (in China, mode On):**

1. **Satellite and terrain relief are WGS-84** — never shift `lyrs=s` or shade `lyrs=t`. Do **not** CSS-shift Google’s combined terrain tile (`lyrs=p`): it bakes GCJ roads onto WGS hillshade, so shifting whole `p` drags cliffs with the roads (at 五丈原, X235 climbs the west plateau face instead of the valley). Terrain mode matches the outside-China look as closely as the tiles allow: **shifted street `m` under unshifted `t` shade** (`invert` + brightness/contrast so weak `t` ridges actually multiply-darken, opacity 0.5) — not grayscale `t`+labels alone, and not a fake green basemap tint.
2. **The URL camera `@lat,lon` is usually GCJ-02** — the same datum as the sidebar `!3d/!4d` for named places, which is why the Off pin sits on the Off street map. The overlay draws a WGS-84 world, so it centers on `gcjToWgs(@)`. **Exception:** `/maps/place/<DMS or decimal lat,lon>/` queries are already WGS-84 (Off satellite pins them on the real feature — e.g. 太和殿 at `39°54′57″N 116°23′26″E`); do not run `gcjToWgs` on those or the pin slides west of the palace. Centering a GCJ `@` on the raw numbers slid the whole view by one GCJ offset that doubled per zoom level (107px at z15, 428px at z17).
3. **Streets, traffic/transit/bike overlays are GCJ-02** — CSS-shift them onto the WGS-84 camera with **one camera vector** (same WGS tile `x,y` as satellite/terrain for hybrid roads). Search pins are canvas-painted by Maps, so On redraws icon+label; GCJ pins use the street shift, WGS lat/lon place pins plot in WGS directly. Place-page titles like「結果」are ignored; names come from `/maps/place/NAME/` and visited-link aria suffixes are stripped.
4. **A tile's anchor is its centre, on both axes** — `tileCenterLatLon` feeds a `- tileSize/2` corner calculation, so a west-edge longitude there shifts every tile half a tile (128px at scale 1) west, at every zoom. That leaves markers on the right pixel and the roads under them on the wrong one, which reads as a POI that drifts further off the map the further you zoom out.

On a street-only view these rules cancel: the overlay re-centres on `gcjToWgs(@)` and shifts the GCJ tiles back by the same vector, so it must reproduce Maps pixel for pixel. There is no satellite to align to, so any residual offset is a bug — `tests/tile-align.spec.js` measures it by correlating On and Off screenshots.

Outside China the overlay stays off.

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

Version follows [Semantic Versioning](https://semver.org/) in `manifest.json` (currently **0.6.45**).

## Usage

While the extension is enabled it is always active: inside China it shifts street tiles onto satellite; outside China the overlay stays off. There is no On/Off popup — disable the extension in `chrome://extensions` to restore native Maps everywhere.

The toolbar icon is a status lamp (no click action):

- **Red** — the current Maps view is inside China (shifting)
- **Green** — outside China / idle

A small status line on the map shows layer (`satellite` / `terrain` / `map`), version, and zoom when aligning.

Map zoom, search, layers, and other Google chrome stay clickable (overlay is `pointer-events: none` under them); aligned tiles paint under those corner controls so the map edge matches outside China. Terrain, traffic, transit, bicycling, and Street View coverage use matching Google tiles (streets still shifted). Search result pins are redrawn on the overlay from the sidebar place links; hovering a result shows the same classic red teardrop and name tooltip as native Maps (title plus the sidebar description blurb when Maps provides one). Full Street View and 3D Earth stay on Google’s native view.

## Development

Requires Node.js 18+.

```bash
npm install
npx playwright install chromium
npm test
```

- `npm run test:unit` — Node test runner (`tests/unit`), including 紫禁城 / 五丈原 / 兑山村 URLs
- `npm run test:e2e` — Playwright: Xiamen chrome checks, a parameterized 4-step flow per search landmark, POI placement across z14–z19 measured against a plain-mercator oracle, an On-vs-Off image compare of the street tiles, and sidebar-hover teardrop/tooltip parity
- `npm run pack` — build `dist/china-street-align-<version>.zip` (and `china-street-align.zip`) for GitHub Releases
- CI runs `npm run test:unit` on every push and pull request

## Limits

- Visual alignment only; it does not alter Google’s servers or URLs.
- GCJ-02 is not a published formula. The shift uses a common public approximation and is locally first-order (a translation per view).
- Google Maps DOM and tile URLs change. If controls or tiles break, reload the extension and reopen Maps.
- This is not legal advice. The statutes above govern mapping products in China; this extension is a personal overlay on Google’s existing tiles.

## License

[THE PEARL-TEA-WARE LICENSE](LICENSE) (based on Poul-Henning Kamp’s [Beer-ware License](https://people.freebsd.org/~phk/)). Keep the notice; do what you want with the code. If we meet and you think it was worth it, you can buy Yen-Ming Lee a pearl tea.
