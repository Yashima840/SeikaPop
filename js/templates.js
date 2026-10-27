// ポップのデザイン（テンプレート）。
// 各テンプレートは photoBox(W, H, pop, measure)＝写真を敷く枠（pop・measure は「金額主役」だけが使う） と draw(ctx, d)＝描画 を持つ。
// 大きさは幅1080px を基準にした u（W/1080）で書き、縦の長さ（H）に合わせて写真の枠を伸ばす。

import { coverSource, fitFontSize, layoutLines, seededRandom } from './layout.js';
import { splitDecimal, taxNote } from './model.js';
import { VINTAGE } from './image.js';
import { drawPrice } from './price-design.js';
import { canvasMeasure, drawLabels, labelDesignFor, labelsBelow } from './labels.js';

const FALLBACK = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif';
export const FONTS = {
  impact: { family: 'Dela Gothic One', weight: '400' },   // 太い見出し
  marker: { family: 'Yusei Magic', weight: '400' },       // マジックで書いた字
  round: { family: 'Zen Maru Gothic', weight: '700' },    // やわらかい本文
  roundM: { family: 'Zen Maru Gothic', weight: '500' },
  mincho: { family: 'Zen Old Mincho', weight: '700' },    // 上品な見出し
};

export function font(f, size) {
  const fb = f === FONTS.mincho ? `"Hiragino Mincho ProN", "Yu Mincho", serif` : FALLBACK;
  return `${f.weight} ${Math.round(size)}px "${f.family}", ${fb}`;
}

export function measurer(ctx, f) {
  return (t, s) => { ctx.font = font(f, s); return ctx.measureText(t).width; };
}

export function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * 写真を枠いっぱいに敷く。写真が無ければ false（呼び出し側が代わりを描く）。
 * fx.fade＝外周フェードの色（[r, g, b]。写真のまわりの下地の色）。fx.vignette＝周辺減光の強さ（0〜1。四隅の暗さ）。
 */
function drawPhoto(ctx, photo, box, crop, radius = 0, fx = {}) {
  if (!photo) return false;
  const s = coverSource(photo.width, photo.height, box.w, box.h, crop);
  ctx.save();
  if (radius) { roundRectPath(ctx, box.x, box.y, box.w, box.h, radius); ctx.clip(); }
  ctx.drawImage(photo, s.sx, s.sy, s.sw, s.sh, box.x, box.y, box.w, box.h);
  if (fx.vignette) drawFade(ctx, box, [0, 0, 0], 0.55, fx.vignette * 0.4, fx.vignette);
  if (fx.fade) drawFade(ctx, box, fx.fade, 0.78, 0.6, 1);
  ctx.restore();
  return true;
}

/**
 * 枠の外周を色へ寄せる。枠の形に合わせた楕円で、inner より内はそのまま、辺の中央で mid、角で edge の濃さになる。
 * 楕円は「半径1の円」を枠の半分の幅・高さへ引き伸ばして作る（1＝辺の中央、√2＝角）。
 */
function drawFade(ctx, box, [r, g, b], inner, mid, edge) {
  const outer = Math.SQRT2;
  const at = v => (v - inner) / (outer - inner);
  const grad = ctx.createRadialGradient(0, 0, inner, 0, 0, outer);
  grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
  grad.addColorStop(at(1), `rgba(${r},${g},${b},${mid})`);
  grad.addColorStop(1, `rgba(${r},${g},${b},${edge})`);
  ctx.save();
  ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
  ctx.scale(box.w / 2, box.h / 2);
  ctx.fillStyle = grad;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

/**
 * ポップで選んだ写真の仕上げのうち、枠に収めた後で描くもの。rgb＝外周フェードで寄せる下地の色。
 * フィルム風の周辺減光（-15）は、四隅を 3 割ほど暗くする。
 */
const fxOf = (pop, rgb) => ({
  fade: pop.photoFade ? rgb : null,
  vignette: pop.photoVintage ? -VINTAGE.vignette / 50 : 0,
});

function drawNoPhoto(ctx, box, colors, d, radius = 0) {
  ctx.save();
  if (radius) { roundRectPath(ctx, box.x, box.y, box.w, box.h, radius); ctx.clip(); }
  const g = ctx.createLinearGradient(box.x, box.y, box.x + box.w, box.y + box.h);
  g.addColorStop(0, colors[0]);
  g.addColorStop(1, colors[1]);
  ctx.fillStyle = g;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  if (d.preview) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = font(FONTS.round, 48 * d.u);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📷 写真を追加', box.x + box.w / 2, box.y + box.h / 2);
  }
  ctx.restore();
}

