// 写真の補正と、バックアップ・写真の後片付けの判定
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustPixels, autoAdjust, sepiaPixels } from '../js/image.js';
import { BACKUP_FORMAT, mergePops, unreferencedPhotoIds, validateBackup } from '../js/backup.js';

const px = (...rgb) => new Uint8ClampedArray(rgb.flatMap(c => [...c, 255]));

test('補正なしなら画素は変わらない', () => {
  const d = px([10, 20, 30], [200, 100, 50]);
  adjustPixels(d, { brightness: 0, contrast: 0, saturation: 0, warmth: 0 });
  assert.deepEqual([...d], [10, 20, 30, 255, 200, 100, 50, 255]);
});

test('明るさは足し、0〜255 に収まる。透明度は触らない', () => {
  const d = px([250, 128, 0]);
  adjustPixels(d, { brightness: 50 });
  assert.equal(d[0], 255);
  assert.equal(d[1], 192);
  assert.equal(d[3], 255);
});

test('鮮やかさ -100 で灰色になる', () => {
  const d = px([200, 100, 50]);
  adjustPixels(d, { saturation: -100 });
  assert.equal(d[0], d[1]);
  assert.equal(d[1], d[2]);
});

test('セピアは少しだけ寄せる（灰色は茶色がかる・赤>緑>青）。0 なら変えない。透明度は触らない', () => {
  const d = px([128, 128, 128]);
  sepiaPixels(d);
  assert.ok(d[0] > d[1] && d[1] > d[2], `茶色がかる: ${[...d]}`);
  assert.ok(d[2] > 80, '完全なセピアにはしない');
  assert.equal(d[3], 255);
  const e = px([10, 200, 30]);
  sepiaPixels(e, 0);
  assert.deepEqual([...e], [10, 200, 30, 255]);
});

test('暗くくすんだ写真は明るく・鮮やかに寄せる。明るい写真は暗くしすぎない', () => {
  const dark = px(...Array(50).fill([60, 58, 55]));
  const a = autoAdjust(dark);
  assert.ok(a.brightness > 20);
  assert.ok(a.saturation >= 25);
  const bright = px(...Array(50).fill([250, 250, 250]));
  assert.ok(autoAdjust(bright).brightness >= -25);
});

test('バックアップの形を確かめる', () => {
  assert.equal(validateBackup({ format: BACKUP_FORMAT, version: 1, pops: [], photos: [] }).ok, true);
  assert.equal(validateBackup({ format: 'other', pops: [], photos: [] }).ok, false);
  assert.equal(validateBackup({ format: BACKUP_FORMAT, version: 99, pops: [], photos: [] }).ok, false);
  assert.equal(validateBackup({ format: BACKUP_FORMAT, version: 1, pops: [{}], photos: [] }).ok, false);
  assert.equal(validateBackup(null).ok, false);
});

test('読み込みは同じ id なら新しい方を残す（古いバックアップで今朝の分を戻さない）', () => {
  const existing = [{ id: 'a', updatedAt: '2026-10-20T08:00' }, { id: 'b', updatedAt: '2026-10-19T08:00' }];
  const incoming = [
    { id: 'a', updatedAt: '2026-10-19T08:00' },   // 古い → 残さない
    { id: 'b', updatedAt: '2026-10-20T09:00' },   // 新しい → 更新
    { id: 'c', updatedAt: '2026-10-18T09:00' },   // 無い → 追加
  ];
  const r = mergePops(existing, incoming);
  assert.deepEqual(r.toPut.map(p => p.id), ['b', 'c']);
  assert.deepEqual([r.added, r.updated, r.skipped], [1, 1, 1]);
});

test('レギュラーが使っている写真は、今日のポップを消しても残る', () => {
  const pops = [{ id: 'reg', photoId: 'p1', isRegular: true }, { id: 'x', photoId: null }];
  assert.deepEqual(unreferencedPhotoIds(pops, ['p1', 'p2']), ['p2']);
});
