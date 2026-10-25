// 作ったポップを事務所（法人の Google ドライブ）へ送る。判定は collect.js、控えは store.js。
// 送れないときは控えたまま、次の機会（アプリを開いた・電波が戻った・表へ戻った）に送り直す。

import * as store from './store.js';
import { adOutboxRecord, collectorOf, deliveryBody, pingBody, popOutboxRecord, readReply } from './collect.js';
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

async function post(url, body) {
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
    return readReply(reply);
  } catch (err) {
    const message = err?.name === 'AbortError'
      ? '送るのに時間がかかりすぎました（電波を確かめてください）'
      : '送れませんでした（電波が無いか、送り先に届きません）';
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