function fillLines(ctx, lines, x, y, lineH) {
  lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * lineH));
}

// 税込の小数（".84"）は、ほかの文字より2段小さく描く
const DECIMAL_SMALL = 0.7;
// 「各」は「円」の8割の大きさで、数字の左下に重ねる（数字より手前）
const EACH_OF_YEN = 0.8;
// 写真の角の丸み（1080幅のとき）。写真が画像の端まである「写真主役」「シンプル上品」は角を丸めない
const PHOTO_RADIUS = 24;

/**
 * 小数の部分だけ小さくして1行を描く。paint(text, x, y, f, size) は左揃えで1つ描く関数。
 * align は x をどこに合わせるか（left・center・right）。
 */
function paintMixed(ctx, text, x, y, f, size, align, paint) {
  const segs = splitDecimal(text).map(s => ({ ...s, size: s.small ? size * DECIMAL_SMALL : size }));
  const widths = segs.map(s => { ctx.font = font(f, s.size); return ctx.measureText(s.text).width; });
  const total = widths.reduce((a, b) => a + b, 0);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  ctx.save();
  ctx.textAlign = 'left';
  segs.forEach((s, i) => { paint(s.text, cx, y, f, s.size); cx += widths[i]; });
  ctx.restore();
}

/**
 * 「各」を、x＝数字の左端 から「各」の大きさの半分だけ左・y＝基準の線 に重ねる。
 * 数字と同じ色なので、halo（下地の色）で縁取って数字から浮かせる。
 */
function paintEach(ctx, x, y, f, size, color, halo) {
  ctx.save();
  ctx.font = font(f, size);
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  x -= size / 2;
  ctx.lineWidth = size * 0.3;
  ctx.strokeStyle = halo;
  ctx.strokeText('各', x, y);
  ctx.fillStyle = color;
  ctx.fillText('各', x, y);
  ctx.restore();
}

function withShadow(ctx, blur, color, fn) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = blur / 4;
  fn();
  ctx.restore();
}

/**
 * 価格（数字＋「円」）と、その上の単位・下の税の文字を中心 (cx, cy) へ置く。
 * 価格は総額表示（税込）が義務なので、税込（税抜で入れたときは税込の金額）を必ず添える。
 * st.halo＝価格の下地の色（「各」の縁取りに使う）。
 */
function drawPriceBlock(ctx, d, cx, cy, maxW, st) {
  const { pop, u } = d;
  const num = d.price.main;
  const mNum = measurer(ctx, st.font);
  const yenK = 0.42;
  const both = (t, s) => mNum(t, s) + mNum('円', s * yenK) + s * 0.04;
  const size = Math.min(st.maxSize, Math.floor(st.maxSize * maxW / both(num, st.maxSize)));
  const wNum = mNum(num, size);
  const wAll = both(num, size);
  const left = cx - wAll / 2;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const base = cy + size * 0.36;
  const paint = (text, x, y, f, s) => {
    ctx.font = font(f, s);
    if (st.stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = st.strokeW * u;
      ctx.strokeStyle = st.stroke;
      ctx.strokeText(text, x, y);
    }
    ctx.fillText(text, x, y);
  };
  ctx.fillStyle = st.color;
  paint(num, left, base, st.font, size);
  if (d.price.each) paintEach(ctx, left, base, st.font, size * yenK * EACH_OF_YEN, st.color, st.halo || '#fff');
  paint('円', left + wNum + size * 0.04, base, st.font, size * yenK);
  ctx.textAlign = 'center';
  ctx.fillStyle = st.subColor || st.color;
  const sub = Math.max(38 * u, size * 0.3);
  if (pop.unit) paint(pop.unit, cx, cy - size * 0.55, st.subFont || FONTS.round, sub);
  const note = taxNote(d.price);
  const subFont = st.subFont || FONTS.round;
  paintMixed(ctx, note, cx, base + sub * 1.25, subFont, fitFontSize(note, maxW * 0.92, measurer(ctx, subFont), sub * 0.85, 18 * u), 'center', paint);
  ctx.restore();
}

