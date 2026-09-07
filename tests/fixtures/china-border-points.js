"use strict";

/**
 * Curated in/out samples for the overlay region gate.
 * `out: true` means outOfChina must be true (no alignment tint).
 * Used by unit tests and the z≥7 coverage border sweep.
 */
const BORDER_POINTS = [
  // Mainland coastal / border cities — must stay inside
  { name: "Beijing", lat: 39.9042, lon: 116.4074, out: false },
  { name: "Shanghai", lat: 31.2304, lon: 121.4737, out: false },
  { name: "Zhoushan", lat: 30.016, lon: 122.1069, out: false },
  { name: "Yushan-Islands", lat: 28.8883, lon: 122.275, out: false },
  { name: "Ningbo", lat: 29.8683, lon: 121.544, out: false },
  { name: "Wenzhou", lat: 27.9938, lon: 120.6994, out: false },
  { name: "Fuzhou", lat: 26.0745, lon: 119.2965, out: false },
  { name: "Pingtan", lat: 25.503, lon: 119.784, out: false },
  { name: "Xiamen", lat: 24.479, lon: 118.089, out: false },
  { name: "Shenzhen-Luohu", lat: 22.5329, lon: 114.1145, out: false },
  { name: "Dongxing", lat: 21.547717, lon: 107.9690085, out: false },
  { name: "Fangchenggang", lat: 21.77, lon: 108.35, out: false },
  { name: "Hekou", lat: 22.53, lon: 103.96, out: false },
  { name: "Jinghong", lat: 22.0, lon: 100.78, out: false },
  { name: "Ruili", lat: 24.01, lon: 97.85, out: false },
  { name: "Dandong", lat: 40.124, lon: 124.383, out: false },
  { name: "Jian", lat: 41.125, lon: 126.194, out: false },
  { name: "Linjiang", lat: 41.81, lon: 126.92, out: false },
  { name: "Tonghua", lat: 41.73, lon: 125.94, out: false },
  { name: "Yanji", lat: 42.891, lon: 129.509, out: false },
  { name: "Hunchun", lat: 42.86, lon: 130.37, out: false },
  { name: "Mudanjiang", lat: 44.55, lon: 129.63, out: false },
  { name: "Heihe", lat: 50.25, lon: 127.49, out: false },
  { name: "Xunke", lat: 49.564, lon: 128.476, out: false },
  { name: "Mohe", lat: 53.48, lon: 122.37, out: false },
  { name: "Jiagedaqi", lat: 50.411, lon: 124.118, out: false },
  { name: "Tahe", lat: 52.34, lon: 124.71, out: false },
  { name: "Xinlin", lat: 51.70, lon: 124.40, out: false },
  { name: "Huma", lat: 51.73, lon: 126.65, out: false },
  { name: "Hulunbuir", lat: 49.212, lon: 119.765, out: false },
  { name: "Manzhouli", lat: 49.6, lon: 117.43, out: false },
  { name: "Gyirong-county", lat: 28.855, lon: 85.298, out: false },
  { name: "Gyirong-town", lat: 28.393, lon: 85.325, out: false },
  { name: "Gyirong-port", lat: 28.278, lon: 85.370, out: false },
  { name: "Zhangmu", lat: 27.975, lon: 85.968, out: false },
  { name: "Rongcheng", lat: 37.17, lon: 122.42, out: false },
  { name: "Weizhou", lat: 21.05, lon: 109.12, out: false },
  { name: "Haikou", lat: 20.04, lon: 110.35, out: false },
  { name: "Sanya", lat: 18.25, lon: 109.5, out: false },
  { name: "Hainan-Dongfang", lat: 19.1, lon: 108.65, out: false },
  { name: "Hainan-west-coast", lat: 19.5, lon: 108.8, out: false },
  { name: "Xuwen", lat: 20.33, lon: 110.18, out: false },
  { name: "Wangcungang", lat: 21.4368, lon: 110.9414, out: false },
  { name: "Beihai-GoldenCoast-BBQ", lat: 21.44681, lon: 109.04915, out: false },

  // Taiwan Strait median (ROC MND: 27°N/122°E–23°N/118°E) + ROC — east is out
  { name: "Taipei", lat: 25.033, lon: 121.565, out: true },
  { name: "Kaohsiung", lat: 22.627, lon: 120.301, out: true },
  { name: "Hualien", lat: 23.9739, lon: 121.6014, out: true },
  { name: "strait-east-of-median", lat: 24.5, lon: 119.9, out: true },
  { name: "strait-on-median", lat: 24.5, lon: 119.5, out: true },
  { name: "strait-west-of-median", lat: 24.5, lon: 119.4, out: false },
  { name: "Penghu-Magong", lat: 23.5712, lon: 119.5794, out: true },
  { name: "Kinmen", lat: 24.4329, lon: 118.3171, out: true },
  { name: "Matsu-Nangan", lat: 26.1506, lon: 119.931, out: true },

  // East / Yellow Sea beyond coastal waters — must not tint toward Kyushu
  { name: "ECS-mid", lat: 28.0, lon: 125.0, out: true },
  { name: "ECS-near-Kyushu", lat: 31.0, lon: 128.0, out: true },
  { name: "Yellow-Sea-mid", lat: 36.0, lon: 124.8, out: true },
  { name: "KADIZ-west-wedge", lat: 37.5, lon: 123.95, out: true },
  { name: "Taiwan-ADIZ-NE", lat: 28.5, lon: 122.8, out: true },
  { name: "Japan-ADIZ-ECS", lat: 28.0, lon: 123.1, out: true },
  { name: "Taiwan-ADIZ-ECS-lobe", lat: 28.0, lon: 122.8, out: true },
  { name: "Kagoshima", lat: 31.59, lon: 130.55, out: true },
  { name: "Naha", lat: 26.2124, lon: 127.6809, out: true },
  { name: "Yonaguni", lat: 24.4558, lon: 122.9885, out: true },
  { name: "Narai-juku", lat: 35.964, lon: 137.571, out: true },
  { name: "Osaka", lat: 34.69, lon: 135.5, out: true },

  { name: "Kashgar", lat: 39.47, lon: 75.99, out: false },
  { name: "Urumqi", lat: 43.825, lon: 87.617, out: false },
  { name: "Turpan", lat: 42.951, lon: 89.189, out: false },
  { name: "Hami", lat: 42.819, lon: 93.515, out: false },
  { name: "Yining-Ili", lat: 43.917, lon: 81.324, out: false },
  { name: "Khorgas", lat: 44.214, lon: 80.418, out: false },
  { name: "Bole-Bortala", lat: 44.85, lon: 82.07, out: false },
  { name: "Lhasa", lat: 29.65, lon: 91.17, out: false },
  { name: "Purang-Tibet", lat: 30.29, lon: 81.17, out: false },
  { name: "Dehradun-Uttarakhand", lat: 30.3165, lon: 78.0322, out: true },
  { name: "Nainital", lat: 29.3803, lon: 79.4636, out: true },
  { name: "Aligarh-UP", lat: 27.88, lon: 78.08, out: true },

  // SE Asia / Indian Ocean — must stay outside (inclusion model)
  { name: "Beibu-gulf-tonkin", lat: 20.0, lon: 108.0, out: true },
  { name: "Tonkin-strip", lat: 20.0, lon: 106.5, out: true },
  { name: "Bangkok", lat: 13.75, lon: 100.5, out: true },
  { name: "Chiang-Mai", lat: 18.79, lon: 98.98, out: true },
  { name: "Kuala-Lumpur", lat: 3.14, lon: 101.69, out: true },
  { name: "Maldives-Male", lat: 4.175, lon: 73.509, out: true },
  { name: "Kyushu-west-sea", lat: 32.5, lon: 128.7, out: true },
  { name: "Taiwan-SE-sea", lat: 21.5, lon: 121.8, out: true },
  { name: "NK-east-enclave", lat: 41.5, lon: 131.0, out: true },
  { name: "NK-east-gap-39.75", lat: 39.75, lon: 129.5, out: true },

  // Korea
  { name: "Pyongyang", lat: 39.039, lon: 125.762, out: true },
  { name: "Wonsan", lat: 39.15, lon: 127.45, out: true },
  { name: "Chongjin", lat: 41.79, lon: 129.79, out: true },
  { name: "NK-east-nearshore", lat: 41.0, lon: 130.2, out: true },
  { name: "Sinuiju", lat: 40.1, lon: 124.6, out: true },
  { name: "Kimchaek", lat: 40.67, lon: 129.2, out: true },
  { name: "Hyesan", lat: 41.4, lon: 128.17, out: true },
  { name: "Seoul", lat: 37.566, lon: 126.978, out: true },
  { name: "Busan", lat: 35.18, lon: 129.08, out: true },

  // Vietnam / SE Asia
  { name: "Hanoi", lat: 21.028, lon: 105.854, out: true },
  { name: "Da-Nang", lat: 16.05, lon: 108.2, out: true },
  { name: "Ho-Chi-Minh", lat: 10.82, lon: 106.63, out: true },
  { name: "Mong-Cai", lat: 21.5307043, lon: 107.9581901, out: true },

  // South Asia
  { name: "Dhaka", lat: 23.81, lon: 90.41, out: true },
  { name: "Kolkata", lat: 22.57, lon: 88.36, out: true },
  { name: "Guwahati", lat: 26.14, lon: 91.74, out: true },
  { name: "Delhi", lat: 28.61, lon: 77.21, out: true },
  { name: "Kathmandu", lat: 27.717, lon: 85.324, out: true },
  { name: "Pokhara", lat: 28.21, lon: 83.99, out: true },
  { name: "Mustang", lat: 29.18, lon: 83.96, out: true },

  // Russia / Mongolia
  { name: "Blagoveshchensk", lat: 50.29, lon: 127.54, out: true },
  { name: "Vladivostok", lat: 43.115, lon: 131.885, out: true },
  { name: "Khabarovsk", lat: 48.48, lon: 135.07, out: true },
  { name: "Chita", lat: 52.03, lon: 113.5, out: true },
  { name: "Ulaanbaatar", lat: 47.8864, lon: 106.9057, out: true },
  { name: "Sainshand", lat: 44.882, lon: 110.137, out: true },
  { name: "Zamyn-Uud", lat: 43.728, lon: 111.902, out: true },
  { name: "Dalanzadgad", lat: 43.57, lon: 104.426, out: true },
  { name: "Choibalsan", lat: 48.078, lon: 114.535, out: true },
  { name: "Baruun-Urt", lat: 46.681, lon: 113.279, out: true },
  { name: "Erenhot", lat: 43.668, lon: 111.977, out: false },
];

