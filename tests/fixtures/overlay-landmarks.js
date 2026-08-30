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
  // WGS-84 of that GCJ !3d must stay south of G310 and west of X235.
  poiWgsSouthOfG310Lat: 34.286,
  poiWgsWestOfX235Lon: 107.617
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
