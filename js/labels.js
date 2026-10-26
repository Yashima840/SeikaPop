// 「金額主役」の 産地・商品名・数量と単位 の3行。見た目・置き場所は label-design.js（tools/designer.html で編集する）。
// 置き方の計算（layoutLabels・labelBounds）と検査（labelDesignProblems）は Canvas に触らない純粋な関数。
// 文字の幅は measure(text, size, style) を外から渡す（テストでは 文字数×大きさ で代用できる）。

import { LABEL_DESIGN } from './label-design.js';
import { layoutLines } from './layout.js';

export const LABEL_KEYS = ['origin', 'name', 'unit'];
export const LABEL_NAMES = { origin: '産地', name: '商品名', unit: '数量と単位' };
export const ALIGNS = { left: '左揃え', center: '中央', right: '右揃え' };
const FALLBACK = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif';
const LINE_H = 1.08;                 // 折り返したときの行の間隔（大きさに対する倍率）
const ASCENT = 0.88, DESCENT = 0.12; // 文字の上端・下端（大きさに対する割合）。背景の帯と選ぶ範囲に使う

export function labelFont(t, size) {
  return `${t.weight} ${Math.round(size * 100) / 100}px "${t.font}", ${FALLBACK}`;
}

/** 行に書く文字（前後の飾りを付けて）。中身が空なら ''＝その行は描かない。 */
export function labelText(key, pop, t) {
  const raw = String(pop[key] ?? '').trim();
  return raw ? `${t.prefix || ''}${raw}${t.suffix || ''}` : '';
}

/** デザイン単位 → 画像の px。写真の枠の左下が原点、1単位＝u px。 */
export function labelFrame(box, u) {
  return { x: box.x, y: box.y + box.h, k: u };
}

const lineLeft = (line, align) => (align === 'right' ? line.x - line.w : align === 'center' ? line.x - line.w / 2 : line.x);

function layoutOne(key, t, pop, measure, anchor) {
  const text = labelText(key, pop, t);
  if (!text) return null;
  const m = (s, size) => measure(s, size, t);
  const l = layoutLines(text, t.maxW, m, { maxSize: t.size, minSize: t.minSize, maxLines: t.maxLines });
  const x = (anchor?.x ?? 0) + t.x, y = (anchor?.y ?? 0) + t.y;
  const lineH = l.size * LINE_H;
  return { size: l.size, lines: l.lines.map((s, i) => ({ text: s, x, y: y + i * lineH, w: m(s, l.size) })) };
}

/**
 * 3行の置き場所（デザイン単位）。描かない行は null。
 * bottom＝商品名（と、付いていく単位）の最後の行の下端の線（縦長でひとことをその下に置くため）。無ければ null。
 */
export function layoutLabels(pop, measure, design = LABEL_DESIGN) {
  const name = layoutOne('name', design.name, pop, measure);
  let anchor = null;
  if (design.unit.follow) {
    const last = name?.lines.at(-1);
    anchor = last ? { x: lineLeft(last, design.name.align) + last.w, y: last.y } : { x: design.name.x, y: design.name.y };
  }
  const unit = layoutOne('unit', design.unit, pop, measure, anchor);
  const ys = [name?.lines.at(-1).y, design.unit.follow ? unit?.lines.at(-1).y : null].filter(v => v != null);
  return {
    origin: layoutOne('origin', design.origin, pop, measure),
    name, unit,
    bottom: ys.length ? Math.max(...ys) : null,
  };
}

/**
 * 写真の下に要る高さ（デザイン単位）＝写真の枠の下端より下にはみ出す行の下端。下に何も出ないなら 0。
 * 「金額主役」が写真の高さを決めるのに使う（商品名が2行なら写真を縮める）。
 */
export function labelsBelow(pop, measure, design = LABEL_DESIGN) {
  const lay = layoutLabels(pop, measure, design);
  return Math.max(0, ...LABEL_KEYS.map(k => labelBounds(lay, k, design)?.box.y1 ?? 0));
}

/** 行が占める範囲（デザイン単位）。編集画面がクリックの当たり判定と、選んだ行の枠に使う。描かない行は null。 */
export function labelBounds(lay, key, design = LABEL_DESIGN) {
  const L = lay[key];
  if (!L) return null;
  const t = design[key];
  const pad = Math.max(0, ...t.strokes.map(s => s.width)) / 2;
  const px = Math.max(pad, t.bg ? t.bg.padX : 0), py = Math.max(pad, t.bg ? t.bg.padY : 0);
  const pts = [];
  for (const line of L.lines) {
    const l = lineLeft(line, t.align) - px, r = lineLeft(line, t.align) + line.w + px;
    for (const dy of [-L.size * ASCENT - py, L.size * DESCENT + py]) {
      // 描くときと同じ傾け方（基準の線からの高さ dy に比例して横へずらす）
      pts.push([l - t.slant * dy, line.y + dy], [r - t.slant * dy, line.y + dy]);
    }
  }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  return { box, poly: [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]] };
}

// ---- ここから下は Canvas に描く ----

export function canvasMeasure(ctx) {
  return (s, size, t) => { ctx.font = labelFont(t, size); return ctx.measureText(s).width; };
}

