// バックアップ（書き出し・読み込み）と写真の後片付けの判定。純粋な関数だけ。

import { localStamp } from './model.js';

export const BACKUP_FORMAT = 'seikapop-backup';
export const BACKUP_VERSION = 1;

/** 読み込んだJSONがこのアプリのバックアップか確かめる。違えば理由を返す。 */
export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, message: 'ファイルの中身が読めません' };
  if (obj.format !== BACKUP_FORMAT) return { ok: false, message: 'このアプリのバックアップファイルではありません' };
  if (obj.version > BACKUP_VERSION) {
    return { ok: false, message: 'より新しい版で作られたバックアップです。アプリを更新してから読み込んでください' };
  }
  if (!Array.isArray(obj.pops) || !Array.isArray(obj.photos)) {
    return { ok: false, message: 'バックアップの形が壊れています（pops / photos がありません）' };
  }
  const bad = obj.pops.find(p => !p || typeof p.id !== 'string');
  if (bad !== undefined) return { ok: false, message: 'id の無いポップが含まれています' };
  // shots（作った画像の履歴）は後から足した欄。無い古いバックアップもそのまま読める
  if (obj.shots != null) {
    if (!Array.isArray(obj.shots)) return { ok: false, message: 'バックアップの形が壊れています（shots が一覧になっていません）' };
    const badShot = obj.shots.find(s => !s || typeof s.id !== 'string' || typeof s.data !== 'string');
    if (badShot !== undefined) return { ok: false, message: '画像の欠けた履歴が含まれています' };
  }
  return { ok: true };
}

/**
 * 今あるポップへバックアップを重ねる。同じ id は更新日時が新しい方を残す
 * （古いバックアップを読み込んで、今朝直した分が戻ってしまわないように）。
 */
export function mergePops(existing, incoming) {
  const byId = new Map(existing.map(p => [p.id, p]));
  const toPut = [];
  let added = 0, updated = 0, skipped = 0;
  for (const p of incoming) {
    const cur = byId.get(p.id);
    if (!cur) { toPut.push(p); added += 1; continue; }
    if (String(p.updatedAt) > String(cur.updatedAt)) { toPut.push(p); updated += 1; } else { skipped += 1; }
  }
  return { toPut, added, updated, skipped };
}

/**
 * 作った画像の履歴を重ねる。履歴の画像は後から変わらないので、無いものだけ足す。
 * ピンだけは「どちらかで付けていれば付ける」（重ねてピンが外れる、を起こさない）。
 */
export function mergeShots(existing, incoming) {
  const byId = new Map(existing.map(s => [s.id, s]));
  const toPut = [];
  let added = 0;
  for (const s of incoming) {
    const cur = byId.get(s.id);
    if (!cur) { toPut.push(s); added += 1; } else if (s.pinnedAt && !cur.pinnedAt) toPut.push({ ...cur, pinnedAt: s.pinnedAt });
  }
  return { toPut, added };
}

/** どのポップからも使われていない写真の id（消してよいもの）。 */
export function unreferencedPhotoIds(pops, photoIds) {
  const used = new Set(pops.map(p => p.photoId).filter(Boolean));
  return photoIds.filter(id => !used.has(id));
}

export function backupFileName(now = new Date()) {
  return `seikapop-backup_${localStamp(now, true)}.json`;
}
