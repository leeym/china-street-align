# China Street Align

A Chrome extension that, **inside China**, shifts Google Maps **street tiles onto satellite imagery** so roads sit on the physical features you see in photos.

The Chrome Web Store / toolbar name is **Google Maps China Street Align**. This repository is `china-street-align`.

## Why streets and satellite do not line up

Google Maps satellite tiles over China are typically **WGS-84** (the same datum as GPS). Street, label, and POI tiles are typically **GCJ-02**.

That split is not a Google bug. Public maps of China must use an approved national geodetic system:

- [Surveying and Mapping Law of the People’s Republic of China](http://www.npc.gov.cn/zgrdw/npc/xinwen/2017-04/27/content_2020927.htm) (《中华人民共和国测绘法》, 2017 revision)
- [Regulations on Map Management](https://www.gov.cn/zhengce/2015-12/14/content_5023591.htm) (《地图管理条例》, State Council Decree No. 664)

In practice, civilian internet maps implement that system as **GCJ-02** (often called “Mars coordinates”), a confidential offset from WGS-84 historically associated with the State Bureau of Surveying and Mapping (国测局). Satellite / aerial imagery is often still published in WGS-84. Plotting GCJ-02 streets on WGS-84 photos produces a consistent shift (on the order of hundreds of metres). Xinglin Bay Bridge in Xiamen is a clear example: the yellow highway and the physical bridge run as two parallel lines.

This project does **not** change the satellite layer. When enabled, it overlays street tiles and **translates them GCJ-02 → WGS-84** so they match the satellite.

Outside China the overlay stays off.

## Install (unpacked)

1. Chrome → `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** and select this repository directory.
3. Open Google Maps. The default mode is **On**.
4. After you reload or update the extension, **close the Maps tab and open it again** so the content script is not stale.

Version follows [Semantic Versioning](https://semver.org/) in `manifest.json` (currently **0.5.6**).

## Usage

The toolbar popup has:

- **On** — shift streets onto satellite (default in China)
- **Off** — original Google Maps

A small status line on the map shows mode, layer (`satellite` / `map`), version, and zoom.

Map zoom, search, layers, and other Google chrome stay clickable; the overlay is clipped away from those controls.

## Development

Requires Node.js 18+.

```bash
npm install
npx playwright install chromium
npm test
```

- `npm run test:unit` — Node test runner (`tests/unit`)
- `npm run test:e2e` — Playwright, loads the unpacked extension against Google Maps

## Limits

- Visual alignment only; it does not alter Google’s servers or URLs.
- GCJ-02 is not a published formula. The shift uses a common public approximation and is locally first-order (a translation per view).
- Google Maps DOM and tile URLs change. If controls or tiles break, reload the extension and reopen Maps.
- This is not legal advice. The statutes above govern mapping products in China; this extension is a personal overlay on Google’s existing tiles.

## License

[THE PEARL-TEA-WARE LICENSE](LICENSE) (based on Poul-Henning Kamp’s [Beer-ware License](https://people.freebsd.org/~phk/)). Keep the notice; do what you want with the code. If we meet and you think it was worth it, you can buy Yen-Ming Lee a pearl tea.
