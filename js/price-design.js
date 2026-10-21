// 「金額主役」デザインの価格部分（数字・円・税の表記）。
// 下の印に挟まれた範囲だけを、外部のデザイン案（tools/price-kit/）と丸ごと入れ替える。
// 入れ替えは node tools/price-kit/adopt.mjs <返ってきたファイル> で行う（手で貼らない）。

// ===== ここから: デザイン担当が書き換える範囲 =====
// 使う Google Fonts（family は Google Fonts の名前どおり、weight は '400' や '700'）
const PRICE_FONTS = [
  { family: 'Dela Gothic One', weight: '400' },
];

/**
 * 価格を area の中に描く。
 * price.main … 大きく出す数字（"298" "1,980" などカンマ入り）
 * price.incl … 税抜で入れたときの税込額（"321.84"）。税込で入れたときは ""
 * u          … 倍率（幅1080pxの画像で 1）
 */
function drawPrice(ctx, area, price, u) {
  const RED = '#e60012', INK = '#1a1a1a';
  const font = s => `400 ${Math.round(s)}px "Dela Gothic One", sans-serif`;
  const width = (t, s) => { ctx.font = font(s); return ctx.measureText(t).width; };
  const right = area.x + area.w, bottom = area.y + area.h;
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // 税込の併記（右下）。税抜で入れたときは税込額、税込で入れたときは「税込」とだけ
  const note = price.incl ? `（税込 ${price.incl}円）` : '（税込）';
  const noteSize = Math.max(24 * u, Math.min(46 * u, 46 * u * area.w * 0.7 / width(note, 46 * u)));
  ctx.font = font(noteSize);
  ctx.textAlign = 'right';
  ctx.fillStyle = INK;
  ctx.fillText(note, right, bottom - noteSize * 0.15);

  // 数字: 入る限り大きく。「円」は赤い四角に白抜き
  const yenK = 0.34, gapK = 0.06;
  const byWidth = area.w / (width(price.main, 100) / 100 + yenK + gapK + 0.12);
  const byHeight = bottom - noteSize * 1.3 - area.y;
  const size = Math.max(40 * u, Math.min(360 * u, byWidth, byHeight));
  const base = area.y + size * 0.86;
  const yen = size * yenK;
  const yenX = right - yen - 4 * u;

  ctx.font = font(size);
  ctx.textAlign = 'right';
  ctx.lineJoin = 'round';
  const x = yenX - size * gapK;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = size * 0.16 + 6 * u;
  ctx.strokeText(price.main, x, base);
  ctx.strokeStyle = INK;
  ctx.lineWidth = size * 0.07;
  ctx.strokeText(price.main, x, base);
  ctx.fillStyle = RED;
  ctx.fillText(price.main, x, base);

  ctx.beginPath();
  ctx.rect(yenX, base - yen * 1.05, yen, yen * 1.05);
  ctx.fillStyle = RED;
  ctx.fill();
  ctx.lineWidth = 4 * u;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = font(yen * 0.8);
  ctx.fillText('円', yenX + yen / 2, base - yen * 0.2);
  if (price.incl) {
    // 大きい数字が税抜であることを、円の上に小さく示す
    ctx.font = font(yen * 0.42);   // 円の箱に比例させる（下限を付けると狭い範囲で上へはみ出す）
    ctx.fillStyle = INK;
    ctx.fillText('税抜', yenX + yen / 2, base - yen * 1.05 - 10 * u);
  }
  ctx.restore();
}
// ===== ここまで: デザイン担当が書き換える範囲 =====

export { PRICE_FONTS, drawPrice };
