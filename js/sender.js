// 作ったポップを事務所（法人の Google ドライブ）へ送る。写真ストックの読み書きもここ。判定は collect.js、控えは store.js。
// 送れないときは控えたまま、次の機会（アプリを開いた・電波が戻った・表へ戻った）に送り直す。

import * as store from './store.js';
import {
  adOutboxRecord, collectorOf, deliveryBody, pingBody, popOutboxRecord, readReply, readStockReply, stockItems,
  STOCK_THUMB, stockOutboxRecord, stockRequestBody,
} from './collect.js';
import { shrinkPhoto } from './image.js';
import { newId } from './model.js';
import { recordError } from './crash.js';

const TIMEOUT_MS = 60000;
let flushing = null;
const listeners = new Set();

/** 控えの数が変わったら呼ぶ（はじめの画面・設定画面の表示用）。戻り値で解除する。 */
export function onOutboxChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) {
    try { fn(); } catch (err) { recordError('outbox listener', err); }
  }
}

async function post(url, body, read = readReply) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // text/plain で送る（application/json だと事前の問い合わせが要り、Apps Script はそれに答えない）
    const res = await fetch(url, {
      method: 'POST', body: JSON.stringify(body), signal: ctrl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    });
    let reply = null;
    try { reply = await res.json(); } catch { /* 読めない返事は下の readReply が理由付きで失敗にする */ }
    if (!reply && !res.ok) return { ok: false, message: `送り先が応答しません（${res.status}）` };
    return read(reply);
  } catch (err) {
    const message = err?.name === 'AbortError'
      ? '送るのに時間がかかりすぎました（電波を確かめてください）'
      : '事務所につながりませんでした（電波が無いか、送り先に届きません）';
    return { ok: false, offline: true, message };
  } finally {
    clearTimeout(timer);
  }
}

/** ポップを送る控えに足して、送り始める。送り先が未設定なら何もしない（false）。 */
export async function queuePop(pop, image) {
  // 中身は呼ばれた時点で写し取る（この後で打ち直されても、出した画像と食い違わないように）
  const record = popOutboxRecord(pop, { id: newId(), sender: '' });
  const c = collectorOf(await store.getSettings());
  if (!c.ready) return false;
  const photo = pop.photoId ? await store.getPhoto(pop.photoId) : null;
  await store.queueDelivery({ ...record, sender: c.sender }, image, photo);
  notify();
  flushOutbox();
  return true;
}

/** 広告（画像だけ）を送る控えに足して、送り始める。 */
export async function queueAd(shot, image) {
  const record = adOutboxRecord(shot, { id: newId(), sender: '' });
  const c = collectorOf(await store.getSettings());
  if (!c.ready) return false;
  await store.queueDelivery({ ...record, sender: c.sender }, image, null);
  notify();
  flushOutbox();
  return true;
}

// ---- 写真ストック（どの端末からでも呼び出せる写真の置き場）----

/** 写真をストックに足す控えを作って、送り始める。送り先が未設定なら false。 */
export async function queueStockPhoto(photoId, title) {
  const c = collectorOf(await store.getSettings());
  if (!c.ready) return false;
  const photo = await store.getPhoto(photoId);
  if (!photo) throw new Error('写真の本体が見つかりません');
  await store.queueDelivery(stockOutboxRecord(photoId, title, { id: newId(), sender: c.sender }), photo, await stockThumbOf(photo));
  notify();
  flushOutbox();
  return true;
}

/**
 * PC の作業場から、写真を1枚ストックへ送る。控えには残さず、その場で結果を返す
 * （作業場の画面が送れなかった写真と理由を並べ、送り直してもらう）。key は stockFileKey で作った印。
 */
export async function sendStockPhoto({ url, passcode, sender }, photo, title, key) {
  const record = stockOutboxRecord(key, title, { id: newId(), sender });
  return post(url, deliveryBody(record, passcode, await asData(photo), await asData(await stockThumbOf(photo))));
}

/** ストックの一覧に並べる小さい見本（JPEG）。 */
export function stockThumbOf(blob) {
  return shrinkPhoto(blob, STOCK_THUMB.side, STOCK_THUMB.quality);
}

/**
 * ストックに問い合わせる（控えずにその場で）。{ ok, data } か { ok:false, message }。
 * admin＝PC の作業場で打った送り先 { url, passcode }（無ければこの端末の設定のもの）。
 */
async function askStock(action, extra, admin = null) {
  const c = admin || collectorOf(await store.getSettings());
  if (!admin && !c.ready) return { ok: false, notSet: true, message: '合言葉がまだ入っていません（⚙ 設定 →「みんなで使える場所」）' };
  return post(c.url, stockRequestBody(c.passcode, action, extra), readStockReply);
}

