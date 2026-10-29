// 税抜で入れた価格に、税込の金額を併記する計算
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPop, DEFAULT_TAX_RATE, formatTaxIncluded, newPop, nextTaxRounding, parseTaxRateInput, popFromRegular, priceTexts,
  popFromShared, popTaxRate, popTaxRounding, regularFromPop, splitDecimal, taxNote, taxRateOf,
} from '../js/model.js';

test('税込の金額は銭の整数で計算する（109×1.08 が 117.72000000000001 にならない）', () => {
  // 参考にしたチラシと同じ数字
  assert.equal(formatTaxIncluded(109, 8), '117.72');
  assert.equal(formatTaxIncluded(79, 8), '85.32');
  assert.equal(formatTaxIncluded(257, 8), '277.56');
  assert.equal(formatTaxIncluded(99, 8), '106.92');
  assert.equal(formatTaxIncluded(100, 8), '108');        // 割り切れたら小数を付けない
  assert.equal(formatTaxIncluded(105, 10), '115.5');     // 末尾の0は付けない
  assert.equal(formatTaxIncluded(1980, 8), '2,138.4');   // 桁区切りも付く
});

test('税込の端数は設定で切り捨て・四捨五入にできる', () => {
  assert.equal(formatTaxIncluded(109, 8, 'floor'), '117');
  assert.equal(formatTaxIncluded(109, 8, 'round'), '118');
  assert.equal(formatTaxIncluded(106, 8, 'round'), '114');   // 114.48 → 114
  assert.equal(formatTaxIncluded(1125, 8, 'round'), '1,215'); // ちょうど割り切れる
});

test('税率の欄は 0〜30 の整数だけ受け付ける（打ち間違いの 80% を出さない）', () => {
  assert.deepEqual(parseTaxRateInput('8'), { ok: true, value: 8 });
  assert.deepEqual(parseTaxRateInput('１０％'), { ok: true, value: 10 });
  assert.deepEqual(parseTaxRateInput('0'), { ok: true, value: 0 });
  for (const bad of ['', '80', '8.5', 'abc', '-8']) assert.equal(parseTaxRateInput(bad).ok, false, bad);
  assert.equal(taxRateOf({}), DEFAULT_TAX_RATE);
  assert.equal(taxRateOf({ taxRate: 'x' }), DEFAULT_TAX_RATE);
  assert.equal(taxRateOf({ taxRate: 10 }), 10);
});

test('税抜で入れたポップは税込を併記し、税込で入れたポップは「税込」とだけ添える', () => {
  const excl = { ...createPop(), price: 109, priceTax: 'excl' };
  assert.deepEqual(priceTexts(excl, { taxRate: 8 }), { main: '109', incl: '117.72', each: false });
  assert.equal(priceTexts({ ...excl, each: true }, { taxRate: 8 }).each, true);
  assert.equal(taxNote(priceTexts(excl, { taxRate: 8 })), '税込 117.72円');
  const incl = { ...excl, priceTax: 'incl' };
  assert.deepEqual(priceTexts(incl, { taxRate: 8 }), { main: '109', incl: '', each: false });
  assert.equal(taxNote(priceTexts(incl, {})), '税込');
  assert.equal(priceTexts({ ...excl, price: null }, {}), null);
});

test('0.1.0 で作ったポップ（priceTax が無い）は税込のまま読む（前の価格に税を足して出さない）', () => {
  const old = { ...createPop(), price: 298 };
  delete old.priceTax;
  assert.equal(priceTexts(old, { taxRate: 8 }).incl, '');
});

test('税抜・税込の別はレギュラーに引き継ぐ', () => {
  const reg = regularFromPop({ ...createPop(), name: 'a', price: 100, priceTax: 'incl' });
  assert.equal(popFromRegular(reg).priceTax, 'incl');
});

