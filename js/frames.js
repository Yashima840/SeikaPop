// 複数の画像を1枚に収めるフレーム（データ）と、広告の組み合わせの判定。純粋な関数だけ。
//
// フレームの足し方: FRAMES に1つ足し、FRAME_ORDER に id を足す。座標は出力の px。
//   slots   画像を置く枠（並び順＝選んだ順）。画像は切らずに枠の中へ丸ごと収める（containRect）
//   header  上の帯（見出しの文字）／footer 下の帯（店名・日付）。高さ 0 なら描かない
//   overlay 別に用意した飾りの画像（PNG。枠の部分を透明に抜いたもの）。'frames/xxx.png' のように
//           置き場所を書く。置いたら sw.js の SHELL にも足すこと。画像に文字まで入れたなら header/footer は 0 に
// 足したら npm test（frameProblems で枠のはみ出しを止める）と tools/gallery.html で見た目を確かめる。
// カスタムフレーム（広告の画面で行ごとの枚数を選んで作る）は customFrame が行の指定から作る。

import { localStamp, newId } from './model.js';

export const FRAMES = {
  // 特売が1品だけの日用。ポップ1枚に日付を入れないので、日付はこの下の帯で入れる
  single: {
    label: '1枚', note: '縦 4:5', w: 1080, h: 1350,
    bg: '#fffaf0', header: { h: 200, bg: '#2f7d43', color: '#ffffff' }, footer: { h: 110, color: '#22603a' },
    slots: [{ x: 36, y: 224, w: 1008, h: 992 }],
  },
  pair: {
    label: '2枚 横並び', note: '正方形', w: 1080, h: 1080,
    bg: '#fff8e8', header: { h: 220, bg: '#2f7d43', color: '#ffffff' }, footer: { h: 110, color: '#22603a' },
    slots: [{ x: 36, y: 349, w: 492, h: 492 }, { x: 552, y: 349, w: 492, h: 492 }],
  },
  grid4: {
    label: '4枚 田の字', note: '縦 4:5', w: 1080, h: 1350,
    bg: '#fdf6e3', header: { h: 200, bg: '#c62828', color: '#ffffff' }, footer: { h: 110, color: '#8e1c1c' },
    slots: [
      { x: 36, y: 216, w: 492, h: 492 }, { x: 552, y: 216, w: 492, h: 492 },
      { x: 36, y: 732, w: 492, h: 492 }, { x: 552, y: 732, w: 492, h: 492 },
    ],
  },
  trio: {
    label: '3枚 大1・小2', note: '縦長 9:16', w: 1080, h: 1920,
    bg: '#f4f2ec', header: { h: 240, bg: '#2f7d43', color: '#ffffff' }, footer: { h: 130, color: '#22603a' },
    slots: [
      { x: 36, y: 260, w: 1008, h: 998 },
      { x: 36, y: 1278, w: 492, h: 492 }, { x: 552, y: 1278, w: 492, h: 492 },
    ],
  },
  stack2: {
    label: '2枚 縦並び', note: '縦長 9:16', w: 1080, h: 1920,
    bg: '#fff3e0', header: { h: 260, bg: '#e65100', color: '#ffffff' }, footer: { h: 140, color: '#a33a00' },
    slots: [{ x: 178, y: 284, w: 724, h: 724 }, { x: 178, y: 1032, w: 724, h: 724 }],
  },
};
export const FRAME_ORDER = ['single', 'pair', 'stack2', 'trio', 'grid4'];  // 枚数の少ない順

// ---- カスタムフレーム: 6行それぞれに 0（使わない）〜3 枚。使う行だけを上から詰めて並べる ----
export const CUSTOM_ID = 'custom';
export const CUSTOM_ROWS = 6;
export const CUSTOM_MAX_PER_ROW = 3;
const CUSTOM = {
  w: 1080, gap: 5,   // 写真どうし・左右の端・上下の帯との隙間は、どれもほぼ無し（5px）
  bg: '#fdf6e3', header: { h: 200, bg: '#2f7d43', color: '#ffffff' }, footer: { h: 110, color: '#22603a' },
};
export const CUSTOM_NAME_MAX = 20;

/** 行ごとの枚数を 0〜3 の整数 6 個にそろえる（壊れた保存データでも落ちないように）。 */
export function normalizeRows(rows) {
  return Array.from({ length: CUSTOM_ROWS }, (_, i) => {
    const n = Math.floor(Number(rows?.[i]) || 0);
    return Math.min(CUSTOM_MAX_PER_ROW, Math.max(0, n));
  });
}

