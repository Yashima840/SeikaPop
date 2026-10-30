// 複数の画像を1枚に収めるフレーム（データ）と、広告の組み合わせの判定。純粋な関数だけ。
//
// フレームの足し方: FRAMES に1つ足し、FRAME_ORDER に id を足す。座標は出力の px。
//   slots   画像を置く枠（並び順＝選んだ順）。画像は切らずに枠の中へ丸ごと収める（containRect）
//   header  上の帯（見出しの文字）／footer 下の帯（決まり文句 FOOTER_TEXT）／band 期間のバッジの帯（入れるときだけ）
//   overlay 別に用意した飾りの画像（PNG。枠の部分を透明に抜いたもの）。'frames/xxx.png' のように
//           置き場所を書く。置いたら sw.js の SHELL にも足すこと。画像に文字まで入れたなら header/footer は 0 に
// 足したら npm test（frameProblems で枠のはみ出しを止める）と tools/gallery.html で見た目を確かめる。
// カスタムフレーム（広告の画面で行ごとの枚数を選んで作る）は customFrame が行の指定から作る。

import { newId } from './model.js';

// どのフレームも、写真どうし・左右の端・上下の帯との隙間は 5px（余白は作らない）。枠は正方形（ポップは正方形が多い）で、
// 各行は横幅いっぱいに n 枚を並べ、縦は中身に合わせて伸ばす。同梱のフレームもカスタムも rowsFrame で作る。
const LAYOUT = { w: 1080, gap: 5, headerH: 200, footerH: 48 };
// 下の帯に入れる決まり文句（日付・店名は入れない）
export const FOOTER_TEXT = 'なくなり次第終了いたします。画像はイメージです';
// 店の営業時間（ad.hours）。入れたときだけ、下の帯の左に入れる（決まり文句は右）
export const HOURS_MAX = 30;
/** 下の帯に入れる営業時間（前後の空白を除き、長すぎる分は切る。無ければ ''）。 */
export const hoursOf = ad => Array.from(String(ad?.hours ?? '').trim()).slice(0, HOURS_MAX).join('');
// 期間のバッジ（「10/17(土)～10/19(月) 3日間限り」）。入れたいときだけ、見出しの帯のすぐ下に帯で差し込む
export const PERIOD_BAND = { h: 110, bg: '#ffe14d', color: '#c62828' };

/** 縦横の比から、フレームを選ぶ欄に添える形の目安。 */
function shapeNote(w, h) {
  const r = h / w;
  return r <= 1.08 ? '正方形' : r <= 1.4 ? '縦長' : 'とても縦長';
}

/**
 * 行ごとの枚数（上から。0 の行は渡さない）からフレームを作る。使う行が無ければ null。
 * band＝期間のバッジの帯を入れるか。header/footer は色（{ bg, color }・{ color }）。
 */
function rowsFrame(used, { label, header, footer, bg, band = false }) {
  if (!used.length) return null;
  const { w: W, gap, headerH, footerH } = LAYOUT;
  const bandH = band ? PERIOD_BAND.h : 0;
  const innerW = W - 2 * gap;
  const size = used.map(n => (innerW - (n - 1) * gap) / n);   // 枠の一辺（正方形）
  const top = headerH + bandH;
  const H = Math.round(top + gap + size.reduce((x, y) => x + y, 0) + (used.length - 1) * gap + gap + footerH);
  let y = top + gap;
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
  return {
    label, note: shapeNote(W, H), w: W, h: H, bg,
    header: { h: headerH, ...header }, footer: { h: footerH, ...footer },
    ...(band ? { band: { y: headerH, ...PERIOD_BAND } } : {}),
    slots,
  };
}

