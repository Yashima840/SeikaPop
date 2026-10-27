// ポップのデータの扱い（レギュラーの使い回し・価格の読み取り・出力の止め方）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPop, exportFileName, exportProblems, formatDate, formatPrice, isBlankPop, localStamp,
  parsePriceInput, popFromRegular, regularFromPop, SAMPLE_POP, SHARE_TARGETS, SIZES, updateRegularFrom, withSample,
} from '../js/model.js';

const T0 = new Date('2026-10-20T06:30:00Z');
const T1 = new Date('2026-10-21T06:30:00Z');

function filled() {
  return {
    ...createPop(T0), name: '完熟トマト', price: 298, unit: '1袋', origin: '熊本県産', photoId: 'ph1',
    crop: { x: 0.2, y: 0, zoom: 1.5 }, adjust: { brightness: 10, contrast: 0, saturation: 5, warmth: 0 },
  };
}

test('レギュラーから作ると中身は引き継ぐが、id と「確認済み」は引き継がない', () => {
  const reg = { ...regularFromPop(filled(), T0), confirmed: true };
  const today = popFromRegular(reg, T1);
  assert.notEqual(today.id, reg.id);
  assert.equal(today.name, '完熟トマト');
  assert.equal(today.photoId, 'ph1');
  assert.equal(today.isRegular, false);
  assert.equal(today.fromRegularId, reg.id);
  assert.equal(today.confirmed, false);   // 前回の価格・産地のまま出さないため
  assert.equal(today.createdAt, T1.toISOString());
});

test('呼び出した後で crop を動かしても、元のレギュラーは変わらない（写し）', () => {
  const reg = regularFromPop(filled(), T0);
  const today = popFromRegular(reg, T1);
  today.crop.x = -1;
  today.adjust.brightness = 50;
  assert.equal(reg.crop.x, 0.2);
  assert.equal(reg.adjust.brightness, 10);
});

test('レギュラーの更新は id・作成日を保ち、中身だけ差し替える', () => {
  const reg = regularFromPop(filled(), T0);
  const today = { ...popFromRegular(reg, T1), price: 258 };
  const up = updateRegularFrom(reg, today, T1);
  assert.equal(up.id, reg.id);
  assert.equal(up.createdAt, reg.createdAt);
  assert.equal(up.isRegular, true);
  assert.equal(up.price, 258);
  assert.equal(up.updatedAt, T1.toISOString());
});

test('出力は商品名が空・レギュラー由来で未確認のときだけ止める', () => {
  assert.deepEqual(exportProblems(filled()), []);
  assert.equal(exportProblems({ ...filled(), name: '  ' }).length, 1);
  const today = popFromRegular(regularFromPop(filled(), T0), T1);
  assert.equal(exportProblems(today).length, 1);
  assert.deepEqual(exportProblems({ ...today, confirmed: true }), []);
});

test('価格の読み取り', async t => {
  const cases = [['298', 298], ['２９８', 298], ['1,280円', 1280], ['¥ 980', 980], ['', null], ['  ', null]];
  for (const [input, want] of cases) {
    await t.test(JSON.stringify(input), () => assert.deepEqual(parsePriceInput(input), { ok: true, value: want }));
  }
  for (const bad of ['2個で500', '-100', '29.8', 'abc']) {
    await t.test(`読めない: ${bad}`, () => {
      const r = parsePriceInput(bad);
      assert.equal(r.ok, false);
      assert.match(r.message, /数字/);
    });
  }
});

test('表示の整形', () => {
  assert.equal(formatPrice(1280), '1,280');
  assert.equal(formatPrice(null), '');
  assert.equal(formatDate(new Date(2026, 9, 20)), '10/20(火)');
  assert.equal(exportFileName({ name: 'ミニ トマト/赤' }, new Date(2026, 9, 20, 7, 0)), 'pop_20261020_ミニ_トマト_赤.jpg');
});

test('ファイル名の日付は端末の時刻で付ける（日本の朝7時に前日の日付にならない）', () => {
  // 2026-10-20 07:00 JST は UTC では 10/19 22:00
  const morning = new Date(2026, 9, 20, 7, 5);
  assert.equal(localStamp(morning), '20261020');
  assert.equal(localStamp(morning, true), '20261020-0705');
});

test('何も入れていない新規だけを「空」とみなす（レギュラー・レギュラー由来は消さない）', () => {
  const blank = createPop(T0);
  assert.equal(isBlankPop(blank), true);
  assert.equal(isBlankPop({ ...blank, name: 'a' }), false);
  assert.equal(isBlankPop({ ...blank, price: 0 }), false);
  assert.equal(isBlankPop({ ...blank, photoId: 'x' }), false);
  assert.equal(isBlankPop({ ...blank, isRegular: true }), false);
  assert.equal(isBlankPop({ ...blank, fromRegularId: 'r' }), false);
});

test('見本で描く: 空の所だけ見本（じゃが芋・長崎県・98円）にし、入れた所と元のポップは変えない', () => {
  const blank = createPop();
  const s = withSample(blank);
  assert.equal(s.name, SAMPLE_POP.name);
  assert.equal(s.origin, SAMPLE_POP.origin);
  assert.equal(s.price, SAMPLE_POP.price);
  assert.equal(blank.name, '', '元のポップは空のまま');
  const mine = withSample({ ...createPop(), name: 'トマト', price: 0 });
  assert.equal(mine.name, 'トマト');
  assert.equal(mine.price, 0, '0円は入れた値として残す');
  assert.equal(mine.origin, SAMPLE_POP.origin);
});

test('共有の使う先は、どれもある大きさを指し、重ならない', () => {
  for (const t of SHARE_TARGETS) assert.ok(SIZES[t.size], t.id);
  assert.equal(new Set(SHARE_TARGETS.map(t => t.id)).size, SHARE_TARGETS.length);
});
