// ポップのデータの扱い（レギュラーの使い回し・価格の読み取り・出力の止め方）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  createPop, exportFileName, exportProblems, formatDate, formatPrice, isBlankPop, localStamp,
  catchDesignFor, isBurstLayout, moveToRegular, needsCheck, nextPriceBadge, parsePriceInput, upgradeDesign, popFromRegular, popFromShared, placeStamp, PRICE_BADGES, priceBadgeOf, regularFromPop, STAMP, stampOf, normalizeStamp, SAMPLE_POP, SHARE_TARGETS, SIZES, updateRegularFrom, withSample,
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

test('保管したポップから作ると、中身は引き継ぎ・写真は入れ直した id・確認が済むまで出さない', () => {
  // 受け取り口に届く中身（popOutboxRecord の pop。photoId・thumb は送らない）
  const { photoId: _p, thumb: _t, ...sent } = { ...filled(), id: 'old-id', priceTax: 'excl' };
  const today = popFromShared(JSON.parse(JSON.stringify(sent)), { photoId: 'new-photo' }, T1);
  assert.notEqual(today.id, 'old-id', '新しいポップとして作る（元を書き換えない）');
  assert.deepEqual([today.name, today.price, today.priceTax, today.unit, today.origin, today.photoId], ['完熟トマト', 298, 'excl', '1袋', '熊本県産', 'new-photo']);
  assert.deepEqual(today.crop, { x: 0.2, y: 0, zoom: 1.5 });
  assert.equal(today.createdAt, T1.toISOString());
  assert.equal(needsCheck(today), true);
  assert.equal(exportProblems(today).length, 1, '前に出した価格・産地のまま出さない');
  assert.deepEqual(exportProblems({ ...today, confirmed: true }), []);
  // 他の端末から届いた中身なので、知らない項目・形の違う値は取り込まない
  const odd = popFromShared({ name: 'なす', price: '298', isRegular: true, fromRegularId: 'x', confirmed: true, crop: 'bad', each: 'yes' });
  assert.deepEqual([odd.name, odd.price, odd.isRegular, odd.fromRegularId, odd.confirmed, odd.each], ['なす', null, false, null, false, false]);
  assert.deepEqual(odd.crop, createPop().crop);
  // priceTax の無い古いポップは税込で入れたもの
  assert.equal(popFromShared({ name: 'なす', price: 98 }).priceTax, 'incl');
  // レギュラーへ移したら確認の印は要らなくなる（レギュラーの元は出すものではない）
  assert.equal(needsCheck(moveToRegular(today)), false);
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

test('金額の台紙: 絵がアプリに入っていて（オフラインでも出る）、知らない id は黄色い丸', () => {
  const shell = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const b of PRICE_BADGES.filter(x => x.src)) {
    assert.ok(existsSync(new URL(`../${b.src}`, import.meta.url)), b.src);
    assert.ok(shell.includes(`'./${b.src}'`), `sw.js の SHELL に ${b.src}`);
    assert.ok(b.text.w > 0 && b.text.w < 1 && b.aspect > 0, b.id);
  }
  assert.equal(priceBadgeOf({ priceBadge: 'gold-brush' })?.id, 'gold-brush');
  assert.equal(priceBadgeOf({ priceBadge: 'no-such' }), null);
  assert.equal(priceBadgeOf({}), null);
});

test('金額の台紙のボタン: 押すたびに一覧の順に回り、最後の次は最初へ戻る', () => {
  const seen = [];
  let id = '';
  for (let i = 0; i < PRICE_BADGES.length; i++) { seen.push(id); id = nextPriceBadge(id); }
  assert.deepEqual(seen, PRICE_BADGES.map(b => b.id), '全部を1回ずつ通る');
  assert.equal(id, '', '1周したら最初（黄色い丸）');
  assert.equal(nextPriceBadge(undefined), PRICE_BADGES[1].id, '古いポップ（台紙なし）は黄色い丸の次へ');
  assert.equal(nextPriceBadge('no-such'), PRICE_BADGES[1].id);
});

test('「金額主役」は「写真主役」の台紙「爆発」になった（古いポップは読み込むときに直す）', () => {
  const old = { id: 'p1', template: 'bold', name: 'トマト', priceBadge: '', badgePos: { x: 0.5, y: 0.5 } };
  const up = upgradeDesign(old);
  assert.equal(up.template, 'fresh');
  assert.equal(up.priceBadge, 'burst');
  assert.equal(up.badgePos, null);
  assert.equal(up.name, 'トマト');
  assert.equal(isBurstLayout(up), true);
  assert.equal(old.template, 'bold', '元のポップは変えない');
  const fresh = { template: 'fresh', priceBadge: 'gold-brush' };
  assert.equal(upgradeDesign(fresh), fresh, '今の形はそのまま');
  assert.equal(upgradeDesign(null), null);
  assert.ok(PRICE_BADGES.some(b => b.id === 'burst' && b.label === '爆発'));
});

test('「爆発2」は「爆発」と同じ置き方で、ギザギザを赤・数字と「円」を黄色にする', () => {
  const design = { burst: { fill: '#111111', line: '#ffffff', points: [[0, 0]] }, num: { fill: '#e60012', size: 100 }, yen: { fill: '#e60012' }, tax: { fill: '#ffffff' } };
  const red = { priceBadge: 'burst-red' };
  assert.ok(PRICE_BADGES.some(b => b.id === 'burst-red' && b.label === '爆発2'));
  assert.equal(isBurstLayout(red), true);
  const d = catchDesignFor(red, design);
  assert.equal(d.burst.fill, '#e60012');
  assert.equal(d.num.fill, '#ffe100');
  assert.equal(d.yen.fill, '#ffe100');
  assert.equal(d.tax.fill, '#ffffff', '税込の文字はそのまま');
  assert.equal(d.burst.line, '#ffffff', '色以外はそのまま');
  assert.equal(d.num.size, 100);
  assert.equal(design.burst.fill, '#111111', '元のデザインは変えない');
  assert.equal(catchDesignFor({ priceBadge: 'burst' }, design), design, '「爆発」はそのまま');
  assert.equal(isBurstLayout({ priceBadge: 'gold-brush' }), false);
});

test('文字スタンプ: 置き方を決めていなければ決まった位置。動かしても画像の中・決まった大きさに収め、向きは -180〜180', () => {
  const pop = createPop(T0);
  assert.equal(pop.stampText, '');
  assert.deepEqual(stampOf(pop), { x: STAMP.x, y: STAMP.y, scale: 1, rot: 0 });
  const st = stampOf(pop);
  assert.deepEqual(placeStamp(st, { x: 1.5, y: -0.2 }), { ...st, x: 1, y: 0 }, '真ん中は画像の中');
  assert.equal(placeStamp(st, { scale: 99 }).scale, STAMP.maxScale);
  assert.equal(placeStamp(st, { scale: 0 }).scale, STAMP.minScale);
  assert.equal(placeStamp(st, { rot: 190 }).rot, -170, '回し続けても値が膨らまない');
  assert.equal(placeStamp(st, { rot: -190 }).rot, 170);
  assert.equal(placeStamp(st, { rot: 180 }).rot, 180);
  // 壊れた置き方は決まった位置へ
  assert.equal(normalizeStamp({ x: 'a', y: 0, scale: 1, rot: 0 }), null);
  assert.equal(normalizeStamp(null), null);
  assert.deepEqual(stampOf({ stamp: { x: 0.3 } }), stampOf(pop));
});

test('文字スタンプはレギュラー・保管へ引き継ぐ（届いた置き方は形を確かめて取り込む）', () => {
  const pop = { ...createPop(T0), name: 'じゃが芋', stampText: '今夜はカレー！', stamp: { x: 0.3, y: 0.7, scale: 1.5, rot: -12 } };
  const today = popFromRegular(regularFromPop(pop, T0), T1);
  assert.equal(today.stampText, '今夜はカレー！');
  assert.equal(popFromRegular(regularFromPop({ ...pop, stampVertical: true }, T0), T1).stampVertical, true, '縦書きも引き継ぐ');
  assert.deepEqual(today.stamp, pop.stamp);
  assert.notEqual(today.stamp, pop.stamp, '同じ物を指さない（片方を動かしても他方は動かない）');
  assert.deepEqual(popFromShared({ stampText: 'a', stamp: { x: 0.3, y: 0.7, scale: 9, rot: 0 } }).stamp, { x: 0.3, y: 0.7, scale: STAMP.maxScale, rot: 0 });
  assert.equal(popFromShared({ stamp: 'x' }).stamp, null);
  assert.equal(isBlankPop({ ...createPop(T0), stampText: '今夜は' }), false, 'ひとことだけ入れたポップも片付けない');
});
