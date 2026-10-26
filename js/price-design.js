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
 * キャッチの置き場所: 写真の枠の右下が原点。倍率 k は写真の幅に比例（fit.scale）させる。
 * 写真がとても横長（高さが幅の半分未満）のときだけ、高さに合わせて縮める。
 * 部品の形には左右されない（背景を大きくしたら数字まで縮む、ということが起きないように）。
 * 編集画面も同じ計算で、ドラッグの位置をデザインの座標へ直す。
 */
function catchFrame(area, design = CATCH_DESIGN) {
  const k = Math.min(area.w, area.h * 2) / 1000 * design.fit.scale;
  return { x: area.x + area.w, y: area.y + area.h, k };
}

// 税込の小数（".84"）は2段小さく。「各」は数字の4分の1の大きさで、数字の左下に重ねる（数字より手前）
const DECIMAL_SMALL = 0.7, EACH_SMALL = 0.25;

/** 小数の部分（".84"）だけ小さくするための分け方。[{ text, k }]（k＝大きさの倍率）。 */
function splitSmall(text) {
  const m = /\.\d+/.exec(text);
  if (!m) return [{ text, k: 1 }];
  return [
    { text: text.slice(0, m.index), k: 1 },
    { text: m[0], k: DECIMAL_SMALL },
    { text: text.slice(m.index + m[0].length), k: 1 },
  ].filter(s => s.text);
}

/** 文字を、外側の縁取りから順に重ねて描く（strokes の先頭がいちばん外）。slant は右上がりの傾き。小数は小さく描く。 */
function layeredText(ctx, text, t, align, scale = 1) {
  const fontOf = k => `${t.weight} ${t.size * scale * k}px "${t.font}", "Hiragino Sans", sans-serif`;
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.transform(1, 0, -t.slant, 1, 0, 0);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  const segs = splitSmall(text).map(s => { ctx.font = fontOf(s.k); return { ...s, w: ctx.measureText(s.text).width }; });
  const total = segs.reduce((a, s) => a + s.w, 0);
  let x = align === 'right' ? -total : align === 'center' ? -total / 2 : 0;
  for (const s of segs) { s.x = x; x += s.w; }
  const each = fn => segs.forEach(s => { ctx.font = fontOf(s.k); fn(s); });
  for (const st of t.strokes) {   // 縁取りを全部の字に引いてから塗る（隣の字の塗りを縁取りで消さない）
    if (!st.width) continue;
    ctx.strokeStyle = st.color;
    ctx.lineWidth = st.width * scale;   // 文字を縮めたときは縁取りも同じ割合で細くする
    each(s => ctx.strokeText(s.text, s.x, 0));
  }
  ctx.fillStyle = t.fill;
  each(s => ctx.fillText(s.text, s.x, 0));
  ctx.restore();
}

/** 「各」を、数字（右揃え）の左端の下に、数字の4分の1の大きさで重ねる。 */
function drawEach(ctx, price, design) {
  const t = design.num, text = TEXT_PARTS.num.text(price), scale = fitScale(ctx, text, t);
  ctx.font = `${t.weight} ${t.size * scale}px "${t.font}", "Hiragino Sans", sans-serif`;
  const left = t.x - ctx.measureText(text).width;
  layeredText(ctx, '各', { ...t, x: left }, 'left', scale * EACH_SMALL);
}

/** maxW に収まる倍率（収まるなら 1）。 */
function fitScale(ctx, text, t) {
  ctx.font = `${t.weight} ${t.size}px "${t.font}", "Hiragino Sans", sans-serif`;
  const w = ctx.measureText(text).width;
  return w > t.maxW ? t.maxW / w : 1;
}

// キャッチの部品。order（重なり順。先頭がいちばん奥）が無い・壊れているときはこの順
const PART_KEYS = ['burst', 'num', 'yen', 'tax'];
function partOrder(design) {
  const o = design.order;
  return Array.isArray(o) && o.length === PART_KEYS.length && PART_KEYS.every(k => o.includes(k)) ? o : PART_KEYS;
}

// 文字の部品: 何を書くか・どこを基準に揃えるか・最大幅で縮めるか
// 数字は右揃え（桁が増えると左へ伸びる）。税込の併記は総額表示のため必ず描く（税込で入れたときは「(税込)」）
const TEXT_PARTS = {
  num: { text: price => price.main, align: 'right', fit: true },
  yen: { text: () => '円', align: 'left', fit: false },
  tax: { text: price => (price.incl ? `(税込${price.incl}円)` : '(税込)'), align: 'center', fit: true },
};

function drawBurst(ctx, b) {
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
}

/**
 * 部品が占める範囲（デザイン単位）。poly は傾きを含めた外形、box はそれを囲む長方形。
 * 編集画面がクリックの当たり判定と、選んだ部品の枠に使う。
 */
function partBounds(ctx, key, design, price) {
  if (key === 'burst') {
    const b = design.burst, pad = b.lineWidth / 2;
    const xs = b.points.map(p => p[0]), ys = b.points.map(p => p[1]);
    const box = { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
    return { poly: b.points, box };
  }
  const t = design[key], spec = TEXT_PARTS[key], text = spec.text(price);
  const scale = spec.fit ? fitScale(ctx, text, t) : 1;
  ctx.save();
  ctx.font = `${t.weight} ${t.size * scale}px "${t.font}", "Hiragino Sans", sans-serif`;
  ctx.textAlign = spec.align;
  const m = ctx.measureText(text);
  ctx.restore();
  const pad = Math.max(0, ...t.strokes.map(s => s.width)) * scale / 2;
  const l = -m.actualBoundingBoxLeft - pad, r = m.actualBoundingBoxRight + pad;
  const top = -m.actualBoundingBoxAscent - pad, bottom = m.actualBoundingBoxDescent + pad;
  // 描くときと同じ傾け方（x を -slant×y ずらす）をして、基準点の位置へ動かす
  const poly = [[l, top], [r, top], [r, bottom], [l, bottom]].map(([x, y]) => [t.x + x - t.slant * y, t.y + y]);
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  return { poly, box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } };
}

/**
 * 金額キャッチを area（写真の枠）の右下に描く。はみ出す分は枠で切る（ギザギザは枠の端に掛かる形）。
 * price.main … 大きく出す数字（"298" "1,980" などカンマ入り）
 * price.incl … 税抜で入れたときの税込額（"321.84"）。税込で入れたときは ""。小数（".84"）は小さく描く
 * price.each … true なら数字の左下に「各」を重ねる（数字の4分の1の大きさ）
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
  for (const key of partOrder(design)) {   // 重なり順（後に描くものが手前）
    if (key === 'burst') { drawBurst(ctx, design.burst); continue; }
    const spec = TEXT_PARTS[key], t = design[key], text = spec.text(price);
    layeredText(ctx, text, t, spec.align, spec.fit ? fitScale(ctx, text, t) : 1);
  }
  if (price.each) drawEach(ctx, price, design);   // いちばん手前
  ctx.restore();
}
// ===== ここまで: デザイン担当が書き換える範囲 =====

// 編集画面が使う（外部の案に入れ替えて無くなっていても、アプリは動くようにする）
const editorApi = typeof catchFrame === 'function' && typeof partBounds === 'function' && typeof partOrder === 'function'
  ? { catchFrame, partBounds, partOrder } : null;
export { PRICE_FONTS, drawPrice, editorApi };
