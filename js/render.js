// ポップを Canvas へ描く・画像ファイルにする。

import { adFileName, exportFileName, formatDate, NAME_FONTS, nameFontOf, priceBadgeOf, priceTexts, SIZES } from './model.js';
import { FONTS, font, measurer, roundRectPath, TEMPLATES } from './templates.js';
import { canvasToBlob } from './image.js';
import { containRect, fitFontSize, googleFontsUrl, layoutLines } from './layout.js';
import { PRICE_FONTS } from './price-design.js';
import { canvasMeasure, labelFontList } from './labels.js';
import { LABEL_DESIGN } from './label-design.js';

export function sizeOf(pop) {
  return SIZES[pop.size] || SIZES.square;
}

export function templateOf(pop) {
  return TEMPLATES[pop.template] || TEMPLATES.fresh;
}

let measureCtx = null;
/** 写真を敷く枠（編集画面のドラッグにも使う）。「金額主役」は商品名の行数で写真の高さが変わるので、文字を測って渡す。 */
export function photoBoxOf(pop) {
  const s = sizeOf(pop);
  measureCtx ??= document.createElement('canvas').getContext('2d');
  return templateOf(pop).photoBox(s.w, s.h, pop, canvasMeasure(measureCtx));
}

let fontWarned = false;
let priceFontCss = null;

// 金額の台紙の絵（src → 読み込んだ Image。読めなかったものは null＝黄色い丸で描く）
const badgeImages = new Map();
const badgeLoading = new Map();

/** 台紙の絵を読み込む（描く前に済ませる。描くのは同期なので）。読めなくても止めない。 */
function loadBadge(badge) {
  if (!badge?.src || badgeImages.has(badge.src)) return null;
  if (!badgeLoading.has(badge.src)) {
    badgeLoading.set(badge.src, new Promise(resolve => {
      const img = new Image();
      img.onload = () => { badgeImages.set(badge.src, img); resolve(); };
      img.onerror = () => { badgeLoading.delete(badge.src); resolve(); };   // 次の描画で読み直す。それまでは黄色い丸
      img.src = new URL(`../${badge.src}`, import.meta.url).href;   // tools/ の画面から呼んでも同じ絵を指すように
    }));
  }
  return badgeLoading.get(badge.src);
}

/** 描くときに渡す台紙（絵が読めていなければ null）。 */
function badgeFor(pop) {
  const b = priceBadgeOf(pop);
  const img = b && badgeImages.get(b.src);
  return img ? { ...b, img } : null;
}

/** 定義を読み込む書体（金額キャッチ・産地・商品名・数量と単位の3行・商品名に選べる書体）。 */
const designFonts = () => [...PRICE_FONTS, ...labelFontList(LABEL_DESIGN), ...NAME_FONTS.filter(f => f.family)];

/** その書体の定義（@font-face）を読み込む。デザインで書体が変わっても index.html を直さずに済むように。 */
function loadPriceFontCss() {
  priceFontCss ??= new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = googleFontsUrl(designFonts());
    link.onload = resolve;
    link.onerror = () => {
      link.remove();
      priceFontCss = null;   // 電波が戻ったら次の描画で読み直す
      reject(new Error('デザインの書体を読み込めませんでした'));
    };
    document.head.append(link);
  });
  return priceFontCss;
}

/**
 * 描く文字に要る字形だけを読み込む（Google Fonts は字ごとに分割されている）。
 * 読めなくても（電波が無い等）端末の字で描けるので止めない。
 */
export async function ensureFonts(pop, settings, onFail) {
  const badge = loadBadge(priceBadgeOf(pop));   // 書体と並べて待つ
  if (!document.fonts?.load) { await badge; return; }
  const decor = Object.values(LABEL_DESIGN).flatMap(t => [t?.prefix, t?.suffix]).filter(Boolean);   // 〈〉など3行の前後の飾り
  const text = [pop.name, pop.unit, pop.origin, ...decor,
    '0123456789,.円税込抜各()（）〈〉月火水木金土日/📷写真を追加—'].join('');
  try {
    const load = f => document.fonts.load(`${f.weight} 40px "${f.family}"`, text);
    await Promise.all([
      ...Object.values(FONTS).map(load),
      loadPriceFontCss().then(() => Promise.all([...designFonts().filter(f => !NAME_FONTS.includes(f)), nameFontOf(pop)].filter(Boolean).map(load))),
      badge,
    ]);
  } catch (err) {
    if (!fontWarned) { fontWarned = true; onFail?.(err); }
  }
}

/** pop を canvas へ描く。canvas の大きさは出力サイズ（1080幅）に合わせる。 */
export function renderPop(canvas, pop, photo, settings, { preview = false } = {}) {
  const s = sizeOf(pop);
  if (canvas.width !== s.w) canvas.width = s.w;
  if (canvas.height !== s.h) canvas.height = s.h;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.clearRect(0, 0, s.w, s.h);
  // 見出し（badge）とひとこと（catch＝今はメモ）・店名は画像に入れない。見出しはフレーム（広告）で入れる。
  // デザインはどれも空なら描かない作りなので、ここで空にして渡す（古いポップに残っている文字も出さない）
  templateOf(pop).draw(ctx, {
    W: s.w, H: s.h, u: s.w / 1080, pop: { ...pop, badge: '', catch: '' }, photo, preview,
    price: priceTexts(pop, settings),   // 価格が無ければ null
    shopName: '',   // 店名はポップに入れない（フレームの下の帯で入れる）
    nameFont: nameFontOf(pop),   // 商品名の書体（選んでいなければ null＝デザインのまま）
    priceBadge: badgeFor(pop),   // 金額の台紙（「写真主役」だけが使う。無ければ黄色い丸）
  });
  ctx.restore();
}