/** 「写真主役」の金額を台紙の絵の上に描く。nameTop は商品名の上端（台紙はその上の右に置く）。 */
function drawBadgePrice(ctx, d, nameTop) {
  const { W, u, priceBadge: b } = d;
  const bw = Math.min(500, 560 * b.aspect) * u, bh = bw / b.aspect;   // 縦長の台紙は高さで抑える
  const x = W - 40 * u - bw, top = Math.max(150 * u, nameTop - bh);
  withShadow(ctx, 24 * u, 'rgba(0,0,0,0.4)', () => ctx.drawImage(b.img, x, top, bw, bh));
  const cx = x + bw * b.text.cx, cy = top + bh * b.text.cy, maxW = bw * b.text.w;
  let color = b.color;
  if (color === 'gold') {
    // 数字の高さ（だいたい maxW の半分）に合わせた、上が明るい金
    color = ctx.createLinearGradient(0, cy - maxW * 0.3, 0, cy + maxW * 0.2);
    color.addColorStop(0, '#fff6c8');
    color.addColorStop(0.45, '#f5c84c');
    color.addColorStop(1, '#b8861a');
  }
  drawPriceBlock(ctx, d, cx, cy, maxW, { font: FONTS.impact, maxSize: 150 * u, color, subColor: b.sub, halo: '#1e1c1c' });
}

