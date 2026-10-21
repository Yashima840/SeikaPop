// 「金額主役」デザインの金額キャッチ（写真の右下に乗せる、黒いギザギザ＋価格＋税込）。
// 下の印に挟まれた範囲だけを、外部のデザイン案（tools/price-kit/）と丸ごと入れ替えられる。
// 入れ替えは node tools/price-kit/adopt.mjs <返ってきたファイル> で行う（手で貼らない）。

// ===== ここから: デザイン担当が書き換える範囲 =====
// 使う Google Fonts（family は Google Fonts の名前どおり、weight は '400' や '700'）
// 元の案は Impact・メイリオ だが、どちらもスマホに無いので近いものに置き換えている
const PRICE_FONTS = [
  { family: 'Anton', weight: '400' },          // Impact に近い縦長の極太数字
  { family: 'Noto Sans JP', weight: '900' },   // 「円」
  { family: 'Noto Sans JP', weight: '700' },   // 税込の併記
];

// 元の案（pop_design.svg, 600×300）の座標を、絵の右下 (600, 300) を原点にして写したもの。
// ギザギザは SVG の translate(-1,16) scale(0.8)（中心 410,190）を当て済み。
const CATCH = {
  burst: [[-383, -6], [-319, -38], [-367, -94], [-287, -82], [-295, -150], [-223, -114], [-191, -178],
    [-143, -130], [-71, -186], [-55, -122], [1, -154], [1, -6]],
  burstLine: 8,                                      // ギザギザの白い縁（10 × 0.8）
  baseY: -44,                                        // 数字と「円」の下端（文字の基準線）
  numRight: -68, numSize: 140, numMaxW: 265,         // 数字は右揃え。これより長いと縮める（帯の左端に掛からない幅）
  yenLeft: -63, yenSize: 50,
  numStroke: [26, 12], yenStroke: [16, 8],           // 縁取り（外の黒、内の白）の太さ
  slant: 0.21,                                       // 斜体の傾き（約12°）
  taxX: -160, taxY: -15, taxSize: 20, taxMaxW: 330,  // 税込の併記（中央揃え・白抜き）
  width: 384, height: 186,                           // キャッチ全体の大きさ（倍率を決めるのに使う）
};

/**
 * 金額キャッチを area（写真の枠）の右下に描く。はみ出す分は枠で切る（ギザギザは枠の端に掛かる形）。
 * price.main … 大きく出す数字（"298" "1,980" などカンマ入り）
 * price.incl … 税抜で入れたときの税込額（"321.84"）。税込で入れたときは ""
 * u          … 倍率（幅1080pxの画像で 1）。この案は枠の大きさに比例させるので使わない
 */
function drawPrice(ctx, area, price, u) {
  void u;
  const C = CATCH;
  // 枠の幅の8割・高さの6割に収まる倍率
  const k = Math.min(area.w * 0.8 / C.width, area.h * 0.6 / C.height);
  const ox = area.x + area.w, oy = area.y + area.h;
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.w, area.h);
  ctx.clip();
  ctx.translate(ox, oy);
  ctx.scale(k, k);

  // 黒いギザギザ（白い縁）
  ctx.beginPath();
  C.burst.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = '#111';
  ctx.fill();
  ctx.lineJoin = 'miter';
  ctx.lineWidth = C.burstLine;
  ctx.strokeStyle = '#fff';
  ctx.stroke();

  // 数字と「円」: 外から 黒の太い縁 → 白の縁 → 赤 の3重。基準線を軸に右へ傾けて斜体にする
  const numFont = s => `400 ${s}px "Anton", "Impact", sans-serif`;
  ctx.font = numFont(C.numSize);
  const w = ctx.measureText(price.main).width;
  const numSize = w > C.numMaxW ? C.numSize * C.numMaxW / w : C.numSize;   // 長い数字は左へ伸ばさず縮める
  // shrink: 文字を縮めたときは縁取りも同じ割合で細くする
  const layered = (text, x, strokes, shrink = 1) => {
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = strokes[0] * shrink;
    ctx.strokeText(text, x, 0);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = strokes[1] * shrink;
    ctx.strokeText(text, x, 0);
    ctx.fillStyle = '#e60012';
    ctx.fillText(text, x, 0);
  };
  ctx.save();
  ctx.translate(0, C.baseY);
  ctx.transform(1, 0, -C.slant, 1, 0, 0);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'right';
  ctx.font = numFont(numSize);
  layered(price.main, C.numRight, C.numStroke, numSize / C.numSize);
  ctx.textAlign = 'left';
  ctx.font = `900 ${C.yenSize}px "Noto Sans JP", "Hiragino Sans", sans-serif`;
  layered('円', C.yenLeft, C.yenStroke);
  ctx.restore();

  // 税込の併記（総額表示。税込で入れたときは「(税込)」とだけ）
  const tax = price.incl ? `(税込${price.incl}円)` : '(税込)';
  ctx.font = `700 ${C.taxSize}px "Noto Sans JP", "Hiragino Sans", sans-serif`;
  const tw = ctx.measureText(tax).width;
  if (tw > C.taxMaxW) ctx.font = `700 ${C.taxSize * C.taxMaxW / tw}px "Noto Sans JP", "Hiragino Sans", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.fillText(tax, C.taxX, C.taxY);
  ctx.restore();
}
// ===== ここまで: デザイン担当が書き換える範囲 =====

export { PRICE_FONTS, drawPrice };
