// 保存先（今はスマホの中＝IndexedDB）。
// 将来「どのスマホからでも同じ場所を見る」形にするときは、同じ関数を持つ
// クラウド版を作ってここを差し替える。画面側はこのファイルの関数しか呼ばない。

import { BACKUP_FORMAT, BACKUP_VERSION, mergePops, mergeShots, unreferencedPhotoIds, validateBackup } from './backup.js';
import { DEFAULT_TAX_RATE, historyOverflow, newId } from './model.js';

const DB_NAME = 'seikapop';
const DB_VERSION = 2;   // 2: 作った画像の履歴（shots・shotImages）を追加
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
      // 履歴は一覧用（名前・見本・ピン）と画像本体を分ける（一覧を開くたびに全部の画像を読まないため）
      if (!db.objectStoreNames.contains('shots')) db.createObjectStore('shots', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('shotImages')) db.createObjectStore('shotImages', { keyPath: 'id' });
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

export async function listPops() {
  return run(['pops'], 'readonly', tx => reqDone(tx.objectStore('pops').getAll()));
}

export async function getPop(id) {
  return run(['pops'], 'readonly', tx => reqDone(tx.objectStore('pops').get(id)));
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
 * ピンの無い画像が上限を超えたら古い方を同じトランザクションで消す。
 * 戻り値: { added, pruned }
 */
export async function addShot(shot, blob) {
  return run(['shots', 'shotImages'], 'readwrite', async tx => {
    const shots = await reqDone(tx.objectStore('shots').getAll());
    if (shots.some(s => s.key === shot.key)) return { added: false, pruned: 0 };
    tx.objectStore('shots').put(shot);
    tx.objectStore('shotImages').put({ id: shot.id, blob, type: blob.type });
    const pruned = historyOverflow([...shots, shot]);
    for (const id of pruned) { tx.objectStore('shots').delete(id); tx.objectStore('shotImages').delete(id); }
    return { added: true, pruned: pruned.length };
  });
}

/** ピンの付け外し。外したとき上限を超えていれば古い方を消す。戻り値: 消した数 */
export async function putShotMeta(shot) {
  return run(['shots', 'shotImages'], 'readwrite', async tx => {
    tx.objectStore('shots').put(shot);
    const shots = (await reqDone(tx.objectStore('shots').getAll())).map(s => (s.id === shot.id ? shot : s));
    const pruned = historyOverflow(shots);
    for (const id of pruned) { tx.objectStore('shots').delete(id); tx.objectStore('shotImages').delete(id); }
    return pruned.length;
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

const DEFAULT_SETTINGS = { shopName: '', taxRate: DEFAULT_TAX_RATE, taxRounding: 'decimal' };

export async function getSettings() {
  const rec = await run(['meta'], 'readonly', tx => reqDone(tx.objectStore('meta').get('settings')));
  return { ...DEFAULT_SETTINGS, ...rec?.value };
}

export async function putSettings(value) {
  await run(['meta'], 'readwrite', tx => reqDone(tx.objectStore('meta').put({ key: 'settings', value })));
}

// ---- バックアップ ----

function blobToBase64(blob) {
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
      // ピンだけ重ねた既存の画像は data を持たない（本体は端末にある）
      if (r.data) {
        tx.objectStore('shotImages').put({ id: r.meta.id, type: r.type, blob: base64ToBlob(r.data, r.type) });
      }
    }
    const all = await reqDone(tx.objectStore('shots').getAll());
    for (const id of historyOverflow(all)) { tx.objectStore('shots').delete(id); tx.objectStore('shotImages').delete(id); }
  });
  return { ...merged, shotsAdded: shotMerge.added };
}
