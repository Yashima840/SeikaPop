// 作ったポップを事務所（法人の Google ドライブ）へ集める仕組みの、計算と判定だけ。
// 送るのは js/sender.js、控えておくのは store.js。受け取り口は tools/collector/。
//
// 流れ: 共有・保存（「みんなで使える場所に保管」に印があるとき）→ 送るものを端末に控える（outbox）→ つながっていれば送る
//       → 届いたら控えを消す。送れなければ控えたまま、次に開いたときにまた送る。
// 写真ストック（どの端末からでも呼び出せる写真の置き場。ドライブの「青果ポップ 写真ストック」）も同じ受け取り口を使う。
//       足すのは控えて送る（kind: 'stock'）、読むのはその場で問い合わせる。

import { contentOf, localStamp, popTitle } from './model.js';

export const DELIVERY_FORMAT = 'seikapop-delivery';
export const DELIVERY_VERSION = 1;

// 受け取り口（Google Apps Script のウェブアプリ）の URL の形。
// 違う所へ送らせないように、この形以外は受け付けない。
// 法人用（Google Workspace）のアカウントで作ると /a/macros/<会社のドメイン>/s/… になる
const COLLECTOR_URL = /^https:\/\/script\.google\.com\/(?:a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/;
const PASSCODE = /^[\w-]{8,64}$/;

// この店の受け取り口（法人アカウントのウェブアプリ）。URL だけでは送れない（合言葉が要る）ので、公開されても困らない。
// 店員さんは合言葉を1回打つだけで設定できる。別の店で使うときはここを差し替える（設定用リンクで別の URL も入れられる）。
export const BUILT_IN_COLLECTOR_URL =
  'https://script.google.com/macros/s/AKfycbytU4tbwjjDlPVbi5vWbptmh3Ar3XddpZOPm4FT9V6DmR7IweiZh7Xc3A1gpHuGVHbQxA/exec';

/** 設定から送り先を取り出す。URL を入れていない端末は組み込みの受け取り口へ送る。ready: 送れる状態か。 */
export function collectorOf(settings) {
  const c = settings?.collector || {};
  const url = c.url || BUILT_IN_COLLECTOR_URL;
  const ready = COLLECTOR_URL.test(url) && PASSCODE.test(c.passcode || '');
  return { ready, url, passcode: c.passcode || '', sender: String(c.sender || '').trim() };
}

/**
 * 設定画面で打った合言葉を読む。全角で打っても半角にし、前後の空白は除く。
 * 前の設定用リンクを貼り付けたときは、その中の送り先と合言葉を使う。
 * { ok, url, passcode } か { ok:false, message }（url が空なら組み込みの受け取り口）。
 */
export function parsePasscodeInput(text) {
  const s = String(text ?? '').normalize('NFKC').trim();
  if (!s) return { ok: false, message: '合言葉を入れてください（事務所で聞いてください）' };
  if (s.includes('#/setup?')) return parseSetupCode(s);
  if (!PASSCODE.test(s)) {
    return { ok: false, message: '合言葉は英字・数字・「-」「_」で8文字以上です（空白や記号が入っていないか確かめてください）' };
  }
  return { ok: true, url: '', passcode: s };
}

// 覚えやすい合言葉に使う言葉（青果のローマ字。打ち間違えにくい短いもの）
const EASY_WORDS = [
  'tomato', 'kyuuri', 'ninjin', 'daikon', 'kabocha', 'negi', 'nasu', 'piman', 'ringo', 'mikan', 'ichigo', 'budou',
  'momo', 'nashi', 'kaki', 'renkon', 'gobou', 'hakusai', 'kyabetsu', 'retasu', 'tamanegi', 'jagaimo', 'shouga',
  'ninniku', 'edamame', 'suika', 'meron', 'banana', 'kiwi', 'remon', 'yuzu', 'satoimo',
];

/**
 * 口で伝えられる合言葉（言葉3つ＋3桁の数。例 tomato-negi-kaki-482）。約3,300万通り。
 * bytes は乱数（crypto.getRandomValues の Uint8Array、6個以上）。テストで決まった値を渡せるように外から受け取る。
 */
export function makeEasyPasscode(bytes) {
  const words = [0, 1, 2].map(i => EASY_WORDS[bytes[i] % EASY_WORDS.length]);
  const num = ((bytes[3] << 16) | (bytes[4] << 8) | bytes[5]) % 1000;
  return [...words, String(num).padStart(3, '0')].join('-');
}

/**
 * 「保存する」で実際にどこへ置くか。choice は画面のチェック（shared: みんなで使える場所＝事務所のドライブ／
 * phone: この端末／regular: レギュラー）。送り先が未設定なら shared は外す。none: 置く所が1つも無い。
 */
export function saveTargets(choice, collectorReady) {
  const t = { shared: !!choice.shared && !!collectorReady, phone: !!choice.phone, regular: !!choice.regular };
  return { ...t, none: !t.shared && !t.phone && !t.regular };
}

/** 事務所が店員さんへ配る設定用リンク（アプリのURL＋#/setup?u=…&k=…）。 */
export function makeSetupLink(appUrl, url, passcode) {
  const base = String(appUrl).replace(/#.*$/, '');
  const q = new URLSearchParams({ u: url, k: passcode });
  return `${base}#/setup?${q}`;
}

/**
 * 設定用リンク（または貼り付けた文字）から送り先を読む。読めなければ理由を返す。
 * iPhone はホーム画面のアプリと Safari で保存場所が別なので、リンクを開くだけでなく
 * 「貼り付けて読む」でも同じものを受け付ける。
 */
export function parseSetupCode(text) {
  const s = String(text ?? '').trim();
  const at = s.indexOf('#/setup?');
  if (at < 0) return { ok: false, message: '設定用リンクではありません（事務所から届いたリンクをそのまま貼り付けてください）' };
  const q = new URLSearchParams(s.slice(at + '#/setup?'.length).split(/\s/)[0]);
  const url = q.get('u') || '', passcode = q.get('k') || '';
  if (!COLLECTOR_URL.test(url)) return { ok: false, message: '送り先のアドレスが正しくありません（リンクが途中で切れているかもしれません）' };
  if (!PASSCODE.test(passcode)) return { ok: false, message: '合言葉が正しくありません（リンクが途中で切れているかもしれません）' };
  return { ok: true, url, passcode };
}

/** 合言葉の形か（受け取り口の設置手順で、事務所が決めるときの検査にも使う）。 */
export function isValidPasscode(s) {
  return PASSCODE.test(String(s ?? ''));
}

/**
 * 同じものを2回送ったとき、ドライブ側で最新の1件にまとめるための印。
 * ポップは id ごと（同じポップをLINEとInstagramに出しても1件）、広告は組み合わせごと。
 */
export function deliveryKey(kind, id) {
  return `${kind}:${id}`;
}

/** ドライブに置くファイル名（拡張子なし）。いつ・誰が・何を、が一目で分かるように。端末の時刻で。 */
export function deliveryBaseName(createdAt, sender, title, id) {
  const d = new Date(createdAt);
  const stamp = Number.isNaN(d.getTime()) ? 'unknown' : localStamp(d, true);
  const clean = (s, n) => String(s ?? '').trim().replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, n);
  return [stamp, clean(sender, 12) || '名前なし', clean(title, 20) || 'pop', String(id).slice(0, 6)].join('_');
}

/** ポップを送るときの控え（送る時点の中身を写し取る。後でポップを直しても送るものは変わらない）。 */
export function popOutboxRecord(pop, { id, sender, now = new Date() }) {
  // photoId・thumb は端末の中でしか意味が無い（写真は photo、見た目は image で別に送る）
  const { photoId: _photoId, thumb: _thumb, ...content } = contentOf(pop);
  return {
    id, key: deliveryKey('pop', pop.id), kind: 'pop', title: popTitle(pop),
    sender, createdAt: now.toISOString(), pop: { id: pop.id, ...content },
    tries: 0, lastError: null,
  };
}

/** 広告を送るときの控え（広告は作り直し用のデータを持たないので画像だけ）。 */
export function adOutboxRecord(shot, { id, sender, now = new Date() }) {
  return {
    id, key: deliveryKey('ad', shot.key), kind: 'ad', title: shot.title,
    sender, createdAt: now.toISOString(), pop: null, tries: 0, lastError: null,
  };
}

/**
 * 写真ストックへ足す写真の控え（写真の本体は image で送る）。同じ写真を2回入れても1枚にまとまる。
 * title＝ストックでの名前（ふつうは商品名）。
 */
export function stockOutboxRecord(photoId, title, { id, sender, now = new Date() }) {
  return {
    id, key: deliveryKey('stock', photoId), kind: 'stock', title: String(title || '').trim() || '写真',
    sender, createdAt: now.toISOString(), pop: null, tries: 0, lastError: null,
  };
}

/**
 * ストックの一覧に並べる見本の大きさ（長い辺 px）と JPEG の画質。送るときに端末で作り、受け取り口がまとめて持つ
 * （ドライブが作る見本は PNG で1枚数十KBあり、一覧を開くたびの通信が重いため。これなら1枚数KB）。
 */
export const STOCK_THUMB = Object.freeze({ side: 200, quality: 0.7 });

/** PC からストックへ送る写真の名前（ファイル名から拡張子を外したもの。空なら「写真」）。 */
export function stockTitleOf(fileName) {
  return String(fileName || '').trim().replace(/\.[a-z0-9]{2,5}$/i, '').trim() || '写真';
}

/**
 * PC からストックへ送る写真の印（ファイルの中身の SHA-256 から作る）。
 * 同じ写真を送り直しても、受け取り口が前の1枚を置き換えるので、ストックに同じ写真が並ばない。
 */
export function stockFileKey(digest) {
  const hex = Array.from(new Uint8Array(digest).slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
  return `file-${hex}`;
}

/** 写真ストックを読む本文（action: stock-list / stock-thumbs / stock-get）。 */
export function stockRequestBody(passcode, action, extra = {}) {
  return { format: DELIVERY_FORMAT, version: DELIVERY_VERSION, passcode, action, ...extra };
}

// 写真ストックに対応する前の受け取り口は、ストックの問い合わせを「画像の無い送信」として断る
const OLD_COLLECTOR = '事務所の受け取り口が古い版です（事務所で Code.gs を差し替えて「新バージョン」でデプロイしてください）';

/** ストックの問い合わせの返事を読む。ok なら reply をそのまま data に入れて返す。 */
export function readStockReply(reply) {
  const r = readReply(reply);
  if (!r.ok) return reply && typeof reply === 'object' && !reply.stock && reply.message === '画像が入っていません' ? { ok: false, message: OLD_COLLECTOR } : r;
  if (!reply.stock) return { ok: false, message: OLD_COLLECTOR };
  return { ok: true, data: reply };
}

/** ストックの一覧を、画面で使う形にそろえる（名前の拡張子と、アプリが付けた日時・名前の前置きは見せない）。 */
export function stockItems(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(x => x && typeof x.id === 'string').map(x => ({
    id: x.id, name: stockLabel(x.name), file: String(x.name || ''), type: String(x.type || ''),
    size: Number(x.size) || 0, updated: String(x.updated || ''),
  }));
}

/** 「20261027-0830_田中_トマト_1a2b3c.jpg」→「トマト（田中）」。PC で入れた名前はそのまま（拡張子だけ外す）。 */
export function stockLabel(fileName) {
  const base = String(fileName || '').replace(/\.[a-z0-9]{2,5}$/i, '');
  const m = /^\d{8}-\d{4}_([^_]+)_(.+)_[\w-]{1,6}$/.exec(base);
  if (!m) return base || '（名前なし）';
  return m[1] === '名前なし' ? m[2] : `${m[2]}（${m[1]}）`;
}

/** ストックを名前で絞る（空なら全部）。全角・半角やカタカナ・ひらがなの違いは気にしない。 */
export function filterStock(items, query) {
  const norm = s => String(s).normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const q = norm(query).trim();
  if (!q) return items;
  const words = q.split(/\s+/);
  return items.filter(x => words.every(w => norm(x.name).includes(w)));
}

/**
 * 受け取り口へ送る本文。image / photo は { type, data(base64) }。
 * ストックの写真（kind: stock）では、2つ目は写真ではなく一覧に並べる小さい見本（thumb）として送る。
 */
export function deliveryBody(record, passcode, image, photo) {
  const stock = record.kind === 'stock';
  return {
    format: DELIVERY_FORMAT, version: DELIVERY_VERSION, passcode,
    key: record.key, kind: record.kind, title: record.title, sender: record.sender, createdAt: record.createdAt,
    name: deliveryBaseName(record.createdAt, record.sender, record.title, record.id),
    pop: record.pop, image, photo: stock ? null : photo || null,
    ...(stock ? { thumb: photo || null } : {}),
  };
}

/** 送り先を確かめるだけの本文（受け取り口は合言葉だけ見て、何も保存しない）。 */
export function pingBody(passcode) {
  return { format: DELIVERY_FORMAT, version: DELIVERY_VERSION, passcode, ping: true };
}

/** 受け取り口の返事を読む。ok でなければ画面に出す理由を付ける。 */
export function readReply(reply) {
  if (!reply || typeof reply !== 'object') return { ok: false, message: '送り先から読める返事がありません（設置の手順を確かめてください）' };
  if (reply.ok === true) return { ok: true };
  if (reply.code === 'passcode') return { ok: false, stop: true, message: '合言葉が違います（事務所で今の合言葉を聞いて、⚙ 設定 →「みんなで使える場所」で入れ直してください）' };
  return { ok: false, message: `送り先で失敗しました: ${reply.message || '理由不明'}` };
}

/** 控えに新しいものを足すとき、同じ印の古い控えは送らずに置き換える（最新の1件だけ送ればよい）。 */
export function outboxReplaced(records, key) {
  return records.filter(r => r.key === key).map(r => r.id);
}

/** 送る順（古いものから）。 */
export function sortOutbox(records) {
  return [...records].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}