test('税率はポップごと（無い・読めないときは設定の税率＝前の版で入れた値）。レギュラー・保管へ引き継ぐ', () => {
  const pop = { ...createPop(), price: 100, priceTax: 'excl' };
  assert.equal(pop.taxRate, null, '新しいポップは設定の税率');
  assert.equal(popTaxRate(pop, { taxRate: 10 }), 10);
  assert.equal(popTaxRate(pop, {}), DEFAULT_TAX_RATE);
  const ten = { ...pop, taxRate: 10 };
  assert.equal(popTaxRate(ten, { taxRate: 8 }), 10, 'ポップに入れた税率が先');
  assert.equal(priceTexts(ten, { taxRate: 8 }).incl, '110');
  assert.equal(priceTexts(pop, { taxRate: 8 }).incl, '108', '他のポップの税率に引きずられない');
  assert.equal(popTaxRate({ ...pop, taxRate: 80 }, { taxRate: 8 }), 8, '読めない値は使わない');
  assert.equal(popFromRegular(regularFromPop(ten)).taxRate, 10);
  assert.equal(popFromShared({ name: 'a', price: 100, priceTax: 'excl', taxRate: 10 }).taxRate, 10);
  assert.equal(popFromShared({ name: 'a', price: 100, taxRate: 'x' }).taxRate, null, '形の合わない値は取り込まない');
});

test('税込の小数は小さく描くために分ける（小数が無ければそのまま1つ）', () => {
  assert.deepEqual(splitDecimal('税込 321.84円'), [
    { text: '税込 321', small: false }, { text: '.84', small: true }, { text: '円', small: false }]);
  assert.deepEqual(splitDecimal('税込 1,333,332.36円'), [
    { text: '税込 1,333,332', small: false }, { text: '.36', small: true }, { text: '円', small: false }]);
  assert.deepEqual(splitDecimal('税込 108円'), [{ text: '税込 108円', small: false }]);
});

test('税込の端数はポップごと。新しいポップは小数第2位まで、欄の無い古いポップは前の版の設定の値', () => {
  const pop = { ...createPop(), price: 109, priceTax: 'excl', taxRate: 8 };
  assert.equal(pop.taxRounding, 'decimal');
  assert.equal(priceTexts(pop, { taxRounding: 'floor' }).incl, '117.72', '新しいポップは設定に引きずられない');
  assert.equal(priceTexts({ ...pop, taxRounding: 'round' }, {}).incl, '118');
  const { taxRounding: _drop, ...old } = pop;
  assert.equal(popTaxRounding(old, { taxRounding: 'floor' }), 'floor');
  assert.equal(popTaxRounding(old, {}), 'decimal');
  assert.equal(popTaxRounding({ ...pop, taxRounding: 'x' }, { taxRounding: 'y' }), 'decimal', '読めない値は小数第2位まで');
});

test('税込の金額を押すたびに 小数第2位まで → 切り捨て → 四捨五入 → 頭へ戻る', () => {
  const pop = { ...createPop(), price: 109, priceTax: 'excl', taxRate: 8 };   // 117.72 → 117 → 118
  assert.equal(nextTaxRounding(pop, {}), 'floor');
  assert.equal(nextTaxRounding({ ...pop, taxRounding: 'floor' }, {}), 'round');
  assert.equal(nextTaxRounding({ ...pop, taxRounding: 'round' }, {}), 'decimal');
});

test('切り捨てと四捨五入が同じ金額になる価格でも飛ばさない（選んだ扱いは次のポップへ引き継ぐので、きっちり選べるように）', () => {
  const pop = { ...createPop(), price: 106, priceTax: 'excl', taxRate: 8 };   // 114.48 → 114 と 114
  assert.equal(nextTaxRounding(pop, {}), 'floor');
  assert.equal(nextTaxRounding({ ...pop, taxRounding: 'floor' }, {}), 'round');
  assert.equal(nextTaxRounding({ ...pop, taxRounding: 'round' }, {}), 'decimal');
});

test('新しく作るポップは、前に選んだ税込の端数を引き継ぐ', () => {
  assert.equal(newPop({ taxRounding: 'round' }).taxRounding, 'round');
  assert.equal(newPop({}).taxRounding, 'decimal');
  assert.equal(newPop({ taxRounding: 'x' }).taxRounding, 'decimal');
});

test('税込の端数は、レギュラー・保管したポップから作っても引き継ぐ', () => {
  const pop = { ...createPop(), price: 109, priceTax: 'excl', taxRate: 8, taxRounding: 'round' };
  assert.equal(popFromRegular(regularFromPop(pop)).taxRounding, 'round');
});
