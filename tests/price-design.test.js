// 価格デザイン（js/price-design.js）と、外部AIに渡す試作キット（tools/price-kit/）の約束
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRICE_FONTS, drawPrice } from '../js/price-design.js';
import { googleFontsUrl } from '../js/layout.js';
import { extractRegion, kitFromTemplate, MARK_END, MARK_START, replaceRegion } from '../tools/price-kit/kit.mjs';

/** 呼ばれた描画命令を控えるだけの Canvas の代わり（文字幅は 文字数×大きさ で代用）。 */
function fakeContext() {
  const texts = [];
  let depth = 0, minDepth = 0;
  const state = { font: '10px sans-serif' };
  const size = () => Number(/(\d+(?:\.\d+)?)px/.exec(state.font)?.[1] || 10);
  const methods = {
    save: () => { depth++; },
    restore: () => { depth--; minDepth = Math.min(minDepth, depth); },
    fillText: t => texts.push(String(t)),
    strokeText: t => texts.push(String(t)),
    measureText: t => ({
      width: String(t).length * size() * 0.6,
      actualBoundingBoxAscent: size() * 0.8, actualBoundingBoxDescent: size() * 0.2,
      actualBoundingBoxLeft: 0, actualBoundingBoxRight: String(t).length * size() * 0.6,
      fontBoundingBoxAscent: size() * 0.9, fontBoundingBoxDescent: size() * 0.2,
    }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getLineDash: () => [],
  };
  const ctx = new Proxy(state, {
    get: (s, k) => (k in methods ? methods[k] : k in s ? s[k] : () => {}),
    set: (s, k, v) => { s[k] = v; return true; },
  });
  return { ctx, texts, balance: () => ({ depth, minDepth }) };
}

const CASES = [
  { main: '298', incl: '321.84' }, { main: '98', incl: '105.84' }, { main: '1,980', incl: '2,138.4' },
  { main: '12,800', incl: '13,824' }, { main: '158', incl: '' }, { main: '1,234,567', incl: '1,333,332.36' },
];
const AREAS = [
  { x: 50, y: 700, w: 980, h: 300, u: 1 },     // 正方形
  { x: 50, y: 960, w: 980, h: 310, u: 1 },     // 縦 4:5
  { x: 50, y: 760, w: 980, h: 120, u: 1 },     // 商品名2行などで狭いとき
  { x: 25, y: 350, w: 490, h: 150, u: 0.5 },   // 半分の大きさ
];

test('どの価格・どの範囲でも例外を出さず、save と restore の数が合う', () => {
  for (const price of CASES) {
    for (const { u, ...area } of AREAS) {
      const f = fakeContext();
      assert.doesNotThrow(() => drawPrice(f.ctx, area, price, u), JSON.stringify({ price, area }));
      assert.deepEqual(f.balance(), { depth: 0, minDepth: 0 }, 'save/restore の対応が崩れると後の描画の色や位置が狂う');
    }
  }
});

test('総額表示: 税抜で入れたときは税込額を、税込で入れたときは「税込」を必ず描く', () => {
  for (const price of CASES) {
    const f = fakeContext();
    drawPrice(f.ctx, AREAS[0], price, 1);
    const all = f.texts.join('|');
    assert.ok(all.includes(price.main), `数字 ${price.main} が描かれていない: ${all}`);
    if (price.incl) assert.ok(all.includes(price.incl) && all.includes('税込'), `税込 ${price.incl} が描かれていない: ${all}`);
    else assert.ok(all.includes('税込'), `「税込」が描かれていない: ${all}`);
  }
});

test('使う書体は Google Fonts の名前と太さで書く', () => {
  assert.ok(PRICE_FONTS.length > 0);
  for (const f of PRICE_FONTS) {
    assert.equal(typeof f.family, 'string');
    assert.match(String(f.weight), /^[1-9]00$/);
  }
  assert.equal(googleFontsUrl([{ family: 'Dela Gothic One', weight: '400' }, { family: 'M PLUS 1', weight: '900' }, { family: 'M PLUS 1', weight: '700' }]),
    'https://fonts.googleapis.com/css2?family=Dela+Gothic+One:wght@400&family=M+PLUS+1:wght@700;900&display=swap');
});

test('試作キット（price-kit.html）は今の price-design.js と同じデザインを持っている', () => {
  const design = extractRegion(readFileSync(new URL('../js/price-design.js', import.meta.url), 'utf8'));
  const kit = extractRegion(readFileSync(new URL('../tools/price-kit/price-kit.html', import.meta.url), 'utf8'));
  assert.equal(kit, design, '食い違っている: node tools/price-kit/build.mjs で作り直す');
});

test('範囲の取り出し・差し替え', () => {
  const region = `${MARK_START}\nconst PRICE_FONTS = [];\nfunction drawPrice() {}\n${MARK_END}`;
  const file = `head\r\n${region.replace(/\n/g, '\r\n')}\r\ntail`;   // Windows の改行で返ってきても読める
  assert.equal(extractRegion(file), region);
  const next = region.replace('() {}', '(a) { return a; }');
  assert.equal(replaceRegion(`a\n${region}\nb`, next), `a\n${next}\nb`);
  assert.equal(kitFromTemplate('<x>/*__PRICE_DESIGN__*/</x>', '$&'), '<x>$&</x>');   // $ が入っていても壊れない
  assert.throws(() => extractRegion('no marks'), /印が見つかりません/);
  assert.throws(() => extractRegion(`${region}\n${region}`), /2組/);
  assert.throws(() => extractRegion(`${MARK_START}\nfunction drawPrice() {}\n${MARK_END}`), /PRICE_FONTS/);
});
