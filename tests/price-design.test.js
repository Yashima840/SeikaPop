// 価格デザイン（js/price-design.js）と、外部AIに渡す試作キット（tools/price-kit/）の約束
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { drawPrice, editorApi, PRICE_FONTS } from '../js/price-design.js';
import { CATCH_DESIGN } from '../js/catch-design.js';
import { catchDesignProblems, catchFontList } from '../js/catch-check.js';
import { googleFontsUrl } from '../js/layout.js';
import { designInKit, extractRegion, kitFromTemplate, MARK_END, MARK_START, replaceRegion } from '../tools/price-kit/kit.mjs';

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
    measureText: t => {
      // ブラウザと同じく、左右の広がりは textAlign の基準点から測る
      const w = String(t).length * size() * 0.6;
      const left = { right: w, end: w, center: w / 2 }[state.textAlign] ?? 0;
      return {
        width: w,
        actualBoundingBoxAscent: size() * 0.8, actualBoundingBoxDescent: size() * 0.2,
        actualBoundingBoxLeft: left, actualBoundingBoxRight: w - left,
        fontBoundingBoxAscent: size() * 0.9, fontBoundingBoxDescent: size() * 0.2,
      };
    },
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
    // 税込の小数は小さくするため「(税込321」「.84」「円)」と分けて続けて描く。続けた文字で確かめる
    const all = f.texts.join('');
    assert.ok(all.includes(price.main), `数字 ${price.main} が描かれていない: ${all}`);
    if (price.incl) assert.ok(all.includes(price.incl) && all.includes('税込'), `税込 ${price.incl} が描かれていない: ${all}`);
    else assert.ok(all.includes('税込'), `「税込」が描かれていない: ${all}`);
  }
});

