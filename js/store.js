// 保存先（今はスマホの中＝IndexedDB）。
// 将来「どのスマホからでも同じ場所を見る」形にするときは、同じ関数を持つ
// クラウド版を作ってここを差し替える。画面側はこのファイルの関数しか呼ばない。

import { BACKUP_FORMAT, BACKUP_VERSION, mergePops, mergeShots, unreferencedPhotoIds, validateBackup } from './backup.js';
import { outboxReplaced, sortOutbox } from './collect.js';
import { DEFAULT_TAX_RATE, historyOverflow, newId, upgradeDesign } from './model.js';
import { cleanCustomFrames, mergeCustomFrames } from './frames.js';

const DB_NAME = 'seikapop';
const DB_VERSION = 3;   // 2: 作った画像の履歴（shots・shotImages）を追加／3: 事務所へ送る控え（outbox）を追加
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('このブラウザでは保存機能が使えません（プライベートブラウズを外してください）'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('pops')) db.createObjectStore('pops', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      // 履歴は一覧用（名前・見本・日時）と画像本体を分ける（一覧を開くたびに全部の画像を読まないため）
      if (!db.objectStoreNames.contains('shots')) db.createObjectStore('shots', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('shotImages')) db.createObjectStore('shotImages', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
    };
    // 別のタブが古い版で開いたままだと新しい版を開けない。待たされていることを知らせる
    req.onblocked = () => reject(new Error('他のタブで青果ポップが開いたままです。そちらを閉じてから開き直してください'));
    req.onsuccess = () => {
      const db = req.result;
      // 新しい版のアプリが別のタブで開こうとしたら譲る（譲らないと向こうが開けない）
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('保存先を開けませんでした'));
  });
  dbPromise.catch(() => { dbPromise = null; });  // 次に呼ばれたときにやり直せるように
  return dbPromise;
}

function reqDone(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 1つのトランザクションで fn を走らせ、書き込みが確定してから結果を返す。 */
async function run(storeNames, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('保存できませんでした'));
    tx.onabort = () => reject(tx.error || new Error('保存が中断されました（容量不足かもしれません）'));
    Promise.resolve(fn(tx)).then(r => { result = r; }, err => { tx.abort(); reject(err); });
  });
}

// 読むときに古いデザインの選び方を今の形へ直す（「金額主役」→「写真主役」の台紙「爆発」）。次に保存したときに書き換わる
export async function listPops() {
  return (await run(['pops'], 'readonly', tx => reqDone(tx.objectStore('pops').getAll()))).map(upgradeDesign);
}

export async function getPop(id) {
  return upgradeDesign(await run(['pops'], 'readonly', tx => reqDone(tx.objectStore('pops').get(id))));
}

export async function putPop(pop) {
  await run(['pops'], 'readwrite', tx => reqDone(tx.objectStore('pops').put(pop)));
  return pop;
}

export async function deletePop(id) {
  await run(['pops'], 'readwrite', tx => reqDone(tx.objectStore('pops').delete(id)));
  await removeUnusedPhotos();
}

export async function putPhoto(blob) {
  const id = newId();
  await run(['photos'], 'readwrite', tx => reqDone(tx.objectStore('photos').put({ id, blob, type: blob.type })));
  return id;
}

export async function getPhoto(id) {
  const rec = await run(['photos'], 'readonly', tx => reqDone(tx.objectStore('photos').get(id)));
  return rec ? rec.blob : null;
}

/** どのポップ（レギュラー含む）からも使われなくなった写真を消す。 */
export async function removeUnusedPhotos() {
  return run(['pops', 'photos'], 'readwrite', async tx => {
    const pops = await reqDone(tx.objectStore('pops').getAll());
    const ids = await reqDone(tx.objectStore('photos').getAllKeys());
    const unused = unreferencedPhotoIds(pops, ids);
    for (const id of unused) tx.objectStore('photos').delete(id);
    return unused.length;
  });
}

// ---- 作った画像の履歴 ----

export async function listShots() {
  return run(['shots'], 'readonly', tx => reqDone(tx.objectStore('shots').getAll()));
}

