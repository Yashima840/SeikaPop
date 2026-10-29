// 事務所へ集める仕組み（設定用リンク・送る控え・受け取り口の返事）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adOutboxRecord, collectorOf, deliveryBaseName, deliveryBody, makeSetupLink, outboxReplaced,
  filterStock, parseSetupCode, popOutboxRecord, readReply, readSavedAsset, readSavedReply, readStockReply, savedItems, sortOutbox, sortSaved, stockItems, stockLabel, stockProductName,
  driveCacheEvict, driveCacheKey, thumbUrls,
  BUILT_IN_COLLECTOR_URL, makeEasyPasscode, parsePasscodeInput, saveTargets, stockOutboxRecord, stockRequestBody, stockTitleOf, stockFileKey, cleanStockName, DELIVERY_FORMAT,
} from '../js/collect.js';
import { createPop } from '../js/model.js';

const URL_OK = 'https://script.google.com/macros/s/AKfycbx-abc_123/exec';
const PASS = 'abcDEF234xyz';
const APP = 'https://yashima840.github.io/SeikaPop/';

test('設定用リンクを作って、同じ読み方で読み戻せる', () => {
  const link = makeSetupLink(APP, URL_OK, PASS);
  assert.ok(link.startsWith(`${APP}#/setup?`));
  assert.deepEqual(parseSetupCode(link), { ok: true, url: URL_OK, passcode: PASS });
});

test('法人用（Google Workspace）の受け取り口の URL も読める', () => {
  const work = 'https://script.google.com/a/macros/example.co.jp/s/AKfycbx-abc_123/exec';
  assert.deepEqual(parseSetupCode(makeSetupLink(APP, work, PASS)), { ok: true, url: work, passcode: PASS });
  assert.equal(parseSetupCode(makeSetupLink(APP, 'https://script.google.com/a/macros/example.co.jp/s/x/dev', PASS)).ok, false);
});

test('アプリのURLに # が付いていても設定用リンクは1つの # だけ', () => {
  const link = makeSetupLink(`${APP}#/settings`, URL_OK, PASS);
  assert.equal(link.split('#').length, 2);
});

test('LINE から貼り付けた前後の文字や改行があっても読める', () => {
  const link = makeSetupLink(APP, URL_OK, PASS);
  assert.equal(parseSetupCode(`設定はこちら\n${link}\nよろしく`).ok, true);
  assert.equal(parseSetupCode(`  ${link}  `).ok, true);
});

test('違う所へ送らせない: Apps Script 以外の送り先・途中で切れたリンクは理由付きで断る', () => {
  const evil = makeSetupLink(APP, 'https://example.com/macros/s/x/exec', PASS);
  assert.equal(parseSetupCode(evil).ok, false);
  assert.equal(parseSetupCode(makeSetupLink(APP, 'http://script.google.com/macros/s/x/exec', PASS)).ok, false);
  // 合言葉の途中で切れて短くなった（8文字以上残る切れ方はここでは見分けられず、
  // 設定した直後の確かめで「合言葉が違います」と出る）
  const cut = makeSetupLink(APP, URL_OK, PASS).slice(0, -6);
  const r = parseSetupCode(cut);
  assert.equal(r.ok, false);
  assert.match(r.message, /合言葉/);
  assert.equal(parseSetupCode('こんにちは').ok, false);
  assert.equal(parseSetupCode(null).ok, false);
});

test('送り先は URL と合言葉がそろって正しい形のときだけ「送れる」', () => {
  assert.equal(collectorOf({}).ready, false);
  assert.equal(collectorOf({ collector: { url: URL_OK } }).ready, false);
  assert.equal(collectorOf({ collector: { url: URL_OK, passcode: PASS, sender: ' 田中 ' } }).ready, true);
  assert.equal(collectorOf({ collector: { url: URL_OK, passcode: PASS, sender: ' 田中 ' } }).sender, '田中');
});