function drawOne(ctx, L, t) {
  for (const line of L.lines) {
    ctx.save();
    ctx.translate(line.x, line.y);
    ctx.transform(1, 0, -t.slant, 1, 0, 0);
    ctx.font = labelFont(t, L.size);
    ctx.textAlign = t.align;
    ctx.textBaseline = 'alphabetic';
    if (t.bg) {
      const x = lineLeft(line, t.align) - line.x - t.bg.padX, y = -L.size * ASCENT - t.bg.padY;
      const w = line.w + t.bg.padX * 2, h = L.size * (ASCENT + DESCENT) + t.bg.padY * 2;
      const r = Math.min(t.bg.radius, h / 2, w / 2);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
      ctx.fillStyle = t.bg.fill;
      ctx.fill();
    }
    ctx.lineJoin = 'round';
    for (const s of t.strokes) {
      if (!s.width) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.strokeText(line.text, 0, 0);
    }
    ctx.fillStyle = t.fill;
    ctx.fillText(line.text, 0, 0);
    ctx.restore();
  }
}

/** 3行を描く。box＝写真の枠、u＝倍率（幅1080pxで 1）。置き方（layoutLabels の結果）を返す。 */
export function drawLabels(ctx, box, pop, u, design = LABEL_DESIGN) {
  const f = labelFrame(box, u);
  const lay = layoutLabels(pop, canvasMeasure(ctx), design);
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.scale(f.k, f.k);
  for (const key of LABEL_KEYS) if (lay[key]) drawOne(ctx, lay[key], design[key]);
  ctx.restore();
  return lay;
}

// ---- 検査（保存の前に通す）----

const COLOR = /^#[0-9a-f]{6}$/i;
const finite = v => typeof v === 'number' && Number.isFinite(v);

function lineProblems(t, label, out) {
  if (!t || typeof t !== 'object') { out.push(`${label}の設定がありません`); return; }
  if (typeof t.font !== 'string' || !t.font.trim()) out.push(`${label}の書体の名前が空です`);
  if (!/^[1-9]00$/.test(String(t.weight))) out.push(`${label}の太さは 100〜900 の100刻みにしてください`);
  for (const k of ['x', 'y', 'size', 'minSize', 'maxW', 'slant']) if (!finite(t[k])) out.push(`${label}の ${k} が数ではありません`);
  if (finite(t.size) && t.size <= 0) out.push(`${label}の大きさが 0 以下です`);
  if (finite(t.minSize) && (t.minSize <= 0 || t.minSize > t.size)) out.push(`${label}の「縮める下限」は 0 より大きく、大きさ以下にしてください`);
  if (finite(t.maxW) && t.maxW <= 0) out.push(`${label}の最大幅が 0 以下です`);
  if (finite(t.slant) && Math.abs(t.slant) > 0.6) out.push(`${label}の傾きが大きすぎます（-0.6〜0.6）`);
  if (!(Number.isInteger(t.maxLines) && t.maxLines >= 1 && t.maxLines <= 3)) out.push(`${label}の行数は 1〜3 にしてください`);
  if (!(t.align in ALIGNS)) out.push(`${label}の揃え方は left・center・right のどれかにしてください`);
  if (!COLOR.test(t.fill)) out.push(`${label}の色が #rrggbb の形ではありません`);
  if (!Array.isArray(t.strokes) || t.strokes.length > 4) out.push(`${label}の縁取りは 0〜4 本にしてください`);
  else {
    t.strokes.forEach((s, i) => {
      if (!COLOR.test(s?.color)) out.push(`${label}の縁取り ${i + 1} の色が #rrggbb の形ではありません`);
      if (!(finite(s?.width) && s.width >= 0)) out.push(`${label}の縁取り ${i + 1} の太さが正しくありません`);
    });
  }
  if (t.bg != null) {
    if (!COLOR.test(t.bg.fill)) out.push(`${label}の背景の色が #rrggbb の形ではありません`);
    if (!['padX', 'padY', 'radius'].every(k => finite(t.bg[k]) && t.bg[k] >= 0)) out.push(`${label}の背景の余白・角の丸みが正しくありません`);
  }
  for (const k of ['prefix', 'suffix']) {
    if (typeof t[k] !== 'string' || Array.from(t[k]).length > 4) out.push(`${label}の前後の飾り（${k}）は 4 文字までにしてください`);
  }
}

/** 保存してはいけない理由の一覧（空なら保存してよい）。 */
export function labelDesignProblems(d) {
  if (!d || typeof d !== 'object') return ['3行のデザインの形が壊れています'];
  const out = [];
  if (d.version !== 1) out.push('3行のデザインの version が 1 ではありません');
  for (const key of LABEL_KEYS) lineProblems(d[key], LABEL_NAMES[key], out);
  if (d.unit && typeof d.unit.follow !== 'boolean') out.push('数量と単位の「商品名に付いていく」は true か false にしてください');
  return out;
}

/** 使っている書体の一覧（同じ書体・太さは1つにまとめる）。 */
export function labelFontList(d) {
  const seen = new Map();
  for (const key of LABEL_KEYS) {
    const t = d[key];
    if (t?.font) seen.set(`${t.font}|${t.weight}`, { family: t.font, weight: String(t.weight) });
  }
  return [...seen.values()];
}

export const LABEL_FONTS = labelFontList(LABEL_DESIGN);