export async function getShotImage(id) {
  const rec = await run(['shotImages'], 'readonly', tx => reqDone(tx.objectStore('shotImages').get(id)));
  return rec ? rec.blob : null;
}

/**
 * 画像を履歴に足す。同じ印（key）の画像が既にあれば足さない。
 * 上限を超えたら古い方を同じトランザクションで消す（各レギュラーの最新の1枚は残す）。
 * 戻り値: { added, pruned }
 */
export async function addShot(shot, blob) {
  return run(['shots', 'shotImages', 'pops'], 'readwrite', async tx => {
    const shots = await reqDone(tx.objectStore('shots').getAll());
    if (shots.some(s => s.key === shot.key)) return { added: false, pruned: 0 };
    tx.objectStore('shots').put(shot);
    tx.objectStore('shotImages').put({ id: shot.id, blob, type: blob.type });
    const pops = await reqDone(tx.objectStore('pops').getAll());
    const pruned = historyOverflow([...shots, shot], pops);
    for (const id of pruned) { tx.objectStore('shots').delete(id); tx.objectStore('shotImages').delete(id); }
    return { added: true, pruned: pruned.length };
  });
}

export async function deleteShot(id) {
  await run(['shots', 'shotImages'], 'readwrite', tx => {
    tx.objectStore('shots').delete(id);
    tx.objectStore('shotImages').delete(id);
  });
}

// 広告の作りかけ（フレームと選んだ画像）。1つだけ持つ
export async function getAdDraft() {
  const rec = await run(['meta'], 'readonly', tx => reqDone(tx.objectStore('meta').get('adDraft')));
  return rec?.value || null;
}

export async function putAdDraft(value) {
  await run(['meta'], 'readwrite', tx => reqDone(tx.objectStore('meta').put({ key: 'adDraft', value })));
}

// 名前を付けて保存したカスタムフレーム（frames.js の saveCustomFrame で作った一覧をまるごと持つ）
export async function listCustomFrames() {
  const rec = await run(['meta'], 'readonly', tx => reqDone(tx.objectStore('meta').get('customFrames')));
  return cleanCustomFrames(rec?.value);
}

export async function putCustomFrames(list) {
  await run(['meta'], 'readwrite', tx => reqDone(tx.objectStore('meta').put({ key: 'customFrames', value: list })));
}

// 写真ストックの一覧と小さい見本の控え（次に開いたとき、電波が弱くてもすぐ並べるため）。{ items, thumbs, fetchedAt }
export async function getStockCache() {
  const rec = await run(['meta'], 'readonly', tx => reqDone(tx.objectStore('meta').get('stockCache')));
  return rec?.value || { items: [], thumbs: {}, fetchedAt: null };
}

export async function putStockCache(value) {
  await run(['meta'], 'readwrite', tx => reqDone(tx.objectStore('meta').put({ key: 'stockCache', value })));
}

// 保管したポップ（みんなで使える場所）の一覧と見本の控え。形は写真ストックと同じ
export async function getSavedCache() {
  const rec = await run(['meta'], 'readonly', tx => reqDone(tx.objectStore('meta').get('savedCache')));
  return rec?.value || { items: [], thumbs: {}, fetchedAt: null };
}

export async function putSavedCache(value) {
  await run(['meta'], 'readwrite', tx => reqDone(tx.objectStore('meta').put({ key: 'savedCache', value })));
}

// ---- 事務所へ送る控え ----
// 送り終わるまで画像（と写真）を端末に持つ。届いたら消す。

/** 控えを足す。同じものの古い控え（まだ送れていないもの）は置き換える。 */
export async function queueDelivery(record, image, photo) {
  await run(['outbox'], 'readwrite', async tx => {
    const all = await reqDone(tx.objectStore('outbox').getAll());
    for (const id of outboxReplaced(all, record.key)) tx.objectStore('outbox').delete(id);
    tx.objectStore('outbox').put({ ...record, image, photo: photo || null });
  });
}

/** 送る順（古いものから）の控え。画像の本体も入っている。 */
export async function listOutbox() {
  return sortOutbox(await run(['outbox'], 'readonly', tx => reqDone(tx.objectStore('outbox').getAll())));
}