test('ファイル名は商品名・産地・作った人・端末の時刻・印の順。「_」は区切りだけで、中身の記号は - にする', () => {
  const local = new Date(2026, 9, 26, 8, 5);   // 日本の朝（UTC だと前日になる時刻）
  assert.equal(deliveryBaseName(local.toISOString(), '田中', 'トマト/大玉 3個', 'abcdef123', '熊本県'), 'トマト-大玉 3個_熊本県_田中_20261026-0805_abcdef');
  assert.equal(deliveryBaseName(local.toISOString(), '田中', 'なす_長', 'x', ''), 'なす-長_田中_20261026-0805_x', '産地が無ければ欄ごと省く');
  assert.equal(deliveryBaseName(local.toISOString(), '', '', 'x'), 'pop_名前なし_20261026-0805_x');
  // 作った名前は一覧で読み戻せる
  assert.equal(stockLabel(deliveryBaseName(local.toISOString(), '田中', 'トマト/大玉', 'abc', '熊本県') + '.jpg'), 'トマト-大玉（熊本県・田中）');
});

test('ポップの控えは呼んだ時点の中身を写し、端末の中でしか意味の無い写真ID・見本は持たない', () => {
  const pop = { ...createPop(), name: 'トマト', price: 298, photoId: 'ph1', thumb: 'data:image/jpeg;base64,xx', crop: { x: 1, y: 2, zoom: 1.5 } };
  const rec = popOutboxRecord(pop, { id: 'r1', sender: '田中', now: new Date('2026-10-26T00:00:00Z') });
  assert.equal(rec.key, `pop:${pop.id}`);
  assert.equal(rec.pop.id, pop.id);
  assert.equal(rec.pop.price, 298);
  assert.equal('photoId' in rec.pop, false);
  assert.equal('thumb' in rec.pop, false);
  pop.crop.x = 99;   // 後から動かしても控えは変わらない
  assert.equal(rec.pop.crop.x, 1);
});

test('同じポップの控えは置き換え、違うポップは残す', () => {
  const pop = createPop();
  const recs = [
    { id: 'a', key: `pop:${pop.id}` }, { id: 'b', key: 'pop:other' }, { id: 'c', key: `pop:${pop.id}` },
  ];
  assert.deepEqual(outboxReplaced(recs, `pop:${pop.id}`), ['a', 'c']);
});

test('広告は画像だけ（作り直し用のデータを持たない）', () => {
  const rec = adOutboxRecord({ key: 'ad:x@1', title: '広告（2枚横並び）' }, { id: 'r2', sender: '' });
  assert.equal(rec.kind, 'ad');
  assert.equal(rec.pop, null);
  assert.equal(rec.key, 'ad:ad:x@1');
});

test('送る本文に合言葉・ファイル名・画像が入る', () => {
  const rec = popOutboxRecord({ ...createPop(), name: 'みかん', origin: '愛媛' }, { id: 'r3', sender: '佐藤' });
  const body = deliveryBody(rec, PASS, { type: 'image/jpeg', data: 'AAA' }, null);
  assert.equal(body.format, DELIVERY_FORMAT);
  assert.equal(body.passcode, PASS);
  assert.match(body.name, /^みかん_愛媛_佐藤_\d{8}-\d{4}_r3$/);
  assert.equal(body.image.data, 'AAA');
  assert.equal(body.photo, null);
  assert.equal('thumb' in body, false, 'ポップには見本を付けない');
});

test('受け取り口の返事: 合言葉違いは残りも送らずに止める・読めない返事は失敗にする', () => {
  assert.deepEqual(readReply({ ok: true }), { ok: true });
  const bad = readReply({ ok: false, code: 'passcode' });
  assert.equal(bad.ok, false);
  assert.equal(bad.stop, true);
  assert.match(readReply({ ok: false, message: '容量不足' }).message, /容量不足/);
  assert.equal(readReply(null).ok, false);
  assert.equal(readReply('<html>').ok, false);
});

test('送る順は古いものから', () => {
  const recs = [{ id: 'b', createdAt: '2026-10-26T02:00:00Z' }, { id: 'a', createdAt: '2026-10-26T01:00:00Z' }];
  assert.deepEqual(sortOutbox(recs).map(r => r.id), ['a', 'b']);
});