/** 使う行の枚数だけ（上から順）。 */
export const usedRows = rows => normalizeRows(rows).filter(n => n > 0);

/**
 * 行ごとの枚数からフレームを作る。使う行が無ければ null。name を渡すと名前入りの label にする。
 * 各行は横幅いっぱい（左右の端も 5px）に n 枚を並べ、枠は正方形（ポップは正方形が多い）。
 * 縦は中身に合わせて伸ばす（行が多いと縦長になる。枠を縮めて左右に余白を作ることはしない）。
 */
export function customFrame(rows, name = '') {
  const used = usedRows(rows);
  if (!used.length) return null;
  const { w: W, gap } = CUSTOM;
  const innerW = W - 2 * gap;
  const size = used.map(n => (innerW - (n - 1) * gap) / n);   // 枠の一辺（正方形）
  const H = Math.round(CUSTOM.header.h + gap + size.reduce((a, b) => a + b, 0) + (used.length - 1) * gap + gap + CUSTOM.footer.h);
  let y = CUSTOM.header.h + gap;
  const slots = [];
  used.forEach((n, r) => {
    // 端は丸めてから幅を決める（行ごとに 1px ずれて見えないように）
    const y0 = Math.round(y), y1 = Math.round(y + size[r]);
    for (let i = 0; i < n; i++) {
      const xa = Math.round(gap + i * (size[r] + gap)), xb = Math.round(gap + i * (size[r] + gap) + size[r]);
      slots.push({ x: xa, y: y0, w: xb - xa, h: y1 - y0 });
    }
    y += size[r] + gap;
  });
  const shape = `${used.length}行 ${slots.length}枚`;
  return {
    label: name ? `${name}（${shape}）` : `カスタム（${shape}）`, note: `${used.join('・')}枚`, w: W, h: H,
    bg: CUSTOM.bg, header: CUSTOM.header, footer: CUSTOM.footer, slots,
  };
}

/** 広告で使うフレーム（カスタムなら行の指定から作る）。無ければ null。 */
export function frameFor(ad) {
  return ad.frameId === CUSTOM_ID ? customFrame(ad.customRows, ad.customName || '') : FRAMES[ad.frameId] || null;
}

// ---- 名前を付けて保存したカスタムフレーム（{ id, name, rows, updatedAt } の一覧）----

/** 保存データを読める形にそろえる（壊れたものは捨てずに直せる所だけ直し、行が無いものは外す）。 */
export function cleanCustomFrames(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(f => f && typeof f.id === 'string' && usedRows(f.rows).length)
    .map(f => ({ id: f.id, name: String(f.name || '').trim() || 'カスタム', rows: normalizeRows(f.rows), updatedAt: String(f.updatedAt || '') }));
}

/** 保存を止める理由（空なら保存できる）。同じ名前は別のもの（id 違い）に使わせない（選ぶときに見分けられないため）。 */
export function customFrameProblems({ id = null, name, rows }, list) {
  const out = [];
  const n = String(name || '').trim();
  if (!n) out.push('名前を入れてください');
  else if (n.length > CUSTOM_NAME_MAX) out.push(`名前は ${CUSTOM_NAME_MAX} 文字までにしてください`);
  else if (list.some(f => f.name === n && f.id !== id)) out.push(`「${n}」という名前のカスタムはもうあります`);
  if (!usedRows(rows).length) out.push('写真を入れる行を1つ以上選んでください');
  return out;
}

/** 保存する（同じ id なら上書き、無ければ足す）。保存したものと新しい一覧を返す。 */
export function saveCustomFrame(list, { id = null, name, rows }, now = new Date()) {
  const entry = { id: id || newId(), name: String(name).trim(), rows: normalizeRows(rows), updatedAt: now.toISOString() };
  const has = list.some(f => f.id === entry.id);
  return { entry, list: has ? list.map(f => (f.id === entry.id ? entry : f)) : [...list, entry] };
}

/** バックアップを重ねる: 無いものは足し、同じ id は更新日時が新しい方を残す。 */
export function mergeCustomFrames(existing, incoming) {
  const byId = new Map(existing.map(f => [f.id, f]));
  let added = 0;
  for (const f of cleanCustomFrames(incoming)) {
    const cur = byId.get(f.id);
    if (!cur) added += 1;
    if (!cur || f.updatedAt > cur.updatedAt) byId.set(f.id, f);
  }
  return { list: [...byId.values()], added };
}