test('「各」は price.each のときだけ描く（いちばん手前＝最後に塗る）', () => {
  const on = fakeContext();
  drawPrice(on.ctx, AREAS[0], { main: '100', incl: '108', each: true }, 1);
  assert.equal(on.texts.at(-1), '各');
  const off = fakeContext();
  drawPrice(off.ctx, AREAS[0], { main: '100', incl: '108', each: false }, 1);
  assert.ok(!off.texts.includes('各'));
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

test('試作キット（price-kit.html）は今の price-design.js・catch-design.js と同じデザインを持っている', () => {
  const design = extractRegion(readFileSync(new URL('../js/price-design.js', import.meta.url), 'utf8'));
  const kitText = readFileSync(new URL('../tools/price-kit/price-kit.html', import.meta.url), 'utf8');
  assert.equal(extractRegion(kitText), design, '描き方が食い違っている: node tools/price-kit/build.mjs で作り直す');
  assert.deepEqual(designInKit(kitText), CATCH_DESIGN, 'デザインのデータが食い違っている: node tools/price-kit/build.mjs で作り直す');
});

test('保存されているデザインは検査を通る', () => {
  assert.deepEqual(catchDesignProblems(CATCH_DESIGN), []);
  assert.deepEqual(PRICE_FONTS, catchFontList(CATCH_DESIGN), '描画が読み込む書体と、編集画面が数える書体が同じ');
});

test('デザインの検査: 壊れた値・総額表示に反する値は保存させない', () => {
  const ok = structuredClone(CATCH_DESIGN);
  const bad = f => { const d = structuredClone(ok); f(d); return catchDesignProblems(d); };
  assert.match(bad(d => { d.tax.size = d.num.size * 0.05; }).join(), /税込の併記が小さすぎます/);
  assert.match(bad(d => { d.burst.points = [[0, 0], [1, 1]]; }).join(), /3 つ以上/);
  assert.match(bad(d => { d.burst.points = [[10, 10], [20, 10], [20, 20]]; }).join(), /内側/);
  assert.match(bad(d => { d.num.fill = 'red'; }).join(), /数字の色/);
  assert.match(bad(d => { d.yen.weight = '850'; }).join(), /「円」の太さ/);
  assert.match(bad(d => { d.num.strokes.push(...Array(4).fill({ color: '#000000', width: 1 })); }).join(), /0〜4 本/);
  assert.match(bad(d => { d.fit.scale = 0; }).join(), /fit\.scale/);
  assert.match(bad(d => { d.num.size = Number.NaN; }).join(), /数字の size/);
  // 「円」を数字と同じ書体・太さにすると1つにまとまる（数字の書体はデザイン作業場で替わるので、今の値から作る）
  assert.deepEqual(catchFontList({ ...ok, yen: { ...ok.yen, font: ok.num.font, weight: ok.num.weight } }).length, 2);
});

test('編集中のデザインを渡すと、その色・縁取りで描く（保存前の見本に使う）', () => {
  const d = structuredClone(CATCH_DESIGN);
  d.num.fill = '#123456';
  d.num.strokes = [{ color: '#abcdef', width: 3 }];
  const f = fakeContext();
  const fills = [];
  const ctx = new Proxy(f.ctx, { set: (s, k, v) => { if (k === 'fillStyle') fills.push(v); s[k] = v; return true; } });
  drawPrice(ctx, AREAS[0], CASES[0], 1, d);
  assert.ok(fills.includes('#123456'));
  assert.deepEqual(f.balance(), { depth: 0, minDepth: 0 });
  const frame = editorApi.catchFrame(AREAS[0], d);
  assert.equal(frame.x, AREAS[0].x + AREAS[0].w);
  assert.ok(frame.k > 0);
});

test('重なり順: order の順に描く（後のものが手前）。壊れた order は既定の順で描く', () => {
  const firstFill = order => {
    const d = { ...structuredClone(CATCH_DESIGN), order };
    d.burst.fill = '#000001'; d.num.fill = '#000002'; d.yen.fill = '#000003'; d.tax.fill = '#000004';
    const f = fakeContext();
    const fills = [];
    const ctx = new Proxy(f.ctx, { set: (s, k, v) => { if (k === 'fillStyle' && /^#00000\d$/.test(v)) fills.push(v); s[k] = v; return true; } });
    drawPrice(ctx, AREAS[0], CASES[0], 1, d);
    return fills;
  };
  assert.deepEqual(firstFill(['tax', 'yen', 'num', 'burst']), ['#000004', '#000003', '#000002', '#000001']);
  assert.deepEqual(firstFill(['num', 'num']), ['#000001', '#000002', '#000003', '#000004']);
  assert.match(catchDesignProblems({ ...structuredClone(CATCH_DESIGN), order: ['num', 'num', 'yen', 'tax'] }).join(), /重なり順/);
});

test('部品の範囲: 文字は基準点・揃え方・傾きに沿い、ギザギザは角を囲む', () => {
  const d = structuredClone(CATCH_DESIGN);
  d.num.slant = 0;
  const f = fakeContext();
  const num = editorApi.partBounds(f.ctx, 'num', d, { main: '298', incl: '321.84' });
  assert.ok(num.box.x1 > d.num.x && num.box.x1 - d.num.x < 30, '右揃えなので右端は基準点のすぐ右（縁取りの分）');
  assert.ok(num.box.x0 < d.num.x - 100, '数字は基準点の左に伸びる');
  assert.ok(num.box.y0 < d.num.y && num.box.y1 > d.num.y);
  const burst = editorApi.partBounds(f.ctx, 'burst', d, CASES[0]);
  assert.equal(burst.box.x0, Math.min(...d.burst.points.map(p => p[0])) - d.burst.lineWidth / 2);
  d.num.slant = 0.3;
  const slanted = editorApi.partBounds(f.ctx, 'num', d, { main: '298', incl: '' });
  assert.ok(slanted.poly[0][0] > slanted.poly[3][0], '右へ傾けると上の辺が右にずれる');
  assert.deepEqual(editorApi.partOrder({ order: null }), ['burst', 'num', 'yen', 'tax']);
});

test('範囲の取り出し・差し替え', () => {
  const region = `${MARK_START}\nconst PRICE_FONTS = [];\nfunction drawPrice() {}\n${MARK_END}`;
  const file = `head\r\n${region.replace(/\n/g, '\r\n')}\r\ntail`;   // Windows の改行で返ってきても読める
  assert.equal(extractRegion(file), region);
  const next = region.replace('() {}', '(a) { return a; }');
  assert.equal(replaceRegion(`a\n${region}\nb`, next), `a\n${next}\nb`);
  assert.equal(kitFromTemplate('/*__CATCH_DESIGN__*/<x>/*__PRICE_DESIGN__*/</x>', '$&', { a: '$&' }),
    'const CATCH_DESIGN = {\n  "a": "$&"\n};<x>$&</x>');   // $ が入っていても壊れない
  assert.throws(() => extractRegion('no marks'), /印が見つかりません/);
  assert.throws(() => extractRegion(`${region}\n${region}`), /2組/);
  assert.throws(() => extractRegion(`${MARK_START}\nfunction drawPrice() {}\n${MARK_END}`), /PRICE_FONTS/);
});

test('キャッチの倍率は写真の大きさだけで決まる（背景の形を変えても、数字の大きさは変わらない）', () => {
  const d = structuredClone(CATCH_DESIGN);
  const before = editorApi.catchFrame(AREAS[0], d).k;
  d.burst.points = d.burst.points.map(([x, y]) => [x * 3, y * 3]);
  assert.equal(editorApi.catchFrame(AREAS[0], d).k, before);
  // とても横長の写真（高さが幅の半分未満）では、高さに合わせて縮める
  assert.ok(editorApi.catchFrame({ x: 0, y: 0, w: 1000, h: 200 }, d).k < editorApi.catchFrame({ x: 0, y: 0, w: 1000, h: 800 }, d).k);
});