// 同梱のフレーム（rows＝行ごとの枚数）。足すときは FRAME_DEFS に1つ足し、FRAME_ORDER に id を足す
const FRAME_DEFS = {
  // 特売が1品だけの日用
  single: { label: '1枚', rows: [1], bg: '#fffaf0', header: { bg: '#2f7d43', color: '#ffffff' }, footer: { color: '#22603a' } },
  pair: { label: '2枚 横並び', rows: [2], bg: '#fff8e8', header: { bg: '#2f7d43', color: '#ffffff' }, footer: { color: '#22603a' } },
  stack2: { label: '2枚 縦並び', rows: [1, 1], bg: '#fff3e0', header: { bg: '#e65100', color: '#ffffff' }, footer: { color: '#a33a00' } },
  trio: { label: '3枚 大1・小2', rows: [1, 2], bg: '#f4f2ec', header: { bg: '#2f7d43', color: '#ffffff' }, footer: { color: '#22603a' } },
  grid4: { label: '4枚 田の字', rows: [2, 2], bg: '#fdf6e3', header: { bg: '#c62828', color: '#ffffff' }, footer: { color: '#8e1c1c' } },
};
const builtIn = (id, band = false) => {
  const d = FRAME_DEFS[id];
  return d ? rowsFrame(d.rows, { ...d, band }) : null;
};
/** 同梱のフレーム（期間のバッジ無しの形。選ぶ欄・見本帳で使う）。 */
export const FRAMES = Object.fromEntries(Object.keys(FRAME_DEFS).map(id => [id, builtIn(id)]));
export const FRAME_ORDER = ['single', 'pair', 'stack2', 'trio', 'grid4'];  // 枚数の少ない順

// ---- カスタムフレーム: 6行それぞれに 0（使わない）〜3 枚。使う行だけを上から詰めて並べる ----
export const CUSTOM_ID = 'custom';
export const CUSTOM_ROWS = 6;
export const CUSTOM_MAX_PER_ROW = 3;
const CUSTOM_BG = '#fdf6e3';
export const CUSTOM_NAME_MAX = 20;
// 見出しの帯の色（選ぶ順）。foot＝下の帯の文字の色。帯の文字は白
export const CUSTOM_COLORS = [
  { id: 'navy', label: '濃い青', bg: '#1d3f8a', foot: '#1d3f8a' },
  { id: 'black', label: '黒', bg: '#1a1a1a', foot: '#1a1a1a' },
  { id: 'red', label: '赤', bg: '#c62828', foot: '#8e1c1c' },
  { id: 'green', label: '緑', bg: '#2f7d43', foot: '#22603a' },
  { id: 'orange', label: 'オレンジ', bg: '#e65100', foot: '#a33a00' },
];
export const CUSTOM_COLOR_DEFAULT = 'green';
/** 見出しの色（知らない id は緑）。 */
export const customColorOf = id => CUSTOM_COLORS.find(c => c.id === id) || CUSTOM_COLORS.find(c => c.id === CUSTOM_COLOR_DEFAULT);

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
 * 行ごとの枚数からカスタムのフレームを作る。使う行が無ければ null。name を渡すと名前入りの label にする。color＝見出しの色の id。
 * band＝期間のバッジの帯を入れるか。
 */
export function customFrame(rows, name = '', color = CUSTOM_COLOR_DEFAULT, { band = false } = {}) {
  const used = usedRows(rows);
  if (!used.length) return null;
  const c = customColorOf(color);
  const shape = `${used.length}行 ${used.reduce((x, y) => x + y, 0)}枚`;
  const f = rowsFrame(used, {
    label: name ? `${name}（${shape}）` : `カスタム（${shape}）`, bg: CUSTOM_BG,
    header: { bg: c.bg, color: '#ffffff' }, footer: { color: c.foot }, band,
  });
  return { ...f, note: `${used.join('・')}枚` };
}

/**
 * 広告で使うフレーム（カスタムなら行の指定から作る）。無ければ null。
 * 期間のバッジを入れるなら、その帯の分だけ下へずらす。ad.headColor（CUSTOM_COLORS の id）があれば見出しの帯と下の帯の文字をその色にする。
 */
