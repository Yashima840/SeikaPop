// 作った画像の履歴（並び・上限・レギュラーの画像の見分け・重複）と、バックアップへの重ね方
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPop, formatShotTime, historyOverflow, keptShotIds, moveToRegular, popFromRegular, popIdOfShot, popLists, popShotKey,
  RECENT_MAX, shotFileName, shotFromPop, slotsToPopIds, sortHistory,
} from '../js/model.js';
import { mergeShots, validateBackup, BACKUP_FORMAT } from '../js/backup.js';

const shot = (id, createdAt, popId = null) => ({ id, createdAt, key: popId ? `pop:${popId}@x` : id, kind: 'pop', title: id });

test('履歴は新しい順', () => {
  const list = [shot('old', '2026-10-01T00:00:00Z'), shot('new', '2026-10-20T00:00:00Z'), shot('mid', '2026-10-10T00:00:00Z')];
  assert.deepEqual(sortHistory(list).map(s => s.id), ['new', 'mid', 'old']);
});

test('画像を出したポップの id を印から読む（広告の画像は null）', () => {
  const pop = createPop();
  assert.equal(popIdOfShot({ key: popShotKey(pop) }), pop.id);
  assert.equal(popIdOfShot({ key: 'ad:abc@1' }), null);
  assert.equal(popIdOfShot({}), null);
});

test('広告の画面とはじめの画面は同じポップを並べる: レギュラーと、それ以外の新しい順 RECENT_MAX 件', () => {
  const at = n => new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString();
  const reg = { ...createPop(), isRegular: true, updatedAt: at(1) };
  const today = { ...popFromRegular(reg), updatedAt: at(3) };
  const plain = { ...createPop(), name: 'なす', updatedAt: at(2) };
  const many = Array.from({ length: RECENT_MAX }, (_, i) => ({ ...createPop(), name: `品${i}`, updatedAt: at(100 + i) }));
  const l = popLists([reg, today, plain, ...many]);
  assert.deepEqual(l.regulars.map(p => p.id), [reg.id]);
  assert.equal(l.recent.length, RECENT_MAX);
  assert.equal(l.recent[0].id, many.at(-1).id, '新しい順');
  assert.ok(!l.recent.some(p => p.id === plain.id), '古いものは上限で外れる');
});

test('何も入れていないポップ（作ってすぐアプリを閉じたもの）は履歴に並べない', () => {
  const blank = createPop();
  const named = { ...createPop(), name: 'トマト' };
  const photoOnly = { ...createPop(), photoId: 'p1' };
  assert.deepEqual(popLists([blank, named, photoOnly]).recent.map(p => p.id).sort(), [named.id, photoOnly.id].sort());
});

test('以前の広告の作りかけ（枠に画像の id）は、そのポップの id へ読み替える', () => {
  const pop = createPop();
  const shots = [{ id: 's1', key: popShotKey(pop) }, { id: 'a1', key: 'ad:x@1' }];
  assert.deepEqual(slotsToPopIds(['s1', 'a1', null, pop.id], shots), [pop.id, null, null, pop.id]);
});

test('上限を超えたら古い方から消すが、各レギュラーの最新の1枚は数えず残す', () => {
  const reg = { ...createPop(), isRegular: true };
  const plain = createPop();
  const shots = [
    shot('regOld', '2020-01-01T00:00:00Z', reg.id),
    shot('regNew', '2020-01-02T00:00:00Z', reg.id),
    shot('a', '2026-10-03T00:00:00Z', plain.id), shot('b', '2026-10-02T00:00:00Z', plain.id),
    shot('c', '2026-10-01T00:00:00Z', plain.id),
  ];
  assert.deepEqual([...keptShotIds(shots, [reg, plain])], ['regNew']);
  assert.deepEqual(historyOverflow(shots, [reg, plain], 2), ['c', 'regOld']);
  assert.deepEqual(historyOverflow(shots, [], 2), ['c', 'regNew', 'regOld'], 'ポップを渡さなければ残す画像は無い');
});

test('以前ピンを付けて残した画像は、ピンを廃止した後も上限で消さない', () => {
  const shots = [shot('a', '2026-10-03T00:00:00Z'), { ...shot('oldPin', '2020-01-01T00:00:00Z'), pinnedAt: '2020-01-02T00:00:00Z' }];
  assert.deepEqual(historyOverflow(shots, [], 1), []);
});

test('履歴のポップをレギュラーへ移す: 同じ id のまま（出した画像がレギュラーの画像になる）', () => {
  const pop = { ...createPop(), name: 'トマト' };
  const now = new Date('2026-10-26T00:00:00Z');
  const reg = moveToRegular(pop, now);
  assert.equal(reg.id, pop.id);
  assert.equal(reg.isRegular, true);
  assert.equal(reg.fromRegularId, null);
  assert.equal(reg.updatedAt, now.toISOString());
  assert.deepEqual(popLists([reg]).regulars.map(p => p.id), [pop.id], 'レギュラーの欄に移る');
});

test('同じポップを直さずに2回出しても同じ印＝履歴は1枚（日が変わっても。ポップに日付は入れない）。直せば別の印', () => {
  const pop = createPop();
  assert.equal(popShotKey(pop), popShotKey({ ...pop }));
  assert.notEqual(popShotKey(pop), popShotKey({ ...pop, updatedAt: '2026-10-22T00:00:01Z' }));
});

test('ポップから作る履歴は、商品名を題名に持つ', () => {
  const s = shotFromPop({ ...createPop(), name: ' 完熟トマト ' }, { w: 1080, h: 1350, thumb: 'data:x' });
  assert.equal(s.title, '完熟トマト');
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
  assert.equal(validateBackup({ ...base, customFrames: [] }).ok, true);
  assert.equal(validateBackup({ ...base, customFrames: 'x' }).ok, false);
});

test('履歴を重ねると無いものだけ足す', () => {
  const existing = [shot('a', 't1'), shot('b', 't1')];
  const incoming = [shot('a', 't1'), shot('b', 't1'), shot('c', 't2')];
  const r = mergeShots(existing, incoming);
  assert.equal(r.added, 1);
  assert.deepEqual(r.toPut.map(s => s.id), ['c']);
});
