// 「金額主役」の 産地・商品名・数量と単位 の3行（置き方・検査）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LABEL_DESIGN } from '../js/label-design.js';
import { LABEL_FONTS, labelBounds, labelDesignProblems, labelFontList, labelText, layoutLabels } from '../js/labels.js';

const measure = (s, size) => Array.from(s).length * size;   // 1文字＝大きさ1つ分
const pop = { name: 'にんじん', unit: '1袋', origin: '北海道産' };
const design = () => structuredClone(LABEL_DESIGN);

test('同梱のデザインは検査を通り、描画が読み込む書体と編集画面が数える書体が同じ', () => {
  assert.deepEqual(labelDesignProblems(LABEL_DESIGN), []);
  assert.deepEqual(LABEL_FONTS, labelFontList(LABEL_DESIGN));
});

test('空の行は描かない（産地を入れていないポップに緑の帯だけ出ない）', () => {
  const lay = layoutLabels({ name: 'にんじん', unit: '', origin: '  ' }, measure);
  assert.equal(lay.origin, null);
  assert.equal(lay.unit, null);
  assert.equal(labelBounds(lay, 'origin'), null);
  assert.equal(labelText('unit', { unit: '1袋' }, LABEL_DESIGN.unit), '〈1袋〉');
});

test('置き場所は x, y のとおり（ドラッグで決めた位置に出る）', () => {
  const d = design();
  Object.assign(d.origin, { x: 300, y: -500 });
  const lay = layoutLabels(pop, measure, d);
  assert.deepEqual([lay.origin.lines[0].x, lay.origin.lines[0].y], [300, -500]);
});

test('単位が商品名に付いていくときは、名前の最後の行の終わりから。付いていかなければ自分の位置', () => {
  const d = design();
  const lay = layoutLabels(pop, measure, d);
  const name = lay.name.lines[0];
  assert.equal(lay.unit.lines[0].x, name.x + name.w + d.unit.x);
  assert.equal(lay.unit.lines[0].y, name.y + d.unit.y);
  d.unit.follow = false;
  Object.assign(d.unit, { x: 900, y: 200, align: 'right' });
  assert.deepEqual([layoutLabels(pop, measure, d).unit.lines[0].x, layoutLabels(pop, measure, d).unit.lines[0].y], [900, 200]);
});

test('右揃えの商品名に付いていく単位は、名前の右端から', () => {
  const d = design();
  Object.assign(d.name, { align: 'right', x: 800 });
  const lay = layoutLabels(pop, measure, d);
  assert.equal(lay.unit.lines[0].x, 800 + d.unit.x);
});

test('長い商品名は最大幅で折り返し、行数を超えるなら縮める。最大幅からはみ出さない', () => {
  const d = design();
  const long = { ...pop, name: 'シャインマスカット大粒種なし贈答用特選品' };
  const lay = layoutLabels(long, measure, d);
  assert.ok(lay.name.lines.length <= d.name.maxLines);
  assert.ok(lay.name.size >= d.name.minSize && lay.name.size <= d.name.size);
  for (const l of lay.name.lines) assert.ok(l.w <= d.name.maxW + 0.5, l.text);
  d.name.maxLines = 1;
  assert.equal(layoutLabels(long, measure, d).name.lines.length, 1);
});

test('ひとことを置く下端は、商品名（と付いていく単位）の最後の行', () => {
  const d = design();
  const two = layoutLabels({ ...pop, name: 'シャインマスカット大粒種なし' }, measure, d);
  assert.equal(two.bottom, two.name.lines.at(-1).y);
  assert.equal(layoutLabels({ name: '', unit: '', origin: '' }, measure, d).bottom, null);
});

test('選ぶ範囲は文字と背景の帯を囲む（背景の余白・傾きの分も含む）', () => {
  const d = design();
  const lay = layoutLabels(pop, measure, d);
  const b = labelBounds(lay, 'origin', d).box;
  const line = lay.origin.lines[0];
  assert.equal(b.x0, line.x - d.origin.bg.padX);
  assert.equal(b.x1, line.x + line.w + d.origin.bg.padX);
  assert.ok(b.y0 < line.y - lay.origin.size * 0.8 && b.y1 > line.y);
  d.origin.slant = 0.2;
  const s = labelBounds(layoutLabels(pop, measure, d), 'origin', d).box;
  assert.ok(s.x1 > b.x1, '傾けた分だけ右上が広がる');
});

test('打ち間違いを保存前に止める', () => {
  const bad = f => { const d = design(); f(d); return labelDesignProblems(d).join('\n'); };
  assert.match(bad(d => { d.name.minSize = 200; }), /縮める下限/);
  assert.match(bad(d => { d.name.maxLines = 0; }), /行数/);
  assert.match(bad(d => { d.unit.align = 'middle'; }), /揃え方/);
  assert.match(bad(d => { d.origin.bg.fill = 'green'; }), /背景の色/);
  assert.match(bad(d => { d.unit.prefix = '【【【【【'; }), /4 文字/);
  assert.match(bad(d => { d.unit.follow = 'yes'; }), /付いていく/);
  assert.match(bad(d => { delete d.origin; }), /産地の設定がありません/);
  assert.match(bad(d => { d.name.fill = '#12345'; }), /商品名の色/);
});
