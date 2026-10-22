// 「金額主役」の 産地・商品名・数量と単位 の3行のデザイン（tools/designer.html の「保存」で書き換わる。手で直してもよい）
// 座標は、写真の枠の左下を (0, 0) とした「デザイン単位」（幅1080pxの画像で 1 単位＝1px）。右・下がプラス。
// x, y は1行目の文字の基準点（align の位置・文字の下端の線）。
// size は最大の大きさ。maxW を超えると maxLines まで折り返し、それでも入らなければ minSize まで縮める。
// unit.follow が true のときは、x, y は「商品名の最後の行の終わり」からのずれ（名前の長さに付いていく）。
export const LABEL_DESIGN = {
  "version": 1,
  "origin": {
    "font": "Zen Maru Gothic",
    "weight": "700",
    "x": 44,
    "y": -36,
    "size": 36,
    "minSize": 24,
    "maxW": 600,
    "maxLines": 1,
    "align": "left",
    "slant": 0,
    "fill": "#ffffff",
    "strokes": [],
    "bg": {
      "fill": "#2e7d32",
      "padX": 24,
      "padY": 11,
      "radius": 29
    },
    "prefix": "",
    "suffix": ""
  },
  "name": {
    "font": "Dela Gothic One",
    "weight": "400",
    "x": 10,
    "y": 108,
    "size": 104,
    "minSize": 56,
    "maxW": 840,
    "maxLines": 2,
    "align": "left",
    "slant": 0,
    "fill": "#1a1a1a",
    "strokes": [],
    "bg": null,
    "prefix": "",
    "suffix": ""
  },
  "unit": {
    "font": "Dela Gothic One",
    "weight": "400",
    "follow": true,
    "x": 6,
    "y": 0,
    "size": 40,
    "minSize": 24,
    "maxW": 220,
    "maxLines": 1,
    "align": "left",
    "slant": 0,
    "fill": "#1a1a1a",
    "strokes": [],
    "bg": null,
    "prefix": "〈",
    "suffix": "〉"
  }
};
