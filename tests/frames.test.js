// フレーム（複数の画像を1枚に収める）のデータと、広告の組み合わせの判定
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adProblems, adShotKey, cleanCustomFrames, createAd, CUSTOM_ID, customFrame, customFrameProblems, dropMissing, fitSlots,
  frameFor, frameProblems, FRAME_ORDER, FRAMES, mergeCustomFrames, normalizeRows, saveCustomFrame, toggleShot,
} from '../js/frames.js';
import { containRect } from '../js/layout.js';

test('同梱のフレームはどれも枠が画像からはみ出さず、上下の帯にも重ならない', () => {
  for (const id of FRAME_ORDER) assert.deepEqual(frameProblems(FRAMES[id]), [], id);
});

test('カスタム: 1行目1枚・2行目2枚・3行目3枚・4行目以降なし → 3行6枚。上の行から左→右の順', () => {
  const f = customFrame([1, 2, 3, 0, 0, 0]);
  assert.equal(f.slots.length, 6);
  assert.match(f.label, /3行 6枚/);
  assert.deepEqual(frameProblems(f), []);
  const ys = [...new Set(f.slots.map(s => s.y))];
  assert.equal(ys.length, 3);
  assert.ok(f.slots[1].x < f.slots[2].x && f.slots[1].y === f.slots[2].y, '同じ行は左から');
});

test('カスタム: 写真どうし・左右の端・上下の帯との隙間はどれも 5px 前後。枠は正方形', () => {
  const f = customFrame([1, 2, 3, 0, 0, 0]);
  for (const s of f.slots) assert.ok(Math.abs(s.w - s.h) <= 1, `正方形: ${s.w}x${s.h}`);
  const rows = [[f.slots[0]], f.slots.slice(1, 3), f.slots.slice(3)];
  for (const row of rows) {
    assert.ok(Math.abs(row[0].x - 5) <= 1, '左の端');
    assert.ok(Math.abs(f.w - (row.at(-1).x + row.at(-1).w) - 5) <= 1, '右の端');
    for (let i = 1; i < row.length; i++) assert.ok(Math.abs(row[i].x - (row[i - 1].x + row[i - 1].w) - 5) <= 1, '写真どうし');
  }
  assert.ok(Math.abs(f.slots[0].y - (f.header.h + 5)) <= 1, '上の帯との間');
  const last = f.slots.at(-1);
  assert.ok(Math.abs(f.h - f.footer.h - (last.y + last.h) - 5) <= 1, '下の帯との間');
});

test('カスタムの保存: 名前は必須・20文字まで・別のものと同じ名前は不可。同じ id は上書き', () => {
  const now = new Date('2026-10-27T00:00:00Z');
  const a = saveCustomFrame([], { name: ' 週末 ', rows: [1, 2, 0, 0, 0, 0] }, now);
  assert.equal(a.entry.name, '週末');
  assert.equal(a.list.length, 1);
  assert.deepEqual(customFrameProblems({ name: '', rows: [1] }, a.list), ['名前を入れてください']);
  assert.match(customFrameProblems({ name: 'あ'.repeat(21), rows: [1] }, a.list)[0], /20 文字/);
  assert.match(customFrameProblems({ name: '週末', rows: [1] }, a.list)[0], /もうあります/);
  assert.deepEqual(customFrameProblems({ id: a.entry.id, name: '週末', rows: [3] }, a.list), [], '自分自身の上書きは同じ名前でよい');
  assert.match(customFrameProblems({ name: '平日', rows: [0, 0] }, a.list)[0], /1つ以上/);
  const b = saveCustomFrame(a.list, { id: a.entry.id, name: '週末', rows: [3, 3, 0, 0, 0, 0] }, now);
  assert.equal(b.list.length, 1);
  assert.deepEqual(b.list[0].rows, [3, 3, 0, 0, 0, 0]);
  assert.match(customFrame(b.entry.rows, b.entry.name).label, /^週末（2行 6枚）$/);
});

test('カスタムのバックアップ: 無いものは足し、同じ id は新しい方を残す。壊れたものは読まない', () => {
  const old = { id: 'x', name: '古い', rows: [1, 0, 0, 0, 0, 0], updatedAt: '2026-10-01T00:00:00Z' };
  const r = mergeCustomFrames([old], [
    { ...old, name: '新しい', updatedAt: '2026-10-02T00:00:00Z' },
    { id: 'y', name: '別', rows: [2, 2, 0, 0, 0, 0], updatedAt: '2026-10-01T00:00:00Z' },
    { id: 'z', name: '空', rows: [0, 0, 0, 0, 0, 0] },
    null,
  ]);
  assert.equal(r.added, 1);
  assert.deepEqual(r.list.map(f => f.name), ['新しい', '別']);
  assert.deepEqual(cleanCustomFrames('壊れた値'), []);
});

test('カスタム: 押さなかった行は使わない（途中の行が空でも詰める）。1枚も無ければフレームにならない', () => {
  assert.deepEqual(customFrame([0, 2, 0, 1, 0, 0]).slots.length, 3);
  assert.equal(customFrame([0, 0, 0, 0, 0, 0]), null);
  assert.equal(customFrame(undefined), null);
  assert.deepEqual(normalizeRows([9, -1, '2', null]), [3, 0, 2, 0, 0, 0], '壊れた値は 0〜3 へ');
});

test('カスタム: 6行×0〜3枚のどの組み合わせでも、枠ははみ出さず重ならない', () => {
  for (let code = 1; code < 4 ** 6; code++) {
    const rows = Array.from({ length: 6 }, (_, i) => Math.floor(code / 4 ** i) % 4);
    const f = customFrame(rows);
    assert.deepEqual(frameProblems(f), [], rows.join(','));
    for (let a = 0; a < f.slots.length; a++) {
      for (let b = a + 1; b < f.slots.length; b++) {
        const p = f.slots[a], q = f.slots[b];
        const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
        assert.ok(!overlap, `${rows.join(',')} の ${a + 1} と ${b + 1} が重なる`);
      }
    }
  }
});

test('カスタム: 広告で使うフレームは行の指定から作り、同じ組み合わせの印に行の形も入る', () => {
  const ad = { ...createAd(), frameId: CUSTOM_ID, customRows: [1, 2, 0, 0, 0, 0], slots: ['a', 'b', 'c'] };
  assert.equal(frameFor(ad).slots.length, 3);
  assert.notEqual(adShotKey(ad), adShotKey({ ...ad, customRows: [2, 1, 0, 0, 0, 0] }));
  assert.equal(frameFor({ ...ad, frameId: 'no-such' }), null);
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
