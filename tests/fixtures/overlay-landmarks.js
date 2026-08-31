"use strict";

// Canonical China overlay URLs. Unit tests parse these on every run so a
// region/zoom/CSS regression cannot ship without failing locally or in CI.
const FORBIDDEN_CITY = {
  id: "forbidden-city",
  name: "紫禁城",
  query: "紫禁城",
  poiNeedles: ["紫禁城", "故宫"],
  mapHref:
    "https://www.google.com/maps/search/%E7%B4%AB%E7%A6%81%E5%9F%8E/@39.9167135,116.3868853,15z/data=!4m2!2m1!6e1",
  satHref:
    "https://www.google.com/maps/search/%E7%B4%AB%E7%A6%81%E5%9F%8E/@39.9167135,116.3868853,4718m/data=!3m1!1e3!4m2!2m1!6e1",
  lat: 39.9167135,
  lon: 116.3868853,
  // 故宫午门, GCJ-02. Must sit on the overlay palace axis, not east of it.
  samplePoi: { name: "故宫", lat: 39.91306, lon: 116.397026 },
  meters: 4718,
  expectZoom: 15
};

const WUZHANGYUAN = {
  id: "wuzhangyuan",
  name: "五丈原",
  query: "五丈原",
  poiNeedles: ["五丈原"],
  mapHref:
    "https://www.google.com/maps/search/%E4%BA%94%E4%B8%88%E5%8E%9F/@34.2820338,107.6089203,15z/data=!4m2!2m1!6e1",
  satHref:
    "https://www.google.com/maps/search/%E4%BA%94%E4%B8%88%E5%8E%9F/@34.2820338,107.6089203,5053m/data=!3m1!1e3!4m2!2m1!6e1",
  lat: 34.2820338,
  lon: 107.6089203,
  meters: 5053,
  expectZoom: 15,
  samplePoi: { name: "五丈原", lat: 34.282582, lon: 107.618568 },
  // 五丈原鎮: the hit whose marker sat 128px east of the town on the tiles.
  townPoi: { name: "五丈原鎮", lat: 34.282017, lon: 107.61922 },
  // Street-map URLs for the On-vs-Off image compare. `expectZoom` is asserted
  // against the live page because Maps rewrites the zoom it does not like: both
  // `16.5z` on a /maps/search/ URL and `16.74z` on a bare /maps/@ URL come back
  // as `16z`. So a live street view cannot exercise a fractional tileSize at
  // all, and that coverage lives in the unit test (FRACTIONAL_ZOOMS) instead.
  tileAlignHrefs: [
    {
      label: "z14",
      href: "https://www.google.com/maps/search/%E4%BA%94%E4%B8%88%E5%8E%9F/@34.2826809,107.5979687,14z/data=!4m2!2m1!6e1",
      expectZoom: 14
    },
    {
      label: "z18",
      href: "https://www.google.com/maps/search/%E4%BA%94%E4%B8%88%E5%8E%9F/@34.2826803,107.6172806,18z/data=!4m2!2m1!6e1",
      expectZoom: 18
    }
  ],
  // Zooms the overlay must handle where tileSize is not 256 (Maps reaches these
  // through satellite `Nm` URLs). Pure math, so no live page is involved.
  fractionalZooms: [15.3, 16.5, 16.74, 17.42],
  // Google frames a search so the hit keeps one screen offset from `@`, the lon
  // delta halving per level. Each set below is framed on a different hit, so
  // `anchor` says which POI must not move on screen as z rises. A POI that
  // walks across the viewport means the overlay camera is in the wrong datum.
  zoomSets: [
    {
      id: "framed-on-town",
      anchorKey: "townPoi",
      // Here `@` lat equals the hit's !3d lat, so the hit holds its screen row
      // as well as its column.
      anchorHoldsY: true,
      steps: [
        {
          zoom: 15,
          href: "https://www.google.com/maps/search/%E4%BA%94%E4%B8%88%E5%8E%9F/@34.2820186,107.6089231,15z/data=!4m2!2m1!6e1"
        },
        {
          zoom: 16,
          href: "https://www.google.com/maps/search/%E4%BA%94%E4%B8%88%E5%8E%9F/@34.2820184,107.6140729,16z/data=!4m2!2m1!6e1"
        },
        {
          zoom: 17,
          href: "https://www.google.com/maps/search/%E4%BA%94%E4%B8%88%E5%8E%9F/@34.2820183,107.6166478,17z/data=!4m2!2m1!6e1"
        }
      ]
    },
    {
      id: "framed-on-plain",
      anchorKey: "samplePoi",
      // Horizontally Google offsets `@` by a fixed pixel count to clear the
      // results panel, so the hit holds its column. Vertically there is no panel
      // to clear and `@` pins a fixed LATITUDE ~0.0001° off the hit, so the hit
      // drifts down the screen as z rises (1px at z14, 44px at z19). That drift
      // is Google's own — Off does it too — so do not assert on y here.
      anchorHoldsY: false,
      steps: [
        {
          zoom: 14,
          href: "https://www.google.com/maps/search/%E4%BA%94%E4%B8%88%E5%8E%9F/@34.2826809,107.5979687,14z/data=!4m2!2m1!6e1"
        },
        {
          zoom: 15,
          href: "https://www.google.com/maps/search/%E4%BA%94%E4%B8%88%E5%8E%9F/@34.2826805,107.6082684,15z/data=!4m2!2m1!6e1"
        },
        {
          zoom: 16,
          href: "https://www.google.com/maps/search/%E4%BA%94%E4%B8%88%E5%8E%9F/@34.2826804,107.6134182,16z/data=!4m2!2m1!6e1"
        },
        {
          zoom: 17,
          href: "https://www.google.com/maps/search/%E4%BA%94%E4%B8%88%E5%8E%9F/@34.2826803,107.6159931,17z/data=!4m2!2m1!6e1"
        },
        {
          zoom: 18,
          href: "https://www.google.com/maps/search/%E4%BA%94%E4%B8%88%E5%8E%9F/@34.2826803,107.6172806,18z/data=!4m2!2m1!6e1"
        },
        {
          zoom: 19,
          href: "https://www.google.com/maps/search/%E4%BA%94%E4%B8%88%E5%8E%9F/@34.2826803,107.6179243,19z/data=!4m2!2m1!6e1"
        }
      ]
    }
  ],
  // WGS-84 of that GCJ !3d (single gcjToWgs — south of G310 / west of X235 gate).
  poiWgsSouthOfG310Lat: 34.286,
  poiWgsWestOfX235Lon: 107.617,
  // Terrain place URL: west plateau edge where shifted `p` sends X235 up the
  // cliff face instead of through the valley (regression lock for e2e).
  terrainHref:
    "https://www.google.com/maps/place/%E4%BA%94%E4%B8%88%E5%8E%9F/@34.2826157,107.5979685,14z/data=!4m6!3m5!1s0x36613e2da81fc14b:0xeee51cceea4d3465!8m2!3d34.282582!4d107.618568!16zL20vMDZkOGxk!5m1!1e4"
};

