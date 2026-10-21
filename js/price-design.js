// 「金額主役」デザインの金額キャッチ（写真の右下に乗せる、黒いギザギザ＋価格＋税込）。
// 見た目の数値・色・書体は catch-design.js（tools/designer.html で編集する）。ここはそれを描くだけ。
// 下の印に挟まれた範囲は、外部のデザイン案（tools/price-kit/）と丸ごと入れ替えることもできる
// （node tools/price-kit/adopt.mjs <返ってきたファイル>）。

import { CATCH_DESIGN } from './catch-design.js';

// ===== ここから: デザイン担当が書き換える範囲 =====
// 使う Google Fonts（デザインの数字・円・税込の書体と太さ。同じものは1つにまとめる）
const PRICE_FONTS = [...new Map(['num', 'yen', 'tax'].map(k => CATCH_DESIGN[k])
  .map(t => [`${t.font}|${t.weight}`, { family: t.font, weight: String(t.weight) }])).values()];

/**
 * キャッチの置き場所: 写真の枠の右下が原点。倍率 k は写真の幅に比例（fit.scale）させ、
 * ギザギザの高さが写真の高さの fit.maxH 倍を超えるときだけ縮める（写真が低いサイズでも収まるように）。
 * 編集画面も同じ計算で、ドラッグの位置をデザインの座標へ直す。
 */
function catchFrame(area, design = CATCH_DESIGN) {
  const bh = Math.max(1, -Math.min(...design.burst.points.map(p => p[1])));
  const k = Math.min(area.w / 1000 * design.fit.scale, area.h * design.fit.maxH / bh);
  return { x: area.x + area.w, y: area.y + area.h, k };
}

/** 文字を、外側の縁取りから順に重ねて描く（strokes の先頭がいちばん外）。slant は右上がりの傾き。 */
function layeredText(ctx, text, t, align, scale = 1) {
  const size = t.size * scale;
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.transform(1, 0, -t.slant, 1, 0, 0);
  ctx.font = `${t.weight} ${size}px "${t.font}", "Hiragino Sans", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  for (const s of t.strokes) {
    if (!s.width) continue;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width * scale;   // 文字を縮めたときは縁取りも同じ割合で細くする
    ctx.strokeText(text, 0, 0);
  }
  ctx.fillStyle = t.fill;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** maxW に収まる倍率（収まるなら 1）。 */
function fitScale(ctx, text, t) {
  ctx.font = `${t.weight} ${t.size}px "${t.font}", "Hiragino Sans", sans-serif`;
  const w = ctx.measureText(text).width;
  return w > t.maxW ? t.maxW / w : 1;
}

/**
 * 金額キャッチを area（写真の枠）の右下に描く。はみ出す分は枠で切る（ギザギザは枠の端に掛かる形）。
 * price.main … 大きく出す数字（"298" "1,980" などカンマ入り）
 * price.incl … 税抜で入れたときの税込額（"321.84"）。税込で入れたときは ""
 * u          … 倍率（幅1080pxの画像で 1）。このデザインは枠の大きさに比例させるので使わない
 * design     … 省略時は catch-design.js（編集画面は編集中のものを渡す）
 */
function drawPrice(ctx, area, price, u, design = CATCH_DESIGN) {
  void u;
  const f = catchFrame(area, design);
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.w, area.h);
  ctx.clip();
  ctx.translate(f.x, f.y);
  ctx.scale(f.k, f.k);

  const b = design.burst;
  ctx.beginPath();
  b.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = b.fill;
  ctx.fill();
  if (b.lineWidth) {
    ctx.lineJoin = 'miter';
    ctx.lineWidth = b.lineWidth;
    ctx.strokeStyle = b.line;
    ctx.stroke();
  }

  // 数字は右揃え（桁が増えると左へ伸びる）。最大幅を超えたら縮める。「円」は左揃えで数字の右に固定
  layeredText(ctx, price.main, design.num, 'right', fitScale(ctx, price.main, design.num));
  layeredText(ctx, '円', design.yen, 'left');

  // 税込の併記（総額表示。税込で入れたときは「(税込)」とだけ）。中央揃え
  const tax = price.incl ? `(税込${price.incl}円)` : '(税込)';
  layeredText(ctx, tax, design.tax, 'center', fitScale(ctx, tax, design.tax));
  ctx.restore();
}
// ===== ここまで: デザイン担当が書き換える範囲 =====

// 編集画面が使う（外部の案に入れ替えて無くなっていても、アプリは動くようにする）
const frameFn = typeof catchFrame === 'function' ? catchFrame : null;
export { PRICE_FONTS, drawPrice, frameFn as catchFrame };