// ------------------------------------------------------------------
// 1. 写真主役（フレッシュ）: 写真を全面に敷き、下に文字・右に価格の丸
// ------------------------------------------------------------------
const fresh = {
  id: 'fresh',
  label: '写真主役',
  photoBox: (W, H) => ({ x: 0, y: 0, w: W, h: H }),
  draw(ctx, d) {
    const { W, H, u, pop } = d;
    const box = this.photoBox(W, H);
    // 全面に敷く写真なので、外周フェードは暗い色へ（下の文字が読めるように）
    if (!drawPhoto(ctx, d.photo, box, pop.crop, 0, fxOf(pop, [20, 16, 10]))) drawNoPhoto(ctx, box, ['#5fa052', '#24613a'], d);

    let g = ctx.createLinearGradient(0, 0, 0, 260 * u);
    g.addColorStop(0, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, 260 * u);
    const shadeTop = H - Math.min(H * 0.62, 760 * u);
    g = ctx.createLinearGradient(0, shadeTop, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0.82)');
    ctx.fillStyle = g;
    ctx.fillRect(0, shadeTop, W, H - shadeTop);

    ctx.textBaseline = 'alphabetic';
    if (pop.badge) {
      const l = layoutLines(pop.badge, W - 112 * u - 64 * u, measurer(ctx, FONTS.impact),
        { maxSize: 58 * u, minSize: 34 * u });
      ctx.font = font(FONTS.impact, l.size);
      const tw = ctx.measureText(l.lines[0]).width;
      withShadow(ctx, 16 * u, 'rgba(0,0,0,0.35)', () => {
        roundRectPath(ctx, 48 * u, 48 * u, tw + 64 * u, l.size + 48 * u, 18 * u);
        ctx.fillStyle = '#e53935';
        ctx.fill();
      });
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.fillText(l.lines[0], 80 * u, 48 * u + 24 * u + l.size * 0.86);
    }

    // 下から積む
    const left = 60 * u, maxW = W - 120 * u;
    let y = H - 56 * u;
    ctx.textAlign = 'left';
    if (d.shopName) {
      ctx.font = font(FONTS.round, 32 * u);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(d.shopName, left, y);
      y -= 64 * u;
    }
    if (pop.origin) {
      ctx.font = font(FONTS.round, 36 * u);
      const tw = ctx.measureText(pop.origin).width;
      roundRectPath(ctx, left, y - 44 * u, tw + 48 * u, 58 * u, 29 * u);
      ctx.fillStyle = '#3f8f3a';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(pop.origin, left + 24 * u, y - 2 * u);
      y -= 86 * u;
    }
    const cl = layoutLines(pop.catch, maxW, measurer(ctx, FONTS.round), { maxSize: 48 * u, minSize: 34 * u, maxLines: 2 });
    if (cl.lines.length) {
      ctx.font = font(FONTS.round, cl.size);
      ctx.fillStyle = '#fff';
      const lh = cl.size * 1.35;
      withShadow(ctx, 8 * u, 'rgba(0,0,0,0.6)', () => fillLines(ctx, cl.lines, left, y - (cl.lines.length - 1) * lh, lh));
      y -= cl.lines.length * lh + 14 * u;
    }
    const nf = d.nameFont || FONTS.impact;
    const nl = layoutLines(pop.name, maxW, measurer(ctx, nf), { maxSize: 150 * u, minSize: 72 * u, maxLines: 2 });
    if (nl.lines.length) {
      ctx.font = font(nf, nl.size);
      ctx.fillStyle = '#fff';
      const lh = nl.size * 1.12;
      withShadow(ctx, 14 * u, 'rgba(0,0,0,0.55)', () => fillLines(ctx, nl.lines, left, y - (nl.lines.length - 1) * lh, lh));
      y -= nl.lines.length * lh;
    }
    if (d.price && d.priceBadge) {
      drawBadgePrice(ctx, d, y);
    } else if (d.price) {
      const r = 168 * u;
      const cx = W - 60 * u - r, cy = Math.max(r + 170 * u, y - r - 10 * u);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-6 * Math.PI / 180);
      withShadow(ctx, 24 * u, 'rgba(0,0,0,0.35)', () => {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd23f';
        ctx.fill();
      });
      ctx.lineWidth = 6 * u;
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.arc(0, 0, r - 14 * u, 0, Math.PI * 2);
      ctx.stroke();
      drawPriceBlock(ctx, d, 0, 4 * u, r * 1.55, { font: FONTS.impact, maxSize: 132 * u, color: '#d32f2f', subColor: '#5d3a00', halo: '#ffd23f' });
      ctx.restore();
    }
  },
};

// ------------------------------------------------------------------
// 2. 段ボール手書き（マルシェ）: 今の段ボールPOPの味わいを、きれいに
// ------------------------------------------------------------------
const kraftCache = new Map();
function kraftTexture(W, H) {
  const key = `${W}x${H}`;
  if (kraftCache.has(key)) return kraftCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const u = W / 1080;
  c.fillStyle = '#c99d63';
  c.fillRect(0, 0, W, H);
  // 段ボールの中しん（波の筋）がうっすら透ける
  c.fillStyle = 'rgba(90,55,20,0.05)';
  for (let x = 0; x < W; x += 22 * u) c.fillRect(x, 0, 9 * u, H);
  const rnd = seededRandom(20261020);
  for (let i = 0; i < 4200; i++) {
    const x = rnd() * W, y = rnd() * H, len = (6 + rnd() * 30) * u, a = (rnd() - 0.5) * 0.6;
    c.strokeStyle = rnd() < 0.5 ? `rgba(80,45,10,${0.04 + rnd() * 0.08})` : `rgba(255,235,200,${0.04 + rnd() * 0.08})`;
    c.lineWidth = (0.8 + rnd() * 1.6) * u;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    c.stroke();
  }
  const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(60,30,0,0.28)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  kraftCache.set(key, cv);
  return cv;
}

