"use strict";

// Canonical China overlay URLs. Unit tests parse these on every run so a
// region/zoom/CSS regression cannot ship without failing locally or in CI.
const FORBIDDEN_CITY = {
  id: "forbidden-city",
  name: "Forbidden City",
  href: "https://www.google.com/maps/search/%E7%B4%AB%E7%A6%81%E5%9F%8E/@39.9167455,116.3868853,4718m/data=!3m1!1e3!4m2!2m1!6e1",
  lat: 39.9167455,
  lon: 116.3868853,
  meters: 4718,
  expectZoom: 15
};

const DUISHAN = {
  id: "duishan",
  name: "Jimei 兑山村",
  href: "https://www.google.com/maps/place/%E4%B8%AD%E5%9C%8B%E7%A6%8F%E5%BB%BA%E7%9C%81%E5%BB%88%E9%96%80%E5%B8%82%E9%9B%86%E7%BE%8E%E5%8D%80%E5%85%8C%E5%B1%B1%E6%9D%91+%E9%82%AE%E6%94%BF%E7%BC%86%E7%A0%81:+361021/@24.6060291,118.0838401,2796m/data=!3m2!1e3!4b1!4m6!3m5!1s0x34148e6ab5fe7f93:0x9985637b6ac4b21e!8m2!3d24.6060199!4d118.08899",
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

const LANDMARKS = [FORBIDDEN_CITY, DUISHAN, XIAMEN_XINGLIN];

module.exports = { FORBIDDEN_CITY, DUISHAN, XIAMEN_XINGLIN, LANDMARKS };