/** ストックの一覧。{ ok, items, skipped（一覧に出せない形の写真の数）} */
export async function fetchStockList(admin = null) {
  const r = await askStock('stock-list', {}, admin);
  return r.ok ? { ok: true, items: stockItems(r.data.items), skipped: Number(r.data.skipped) || 0 } : r;
}

/**
 * 小さい見本（id → data URL）。無いものは入らない。
 * heavy＝受け取り口に軽い見本がまだ無く、ドライブが作った重い見本を返してきた id（端末で縮めて putStockThumbs で返す）。
 */
export async function fetchStockThumbs(ids, admin = null) {
  const r = await askStock('stock-thumbs', { ids }, admin);
  if (!r.ok) return r;
  const thumbs = {}, heavy = [];
  for (const [id, t] of Object.entries(r.data.thumbs || {})) {
    if (!t?.data) continue;
    thumbs[id] = `data:${t.type || 'image/png'};base64,${t.data}`;
    if (t.drive) heavy.push(id);
  }
  return { ok: true, thumbs, heavy };
}

/**
 * 受け取り口に軽い見本が無かった写真（fetchStockThumbs の heavy。ドライブに直接入れた写真など）の重い見本を端末で縮め、
 * 受け取り口へ預け直す（次からはどの端末にも軽い見本が届く）。縮めた見本（id → data URL）を返す。
 * 預けられなくても縮めた見本はこの端末で使えるので、失敗は記録だけ残す。
 */
export async function lightenStockThumbs(thumbs, ids, admin = null) {
  const small = {}, body = {};
  for (const id of ids) {
    const data = await store.blobToBase64(await stockThumbOf(await (await fetch(thumbs[id])).blob()));
    small[id] = `data:image/jpeg;base64,${data}`;
    body[id] = { type: 'image/jpeg', data };
  }
  if (ids.length) {
    const r = await askStock('stock-thumbs-put', { thumbs: body }, admin);
    if (!r.ok) recordError('stock thumbs put', new Error(r.message));
  }
  return small;
}

/** ストックの写真の名前を変える（PC の作業場から）。拡張子は受け取り口がそのまま残す。{ ok, name } */
export async function renameStockPhoto(admin, id, name) {
  const r = await askStock('stock-rename', { id, name }, admin);
  return r.ok ? { ok: true, name: String(r.data.name || '') } : r;
}

/** ストックの写真をドライブのゴミ箱へ移す（PC の作業場から。30日はドライブから戻せる）。{ ok, trashed } */
export async function trashStockPhotos(admin, ids) {
  const r = await askStock('stock-trash', { ids }, admin);
  return r.ok ? { ok: true, trashed: Number(r.data.trashed) || 0 } : r;
}

/** 写真の本体（Blob）。 */
export async function fetchStockImage(id) {
  const r = await askStock('stock-get', { id });
  if (!r.ok) return r;
  const img = r.data.image;
  if (!img?.data) return { ok: false, message: '写真の中身が届きませんでした' };
  const bin = atob(img.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { ok: true, blob: new Blob([bytes], { type: img.type || 'image/jpeg' }) };
}

async function asData(blob) {
  return { type: blob.type || 'image/jpeg', data: await store.blobToBase64(blob) };
}

async function sendAll() {
  const c = collectorOf(await store.getSettings());
  if (!c.ready) return { sent: 0, failed: 0 };
  let sent = 0, failed = 0;
  for (const rec of await store.listOutbox()) {
    // 名前を後から入れた人の分は、送る時点の名前で出す
    const body = deliveryBody({ ...rec, sender: rec.sender || c.sender }, c.passcode,
      await asData(rec.image), rec.photo ? await asData(rec.photo) : null);
    const r = await post(c.url, body);
    if (r.ok) {
      await store.deleteOutbox(rec.id);
      sent++;
      notify();
      continue;
    }
    failed++;
    await store.markOutboxFailed(rec.id, r.message);
    // 電波・合言葉の失敗は残りも同じく失敗するので、次の機会にまとめて送る
    if (r.offline || r.stop) break;
  }
  return { sent, failed };
}

/** 控えを全部送る。重ねて呼ばれても1本にまとめる。失敗は控えに理由を残す（例外は投げない）。 */
export function flushOutbox() {
  if (!flushing) {
    flushing = sendAll()
      .catch(err => { recordError('flushOutbox', err); return { sent: 0, failed: 0, error: err.message }; })
      .finally(() => { flushing = null; notify(); });
  }
  return flushing;
}

/** 送り先と合言葉が通じるかだけを確かめる（何も保存されない）。 */
export function pingCollector(url, passcode) {
  return post(url, pingBody(passcode));
}

/** 控えの数と、いちばん新しい失敗の理由。 */
export async function outboxStatus() {
  const recs = await store.listOutbox();
  const failed = recs.filter(r => r.lastError).sort((a, b) => String(b.lastTriedAt).localeCompare(String(a.lastTriedAt)));
  return { count: recs.length, lastError: failed[0]?.lastError || null };
}