function markerCircle(ctx, cx, cy, rx, ry, u) {
  ctx.save();
  ctx.strokeStyle = 'rgba(211,47,47,0.9)';
  ctx.lineCap = 'round';
  ctx.lineWidth = 7 * u;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, -0.05, Math.PI * 0.15, Math.PI * 2.05);
  ctx.stroke();
  ctx.lineWidth = 4 * u;
  ctx.beginPath();
  ctx.ellipse(cx + 4 * u, cy - 3 * u, rx * 1.03, ry * 0.97, 0.04, Math.PI * 1.1, Math.PI * 2.4);
  ctx.stroke();
  ctx.restore();
}

const marche = {
  id: 'marche',
  label: '段ボール手書き',
  photoBox: (W, H) => {
    const u = W / 1080;
    // 縦長ではひとことを2行入れられるよう、写真を少し詰める
    return { x: 110 * u, y: 196 * u, w: 860 * u, h: H - 560 * u - (H / W > 1.2 ? 90 * u : 0) };
  },
  draw(ctx, d) {
    const { W, H, u, pop } = d;
    ctx.drawImage(kraftTexture(W, H), 0, 0);
    ctx.textBaseline = 'alphabetic';

    if (pop.badge) {
      const l = layoutLines(pop.badge, W - 140 * u, measurer(ctx, FONTS.marker), { maxSize: 86 * u, minSize: 44 * u });
      ctx.font = font(FONTS.marker, l.size);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#c62828';
      ctx.fillText(l.lines[0], 70 * u, 126 * u);
      const tw = ctx.measureText(l.lines[0]).width;
      ctx.strokeStyle = 'rgba(198,40,40,0.75)';
      ctx.lineWidth = 6 * u;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let x = 0; x <= tw; x += 8 * u) {
        const yy = 150 * u + Math.sin(x / (26 * u)) * 5 * u;
        if (x === 0) ctx.moveTo(70 * u + x, yy); else ctx.lineTo(70 * u + x, yy);
      }
      ctx.stroke();
    }

    const box = this.photoBox(W, H);
    ctx.save();
    ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
    ctx.rotate(-1.2 * Math.PI / 180);
    ctx.translate(-(box.x + box.w / 2), -(box.y + box.h / 2));
    withShadow(ctx, 30 * u, 'rgba(40,20,0,0.45)', () => {
      ctx.fillStyle = '#fbf8f1';
      ctx.fillRect(box.x - 20 * u, box.y - 20 * u, box.w + 40 * u, box.h + 40 * u);
    });
    if (!drawPhoto(ctx, d.photo, box, pop.crop, PHOTO_RADIUS * u, fxOf(pop, [251, 248, 241]))) drawNoPhoto(ctx, box, ['#8fbf6a', '#4d8a3c'], d, PHOTO_RADIUS * u);
    ctx.fillStyle = 'rgba(255,248,220,0.6)';
    for (const [tx, rot] of [[box.x + 30 * u, -0.5], [box.x + box.w - 150 * u, 0.45]]) {
      ctx.save();
      ctx.translate(tx + 60 * u, box.y - 6 * u);
      ctx.rotate(rot);
      ctx.fillRect(-75 * u, -22 * u, 150 * u, 44 * u);
      ctx.restore();
    }
    ctx.restore();

    const rowTop = box.y + box.h + 40 * u;
    const hasPrice = !!d.price;
    const textW = W - 140 * u - (hasPrice ? 380 * u : 0);
    const nf = d.nameFont || FONTS.marker;
    const nl = layoutLines(pop.name, textW, measurer(ctx, nf), { maxSize: 116 * u, minSize: 60 * u, maxLines: 2 });
    let y = rowTop;
    ctx.textAlign = 'left';
    if (nl.lines.length) {
      ctx.font = font(nf, nl.size);
      ctx.fillStyle = '#231509';
      const lh = nl.size * 1.1;
      fillLines(ctx, nl.lines, 70 * u, y + nl.size * 0.9, lh);
      y += nl.size * 0.9 + (nl.lines.length - 1) * lh + 22 * u;
    }
    const catchMax = H - 120 * u - y;
    const cl = layoutLines(pop.catch, textW, measurer(ctx, FONTS.marker),
      { maxSize: 44 * u, minSize: 32 * u, maxLines: catchMax > 120 * u ? 2 : 1 });
    if (cl.lines.length && catchMax > 30 * u) {
      ctx.font = font(FONTS.marker, cl.size);
      ctx.fillStyle = '#5b3716';
      fillLines(ctx, cl.lines, 70 * u, y + cl.size, cl.size * 1.3);
    }
    if (hasPrice) {
      const cx = W - 250 * u, cy = rowTop + 112 * u;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(3 * Math.PI / 180);
      withShadow(ctx, 18 * u, 'rgba(40,20,0,0.35)', () => {
        ctx.fillStyle = '#fffdf6';
        ctx.fillRect(-180 * u, -118 * u, 360 * u, 236 * u);
      });
      // 税込の併記が入るときは、赤丸が併記に掛からないよう数字を上げて丸を平たくする
      const note = !!d.price.incl;
      drawPriceBlock(ctx, d, 0, (note ? -18 : -4) * u, 290 * u, { font: FONTS.marker, maxSize: 120 * u, color: '#c62828', subColor: '#3b2410', subFont: FONTS.marker, halo: '#fffdf6' });
      markerCircle(ctx, 0, (note ? -14 : -6) * u, 160 * u, (note ? 64 : 78) * u, u);
      ctx.restore();
    }

    const by = H - 48 * u;
    if (pop.origin) {
      ctx.font = font(FONTS.marker, 46 * u);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#2e6b28';
      ctx.fillText(pop.origin, 70 * u, by);
    }
    if (d.shopName) {
      ctx.font = font(FONTS.marker, 34 * u);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#4e2f12';
      ctx.fillText(d.shopName, W - 70 * u, by);
    }
  },
};

