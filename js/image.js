// 写真の読み込みと色の補正。
// adjustPixels / sepiaPixels / autoAdjust は画素の配列だけを扱う純粋な関数（テスト対象）。
// それ以外はブラウザでだけ動く（呼ばれたときに document を使う）。

import { clamp } from './layout.js';

/** 明るさ・コントラスト・鮮やかさ・色味（いずれも -100〜100）を画素へ当てる。 */
export function adjustPixels(data, adj) {
  const b = (adj.brightness || 0) * 1.28;
  const c = 1 + (adj.contrast || 0) / 100;
  const s = 1 + (adj.saturation || 0) / 100;
  const w = (adj.warmth || 0) * 0.3;
  if (!b && c === 1 && s === 1 && !w) return data;
  for (let i = 0; i < data.length; i += 4) {
    let r = (data[i] - 128) * c + 128 + b;
    let g = (data[i + 1] - 128) * c + 128 + b;
    let bl = (data[i + 2] - 128) * c + 128 + b;
    const gray = 0.299 * r + 0.587 * g + 0.114 * bl;
    r = gray + (r - gray) * s + w;
    g = gray + (g - gray) * s;
    bl = gray + (bl - gray) * s - w;
    data[i] = r;          // Uint8ClampedArray なので 0〜255 に自動で収まる
    data[i + 1] = g;
    data[i + 2] = bl;
  }
  return data;
}

// セピアの強さ（0＝元のまま、1＝完全なセピア）。「少し」なので半分弱だけ寄せる
export const SEPIA_AMOUNT = 0.4;

/** 画素を少しセピア色へ寄せる（amount の割合だけ混ぜる）。 */
export function sepiaPixels(data, amount = SEPIA_AMOUNT) {
  if (!amount) return data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    data[i] = r + (Math.min(255, 0.393 * r + 0.769 * g + 0.189 * b) - r) * amount;
    data[i + 1] = g + (Math.min(255, 0.349 * r + 0.686 * g + 0.168 * b) - g) * amount;
    data[i + 2] = b + (Math.min(255, 0.272 * r + 0.534 * g + 0.131 * b) - b) * amount;
  }
  return data;
}

/**
 * 店内の暗い・くすんだ写真を、食べ物がおいしく見える方へ寄せる補正値を決める。
 * 目標は「やや明るめ・鮮やかめ・ほんの少し暖色」。
 */
export function autoAdjust(data) {
  let n = 0, sum = 0, sum2 = 0, satSum = 0;
  for (let i = 0; i < data.length; i += 4 * 7) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    sum += y; sum2 += y * y; satSum += max ? (max - min) / max : 0;
    n += 1;
  }
  if (!n) return { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const sat = satSum / n;
  return {
    brightness: Math.round(clamp((140 - mean) * 0.45, -25, 35)),
    contrast: Math.round(sd < 60 ? clamp((60 - sd) * 0.6, 0, 25) : 0),
    saturation: sat < 0.35 ? 25 : 12,
    warmth: 5,
  };
}

// ---- ここから下はブラウザ専用 ----

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像を読み込めませんでした（対応していない形式かもしれません）'));
    img.src = src;
  });
}

/** Blob を描ける画像にする。向き（EXIF）は img 要素がそのまま正してくれる。 */
export async function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    await img.decode?.();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('画像を作れませんでした'))), type, quality);
  });
}

/** 撮った写真を保存用の大きさ（長辺 maxSide）へ縮めた JPEG にする。 */
export async function shrinkPhoto(file, maxSide = 1600) {
  const img = await blobToImage(file);
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  if (!w0 || !h0) throw new Error('画像の大きさが読み取れませんでした');
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const cv = document.createElement('canvas');
  cv.width = Math.round(w0 * k);
  cv.height = Math.round(h0 * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return canvasToBlob(cv, 'image/jpeg', 0.88);
}

/** 小さく縮めた画素から自動補正の値を決める。 */
export function autoAdjustFor(img) {
  const k = Math.min(1, 256 / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(img.width * k));
  cv.height = Math.max(1, Math.round(img.height * k));
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  return autoAdjust(ctx.getImageData(0, 0, cv.width, cv.height).data);
}

/** 補正（と sepia＝セピア）を当てた写真（Canvas）を作る。どちらも無ければ元の画像をそのまま返す。 */
export function adjustedCopy(img, adj, { sepia = false } = {}) {
  const noop = !adj.brightness && !adj.contrast && !adj.saturation && !adj.warmth && !sepia;
  if (noop) return img;
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth || img.width;
  cv.height = img.naturalHeight || img.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, cv.width, cv.height);
  adjustPixels(data.data, adj);
  if (sepia) sepiaPixels(data.data);
  ctx.putImageData(data, 0, 0);
  return cv;
}