test('写真ストックへ足す控え: 同じ写真は同じ印（2回入れても1枚）。本文はストック用（kind: stock、作り直し用データ無し）', () => {
  const now = new Date(2026, 9, 27, 8, 30);
  const a = stockOutboxRecord('photo-1', ' トマト ', { id: 'r1', sender: '田中', now });
  const b = stockOutboxRecord('photo-1', 'トマト', { id: 'r2', sender: '田中', now });
  assert.equal(a.key, b.key);
  assert.equal(a.kind, 'stock');
  assert.equal(a.title, 'トマト');
  assert.equal(stockOutboxRecord('p', '', { id: 'x', sender: '' }).title, '写真', '商品名が無くても名前を付ける');
  const body = deliveryBody(a, PASS, { type: 'image/jpeg', data: 'AAA' }, { type: 'image/jpeg', data: 'TT' });
  assert.equal(body.kind, 'stock');
  assert.equal(body.pop, null);
  assert.equal(body.photo, null, 'ストックでは2つ目は写真ではない');
  assert.equal(body.thumb.data, 'TT', '一覧に並べる見本として送る');
  assert.equal(body.name, 'トマト_田中_20261027-0830_r1');
});

test('写真ストックの問い合わせの本文と返事: 古い受け取り口はそれと分かる理由を出す', () => {
  const body = stockRequestBody(PASS, 'stock-get', { id: 'abc' });
  assert.deepEqual([body.format, body.passcode, body.action, body.id], [DELIVERY_FORMAT, PASS, 'stock-get', 'abc']);
  assert.equal(readStockReply({ ok: true, stock: 1, items: [] }).ok, true);
  assert.match(readStockReply({ ok: true }).message, /古い版/);
  assert.match(readStockReply({ ok: false, message: '画像が入っていません' }).message, /古い版/);
  assert.match(readStockReply({ ok: false, code: 'passcode', message: 'x' }).message, /合言葉/);
  assert.match(readStockReply({ ok: false, stock: 1, message: 'ストックにその写真がありません' }).message, /ありません/);
});

test('保管したポップの返事・一覧・作り直し用のデータ: 古い受け取り口・広告・壊れたデータは理由を出す', () => {
  assert.equal(readSavedReply({ ok: true, stock: 1, saved: 1, items: [] }).ok, true);
  assert.match(readSavedReply({ ok: true, stock: 1 }).message, /古い版/, '写真ストックだけ対応の版');
  assert.match(readSavedReply({ ok: false, message: '画像が入っていません' }).message, /古い版/);
  assert.match(readSavedReply({ ok: false, saved: 1, message: '保管したポップが見つかりません' }).message, /見つかりません/);
  const items = savedItems([{ id: 'img1', data: 'json1', name: '20261027-0830_田中_トマト_1a2b3c', size: '5' }, { id: 'img2' }, null]);
  assert.deepEqual(items.map(i => [i.id, i.data, i.name, i.product, i.size]), [['img1', 'json1', 'トマト（田中）', 'トマト', 5]]);
  assert.equal(items[0].locked, false);
  assert.equal(savedItems([{ id: 'a', data: 'b', name: 'x', locked: true }])[0].locked, true, 'ロックは受け取り口の印のまま');
  assert.equal(savedItems([{ id: 'a', data: 'b', name: 'x', locked: 'yes' }])[0].locked, false, '形の違う印はロックとみなさない');
  const pop = popOutboxRecord({ ...createPop(), name: 'トマト', price: 298 }, { id: 'r1', sender: '田中' }).pop;
  const asset = { format: 'seikapop-asset', version: 1, pop, photo: { type: 'image/jpeg', data: 'QUJD' } };
  const r = readSavedAsset(asset);
  assert.equal(r.ok, true);
  assert.equal(r.content.name, 'トマト');
  assert.deepEqual(r.photo, { type: 'image/jpeg', data: 'QUJD' });
  assert.equal(readSavedAsset({ ...asset, photo: null }).photo, null, '写真の無いポップも呼び出せる');
  assert.match(readSavedAsset({ ...asset, pop: null }).message, /広告/);
  assert.match(readSavedAsset({ ...asset, version: 2 }).message, /新しい形/);
  assert.equal(readSavedAsset(null).ok, false);
});

test('保管したポップは商品名順（かな・カナは同じ）→ 産地 → 新しい順に並べる', () => {
  const items = savedItems([
    { id: '1', data: 'd1', name: 'トマト_熊本県_田中_20261027-0830_a', updated: '2026-10-27' },
    { id: '2', data: 'd2', name: 'きゅうり_田中_20261020-0830_b', updated: '2026-10-20' },
    { id: '3', data: 'd3', name: 'とまと_熊本県_佐藤_20261028-0830_c', updated: '2026-10-28' },
    { id: '4', data: 'd4', name: 'トマト_愛知県_田中_20261026-0830_d', updated: '2026-10-26' },
    { id: '5', data: 'd5', name: '20261029-0830_田中_キャベツ_e', updated: '2026-10-29' },   // 前の形の名前
  ]);
  assert.deepEqual(sortSaved(items).map(i => i.id), ['5', '2', '4', '3', '1']);
});

