// 作ったポップを事務所（法人の Google ドライブ）へ集める仕組みの、計算と判定だけ。
// 送るのは js/sender.js、控えておくのは store.js。受け取り口は tools/collector/。
//
// 流れ: 共有・保存・履歴に残す → 送るものを端末に控える（outbox）→ つながっていれば送る
//       → 届いたら控えを消す。送れなければ控えたまま、次に開いたときにまた送る。

import { contentOf, localStamp, popTitle } from './model.js';

export const DELIVERY_FORMAT = 'seikapop-delivery';
export const DELIVERY_VERSION = 1;

// 受け取り口（Google Apps Script のウェブアプリ）の URL の形。
// 違う所へ送らせないように、この形以外は受け付けない。
// 法人用（Google Workspace）のアカウントで作ると /a/macros/<会社のドメイン>/s/… になる
const COLLECTOR_URL = /^https:\/\/script\.google\.com\/(?:a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/;
const PASSCODE = /^[\w-]{8,64}$/;

/** 設定から送り先を取り出す。ready: 送れる状態か。 */
export function collectorOf(settings) {
  const c = settings?.collector || {};
  const ready = COLLECTOR_URL.test(c.url || '') && PASSCODE.test(c.passcode || '');
  return { ready, url: c.url || '', passcode: c.passcode || '', sender: String(c.sender || '').trim() };
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

/** 受け取り口へ送る本文。image / photo は { type, data(base64) }。 */
export function deliveryBody(record, passcode, image, photo) {
  return {
    format: DELIVERY_FORMAT, version: DELIVERY_VERSION, passcode,
    key: record.key, kind: record.kind, title: record.title, sender: record.sender, createdAt: record.createdAt,
    name: deliveryBaseName(record.createdAt, record.sender, record.title, record.id),
    pop: record.pop, image, photo: photo || null,
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
  if (reply.code === 'passcode') return { ok: false, stop: true, message: '合言葉が違います（事務所から新しい設定用リンクをもらってください）' };
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