/** Viewports for live coverage sweeps at z≥7 (map mode). */
const BORDER_SWEEPS = [
  {
    id: "taiwan-strait",
    href: "https://www.google.com/maps/@24.5,119.7,7z",
    // West of median should tint; east (Taiwan) must stay clear.
    expectTeal: true,
    clearSamples: [
      { lat: 25.03, lon: 121.57 }, // Taipei
      { lat: 24.5, lon: 120.5 }
    ],
    tintSamples: [
      { lat: 25.5, lon: 119.5 }, // Pingtan side
      { lat: 24.5, lon: 118.1 } // Xiamen side
    ]
  },
  {
    id: "east-china-sea",
    href: "https://www.google.com/maps/@28.5,124.5,7z",
    expectTeal: false,
    clearSamples: [
      { lat: 28.0, lon: 125.0 },
      { lat: 28.0, lon: 123.1 }, // Japan ADIZ west line
      { lat: 28.5, lon: 122.8 }, // Taiwan ADIZ NE lobe
      { lat: 30.0, lon: 126.0 },
      { lat: 31.0, lon: 128.0 }
    ],
    tintSamples: [
      { lat: 30.0, lon: 122.0 }, // near Zhoushan / Ningbo coast
      { lat: 28.8883, lon: 122.275 }, // Yushan Islands
      { lat: 28.0, lon: 121.0 },
      { lat: 27.99, lon: 120.70 } // Wenzhou west of TW ADIZ cut
    ]
  },
  {
    id: "yellow-sea-korea",
    href: "https://www.google.com/maps/@36.5,124.5,7z",
    expectTeal: true,
    clearSamples: [
      { lat: 36.0, lon: 124.8 },
      { lat: 37.5, lon: 123.95 }, // KADIZ west of coarse 124°E box
      { lat: 37.5, lon: 126.9 }, // Seoul
      { lat: 39.0, lon: 125.8 } // Pyongyang
    ],
    tintSamples: [
      { lat: 37.2, lon: 122.4 }, // Rongcheng
      { lat: 36.0, lon: 120.4 } // Qingdao
    ]
  },
  {
    id: "yalu-dandong",
    href: "https://www.google.com/maps/@40.2,125.2,7z",
    expectTeal: true,
    clearSamples: [
      { lat: 39.04, lon: 125.76 },
      { lat: 40.1, lon: 124.6 },
      { lat: 41.8, lon: 129.8 }
    ],
    tintSamples: [
      { lat: 40.12, lon: 124.38 },
      { lat: 41.0, lon: 122.0 } // inland Liaoning
    ]
  },
  {
    id: "vietnam-border",
    href: "https://www.google.com/maps/@21.8,106.5,7z",
    expectTeal: true,
    clearSamples: [
      { lat: 21.03, lon: 105.85 },
      { lat: 21.53, lon: 107.96 },
      { lat: 16.05, lon: 108.2 }
    ],
    tintSamples: [
      { lat: 21.55, lon: 107.97 },
      { lat: 22.8, lon: 108.3 } // Nanning side
    ]
  },
  {
    id: "amur-heihe",
    href: "https://www.google.com/maps/@50.5,127.5,7z",
    expectTeal: true,
    clearSamples: [
      { lat: 50.29, lon: 127.54 },
      { lat: 52.0, lon: 128.0 }
    ],
    tintSamples: [
      { lat: 50.25, lon: 127.49 },
      { lat: 50.245, lon: 127.528 },
      { lat: 49.564, lon: 128.476 }, // Xunke
      { lat: 49.5, lon: 127.0 }
    ]
  },
  {
    id: "gyirong-nepal",
    href: "https://www.google.com/maps/@28.6,85.3,7z",
    expectTeal: true,
    clearSamples: [
      { lat: 27.717, lon: 85.324 }, // Kathmandu
      { lat: 28.21, lon: 83.99 }, // Pokhara
      { lat: 29.18, lon: 83.96 } // Mustang
    ],
    tintSamples: [
      { lat: 28.855, lon: 85.298 }, // Gyirong county
      { lat: 28.393, lon: 85.325 }, // Gyirong town
      { lat: 28.278, lon: 85.370 }, // Gyirong Port
      { lat: 27.975, lon: 85.968 } // Zhangmu
    ]
  },
  {
    id: "daxinganling",
    href: "https://www.google.com/maps/@51.5,124.5,7z",
    expectTeal: true,
    clearSamples: [
      { lat: 50.29, lon: 127.54 }, // Blagoveshchensk
      { lat: 52.0, lon: 128.5 }
    ],
    tintSamples: [
      { lat: 50.411, lon: 124.118 }, // Jiagedaqi
      { lat: 52.34, lon: 124.71 }, // Tahe
      { lat: 51.73, lon: 126.65 }, // Huma
      { lat: 53.48, lon: 122.37 } // Mohe
    ]
  },
  {
    id: "mongolia-south-east",
    href: "https://www.google.com/maps/@45.5,111.0,7z",
    expectTeal: true,
    clearSamples: [
      { lat: 44.882, lon: 110.137 }, // Sainshand
      { lat: 43.728, lon: 111.902 }, // Zamyn-Uud
      { lat: 48.078, lon: 114.535 }, // Choibalsan
      { lat: 43.57, lon: 104.426 } // Dalanzadgad
    ],
    tintSamples: [
      { lat: 43.668, lon: 111.977 }, // Erenhot
      { lat: 43.95, lon: 116.08 }, // Xilinhot
      { lat: 49.6, lon: 117.43 } // Manzhouli
    ]
  },
  {
    id: "hainan-scs",
    href: "https://www.google.com/maps/@18.5,112.0,7z",
    expectTeal: true,
    clearSamples: [
      { lat: 16.5, lon: 112.0 }, // Paracel
      { lat: 15.0, lon: 114.0 },
      { lat: 10.0, lon: 115.0 }
    ],
    tintSamples: [
      { lat: 19.1, lon: 108.65 }, // Dongfang — Hainan west
      { lat: 18.25, lon: 109.5 }, // Sanya
      { lat: 20.04, lon: 110.35 } // Haikou
    ]
  },
  {
    id: "philippine-sea",
    href: "https://www.google.com/maps/@15.0,128.0,7z",
    expectTeal: false,
    clearSamples: [
      { lat: 15.0, lon: 128.0 },
      { lat: 18.0, lon: 130.0 },
      { lat: 8.0, lon: 130.0 }
    ],
    tintSamples: []
  },
  {
    id: "japan-narai",
    href: "https://www.google.com/maps/@35.964,137.571,7z",
    expectTeal: false,
    clearSamples: [
      { lat: 35.964, lon: 137.571 },
      { lat: 34.69, lon: 135.5 },
      { lat: 35.01, lon: 135.77 }
    ],
    tintSamples: []
  },
  {
    id: "bengal-india",
    href: "https://www.google.com/maps/@24.0,90.0,7z",
    expectTeal: false,
    clearSamples: [
      { lat: 23.81, lon: 90.41 },
      { lat: 22.57, lon: 88.36 },
      { lat: 26.14, lon: 91.74 }
    ],
    tintSamples: []
  }
];

module.exports = { BORDER_POINTS, BORDER_SWEEPS };