test('写真ストックの名前: アプリが付けた日時・印は見せず「商品名（送った人）」、PC で入れた名前はそのまま', () => {
  assert.equal(stockLabel('20261027-0830_田中_完熟トマト_1a2b3c.jpg'), '完熟トマト（田中）');
  assert.equal(stockLabel('20261027-0830_名前なし_トマト_1a2b3c.jpg'), 'トマト');
  assert.equal(stockLabel('シャインマスカット 箱.JPG'), 'シャインマスカット 箱');
  assert.equal(stockLabel(''), '（名前なし）');
  // 今の形（商品名が先）
  assert.equal(stockLabel('完熟トマト_熊本県_田中_20261027-0830_1a2b3c.jpg'), '完熟トマト（熊本県・田中）');
  assert.equal(stockLabel('トマト_名前なし_20261027-0830_1a2b3c.jpg'), 'トマト');
  assert.equal(stockProductName('完熟トマト_熊本県_田中_20261027-0830_1a2b3c.jpg'), '完熟トマト');
  assert.equal(stockLabel('トマト_大玉.jpg'), 'トマト_大玉', 'PC で入れた名前はそのまま');
  // 商品名へ入れるのは名前だけ（送った人・日時・印・拡張子は付けない）
  assert.equal(stockProductName('20261027-0830_田中_完熟トマト_1a2b3c.jpg'), '完熟トマト');
  assert.equal(stockProductName('20261027-0830_名前なし_トマト_1a2b3c.jpg'), 'トマト');
  assert.equal(stockProductName('シャインマスカット 箱.JPG'), 'シャインマスカット 箱');
  assert.equal(stockProductName(''), '');
  assert.equal(stockItems([{ id: 'x', name: '20261027-0830_田中_なす_1a2b3c.jpg' }])[0].product, 'なす');
  assert.deepEqual(stockItems([{ id: 'x', name: 'a.png', size: '10' }, null, { name: 'no-id' }]).map(i => [i.id, i.name, i.size]), [['x', 'a', 10]]);
});

test('写真ストックを名前で探す: 全角半角・カタカナひらがなの違いは気にしない。言葉はすべて含むもの', () => {
  const items = stockItems([{ id: '1', name: 'トマト 大玉.jpg' }, { id: '2', name: 'ﾄﾏﾄ ミニ.jpg' }, { id: '3', name: 'きゅうり.jpg' }]);
  assert.deepEqual(filterStock(items, 'とまと').map(i => i.id), ['1', '2']);
  assert.deepEqual(filterStock(items, 'トマト みに').map(i => i.id), ['2']);
  assert.equal(filterStock(items, '  ').length, 3);
});
test('保存する場所: 送り先が未設定なら「みんなで使える場所」は外し、1つも無ければ none', () => {
  assert.deepEqual(saveTargets({ shared: true, phone: true, regular: false }, true),
    { shared: true, phone: true, regular: false, none: false });
  assert.equal(saveTargets({ shared: true, phone: false }, false).shared, false);
  assert.equal(saveTargets({ shared: true, phone: false }, false).none, true);
  assert.equal(saveTargets({ regular: true }, false).none, false);
  assert.equal(saveTargets({}, true).none, true);
  assert.equal(saveTargets({ shared: false, phone: false }, true, true).none, false, 'レギュラーそのものはチェックが無くても保存だけで済む');
});

test('合言葉だけで送れる（URL を入れていない端末は組み込みの受け取り口へ）', () => {
  const c = collectorOf({ collector: { passcode: 'tomato-negi-kaki-482', sender: '田中' } });
  assert.equal(c.ready, true);
  assert.equal(c.url, BUILT_IN_COLLECTOR_URL);
  assert.equal(collectorOf({ collector: { sender: '田中' } }).ready, false);
  assert.equal(collectorOf({}).ready, false);
});

