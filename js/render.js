// ポップを Canvas へ描く・画像ファイルにする。

import { exportFileName, formatDate, priceTexts, SIZES } from './model.js';
import { FONTS, TEMPLATES } from './templates.js';
import { canvasToBlob } from './image.js';

export function sizeOf(pop) {
  return SIZES[pop.size] || SIZES.square;
}

export function templateOf(pop) {
  return TEMPLATES[pop.template] || TEMPLATES.fresh;
}

export function photoBoxOf(pop) {
  const s = sizeOf(pop);
  return templateOf(pop).photoBox(s.w, s.h);
}

let fontWarned = false;

/**
 * 描く文字に要る字形だけを読み込む（Google Fonts は字ごとに分割されている）。
 * 読めなくても（電波が無い等）端末の字で描けるので止めない。
 */
export async function ensureFonts(pop, settings, onFail) {
  if (!document.fonts?.load) return;
  const text = [pop.name, pop.catch, pop.badge, pop.unit, pop.origin, settings?.shopName,
    '0123456789,.円税込抜()（）〈〉月火水木金土日/📷写真を追加—'].join('');
  try {
    await Promise.all(Object.values(FONTS).map(f => document.fonts.load(`${f.weight} 40px "${f.family}"`, text)));
  } catch (err) {
    if (!fontWarned) { fontWarned = true; onFail?.(err); }
  }
}

/** pop を canvas へ描く。canvas の大きさは出力サイズ（1080幅）に合わせる。 */
export function renderPop(canvas, pop, photo, settings, { preview = false, now = new Date() } = {}) {
  const s = sizeOf(pop);
  if (canvas.width !== s.w) canvas.width = s.w;
  if (canvas.height !== s.h) canvas.height = s.h;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.clearRect(0, 0, s.w, s.h);
  templateOf(pop).draw(ctx, {
    W: s.w, H: s.h, u: s.w / 1080, pop, photo, preview,
    price: priceTexts(pop, settings),   // 価格が無ければ null
    shopName: String(settings?.shopName || '').trim(),
    dateText: pop.showDate ? formatDate(now) : '',
  });
  ctx.restore();
}

/** 出力用の画像ファイル（JPEG）を作る。 */
export async function renderToFile(pop, photo, settings) {
  await ensureFonts(pop, settings);
  const cv = document.createElement('canvas');
  renderPop(cv, pop, photo, settings);
  const blob = await canvasToBlob(cv, 'image/jpeg', 0.92);
  return new File([blob], exportFileName(pop), { type: 'image/jpeg' });
}

/** 一覧に出す小さな見本（保存に入れる）。 */
export function thumbnailOf(canvas, width = 270) {
  const k = width / canvas.width;
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = Math.round(canvas.height * k);
  cv.getContext('2d').drawImage(canvas, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.72);
}