// ------------------------------------------------------------------
// 3. シンプル上品: 生成り地・明朝の商品名・余白を広く
// ------------------------------------------------------------------
const simple = {
  id: 'simple',
  label: 'シンプル上品',
  photoBox: (W, H) => ({ x: 0, y: 0, w: W, h: H - (H / W > 1.2 ? 600 : 500) * (W / 1080) }),
  draw(ctx, d) {
    const { W, H, u, pop } = d;
    ctx.fillStyle = '#f7f3ea';
    ctx.fillRect(0, 0, W, H);
    const box = this.photoBox(W, H);
    if (!drawPhoto(ctx, d.photo, box, pop.crop, 0, fxOf(pop, [247, 243, 234]))) drawNoPhoto(ctx, box, ['#cfd8c4', '#8fa585'], d);
    ctx.textBaseline = 'alphabetic';

    const left = 64 * u, maxW = W - 128 * u;
    let y = box.y + box.h + 70 * u;
    ctx.textAlign = 'left';
    if (pop.badge) {
      ctx.font = font(FONTS.round, 38 * u);
      ctx.fillStyle = '#5b8a45';
      ctx.fillText(`— ${pop.badge} —`, left, y);
      y += 20 * u;
    }
    const tall = H / W > 1.2;
    const nf = d.nameFont || FONTS.mincho;
    const nl = layoutLines(pop.name, maxW, measurer(ctx, nf),
      { maxSize: 118 * u, minSize: 60 * u, maxLines: tall ? 2 : 1 });
    if (nl.lines.length) {
      ctx.font = font(nf, nl.size);
      ctx.fillStyle = '#22261f';
      const lh = nl.size * 1.15;
      fillLines(ctx, nl.lines, left, y + nl.size, lh);
      y += nl.size + (nl.lines.length - 1) * lh + 18 * u;
    }
    const cl = layoutLines(pop.catch, maxW, measurer(ctx, FONTS.roundM),
      { maxSize: 42 * u, minSize: 32 * u, maxLines: tall ? 2 : 1 });
    if (cl.lines.length) {
      ctx.font = font(FONTS.roundM, cl.size);
      ctx.fillStyle = '#5c5f58';
      fillLines(ctx, cl.lines, left, y + cl.size, cl.size * 1.4);
    }

    const by = H - 64 * u;
    ctx.strokeStyle = 'rgba(60,70,50,0.25)';
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.moveTo(left, by - 120 * u);
    ctx.lineTo(W - left, by - 120 * u);
    ctx.stroke();
    if (pop.origin) {
      ctx.font = font(FONTS.roundM, 36 * u);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#4c7a3a';
      ctx.fillText(pop.origin, left, by - 6 * u);
    }
    if (d.shopName) {
      ctx.font = font(FONTS.roundM, 28 * u);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#8a8d84';
      ctx.fillText(d.shopName, left, by + 40 * u);
    }
    if (d.price) {
      const m = measurer(ctx, FONTS.mincho);
      const num = d.price.main;
      const size = 124 * u;
      ctx.textAlign = 'right';
      ctx.fillStyle = '#22261f';
      ctx.font = font(FONTS.mincho, size * 0.4);
      ctx.fillText('円', W - left, by);
      const yenW = m('円', size * 0.4) + 6 * u;
      ctx.font = font(FONTS.mincho, size);
      ctx.fillText(num, W - left - yenW, by);
      if (d.price.each) paintEach(ctx, W - left - yenW - m(num, size), by, FONTS.mincho, size * 0.4 * EACH_OF_YEN, '#22261f', '#f7f3ea');
      ctx.fillStyle = '#5c5f58';
      paintMixed(ctx, [pop.unit, taxNote(d.price)].filter(Boolean).join('　'), W - left, by - size + 4 * u, FONTS.round, 34 * u, 'right',
        (s, x, y, f, sz) => { ctx.font = font(f, sz); ctx.fillText(s, x, y); });
    }
  },
};