test('打った合言葉を読む: 全角・前後の空白は直し、短いものや記号入りは理由付きで断る', () => {
  assert.deepEqual(parsePasscodeInput('  ｔｏｍａｔｏ－ｎｅｇｉ－４８２ '), { ok: true, url: '', passcode: 'tomato-negi-482' });
  assert.equal(parsePasscodeInput('').ok, false);
  assert.equal(parsePasscodeInput('tomato').ok, false);
  assert.equal(parsePasscodeInput('tomato negi kaki').ok, false);
  // 前の設定用リンクを貼っても読める
  const link = makeSetupLink('https://example.com/app/', BUILT_IN_COLLECTOR_URL, 'abcdEFGH1234');
  assert.deepEqual(parsePasscodeInput(link), { ok: true, url: BUILT_IN_COLLECTOR_URL, passcode: 'abcdEFGH1234' });
});

test('覚えやすい合言葉: 言葉3つ＋3桁で、合言葉の形として通る', () => {
  const p = makeEasyPasscode(new Uint8Array([0, 1, 2, 0, 0, 7]));
  assert.equal(p, 'tomato-kyuuri-ninjin-007');
  const q = makeEasyPasscode(new Uint8Array([255, 255, 255, 255, 255, 255]));
  assert.match(q, /^[a-z]+-[a-z]+-[a-z]+-\d{3}$/);
  assert.equal(parsePasscodeInput(q).ok, true);
});

test('stockTitleOf: PC から送る写真の名前はファイル名から拡張子を外したもの', () => {
  assert.equal(stockTitleOf('トマト.JPG'), 'トマト');
  assert.equal(stockTitleOf(' 新じゃが 北海道.jpeg '), '新じゃが 北海道');
  assert.equal(stockTitleOf('.png'), '写真');
  assert.equal(stockTitleOf(''), '写真');
});

test('stockFileKey: 中身の SHA-256 の頭16バイトから印を作る（同じ写真は同じ印）', () => {
  const d = new Uint8Array(32).map((_, i) => i * 7);
  assert.equal(stockFileKey(d.buffer), 'file-00070e151c232a31383f464d545b6269');
  assert.equal(stockFileKey(d.buffer), stockFileKey(d.slice().buffer));
});

test('cleanStockName: ドライブで使えない記号は「_」、前後の空白は外す、60文字まで', () => {
  assert.deepEqual(cleanStockName(' トマト 大玉 '), { ok: true, name: 'トマト 大玉' });
  assert.equal(cleanStockName('a/b:c*d?e\\f').name, 'a_b_c_d_e_f');
  assert.equal(cleanStockName('あ'.repeat(80)).name.length, 60);
  assert.equal(cleanStockName('  ').ok, false);
});

test('倉庫から開いたものの控えの名前は、ドライブで直されたら変わる（古い中身を使わない）', () => {
  const item = { id: 'abc123', updated: '2026-10-30T01:00:00.000Z' };
  assert.equal(driveCacheKey('stock', item), 'stock:abc123:2026-10-30T01:00:00.000Z');
  assert.notEqual(driveCacheKey('stock', item), driveCacheKey('stock', { ...item, updated: '2026-10-31T01:00:00.000Z' }));
  assert.notEqual(driveCacheKey('stock', item), driveCacheKey('saved', item), '写真とポップは別に持つ');
});

test('控えが多すぎたら、使ってから長いものから捨てる', () => {
  const use = { a: '2026-10-30T01:00:00Z', b: '2026-10-30T03:00:00Z', c: '2026-10-30T02:00:00Z' };
  assert.deepEqual(driveCacheEvict(use, 2), ['a']);
  assert.deepEqual(driveCacheEvict(use, 3), []);
  assert.deepEqual(driveCacheEvict(use, 1).sort(), ['a', 'c']);
  assert.deepEqual(driveCacheEvict(null, 2), []);
});

test('一覧と一緒に届いた見本を data URL にする（ドライブの重い見本は印を付ける・中身の無いものは除く）', () => {
  const r = thumbUrls({ a: { type: 'image/jpeg', data: 'QUJD' }, b: { type: 'image/png', data: 'REVG', drive: true }, c: { type: 'image/jpeg' } });
  assert.deepEqual(r.thumbs, { a: 'data:image/jpeg;base64,QUJD', b: 'data:image/png;base64,REVG' });
  assert.deepEqual(r.heavy, ['b']);
  assert.deepEqual(thumbUrls(undefined), { thumbs: {}, heavy: [] }, '古い版の受け取り口（見本が付かない）');
});
