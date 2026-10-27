// 写真の切り出し・指での移動・文字の折り返し
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverSource, dragCrop, layoutLines, moveBadge, placeBadge, seededRandom, splitsAreNice, wrapText, zoomCrop } from '../js/layout.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const mono = (t, s = 1) => Array.from(t).length * s;   // 1文字＝大きさぶんの幅

test('横長の写真を正方形の枠へ: 縦いっぱい・横は真ん中を切り出す', () => {
  const s = coverSource(2000, 1000, 500, 500, { x: 0, y: 0, zoom: 1 });
  near(s.sw, 1000); near(s.sh, 1000); near(s.sx, 500); near(s.sy, 0);
});

test('crop.x が端（-1/1）なら写真の端に寄る。範囲外は端で止まる', () => {
  near(coverSource(2000, 1000, 500, 500, { x: -1 }).sx, 0);
  near(coverSource(2000, 1000, 500, 500, { x: 1 }).sx, 1000);
  near(coverSource(2000, 1000, 500, 500, { x: 5 }).sx, 1000);
});

test('拡大すると切り出しが狭くなり、中心は保たれる', () => {
  const s = coverSource(1000, 1000, 500, 500, { zoom: 2 });
  near(s.sw, 500); near(s.sx, 250);
});

test('指を右へ動かすと写真が右へ動く（＝切り出しは左へ）。余りの無い向きは動かない', () => {
  const c = dragCrop({ x: 0, y: 0, zoom: 1 }, 100, 100, 2000, 1000, 500, 500);
  assert.ok(c.x < 0);
  assert.equal(c.y, 0);
  const far = dragCrop({ x: 0, y: 0, zoom: 1 }, 99999, 0, 2000, 1000, 500, 500);
  assert.equal(far.x, -1);
});

test('拡大は 1〜4 倍に収める', () => {
  assert.equal(zoomCrop({ zoom: 1 }, 0.5).zoom, 1);
  assert.equal(zoomCrop({ zoom: 3 }, 2).zoom, 4);
});

test('折り返し: 幅で区切り、句読点は行頭に置かない', () => {
  assert.deepEqual(wrapText('あいうえお', 3, mono), ['あいう', 'えお']);
  assert.deepEqual(wrapText('あいう、えお', 3, mono), ['あいう、', 'えお']);
  assert.deepEqual(wrapText('あい\nう', 10, mono), ['あい', 'う']);
  assert.deepEqual(wrapText('   ', 10, mono), []);
});

test('折り返し: 括弧・空白があれば言葉の途中で割らずにそこで折る', () => {
  assert.deepEqual(wrapText('シャインマスカット（大粒）', 10, mono), ['シャインマスカット', '（大粒）']);
  assert.deepEqual(wrapText('朝採れ とうもろこし', 8, mono), ['朝採れ', 'とうもろこし']);
  // 区切りが行の前半にしか無いなら、そこまで戻らず1文字単位で折る（行が短くなりすぎないように）
  assert.deepEqual(wrapText('あ（いうえおかき', 4, mono), ['あ（いう', 'えおかき']);
});

test('折り返し: 行数を超えた分は … で止める', () => {
  assert.deepEqual(wrapText('あいうえおかきく', 3, mono, 2), ['あいう', 'えお…']);
});

test('商品名: 1行で十分大きく入るなら1行、入らなければ2行にして大きさを保つ', () => {
  const short = layoutLines('トマト', 600, mono, { maxSize: 150, minSize: 70, maxLines: 2 });
  assert.deepEqual(short, { size: 150, lines: ['トマト'] });
  const shrink = layoutLines('とれたてトマト', 900, mono, { maxSize: 150, minSize: 70, maxLines: 2 });
  assert.equal(shrink.lines.length, 1);                 // 128 なら 1行で入る（60%以上）
  assert.equal(shrink.size, 128);
  const long = layoutLines('あいうえおかきくけこさしすせそ', 600, mono, { maxSize: 150, minSize: 70, maxLines: 2 });
  assert.equal(long.lines.length, 2);
  assert.ok(long.size >= 70);
  for (const ln of long.lines) assert.ok(mono(ln, long.size) <= 600);
});

test('商品名: 少し小さくすれば言葉の切れ目で折れるなら、そちらを選ぶ', () => {
  // 最大の大きさだと「シャインマスカッ／ト（…」と割れる幅
  const r = layoutLines('シャインマスカット（大粒）', 700, mono, { maxSize: 100, minSize: 50, maxLines: 2 });
  assert.deepEqual(r.lines, ['シャインマスカット', '（大粒）']);
  assert.ok(r.size >= 70 && r.size < 100);
  assert.equal(splitsAreNice(['シャインマスカッ', 'ト']), false);
  assert.equal(splitsAreNice(['朝採れ', 'トマト']), true);
});

test('段ボール模様の乱数は毎回同じ並び（プレビューと出力が揃う）', () => {
  const a = seededRandom(1), b = seededRandom(1);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test('金額の台紙: 動かしていなければデザインの位置、動かした先は割合で持ち、画像からはみ出さない', () => {
  const auto = { x: 600, y: 300 };
  assert.deepEqual(placeBadge(1080, 1080, 400, 400, null, auto), { x: 600, y: 300, w: 400, h: 400 });
  // 中心を割合で持つので、縦長にしても同じ辺りに来る
  assert.deepEqual(placeBadge(1080, 1920, 400, 400, { x: 0.5, y: 0.5 }, auto), { x: 340, y: 760, w: 400, h: 400 });
  // デザインの位置がはみ出していても寄せる
  assert.deepEqual(placeBadge(1080, 1080, 400, 400, null, { x: 900, y: -20 }), { x: 680, y: 0, w: 400, h: 400 });

  const rect = { x: 600, y: 300, w: 400, h: 400 };
  const near = (p, x, y) => assert.ok(Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5, JSON.stringify(p));
  // 左へ100・下へ50 動かすと、左上は (500, 350)
  near(placeBadge(1080, 1080, 400, 400, moveBadge(rect, -100, 50, 1080, 1080), rect), 500, 350);
  // 端の先まで指を動かしても、台紙は画像の中に留まる
  near(placeBadge(1080, 1080, 400, 400, moveBadge(rect, 5000, -5000, 1080, 1080), rect), 680, 0);
});