// ------------------------------------------------------------------
// 4. 金額主役: 写真の右下に金額キャッチ（黒いギザギザ＋価格＋税込）、写真の下に商品名
//    余白は上・左・右・下（商品名の下）とも同じ幅。写真の高さは商品名が何行になるかで決まる
//    税抜で入れたときは、価格の下に税込の金額を必ず添える（中身は price-design.js）
//    産地・商品名・数量と単位の3行は labels.js（見た目と置き場所は label-design.js）
// ------------------------------------------------------------------
const BOLD_MARGIN = 40;   // 周りの余白（1080幅のとき）

const bold = {
  id: 'bold',
  label: '金額主役',
  // measure＝文字の幅の測り方（labels.js の canvasMeasure）。商品名と単位が写真の下に要る高さを測って写真を縮める
  photoBox: (W, H, pop, measure) => {
    const u = W / 1080, m = BOLD_MARGIN * u;
    const below = labelsBelow(pop, measure, labelDesignFor(pop)) * u;
    return { x: m, y: m, w: W - 2 * m, h: H - 2 * m - below - (below ? m : 0) };
  },
  draw(ctx, d) {
    const { W, H, u, pop } = d;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 6 * u;
    ctx.strokeRect(14 * u, 14 * u, W - 28 * u, H - 28 * u);
    ctx.textBaseline = 'alphabetic';

    const box = this.photoBox(W, H, pop, canvasMeasure(ctx));
    if (!drawPhoto(ctx, d.photo, box, pop.crop, PHOTO_RADIUS * u, fxOf(pop, [255, 255, 255]))) drawNoPhoto(ctx, box, ['#ffcf6b', '#f08a24'], d, PHOTO_RADIUS * u);
    // 産地・商品名・数量と単位（置き場所と見た目は label-design.js）
    drawLabels(ctx, box, pop, u, labelDesignFor(pop));
    // 金額キャッチは写真の右下に乗せる。写真の丸めた角からはみ出さないよう、同じ形で切る（中身は price-design.js）
    if (d.price) {
      ctx.save();
      roundRectPath(ctx, box.x, box.y, box.w, box.h, PHOTO_RADIUS * u);
      ctx.clip();
      drawPrice(ctx, box, d.price, u);
      ctx.restore();
    }
  },
};

export const TEMPLATES = { fresh, marche, simple, bold };
export const TEMPLATE_ORDER = ['bold', 'fresh', 'marche', 'simple'];
