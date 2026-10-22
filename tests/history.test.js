// 作った画像の履歴（ピン・上限・重複）と、バックアップへの重ね方
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPop, formatShotTime, historyOverflow, popShotKey, setPinned, shotFileName, shotFromPop, sortHistory,
} from '../js/model.js';
import { mergeShots, validateBackup, BACKUP_FORMAT } from '../js/backup.js';

const shot = (id, createdAt, pinnedAt = null) => ({ id, createdAt, pinnedAt, key: id, kind: 'pop', title: id });

test('ピン付きが最上段（後から付けたものほど上）、その下は新しい順', () => {
  const list = [
    shot('old', '2026-10-01T00:00:00Z'),
    shot('pinA', '2026-09-01T00:00:00Z', '2026-10-05T00:00:00Z'),
    shot('new', '2026-10-20T00:00:00Z'),
    shot('pinB', '2026-08-01T00:00:00Z', '2026-10-10T00:00:00Z'),
  ];
  assert.deepEqual(sortHistory(list).map(s => s.id), ['pinB', 'pinA', 'new', 'old']);
});

test('上限を超えたら、ピンの無いものの古い方だけを消す（ピン付きは数えず、古くても消さない）', () => {
  const list = [
    shot('p', '2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z'),
    shot('a', '2026-10-03T00:00:00Z'), shot('b', '2026-10-02T00:00:00Z'), shot('c', '2026-10-01T00:00:00Z'),
  ];
  assert.deepEqual(historyOverflow(list, 2), ['c']);
  assert.deepEqual(historyOverflow(list, 3), []);
});

test('ピンを外すと付けた日時が消え、付けると今の時刻になる', () => {
  const now = new Date('2026-10-22T00:00:00Z');
  const s = setPinned(shot('a', '2026-10-01T00:00:00Z'), true, now);
  assert.equal(s.pinnedAt, now.toISOString());
  assert.equal(setPinned(s, false).pinnedAt, null);
});

test('同じポップを直さずに2回出しても同じ印＝履歴は1枚。直せば別の印', () => {
  const now = new Date(2026, 9, 22, 7, 0);
  const pop = { ...createPop(), showDate: false };
  assert.equal(popShotKey(pop, now), popShotKey(pop, now));
  assert.notEqual(popShotKey(pop, now), popShotKey({ ...pop, updatedAt: '2026-10-22T00:00:01Z' }, now));
});

test('日付を入れるポップは、直していなくても日が変われば別の画像として残す（日付が違うため）', () => {
  const pop = { ...createPop(), showDate: true };
  assert.notEqual(popShotKey(pop, new Date(2026, 9, 22, 7)), popShotKey(pop, new Date(2026, 9, 23, 7)));
  const noDate = { ...pop, showDate: false };
  assert.equal(popShotKey(noDate, new Date(2026, 9, 22, 7)), popShotKey(noDate, new Date(2026, 9, 23, 7)));
});

test('ポップから作る履歴は、ピン無し・商品名を題名に持つ', () => {
  const s = shotFromPop({ ...createPop(), name: ' 完熟トマト ' }, { w: 1080, h: 1350, thumb: 'data:x' });
  assert.equal(s.title, '完熟トマト');
  assert.equal(s.pinnedAt, null);
  assert.equal(s.kind, 'pop');
  assert.deepEqual([s.w, s.h], [1080, 1350]);
});

test('出し直すファイル名と一覧の日時は端末の時刻（朝9時前に前日にならない）', () => {
  const at = new Date(2026, 9, 22, 7, 5).toISOString();
  assert.equal(shotFileName({ kind: 'ad', createdAt: at }), 'ad_20261022-0705.jpg');
  assert.equal(shotFileName({ kind: 'pop', createdAt: at }), 'pop_20261022-0705.jpg');
  assert.equal(formatShotTime(at), '10/22(木) 7:05');
  assert.equal(formatShotTime('壊れた値'), '');
});

test('履歴の無い古いバックアップも読める。履歴があれば画像の欠けを止める', () => {
  const base = { format: BACKUP_FORMAT, version: 1, pops: [], photos: [] };
  assert.equal(validateBackup(base).ok, true);
  assert.equal(validateBackup({ ...base, shots: [{ id: 'a', data: 'xx' }] }).ok, true);
  assert.equal(validateBackup({ ...base, shots: [{ id: 'a' }] }).ok, false);
  assert.equal(validateBackup({ ...base, shots: 'x' }).ok, false);
});

test('履歴を重ねると無いものだけ足し、ピンはどちらかで付いていれば残す', () => {
  const existing = [shot('a', 't1'), shot('b', 't1', 'p1')];
  const incoming = [shot('a', 't1', 'p2'), shot('b', 't1'), shot('c', 't2')];
  const r = mergeShots(existing, incoming);
  assert.equal(r.added, 1);
  assert.deepEqual(r.toPut.map(s => [s.id, s.pinnedAt]), [['a', 'p2'], ['c', null]]);
});