const DUISHAN = {
  id: "duishan",
  name: "兑山村",
  query: "兑山村",
  poiNeedles: ["兑山村", "兌山村", "Duishan", "361021"],
  mapHref:
    "https://www.google.com/maps/place/%E4%B8%AD%E5%9C%8B%E7%A6%8F%E5%BB%BA%E7%9C%81%E5%BB%88%E9%96%80%E5%B8%82%E9%9B%86%E7%BE%8E%E5%8D%80%E5%85%8C%E5%B1%B1%E6%9D%91+%E9%82%AE%E6%94%BF%E7%BC%86%E7%A0%81:+361021/@24.6060291,118.0838401,16z/data=!4m6!3m5!1s0x34148e6ab5fe7f93:0x9985637b6ac4b21e!8m2!3d24.6060199!4d118.08899",
  satHref:
    "https://www.google.com/maps/place/%E4%B8%AD%E5%9C%8B%E7%A6%8F%E5%BB%BA%E7%9C%81%E5%BB%88%E9%96%80%E5%B8%82%E9%9B%86%E7%BE%8E%E5%8D%80%E5%85%8C%E5%B1%B1%E6%9D%91+%E9%82%AE%E6%94%BF%E7%BC%86%E7%A0%81:+361021/@24.6060291,118.0838401,2796m/data=!3m2!1e3!4b1!4m6!3m5!1s0x34148e6ab5fe7f93:0x9985637b6ac4b21e!8m2!3d24.6060199!4d118.08899",
  lat: 24.6060291,
  lon: 118.0838401,
  meters: 2796
};

const XIAMEN_XINGLIN = {
  id: "xiamen-xinglin",
  name: "Xiamen Xinglin",
  href: "https://www.google.com/maps/@24.6013341,118.0704538,1674m/data=!3m1!1e3",
  lat: 24.6013341,
  lon: 118.0704538,
  meters: 1674,
  expectZoom: 16.74
};

const LANDMARKS = [FORBIDDEN_CITY, WUZHANGYUAN, DUISHAN, XIAMEN_XINGLIN];
const SEARCH_PLACES = [WUZHANGYUAN];

module.exports = {
  FORBIDDEN_CITY,
  WUZHANGYUAN,
  DUISHAN,
  XIAMEN_XINGLIN,
  LANDMARKS,
  SEARCH_PLACES
};
