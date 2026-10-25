// ポップ1枚分のデータと、その扱い。
// 画面・保存・描画から独立した純粋な関数だけを置く（node --test で確かめられるように）。

export const SIZES = {
  square: { label: '正方形', note: 'LINE・Instagram', w: 1080, h: 1080 },
  portrait: { label: '縦 4:5', note: 'Instagram投稿', w: 1080, h: 1350 },
  story: { label: '縦長 9:16', note: 'ストーリーズ', w: 1080, h: 1920 },
};

export const DEFAULT_CROP = Object.freeze({ x: 0, y: 0, zoom: 1 });
export const DEFAULT_ADJUST = Object.freeze({ brightness: 0, contrast: 0, saturation: 0, warmth: 0 });

// レギュラーから呼び出したときに引き継ぐ項目（＝ポップの中身）。
// id・日時・レギュラーかどうか・確認済みかどうかは引き継がない。
const CONTENT_FIELDS = [
  'name', 'catch', 'price', 'priceTax', 'unit', 'origin', 'badge',
  'template', 'size', 'showDate', 'photoId', 'crop', 'adjust', 'thumb',
];

export function newId() {
  // randomUUID は HTTPS でしか使えない（LAN の http で試すときに無い）ので代わりを用意する
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function createPop(now = new Date()) {
  const t = now.toISOString();
  return {
    id: newId(),
    name: '',
    catch: '',
    price: null,          // 円。未入力は null。税抜か税込かは priceTax
    priceTax: 'excl',     // 'excl'＝税抜で入れた（税込を計算して併記）／'incl'＝税込で入れた
    unit: '',
    origin: '',
    badge: '本日のおすすめ',
    template: 'fresh',
    size: 'square',
    showDate: true,
    photoId: null,
    crop: { ...DEFAULT_CROP },
    adjust: { ...DEFAULT_ADJUST },
    thumb: null,
    isRegular: false,
    fromRegularId: null,  // レギュラーから作ったときの元
    confirmed: false,     // レギュラー由来のとき「今日の価格・産地を確認した」か
    createdAt: t,
    updatedAt: t,
  };
}

export function contentOf(pop) {
  const out = {};
  for (const k of CONTENT_FIELDS) {
    const v = pop[k];
    out[k] = v && typeof v === 'object' ? { ...v } : v;
  }
  return out;
}

/** レギュラーから今日のポップを作る。価格・産地は確認が済むまで出力させない。 */
export function popFromRegular(regular, now = new Date()) {
  return { ...createPop(now), ...contentOf(regular), fromRegularId: regular.id, confirmed: false };
}

/** 今のポップを元に、新しいレギュラーを作る。 */
export function regularFromPop(pop, now = new Date()) {
  return { ...createPop(now), ...contentOf(pop), isRegular: true };
}

/** レギュラーの中身を今のポップで上書きする（id・作成日は残す）。 */
export function updateRegularFrom(regular, pop, now = new Date()) {
  return { ...regular, ...contentOf(pop), updatedAt: now.toISOString() };
}

/** 作っただけで何も入れていないポップか（戻ったときに片付けてよいもの）。 */
export function isBlankPop(pop) {
  return !pop.isRegular && !pop.fromRegularId && !pop.photoId
    && !String(pop.name).trim() && !String(pop.catch).trim()
    && pop.price == null && !String(pop.origin).trim();
}

export function toHalfWidth(s) {
  return String(s).replace(/[０-９，．]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
}

/**
 * 価格欄の文字を読む。読めないときは ok:false と理由を返す
 * （呼び出し側は入力を消さずに残して理由を出す）。
 */
export function parsePriceInput(text) {
  const s = toHalfWidth(text ?? '').replace(/[,\s円¥￥]/g, '');
  if (s === '') return { ok: true, value: null };
  if (!/^\d{1,7}$/.test(s)) return { ok: false, message: '数字だけで入力してください（例: 298）' };
  return { ok: true, value: Number(s) };
}

export function formatPrice(value) {
  return value == null ? '' : Number(value).toLocaleString('ja-JP');
}

// ---- 税 ----
// 青果は食料品なので軽減税率 8% を初期値にする（設定で変えられる）。
export const DEFAULT_TAX_RATE = 8;
export const TAX_ROUNDINGS = {
  decimal: '小数第2位まで（例: 117.72円）',
  floor: '切り捨て（例: 117円）',
  round: '四捨五入（例: 118円）',
};

/** 価格が税抜か。この欄が無い古いポップは税込で入れていた（0.1.0 まではそれしか無かった）。 */
export function isTaxExcluded(pop) {
  return pop.priceTax === 'excl';
}

/** 税率の欄を読む。0〜30 の % だけを受け付ける（打ち間違いで 80% のような値を出さないため）。 */
export function parseTaxRateInput(text) {
  const s = toHalfWidth(text ?? '').replace(/[\s%％]/g, '');
  if (!/^\d{1,2}$/.test(s) || Number(s) > 30) return { ok: false, message: '0〜30 の数字で入力してください（例: 8）' };
  return { ok: true, value: Number(s) };
}

/** 設定の税率（読めない値なら初期値。設定画面では読める値しか保存しない）。 */
export function taxRateOf(settings) {
  const r = settings?.taxRate;
  return Number.isInteger(r) && r >= 0 && r <= 30 ? r : DEFAULT_TAX_RATE;
}

/**
 * 税抜価格から税込の表示文字（「117.72」など）を作る。
 * 小数の誤差を出さないよう、銭（1/100円）の整数で計算する（109×1.08 を浮動小数で計算すると 117.72000000000001 になる）。
 */
export function formatTaxIncluded(price, rate, rounding = 'decimal') {
  const sen = price * (100 + rate);   // 銭。price・rate とも整数なので誤差なし
  if (rounding === 'floor') return formatPrice(Math.floor(sen / 100));
  if (rounding === 'round') return formatPrice(Math.floor((sen + 50) / 100));
  const yen = Math.floor(sen / 100), rest = sen % 100;
  if (!rest) return formatPrice(yen);
  return `${formatPrice(yen)}.${String(rest).padStart(2, '0').replace(/0$/, '')}`;
}

/**
 * ポップに出す価格の文字。main＝大きく出す数字、incl＝税抜で入れたときに併記する税込の数字
 * （税込で入れたときは ''＝数字そのものに「税込」と添える）。価格が無ければ null。
 * どのデザインもこれを使う（総額表示＝税込を必ず読めるようにする判断を1か所に置く）。
 */
export function priceTexts(pop, settings) {
  if (pop.price == null) return null;
  const main = formatPrice(pop.price);
  if (!isTaxExcluded(pop)) return { main, incl: '' };
  return { main, incl: formatTaxIncluded(pop.price, taxRateOf(settings), settings?.taxRounding) };
}

/** 数字に添える税の文字（「税込」または「税込 117.72円」）。 */
export function taxNote(texts) {
  return texts.incl ? `税込 ${texts.incl}円` : '税込';
}

const WEEKDAYS = '日月火水木金土';
export function formatDate(d) {
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

/** 出力を止める理由（空なら出力してよい）。 */
export function exportProblems(pop) {
  const out = [];
  if (!String(pop.name).trim()) out.push('商品名を入れてください');
  if (pop.fromRegularId && !pop.confirmed) out.push('今日の価格・産地を確認してチェックを入れてください');
  return out;
}

export function popTitle(pop) {
  return String(pop.name).trim() || '（商品名なし）';
}

export function sortByUpdated(pops) {
  return [...pops].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** 端末の時刻での年月日（toISOString は UTC なので、日本の朝9時前は前日になってしまう）。 */
export function localStamp(d, withTime = false) {
  const p = n => String(n).padStart(2, '0');
  const ymd = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  return withTime ? `${ymd}-${p(d.getHours())}${p(d.getMinutes())}` : ymd;
}

export function exportFileName(pop, now = new Date()) {
  const ymd = localStamp(now);
  const name = String(pop.name).trim().replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 20) || 'pop';
  return `pop_${ymd}_${name}.jpg`;
}

export function adFileName(now = new Date()) {
  return `ad_${localStamp(now, true)}.jpg`;
}

// ---- 作った画像の履歴 ----
// 出した（共有・保存・「履歴に残す」）画像そのものを控える。ポップのデータとは別に持つ
// （ポップを後で直しても、その日に出した画像は残る）。

/** ピンの無い画像を残す枚数。超えた古い分から消す（スマホの容量を食い尽くさないため）。ピン付きは数えず消さない。 */
export const HISTORY_MAX = 60;

/**
 * 同じ中身を2回残さないための印（ポップは id と更新日時。広告は frames.js の adShotKey）。
 * 日付を入れるポップは、直していなくても日が変われば別の画像になるので日付も含める。
 */
export function popShotKey(pop, now = new Date()) {
  const day = pop.showDate ? `#${localStamp(now)}` : '';
  return `pop:${pop.id}@${pop.updatedAt}${day}`;
}

export function shotFromPop(pop, { w, h, thumb }, now = new Date()) {
  return {
    id: newId(), kind: 'pop', title: popTitle(pop), key: popShotKey(pop, now),
    w, h, thumb, createdAt: now.toISOString(), pinnedAt: null,
  };
}

/** 並び順: ピン付きが最上段（後からピンを付けたものほど上）、その下に新しい順。 */
export function sortHistory(shots) {
  return [...shots].sort((a, b) => {
    if (!!a.pinnedAt !== !!b.pinnedAt) return a.pinnedAt ? -1 : 1;
    if (a.pinnedAt) return String(b.pinnedAt).localeCompare(String(a.pinnedAt));
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
}

/** 上限を超えた、消してよい画像の id（ピンの無いものの古い方から）。 */
export function historyOverflow(shots, max = HISTORY_MAX) {
  return sortHistory(shots).filter(s => !s.pinnedAt).slice(max).map(s => s.id);
}

export function setPinned(shot, pinned, now = new Date()) {
  return { ...shot, pinnedAt: pinned ? now.toISOString() : null };
}

/** 履歴から出し直すときのファイル名（作った日時。端末の時刻で）。 */
export function shotFileName(shot) {
  const d = new Date(shot.createdAt);
  const stamp = Number.isNaN(d.getTime()) ? 'unknown' : localStamp(d, true);
  return `${shot.kind === 'ad' ? 'ad' : 'pop'}_${stamp}.jpg`;
}

/** 一覧に出す日時（端末の時刻で「10/22(木) 7:05」）。 */
export function formatShotTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${formatDate(d)} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
