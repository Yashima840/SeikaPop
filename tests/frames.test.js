// フレーム（複数の画像を1枚に収める）のデータと、広告の組み合わせの判定
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adProblems, adShotKey, createAd, dropMissing, fitSlots, frameProblems, FRAME_ORDER, FRAMES, toggleShot,
} from '../js/frames.js';
import { containRect } from '../js/layout.js';

test('同梱のフレームはどれも枠が画像からはみ出さず、上下の帯にも重ならない', () => {
  for (const id of FRAME_ORDER) assert.deepEqual(frameProblems(FRAMES[id]), [], id);
});

test('FRAME_ORDER と FRAMES が食い違っていない（足し忘れで選べないフレームを作らない）', () => {
  assert.deepEqual([...FRAME_ORDER].sort(), Object.keys(FRAMES).sort());
});

test('手で足したフレームの打ち間違いを止める', () => {
  const ok = { w: 1000, h: 1000, header: { h: 100 }, footer: { h: 100 }, slots: [{ x: 0, y: 100, w: 500, h: 500 }] };
  assert.deepEqual(frameProblems(ok), []);
  assert.match(frameProblems({ ...ok, slots: [] })[0], /1つもありません/);
  assert.match(frameProblems({ ...ok, slots: [{ x: 600, y: 100, w: 500, h: 500 }] })[0], /はみ出し/);
  assert.match(frameProblems({ ...ok, slots: [{ x: 0, y: 50, w: 500, h: 500 }] })[0], /帯に重なって/);
  assert.match(frameProblems({ ...ok, overlay: 5 })[0], /overlay/);
});

test('画像は切らずに枠の中へ丸ごと、中央に収める（価格・税込の表示を欠かさない）', () => {
  assert.deepEqual(containRect(1080, 1920, { x: 0, y: 0, w: 500, h: 500 }), { x: 109.375, y: 0, w: 281.25, h: 500 });
  assert.deepEqual(containRect(1000, 1000, { x: 10, y: 20, w: 400, h: 200 }), { x: 110, y: 20, w: 200, h: 200 });
});

test('タップした順に空いている枠へ入り、もう一度タップで外れる。満杯なら入れない', () => {
  let slots = [null, null];
  slots = toggleShot(slots, 'a').slots;
  slots = toggleShot(slots, 'b').slots;
  assert.deepEqual(slots, ['a', 'b']);
  assert.equal(toggleShot(slots, 'c').full, true);
  slots = toggleShot(slots, 'a').slots;
  assert.deepEqual(slots, [null, 'b']);
  assert.deepEqual(toggleShot(slots, 'c').slots, ['c', 'b']);   // 外した所へ入る
});

test('フレームを替えると選んだ順を保って詰め、入り切らない数を知らせる', () => {
  assert.deepEqual(fitSlots(['a', null, 'b', 'c'], 2), { slots: ['a', 'b'], dropped: 1 });
  assert.deepEqual(fitSlots(['a'], 3), { slots: ['a', null, null], dropped: 0 });
  assert.deepEqual(fitSlots(undefined, 2), { slots: [null, null], dropped: 0 });
});

test('履歴から消した画像は枠から外し、外した数を返す', () => {
  assert.deepEqual(dropMissing(['a', 'x', null], ['a']), { slots: ['a', null, null], removed: 1 });
});

test('全部の枠が埋まるまで出させない', () => {
  const ad = { ...createAd(), frameId: 'pair', slots: ['a', null] };
  assert.match(adProblems(ad, FRAMES.pair)[0], /あと 1 枚/);
  assert.deepEqual(adProblems({ ...ad, slots: ['a', 'b'] }, FRAMES.pair), []);
  assert.match(adProblems(ad, undefined)[0], /フレーム/);
});

test('広告の印: 組み合わせ・見出しが違えば別。日付を入れるなら日が変われば別', () => {
  const ad = { ...createAd(), slots: ['a', 'b'] };
  const d1 = new Date(2026, 9, 22, 7), d2 = new Date(2026, 9, 23, 7);
  assert.equal(adShotKey(ad, d1), adShotKey({ ...ad }, d1));
  assert.notEqual(adShotKey(ad, d1), adShotKey({ ...ad, slots: ['b', 'a'] }, d1));
  assert.notEqual(adShotKey(ad, d1), adShotKey({ ...ad, title: '今週の特売' }, d1));
  assert.notEqual(adShotKey(ad, d1), adShotKey(ad, d2));
  assert.equal(adShotKey({ ...ad, showDate: false }, d1), adShotKey({ ...ad, showDate: false }, d2));
});