export function frameFor(ad) {
  const band = !!periodOf(ad);
  const f = ad.frameId === CUSTOM_ID ? customFrame(ad.customRows, ad.customName || '', ad.customColor, { band }) : builtIn(ad.frameId, band);
  const c = f && CUSTOM_COLORS.find(x => x.id === ad.headColor);
  const g = c ? { ...f, header: { ...f.header, bg: c.bg }, footer: { ...f.footer, color: c.foot } } : f;
  if (!g?.band) return g;
  const pc = periodColorOf(ad.period.color);
  return { ...g, band: { ...g.band, bg: pc.bg, color: pc.color } };
}

// ---- 期間のバッジ（ad.period = { on, from, days, color }。from は 'YYYY-MM-DD'（端末の日付）、days は何日間か、color は PERIOD_COLORS の id）----

export const PERIOD_DAYS_MAX = 31;   // 日数は 1〜31 を手で入れる
const DAYS_MAX = PERIOD_DAYS_MAX;
// バッジの色（帯の色と文字の色）。初めは黄色に赤い字
export const PERIOD_COLORS = [
  { id: 'yellow', label: '黄', bg: PERIOD_BAND.bg, color: PERIOD_BAND.color },
  { id: 'red', label: '赤', bg: '#c62828', color: '#ffffff' },
  { id: 'pink', label: 'ピンク', bg: '#e91e63', color: '#ffffff' },
  { id: 'orange', label: 'オレンジ', bg: '#ef6c00', color: '#ffffff' },
  { id: 'navy', label: '濃い青', bg: '#1d3f8a', color: '#ffe14d' },
  { id: 'black', label: '黒', bg: '#1a1a1a', color: '#ffe14d' },
];
/** バッジの色（知らない id は黄）。 */
export function periodColorOf(id) {
  return PERIOD_COLORS.find(c => c.id === id) || PERIOD_COLORS[0];
}
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const parseDay = s => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const validDays = n => Number.isInteger(n) && n >= 1 && n <= DAYS_MAX;