export const AD_TITLES =['本日のおすすめ', '今週の特売', '朝採れ入荷', '旬の味覚', '数量限定'];

/** フレームのデータの誤り（空なら使える）。手で足したフレームの打ち間違いを、画面に出す前に止める。 */
export function frameProblems(frame) {
  const out = [];
  if (!frame || typeof frame !== 'object') return ['フレームのデータがありません'];
  const { w, h } = frame;
  if (!(w > 0 && h > 0)) out.push('w・h（出力の大きさ）がありません');
  if (!Array.isArray(frame.slots) || !frame.slots.length) out.push('slots（画像の枠）が1つもありません');
  const top = frame.header?.h || 0, bottom = h - (frame.footer?.h || 0);
  (frame.slots || []).forEach((s, i) => {
    if (!(s.w > 0 && s.h > 0)) out.push(`${i + 1}枚目の枠の大きさがありません`);
    else if (s.x < 0 || s.y < 0 || s.x + s.w > w || s.y + s.h > h) out.push(`${i + 1}枚目の枠が画像からはみ出しています`);
    else if (s.y < top || s.y + s.h > bottom) out.push(`${i + 1}枚目の枠が上下の帯に重なっています`);
  });
  if (frame.overlay != null && typeof frame.overlay !== 'string') out.push('overlay は画像の置き場所（文字）で書いてください');
  return out;
}

export function createAd(now = new Date()) {
  return {
    // カスタムのときは、使っている保存済みのもの（customId・customName）と形（customRows）を持つ
    frameId: FRAME_ORDER[0], customId: null, customName: '', customRows: normalizeRows([]),
    title: AD_TITLES[0], showDate: true, slots: [],
    updatedAt: now.toISOString(),
  };
}

/**
 * フレームを替えたときの並べ直し。選んだ画像は順を保って前へ詰め、枠の数に合わせる。
 * 入り切らなかった数を dropped で返す（黙って外さず、画面で知らせるため）。
 */
export function fitSlots(slots, count) {
  const chosen = (slots || []).filter(Boolean);
  const kept = chosen.slice(0, count);
  return { slots: [...kept, ...Array(count - kept.length).fill(null)], dropped: chosen.length - kept.length };
}

/** 一覧の画像をタップしたとき: 選んでいれば外す、選んでいなければ空いている最初の枠へ。満杯なら full。 */
export function toggleShot(slots, id) {
  const i = slots.indexOf(id);
  if (i >= 0) return { slots: slots.map((s, j) => (j === i ? null : s)), full: false };
  const empty = slots.indexOf(null);
  if (empty < 0) return { slots, full: true };
  return { slots: slots.map((s, j) => (j === empty ? id : s)), full: false };
}

/** 履歴から消えた画像を枠から外す。外した数を返す。 */
export function dropMissing(slots, existingIds) {
  const have = new Set(existingIds);
  let removed = 0;
  const next = slots.map(s => {
    if (s && !have.has(s)) { removed += 1; return null; }
    return s;
  });
  return { slots: next, removed };
}

/** 出力を止める理由（空なら出せる）。 */
export function adProblems(ad, frame) {
  if (!frame) return ['フレームを選んでください'];
  const empty = ad.slots.filter(s => !s).length;
  return empty ? [`あと ${empty} 枚、「② ポップを選ぶ」から選んでください`] : [];
}

/** 同じ組み合わせを2回残さないための印。日付を入れる日は、日が変われば別の画像になる。 */
export function adShotKey(ad, now = new Date()) {
  const day = ad.showDate ? `@${localStamp(now)}` : '';
  const frame = ad.frameId === CUSTOM_ID ? `${CUSTOM_ID}:${usedRows(ad.customRows).join('-')}` : ad.frameId;
  return `ad:${frame}|${ad.slots.join(',')}|${ad.title}${day}`;
}

export function shotFromAd(ad, frame, { thumb }, now = new Date()) {
  return {
    id: newId(), kind: 'ad', title: `広告（${frame.label}）`, key: adShotKey(ad, now), w: frame.w, h: frame.h,
    thumb, createdAt: now.toISOString(),
  };
}