/** 送れなかった理由を控えに書き残す（消えていたら何もしない）。 */
export async function markOutboxFailed(id, message, now = new Date()) {
  await run(['outbox'], 'readwrite', async tx => {
    const rec = await reqDone(tx.objectStore('outbox').get(id));
    if (rec) tx.objectStore('outbox').put({ ...rec, tries: (rec.tries || 0) + 1, lastError: message, lastTriedAt: now.toISOString() });
  });
}

export async function deleteOutbox(id) {
  await run(['outbox'], 'readwrite', tx => reqDone(tx.objectStore('outbox').delete(id)));
}

const DEFAULT_SETTINGS = { taxRate: DEFAULT_TAX_RATE, taxRounding: 'decimal' };   // 前の店名（shopName）は使わない（フレームに入れない）

export async function getSettings() {
  const rec = await run(['meta'], 'readonly', tx => reqDone(tx.objectStore('meta').get('settings')));
  return { ...DEFAULT_SETTINGS, ...rec?.value };
}

export async function putSettings(value) {
  await run(['meta'], 'readwrite', tx => reqDone(tx.objectStore('meta').put({ key: 'settings', value })));
}

/** 設定の一部だけを書き換える（読み直してから書くので、ほかの画面が書いた合言葉などを古い中身で上書きしない）。 */
export async function patchSettings(patch) {
  await putSettings({ ...await getSettings(), ...patch });
}

// ---- バックアップ ----

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type || 'image/jpeg' });
}

export async function exportBackup() {
  const pops = await listPops();
  const recs = await run(['photos'], 'readonly', tx => reqDone(tx.objectStore('photos').getAll()));
  const photos = [];
  for (const r of recs) photos.push({ id: r.id, type: r.type, data: await blobToBase64(r.blob) });
  const shotMetas = await listShots();
  const shots = [];
  for (const m of shotMetas) {
    const blob = await getShotImage(m.id);
    if (blob) shots.push({ ...m, type: blob.type, data: await blobToBase64(blob) });
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: await getSettings(),
    customFrames: await listCustomFrames(),
    pops,
    photos,
    shots,
  };
}

/** バックアップを重ねて読み込む（今のデータは消さない）。 */
export async function importBackup(obj) {
  const v = validateBackup(obj);
  if (!v.ok) throw new Error(v.message);
  const existing = await listPops();
  const merged = mergePops(existing, obj.pops);
  const photoIds = new Set(merged.toPut.map(p => p.photoId).filter(Boolean));
  const photos = obj.photos.filter(ph => photoIds.has(ph.id))
    .map(ph => ({ id: ph.id, type: ph.type, blob: base64ToBlob(ph.data, ph.type) }));
  const shotMerge = mergeShots(await listShots(), obj.shots || []);
  const shotRecs = shotMerge.toPut.map(({ data, type, ...meta }) => ({ meta, data, type }));
  // 写真とポップは同じトランザクションで書く（ポップだけ入って写真が無い、を作らない）
  await run(['pops', 'photos', 'shots', 'shotImages'], 'readwrite', async tx => {
    for (const ph of photos) tx.objectStore('photos').put(ph);
    for (const p of merged.toPut) tx.objectStore('pops').put(p);
    for (const r of shotRecs) {
      tx.objectStore('shots').put(r.meta);
      if (r.data) {
        tx.objectStore('shotImages').put({ id: r.meta.id, type: r.type, blob: base64ToBlob(r.data, r.type) });
      }
    }
    const all = await reqDone(tx.objectStore('shots').getAll());
    const pops = await reqDone(tx.objectStore('pops').getAll());
    for (const id of historyOverflow(all, pops)) { tx.objectStore('shots').delete(id); tx.objectStore('shotImages').delete(id); }
  });
  // カスタムフレーム（後から足した欄。無い古いバックアップでは何もしない）
  const frames = mergeCustomFrames(await listCustomFrames(), obj.customFrames || []);
  if (frames.added || obj.customFrames?.length) await putCustomFrames(frames.list);
  return { ...merged, shotsAdded: shotMerge.added, framesAdded: frames.added };
}
