# China Street Align

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

1. **Satellite and terrain relief are WGS-84** — never shift `lyrs=s` or `lyrs=t`. Do **not** CSS-shift Google’s combined terrain tile (`lyrs=p`): it bakes GCJ roads onto WGS hillshade, so shifting whole `p` drags cliffs with the roads (at 五丈原, X235 climbs the west plateau face instead of the valley). Terrain mode is unshifted `t` plus shifted `h` — same split as satellite `s`+`h`.
2. **The URL camera `@lat,lon` is GCJ-02** — the same datum as the sidebar `!3d/!4d`, which is why the Off pin sits on the Off street map. The overlay draws a WGS-84 world, so it centers on `gcjToWgs(@)`. Centering on the raw `@` slid the whole view, roads and pins together, by one GCJ offset — and because that offset is a pixel quantity it doubled per zoom level (107px at z15, 428px at z17), so pins walked toward the top-left as you zoomed in.
3. **Streets, traffic/transit/bike overlays are GCJ-02** — CSS-shift them onto the WGS-84 camera with **one camera vector** (same WGS tile `x,y` as satellite/terrain for hybrid roads). Search pins are canvas-painted by Maps, so On redraws icon+label; with the camera in the right datum each pin lands on the exact pixel Off used, and the roads move under it. Place-page titles like「結果」are ignored; names come from `/maps/place/NAME/` and visited-link aria suffixes are stripped.
4. **A tile's anchor is its centre, on both axes** — `tileCenterLatLon` feeds a `- tileSize/2` corner calculation, so a west-edge longitude there shifts every tile half a tile (128px at scale 1) west, at every zoom. That leaves markers on the right pixel and the roads under them on the wrong one, which reads as a POI that drifts further off the map the further you zoom out.

On a street-only view these rules cancel: the overlay re-centres on `gcjToWgs(@)` and shifts the GCJ tiles back by the same vector, so it must reproduce Maps pixel for pixel. There is no satellite to align to, so any residual offset is a bug — `tests/tile-align.spec.js` measures it by correlating On and Off screenshots.

Outside China the overlay stays off.

## Install (unpacked)

1. Chrome → `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** and select this repository directory.
3. Open Google Maps. Alignment runs automatically inside China.
4. After you reload or update the extension, **close the Maps tab and open it again** so the content script is not stale.

Version follows [Semantic Versioning](https://semver.org/) in `manifest.json` (currently **0.6.37**).

## Usage

While the extension is enabled it is always active: inside China it shifts street tiles onto satellite; outside China the overlay stays off. There is no On/Off popup — disable the extension in `chrome://extensions` to restore native Maps everywhere.

The toolbar icon is a status lamp (no click action):

- **Red** — the current Maps view is inside China (shifting)
- **Green** — outside China / idle

A small status line on the map shows layer (`satellite` / `terrain` / `map`), version, and zoom when aligning.

Map zoom, search, layers, and other Google chrome stay clickable; the overlay is clipped away from those controls. Terrain, traffic, transit, bicycling, and Street View coverage use matching Google tiles (streets still shifted). Search result pins are redrawn on the overlay from the sidebar place links; hovering a result shows the same classic red teardrop and name tooltip as native Maps (title plus the sidebar description blurb when Maps provides one). Full Street View and 3D Earth stay on Google’s native view.

## Development

Requires Node.js 18+.

```bash
npm install
npx playwright install chromium
npm test
```

- `npm run test:unit` — Node test runner (`tests/unit`), including 紫禁城 / 五丈原 / 兑山村 URLs
- `npm run test:e2e` — Playwright: Xiamen chrome checks, a parameterized 4-step flow per search landmark, POI placement across z14–z19 measured against a plain-mercator oracle, an On-vs-Off image compare of the street tiles, and sidebar-hover teardrop/tooltip parity
- CI runs `npm run test:unit` on every push and pull request

## Limits

- Visual alignment only; it does not alter Google’s servers or URLs.
- GCJ-02 is not a published formula. The shift uses a common public approximation and is locally first-order (a translation per view).
- Google Maps DOM and tile URLs change. If controls or tiles break, reload the extension and reopen Maps.
- This is not legal advice. The statutes above govern mapping products in China; this extension is a personal overlay on Google’s existing tiles.

## License

[THE PEARL-TEA-WARE LICENSE](LICENSE) (based on Poul-Henning Kamp’s [Beer-ware License](https://people.freebsd.org/~phk/)). Keep the notice; do what you want with the code. If we meet and you think it was worth it, you can buy Yen-Ming Lee a pearl tea.
