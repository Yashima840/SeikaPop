// ポップ1枚分のデータと、その扱い。
// 画面・保存・描画から独立した純粋な関数だけを置く（node --test で確かめられるように）。

export const SIZES = {
  square: { label: '正方形', note: 'LINE・Instagram', w: 1080, h: 1080 },
  portrait: { label: '縦 4:5', note: 'Instagram投稿', w: 1080, h: 1350 },
  story: { label: '縦長 9:16', note: 'ストーリーズ', w: 1080, h: 1920 },
};

// 共有するときの使う先。押した先の大きさでその場で描き直して渡す（保存するのはポップの大きさの1枚だけ）
export const SHARE_TARGETS = [
  { id: 'line', label: 'LINE', size: 'square' },
  { id: 'insta', label: 'Instagram 投稿', size: 'portrait' },
  { id: 'story', label: 'ストーリーズ', size: 'story' },
];

export const DEFAULT_CROP = Object.freeze({ x: 0, y: 0, zoom: 1 });
export const DEFAULT_ADJUST = Object.freeze({ brightness: 0, contrast: 0, saturation: 0, warmth: 0 });

// レギュラーから呼び出したときに引き継ぐ項目（＝ポップの中身）。
// id・日時・レギュラーかどうか・確認済みかどうかは引き継がない。
const CONTENT_FIELDS = [
  'name', 'catch', 'price', 'priceTax', 'unit', 'origin', 'badge',
  'template', 'size', 'photoId', 'crop', 'adjust', 'thumb', 'each', 'nameFont', 'photoFade', 'photoSepia', 'photoVintage',
  'priceBadge', 'badgePos',
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
    each: false,          // 価格の頭に「各」を付ける（同じ値段の品をまとめて出すとき）
    nameFont: '',         // 商品名の書体（NAME_FONTS の id。'' はデザインのまま）
    priceBadge: '',       // 「写真主役」の金額の台紙（PRICE_BADGES の id。'' は黄色い丸）
    badgePos: null,       // 金額の台紙を指で動かした先（中心。画像の幅・高さに対する割合）。null はデザインの位置
    unit: '',
    origin: '',
    badge: '',           // 見出し。画像には入れない（フレームで入れる）。古いデータとの互換のため残す
    template: 'fresh',
    size: 'square',
    photoId: null,
    crop: { ...DEFAULT_CROP },
    adjust: { ...DEFAULT_ADJUST },
    photoFade: false,     // 写真のまわりを下地の色へぼかす（外周フェード）
    photoSepia: false,    // 写真を少しセピア色に寄せる
    photoVintage: false,  // 写真をフィルム風に（image.js の VINTAGE）
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

/**
 * 履歴のポップをそのままレギュラーへ移す（はじめの画面の「★ レギュラーにする」）。
 * 同じ id のまま移すので、このポップから出した画像は、そのままレギュラーの画像として広告に並ぶ。
 */
export function moveToRegular(pop, now = new Date()) {
  return { ...pop, isRegular: true, fromRegularId: null, confirmed: false, updatedAt: now.toISOString() };
}

/** レギュラーの中身を今のポップで上書きする（id・作成日は残す）。 */
export function updateRegularFrom(regular, pop, now = new Date()) {
  return { ...regular, ...contentOf(pop), updatedAt: now.toISOString() };
}

// かんたん作成でデザインを選ぶとき、まだ入れていない所に入れて見せる見本（写真は img/sample-potato.jpg）
export const SAMPLE_POP = { name: 'じゃが芋', origin: '長崎県', price: 98 };
export const SAMPLE_PHOTO_URL = 'img/sample-potato.jpg';

/** 見本で描くためのポップ。入れてある所はそのまま、空の所だけ見本にする（元のポップは変えない）。 */
export function withSample(pop) {
  return {
    ...pop,
    name: String(pop.name).trim() ? pop.name : SAMPLE_POP.name,
    origin: String(pop.origin).trim() ? pop.origin : SAMPLE_POP.origin,
    price: pop.price ?? SAMPLE_POP.price,
  };
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
  const main = formatPrice(pop.price), each = !!pop.each;
  if (!isTaxExcluded(pop)) return { main, incl: '', each };
  return { main, incl: formatTaxIncluded(pop.price, taxRateOf(settings), settings?.taxRounding), each };
}

/** 数字に添える税の文字（「税込」または「税込 117.72円」）。 */
/**
 * 税込の小数（".84" など）を小さく描くための分け方。[{ text, small }] を返す（小数が無ければ1つだけ）。
 * 「金額主役」の price-design.js は外部の案と入れ替える範囲に同じ分け方を持つ（その範囲は他を読み込めないため）。
 */
export function splitDecimal(text) {
  const m = /\.\d+/.exec(text);
  if (!m) return [{ text, small: false }];
  return [
    { text: text.slice(0, m.index), small: false },
    { text: m[0], small: true },
    { text: text.slice(m.index + m[0].length), small: false },
  ].filter(s => s.text);
}

// 商品名に選べる書体（Google Fonts）。'' はデザインごとの書体のまま
export const NAME_FONTS = [
  { id: '', label: 'デザインのまま' },
  { id: 'dela', label: '極太ゴシック', family: 'Dela Gothic One', weight: '400' },
  { id: 'maru', label: '丸ゴシック', family: 'Zen Maru Gothic', weight: '700' },
  { id: 'mincho', label: '明朝', family: 'Zen Old Mincho', weight: '700' },
  { id: 'magic', label: 'マジック書き', family: 'Yusei Magic', weight: '400' },
  { id: 'pop', label: 'ポップ', family: 'Mochiy Pop One', weight: '400' },
  { id: 'rock', label: 'ロックンロール', family: 'RocknRoll One', weight: '400' },
  { id: 'kiwi', label: 'やさしい丸', family: 'Kiwi Maru', weight: '500' },
  { id: 'mplus', label: '太丸ゴシック', family: 'M PLUS Rounded 1c', weight: '800' },
  { id: 'murecho', label: '太ゴシック', family: 'Murecho', weight: '900' },
  { id: 'reggae', label: 'カクカク', family: 'Reggae One', weight: '400' },
  { id: 'potta', label: '筆ポップ', family: 'Potta One', weight: '400' },
  { id: 'brush', label: '筆文字', family: 'Yuji Syuku', weight: '400' },
  { id: 'daruma', label: 'ぽってり', family: 'Darumadrop One', weight: '400' },
  { id: 'hachi', label: 'まる文字', family: 'Hachi Maru Pop', weight: '400' },
  { id: 'klee', label: '手書き', family: 'Klee One', weight: '600' },
  { id: 'yomogi', label: 'ペン字', family: 'Yomogi', weight: '400' },
  { id: 'shippori', label: '太明朝', family: 'Shippori Mincho B1', weight: '800' },
  { id: 'decol', label: '飾り明朝', family: 'Kaisei Decol', weight: '700' },
  { id: 'dot', label: 'ドット', family: 'DotGothic16', weight: '400' },
];

/** ポップの商品名の書体 { family, weight }。デザインのまま（または知らない id）なら null。 */
export function nameFontOf(pop) {
  const f = NAME_FONTS.find(x => x.id && x.id === pop?.nameFont);
  return f ? { family: f.family, weight: f.weight } : null;
}

// 「写真主役」の金額の台紙（文字を抜いた絵）。絵は img/badges/source に置いて tools/make_badges.py で透明にする。
// text は文字を置く枠で、絵の幅・高さに対する割合（cx・cy＝中心、w＝幅）。aspect は絵の幅÷高さ。
// color は数字と「円」の色（'gold' は金のグラデーション）、sub は単位と税込の色。
export const PRICE_BADGES = [
  { id: '', label: '黄色い丸' },
  { id: 'gold-brush', label: '金の筆丸（試し）', src: 'img/badges/gold-brush.png', aspect: 295 / 273,
    text: { cx: 0.512, cy: 0.49, w: 0.6 }, color: 'gold', sub: '#ffffff' },
  { id: 'red-medal', label: '赤のメダル（試し）', src: 'img/badges/red-medal.png', aspect: 482 / 590,
    text: { cx: 0.498, cy: 0.424, w: 0.54 }, color: 'gold', sub: '#ffffff' },
];

/** ポップの金額の台紙。黄色い丸（または知らない id）なら null。 */
export function priceBadgeOf(pop) {
  return PRICE_BADGES.find(b => b.id && b.id === pop?.priceBadge) || null;
}

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

// はじめの画面の「履歴」に並べる数
export const RECENT_MAX = 30;

/**
 * はじめの画面と広告の画面に並べるポップ: レギュラーと履歴（レギュラー以外の新しい順 RECENT_MAX 件）。
 * 2つの画面で同じものが並ぶように、ここだけで決める。
 * 何も入れていないポップ（「1枚作る」の後、編集画面のままアプリを閉じたもの）は並べない。
 */
export function popLists(pops) {
  const sorted = sortByUpdated(pops.filter(p => !isBlankPop(p)));
  return {
    regulars: sorted.filter(p => p.isRegular),
    recent: sorted.filter(p => !p.isRegular).slice(0, RECENT_MAX),
  };
}

/** 以前の広告の作りかけは、枠に画像（履歴）の id を持っていた。そのポップの id へ読み替える（無ければそのまま）。 */
export function slotsToPopIds(slots, shots) {
  const byId = new Map(shots.map(s => [s.id, s]));
  return slots.map(id => (id && byId.has(id) ? popIdOfShot(byId.get(id)) : id));
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
// 出した（共有・保存）画像そのものを控える。ポップのデータとは別に持つ
// （ポップを後で直しても、その日に出した画像は残る）。

/** 画像を残す枚数。超えた古い分から消す（スマホの容量を食い尽くさないため）。各レギュラーの最新の1枚は数えず消さない。 */
export const HISTORY_MAX = 60;

/**
 * 同じ中身を2回残さないための印（ポップは id と更新日時。広告は frames.js の adShotKey）。
 * ポップには日付を入れない（日付はフレームにだけ）ので、直さなければ日が変わっても同じ画像。
 */
export function popShotKey(pop) {
  return `pop:${pop.id}@${pop.updatedAt}`;
}

export function shotFromPop(pop, { w, h, thumb }, now = new Date()) {
  return {
    id: newId(), kind: 'pop', title: popTitle(pop), key: popShotKey(pop),
    w, h, thumb, createdAt: now.toISOString(),
  };
}

/** 新しい順。 */
export function sortHistory(shots) {
  return [...shots].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** 画像を出したポップの id（印 popShotKey から読む）。広告の画像などポップから出していないものは null。 */
export function popIdOfShot(shot) {
  const m = /^pop:(.+?)@/.exec(String(shot.key || ''));
  return m ? m[1] : null;
}

/**
 * 画像がどのレギュラーのものか（レギュラーそのもの、またはレギュラーから作った今日のポップから出した）。
 * 元のポップやレギュラーが消されていれば null。
 */
export function regularIdOfShot(shot, popsById) {
  const pop = popsById.get(popIdOfShot(shot));
  if (!pop) return null;
  const regId = pop.isRegular ? pop.id : pop.fromRegularId;
  return regId && popsById.get(regId)?.isRegular ? regId : null;
}

/**
 * 上限で消さずに残す画像の id（各レギュラーの最新の1枚。広告にレギュラーを並べられるように）。
 * ピンの仕組みは廃止したが、以前ピン（pinnedAt）を付けて残した画像は黙って消さない。
 */
export function keptShotIds(shots, pops) {
  const byId = new Map(pops.map(p => [p.id, p]));
  const seen = new Set(), keep = new Set(shots.filter(s => s.pinnedAt).map(s => s.id));
  for (const s of sortHistory(shots)) {
    const regId = regularIdOfShot(s, byId);
    if (regId && !seen.has(regId)) { seen.add(regId); keep.add(s.id); }
  }
  return keep;
}

/** 上限を超えた、消してよい画像の id（残す画像は数えず、それ以外の古い方から）。 */
export function historyOverflow(shots, pops = [], max = HISTORY_MAX) {
  const keep = keptShotIds(shots, pops);
  return sortHistory(shots).filter(s => !keep.has(s.id)).slice(max).map(s => s.id);
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