/** 端末の日付の 'YYYY-MM-DD'（toISOString は UTC なので使わない）。 */
export function dayInput(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 始まりの日から days 日間の終わりの日（'YYYY-MM-DD'）。読めなければ ''。 */
export function periodEnd(from, days) {
  const a = parseDay(from);
  if (!a || !validDays(days)) return '';
  return dayInput(new Date(a.getFullYear(), a.getMonth(), a.getDate() + days - 1));
}

/**
 * バッジの文字を、大きさの違う切れ目に分ける（月は小さく・日は大きく）。読めなければ []。
 * k: 'month'（10/）・'day'（17）・'week'（(土)）・'sep'（～）・'tail'（ 3日間限り）。
 */
export function periodParts(from, days) {
  const a = parseDay(from), end = periodEnd(from, days);
  if (!a || !end) return [];
  const date = d => [{ t: `${d.getMonth() + 1}/`, k: 'month' }, { t: String(d.getDate()), k: 'day' }, { t: `(${WEEK[d.getDay()]})`, k: 'week' }];
  if (days === 1) return [...date(a), { t: ' 限り', k: 'tail' }];
  return [...date(a), { t: '～', k: 'sep' }, ...date(parseDay(end)), { t: ` ${days}日間限り`, k: 'tail' }];
}

/** バッジの文字:「10/17(土)～10/19(月) 3日間限り」・1日だけなら「10/17(土) 限り」。読めなければ ''。 */
export function periodText(from, days) {
  return periodParts(from, days).map(p => p.t).join('');
}

/** 期間のバッジの初めの値（今日から3日間。入れるかどうかは「入れない」）。 */
export function defaultPeriod(now = new Date()) {
  return { on: false, from: dayInput(now), days: 3, color: PERIOD_COLORS[0].id };
}

/** 保存してある期間を読める形にそろえる（無い・壊れた作りかけは「入れない」。前の { from, to } は日数に直す）。 */
export function normalizePeriod(p, now = new Date()) {
  const d = defaultPeriod(now);
  if (!p || typeof p !== 'object') return d;
  const from = parseDay(p.from) ? p.from : d.from;
  let days = Number(p.days);
  if (!validDays(days) && parseDay(p.to) && parseDay(p.from)) days = Math.round((parseDay(p.to) - parseDay(p.from)) / 86400000) + 1;
  return { on: p.on === true, from, days: validDays(days) ? days : d.days, color: periodColorOf(p.color).id };
}

/** バッジに入れる文字（入れないなら ''）。 */
export function periodOf(ad) {
  return ad?.period?.on ? periodText(ad.period.from, Number(ad.period.days)) : '';
}

// ---- 店のロゴ（ad.logo = { on, x, y, size }。x・y はロゴの真ん中の位置（px）。null なら見出しの帯の左）----
// size は一辺の長さ（px）。null なら LOGO.size。見本の上でピンチ（パソコンは Ctrl＋ホイール）で変える（min〜max）。

export const LOGO = { src: './icons/logo.png', size: 170, pad: 16, min: 60, max: 600 };

/** ロゴの初めの値（入れる・見出しの帯の左・元の大きさ）。 */
export function defaultLogo() {
  return { on: true, x: null, y: null, size: null };
}

/** 保存してあるロゴの指定を読める形にそろえる（無い作りかけは「入れる」。大きさの無い前の作りかけは元の大きさ）。 */
export function normalizeLogo(l) {
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
  if (!l || typeof l !== 'object') return defaultLogo();
  const x = num(l.x), y = num(l.y), size = num(l.size);
  const at = x === null || y === null ? { x: null, y: null } : { x, y };
  return { on: l.on !== false, ...at, size: size === null ? null : clampLogoSize(size) };
}

const clampLogoSize = s => Math.round(Math.min(Math.max(s, LOGO.min), LOGO.max));

/** ロゴの一辺の長さ（px）。画像の短い辺より大きくはしない。 */
export function logoSizeOf(logo, frame = null) {
  const s = clampLogoSize(logo?.size ?? LOGO.size);
  return frame ? Math.min(s, frame.w, frame.h) : s;
}

/** ロゴの大きさを k 倍にした指定（min〜max に収める。位置はそのまま）。 */
export function resizeLogo(logo, k) {
  return { ...logo, size: clampLogoSize(logoSizeOf(logo) * k) };
}

/** 一辺 size のロゴの真ん中を (x, y) に置いたときの位置。画像の外へはみ出さないように収める。 */
export function placeLogo(frame, x, y, size = LOGO.size) {
  const r = Math.min(size, frame.w, frame.h) / 2;
  const clamp = (v, max) => Math.round(Math.min(Math.max(v, r), max - r));
  return { x: clamp(x, frame.w), y: clamp(y, frame.h) };
}

/** ロゴを描く四角（左上と大きさ）。入れないなら null。 */
export function logoRect(ad, frame) {
  if (!ad?.logo?.on || !frame) return null;
  const s = logoSizeOf(ad.logo, frame);
  const head = frame.header?.h || 0;
  const l = ad.logo.x === null || ad.logo.x === undefined
    ? placeLogo(frame, LOGO.pad + s / 2, head ? head / 2 : LOGO.pad + s / 2, s)
    : placeLogo(frame, ad.logo.x, ad.logo.y, s);
  return { x: l.x - s / 2, y: l.y - s / 2, w: s, h: s };
}

// ---- 見出しの文字の左右の位置（ad.titleShift＝真ん中からのずれ（px）。0 が真ん中。見本の上で左右に指で動かす）----
const TITLE_EDGE = 24;   // 左右に寄せても、文字と画像の端の間にはこれだけ空ける

/** 幅 textW の見出しの真ん中の x。ずらしても画像の外へはみ出さないように収める（入り切らない長さなら真ん中）。 */
export function titleCenter(frame, shift, textW) {
  const W = frame.w, mid = W / 2;
  const s = typeof shift === 'number' && Number.isFinite(shift) ? shift : 0;
  const room = Math.max(0, mid - textW / 2 - TITLE_EDGE);
  return Math.round(mid + Math.min(Math.max(s, -room), room));
}

/** 見出しの文字に使える幅。ロゴが見出しの帯にかかるなら、その分を左右とも空けて真ん中にそろえたまま避ける。 */
export function titleWidth(frame, logo) {
  const W = frame.w, base = W - 96;
  if (!logo || !frame.header?.h || logo.y >= frame.header.h) return base;
  const reach = logo.x + logo.w / 2 < W / 2 ? logo.x + logo.w : W - logo.x;   // ロゴが寄っている側の端からの深さ
  return Math.max(W * 0.4, Math.min(base, W - 2 * (reach + 16)));
}

// ---- 名前を付けて保存したカスタムフレーム（{ id, name, rows, color, updatedAt } の一覧）----

/** 保存データを読める形にそろえる（壊れたものは捨てずに直せる所だけ直し、行が無いものは外す）。 */
export function cleanCustomFrames(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(f => f && typeof f.id === 'string' && usedRows(f.rows).length)
    .map(f => ({
      id: f.id, name: String(f.name || '').trim() || 'カスタム', rows: normalizeRows(f.rows),
      color: customColorOf(f.color).id, updatedAt: String(f.updatedAt || ''),   // 色の無い（色を選べる前の）ものは緑
    }));
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
export function saveCustomFrame(list, { id = null, name, rows, color }, now = new Date()) {
  const entry = {
    id: id || newId(), name: String(name).trim(), rows: normalizeRows(rows), color: customColorOf(color).id,
    updatedAt: now.toISOString(),
  };
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
  const top = (frame.header?.h || 0) + (frame.band?.h || 0), bottom = h - (frame.footer?.h || 0);
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
    frameId: FRAME_ORDER[0], customId: null, customName: '', customRows: normalizeRows([]), customColor: CUSTOM_COLOR_DEFAULT,
    title: AD_TITLES[0], titleShift: 0, hours: '', headColor: '', period: defaultPeriod(now), logo: defaultLogo(), slots: [],
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
  const out = [];
  const empty = ad.slots.filter(s => !s).length;
  if (empty) out.push(`あと ${empty} 枚、「② ポップを選ぶ」から選んでください`);
  if (ad.period?.on && !periodOf(ad)) out.push('期間のバッジの始まりの日・日数（1〜31）を確かめてください');
  return out;
}

/** 同じ組み合わせを2回残さないための印。見出しの色と左右の位置・営業時間・ロゴの有無と位置と大きさ・期間のバッジの文字が違えば別の画像になる。 */
export function adShotKey(ad) {
  const period = periodOf(ad) ? `@${periodOf(ad)}~${periodColorOf(ad.period.color).id}` : '';
  const frame = ad.frameId === CUSTOM_ID
    ? `${CUSTOM_ID}:${usedRows(ad.customRows).join('-')}:${customColorOf(ad.customColor).id}` : ad.frameId;
  const color = ad.headColor ? `#${ad.headColor}` : '';
  const logo = ad.logo?.on ? `+logo${ad.logo.x ?? ''},${ad.logo.y ?? ''}${ad.logo.size ? `@${ad.logo.size}` : ''}` : '';
  const shift = Math.round(Number(ad.titleShift) || 0) ? `<>${Math.round(Number(ad.titleShift))}` : '';
  const hours = hoursOf(ad) ? `|${hoursOf(ad)}` : '';
  return `ad:${frame}${color}${logo}|${ad.slots.join(',')}|${ad.title}${shift}${period}${hours}`;
}

export function shotFromAd(ad, frame, { thumb }, now = new Date()) {
  return {
    id: newId(), kind: 'ad', title: `広告（${frame.label}）`, key: adShotKey(ad), w: frame.w, h: frame.h,
    thumb, createdAt: now.toISOString(),
  };
}