/** 出力用の画像ファイル（JPEG）と、履歴の一覧に出す見本を作る。 */
export async function renderToFile(pop, photo, settings) {
  await ensureFonts(pop, settings);
  const cv = document.createElement('canvas');
  renderPop(cv, pop, photo, settings);
  const blob = await canvasToBlob(cv, 'image/jpeg', 0.92);
  return { file: new File([blob], exportFileName(pop), { type: 'image/jpeg' }), thumb: thumbnailOf(cv, 360), w: cv.width, h: cv.height };
}

// ---- 広告（フレームに複数の画像を収める）----

/** 広告の文字に要る字形を読み込む。読めなくても端末の字で描けるので止めない。 */
export async function ensureAdFonts(ad, settings, onFail) {
  if (!document.fonts?.load) return;
  const text = [ad.title, settings?.shopName, '0123456789/()月火水木金土日'].join('');
  try {
    await Promise.all([FONTS.impact, FONTS.round].map(f => document.fonts.load(`${f.weight} 40px "${f.family}"`, text)));
  } catch (err) {
    if (!fontWarned) { fontWarned = true; onFail?.(err); }
  }
}

/**
 * 広告を canvas へ描く。images は枠の順の画像（未選択は null）。overlay はフレームの飾り画像（あれば）。
 * 画像は切らずに枠へ丸ごと収める（ポップの価格・税込の表示を欠かさないため）。
 */
export function renderAd(canvas, frame, ad, images, settings, { overlay = null, preview = false, now = new Date() } = {}) {
  const { w: W, h: H } = frame;
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.fillStyle = frame.bg || '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const head = frame.header;
  if (head?.h) {
    if (head.bg) { ctx.fillStyle = head.bg; ctx.fillRect(0, 0, W, head.h); }
    const title = String(ad.title || '').trim();
    if (title) {
      // 長い見出しは2行まで折り返して大きさを保つ（入り切らなければ … で止める）
      const l = layoutLines(title, W - 96, measurer(ctx, FONTS.impact), { maxSize: head.h * 0.5, minSize: head.h * 0.2, maxLines: 2 });
      ctx.font = font(FONTS.impact, l.size);
      ctx.fillStyle = head.color || '#ffffff';
      const lh = l.size * 1.15;
      l.lines.forEach((line, i) => ctx.fillText(line, W / 2, head.h / 2 + (i - (l.lines.length - 1) / 2) * lh));
    }
  }

  frame.slots.forEach((slot, i) => {
    const img = images[i];
    if (img) {
      const r = containRect(img.naturalWidth || img.width, img.naturalHeight || img.height, slot);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.22)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.restore();
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
    } else if (preview) {
      // まだ選んでいない枠（出力には出ない。出力は全部の枠が埋まるまで止める）
      ctx.save();
      ctx.setLineDash([18, 12]);
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      roundRectPath(ctx, slot.x + 3, slot.y + 3, slot.w - 6, slot.h - 6, 20);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.font = font(FONTS.impact, Math.min(slot.w, slot.h) * 0.3);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillText(String(i + 1), slot.x + slot.w / 2, slot.y + slot.h / 2);
    }
  });

  if (overlay) ctx.drawImage(overlay, 0, 0, W, H);

  const foot = frame.footer;
  if (foot?.h) {
    const y0 = H - foot.h;
    if (foot.bg) { ctx.fillStyle = foot.bg; ctx.fillRect(0, y0, W, foot.h); }
    const size = foot.h * 0.36;
    ctx.fillStyle = foot.color || '#333333';
    ctx.font = font(FONTS.round, size);
    const dateText = ad.showDate ? formatDate(now) : '';
    const dateW = dateText ? ctx.measureText(dateText).width + 40 : 0;
    const shop = String(settings?.shopName || '').trim();
    if (shop) {
      ctx.textAlign = dateText ? 'left' : 'center';
      const shopSize = fitFontSize(shop, W - 96 - dateW, measurer(ctx, FONTS.round), size, size * 0.5);
      ctx.font = font(FONTS.round, shopSize);
      ctx.fillText(shop, dateText ? 48 : W / 2, y0 + foot.h / 2);
    }
    if (dateText) {
      ctx.font = font(FONTS.round, size);
      ctx.textAlign = shop ? 'right' : 'center';
      ctx.fillText(dateText, shop ? W - 48 : W / 2, y0 + foot.h / 2);
    }
  }
  ctx.restore();
}

export async function adToFile(frame, ad, images, settings, overlay) {
  await ensureAdFonts(ad, settings);
  const cv = document.createElement('canvas');
  renderAd(cv, frame, ad, images, settings, { overlay });
  const blob = await canvasToBlob(cv, 'image/jpeg', 0.92);
  return { file: new File([blob], adFileName(), { type: 'image/jpeg' }), thumb: thumbnailOf(cv, 360) };
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
