// 金額キャッチのデザイン（tools/designer.html の「保存」で書き換わる。手で直してもよい）
// 座標は、写真の枠の右下を (0, 0) とした「デザイン単位」。左・上がマイナス。
// 大きさは fit.scale（写真の幅 1000px あたり、デザイン単位1つを何 px にするか）。
// ただしギザギザの高さが写真の高さの fit.maxH 倍を超えるときは、そこまで縮める。
export const CATCH_DESIGN = {
  "version": 1,
  "fit": {
    "scale": 2.09,
    "maxH": 0.6
  },
  "burst": {
    "points": [
      [-383, -6], [-319, -38], [-367, -94], [-287, -82], [-295, -150], [-223, -114], [-191, -178],
      [-143, -130], [-71, -186], [-55, -122], [1, -154], [1, -6]
    ],
    "fill": "#111111",
    "line": "#ffffff",
    "lineWidth": 8
  },
  "num": {
    "font": "Anton",
    "weight": "400",
    "x": -68,
    "y": -44,
    "size": 140,
    "maxW": 265,
    "slant": 0.21,
    "fill": "#e60012",
    "strokes": [
      { "color": "#111111", "width": 26 },
      { "color": "#ffffff", "width": 12 }
    ]
  },
  "yen": {
    "font": "Noto Sans JP",
    "weight": "900",
    "x": -63,
    "y": -44,
    "size": 50,
    "slant": 0.21,
    "fill": "#e60012",
    "strokes": [
      { "color": "#111111", "width": 16 },
      { "color": "#ffffff", "width": 8 }
    ]
  },
  "tax": {
    "font": "Noto Sans JP",
    "weight": "700",
    "x": -160,
    "y": -15,
    "size": 20,
    "maxW": 330,
    "slant": 0,
    "fill": "#ffffff",
    "strokes": []
  }
};
