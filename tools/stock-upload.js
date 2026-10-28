// 写真ストックの管理（PC の作業場）。
// 送る: 選んだ写真を縮めて1枚ずつ送り、送れなかったものは理由を出して一覧に残す。
// 今のストック: 一覧を読み、名前を変える・ゴミ箱へ移す（30日はドライブから戻せる）。
// 送る・問い合わせるのは sender.js、名前と印は collect.js。合言葉はこの画面に入れるだけで、どこにも保存しない。

import * as store from '../js/store.js';
import { cleanStockName, collectorOf, filterStock, parsePasscodeInput, stockFileKey, stockLabel, stockTitleOf } from '../js/collect.js';
import { shrinkPhoto } from '../js/image.js';
import {
  fetchStockList, fetchStockThumbs, lightenStockThumbs, pingCollector, renameStockPhoto, sendStockPhoto, trashStockPhotos,
} from '../js/sender.js';

const $ = id => document.getElementById(id);
const passInput = $('passcode'), senderInput = $('sender');
// state: wait＝まだ／busy＝送っている／done＝送った／failed＝送れなかった（送り直せる）／bad＝写真として読めない（送り直しても同じ）
const items = [];   // { file, title, state, message, el }
let sending = false;
let builtInUrl = collectorOf({}).url;

// このパソコンのアプリに合言葉が入っていれば、それを最初から入れておく（読むだけ）
try {
  const c = collectorOf(await store.getSettings());
  builtInUrl = c.url;
  passInput.value = c.passcode;
  senderInput.value = c.sender || '事務所';
} catch (err) {
  senderInput.value = '事務所';
  console.warn('アプリの設定を読めませんでした', err);
}

$('show').onchange = ev => { passInput.type = ev.target.checked ? 'text' : 'password'; };

/** 画面の合言葉から送り先を作る。読めなければ理由を出して null。 */
function collector() {
  const r = parsePasscodeInput(passInput.value);
  if (!r.ok) {
    setMsg($('pingMsg'), r.message, false);
    return null;
  }
  return { url: r.url || builtInUrl, passcode: r.passcode, sender: senderInput.value.trim() || '事務所' };
}

function setMsg(el, text, ok) {
  el.textContent = text;
  el.className = `msg ${ok ? 'ok' : 'err'}`;
}

$('ping').onclick = async () => {
  const c = collector();
  if (!c) return;
  $('pingMsg').textContent = '確かめています…';
  $('pingMsg').className = 'msg';
  const r = await pingCollector(c.url, c.passcode);
  setMsg($('pingMsg'), r.ok ? '✓ 送り先に届きました' : r.message, r.ok);
};

// ---- 写真を足す ----
const drop = $('drop');
$('choose').onclick = () => $('files').click();
$('files').onchange = ev => { addFiles(ev.target.files); ev.target.value = ''; };
drop.addEventListener('dragover', ev => { ev.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', ev => {
  ev.preventDefault();
  drop.classList.remove('over');
  addFiles(ev.dataTransfer.files);
});

function addFiles(list) {
  for (const file of list) {
    const item = { file, title: stockTitleOf(file.name), state: 'wait', message: '' };
    if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) {
      item.state = 'bad';
      item.message = '画像ではないファイルです';
    }
    items.push(item);
    $('list').append(itemView(item));
  }
  refresh();
}

function itemView(item) {
  const img = document.createElement('img');
  img.alt = '';
  const url = URL.createObjectURL(item.file);
  img.src = url;
  img.onload = () => URL.revokeObjectURL(url);
  img.onerror = () => {
    URL.revokeObjectURL(url);
    if (item.state === 'wait') setState(item, 'bad', 'このブラウザで開けない形の写真です（HEIC などは JPEG に書き出してください）');
  };
  const title = document.createElement('input');
  title.type = 'text';
  title.value = item.title;
  title.title = item.file.name;
  title.oninput = () => { item.title = title.value; };
  const state = document.createElement('div');
  state.className = 'state';
  const rm = document.createElement('button');
  rm.className = 'rm';
  rm.textContent = '一覧から外す';
  rm.onclick = () => {
    if (sending) return;
    items.splice(items.indexOf(item), 1);
    item.el.remove();
    refresh();
  };
  item.el = document.createElement('div');
  item.el.className = 'item';
  item.el.append(img, title, state, rm);
  item.stateEl = state;
  setState(item, item.state, item.message);
  return item.el;
}

function setState(item, state, message = '') {
  item.state = state;
  item.message = message;
  const bad = state === 'failed' || state === 'bad';
  item.el.className = `item ${state === 'done' ? 'done' : bad ? 'failed' : ''}`;
  item.stateEl.className = `state ${state === 'done' ? 'ok' : bad ? 'err' : ''}`;
  item.stateEl.textContent = {
    wait: 'まだ送っていません', busy: message || '送っています…', done: '✓ ストックに入りました', failed: `✗ ${message}`, bad: `✗ 送れません: ${message}`,
  }[state];
  refresh();
}

function refresh() {
  const n = s => items.filter(x => x.state === s).length;
  const left = n('wait') + n('failed');
  $('send').disabled = sending || !left;
  $('send').textContent = n('failed') && !n('wait') ? '送れなかったものを送り直す' : 'まとめて送る';
  $('clearDone').disabled = sending || !n('done');
  const parts = [];
  if (items.length) parts.push(`${items.length} 枚`);
  if (n('done')) parts.push(`送った ${n('done')}`);
  if (n('failed')) parts.push(`送れなかった ${n('failed')}`);
  if (n('bad')) parts.push(`写真として読めない ${n('bad')}`);
  if (n('wait')) parts.push(`まだ ${n('wait')}`);
  $('sum').textContent = parts.join('・');
  $('sum').className = `msg ${n('failed') || n('bad') ? 'err' : ''}`;
}

$('clearDone').onclick = () => {
  for (const item of items.filter(x => x.state === 'done')) {
    items.splice(items.indexOf(item), 1);
    item.el.remove();
  }
  refresh();
};

// ---- 送る ----
$('send').onclick = async () => {
  const c = collector();
  if (!c || sending) return;
  sending = true;
  refresh();
  try {
    for (const item of items.filter(x => x.state === 'wait' || x.state === 'failed')) {
      const r = await sendOne(c, item);
      if (r.stop) {
        // 合言葉が違うときは、残りを送っても同じなので止める
        setMsg($('pingMsg'), r.message, false);
        break;
      }
    }
  } finally {
    sending = false;
    refresh();
  }
  if (stock.loaded && items.some(x => x.state === 'done')) loadStock();   // 送った写真を今のストックにも出す
};

/** 写真の印。中身から作る（同じ写真の送り直しは置き換えになる）。暗号の機能が無い開き方（LAN の http）では名前・大きさ・日時から。 */
async function fileKey(file) {
  if (crypto.subtle) return stockFileKey(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  return `file-${file.name}-${file.size}-${file.lastModified}`;
}

async function sendOne(c, item) {
  try {
    setState(item, 'busy', '縮めています…');
    const key = await fileKey(item.file);
    const photo = await shrinkPhoto(item.file);
    setState(item, 'busy', '送っています…');
    const r = await sendStockPhoto(c, photo, item.title, key);
    setState(item, r.ok ? 'done' : 'failed', r.message);
    return r;
  } catch (err) {
    setState(item, 'bad', `写真を読めませんでした（${err.message}）`);
    return { ok: false };
  }
}

// ---- 今のストック ----
const THUMBS_PER_ASK = 30;   // 受け取り口が1回に返す見本の数（Code.gs の STOCK_THUMBS_MAX）
// list: stockItems の形に、edited（打ちかけの名前）・picked（ゴミ箱へ移す印）を足したもの
const stock = { list: [], thumbs: {}, loaded: false, busy: false, query: '' };
const stockMsg = (text, ok = true) => setMsg($('stockMsg'), text, ok);
const stockBusyMsg = text => { $('stockMsg').textContent = text; $('stockMsg').className = 'msg'; };

$('load').onclick = () => loadStock();
$('q').oninput = () => { stock.query = $('q').value; renderStock(); };
$('pickAll').onchange = ev => {
  for (const x of shownStock()) x.picked = ev.target.checked;
  renderStock();
};

const shownStock = () => filterStock(stock.list, stock.query);

async function loadStock() {
  const c = collector();
  if (!c || stock.busy) return;
  if (stock.list.some(x => x.edited != null) && !confirm('保存していない名前があります。読み直すと消えますが、よろしいですか？')) return;
  stock.busy = true;
  stockBusyMsg('一覧を読み込み中…');
  try {
    const r = await fetchStockList(c);
    if (!r.ok) { stockMsg(r.message, false); return; }
    stock.list = r.items;
    stock.loaded = true;
    const skipped = r.skipped ? `（HEIC など、スマホで開けない形の写真 ${r.skipped} 枚はここにも出ません。ドライブで直接扱ってください）` : '';
    stockMsg(r.items.length ? `${r.items.length} 枚${skipped}` : `ストックはまだ空です${skipped}`);
    renderStock();
    await loadThumbs(c);
  } finally {
    stock.busy = false;
    $('load').textContent = '一覧を読み直す';
    renderStock();
  }
}

async function loadThumbs(c) {
  const missing = stock.list.map(x => x.id).filter(id => !stock.thumbs[id]);
  for (let i = 0; i < missing.length; i += THUMBS_PER_ASK) {
    const r = await fetchStockThumbs(missing.slice(i, i + THUMBS_PER_ASK), c);
    if (!r.ok) { stockMsg(`見本を読み込めませんでした: ${r.message}`, false); return; }
    Object.assign(stock.thumbs, r.thumbs);
    renderStock();
    // ドライブに直接入れた写真の重い見本は、縮めて預け直す（次からスマホでも軽く出る）
    if (r.heavy.length) {
      try {
        Object.assign(stock.thumbs, await lightenStockThumbs(stock.thumbs, r.heavy, c));
      } catch (err) {
        console.warn('見本を縮められませんでした', err);   // 重い見本のまま並べるだけ
      }
    }
  }
}

function renderStock() {
  const shown = shownStock();
  $('stock').replaceChildren(...shown.map(stockView));
  if (stock.loaded && stock.list.length && !shown.length) {
    const p = document.createElement('p');
    p.className = 'help';
    p.textContent = `「${stock.query}」に合う写真はありません`;
    $('stock').append(p);
  }
  const picked = stock.list.filter(x => x.picked).length;
  $('trash').disabled = stock.busy || !picked;
  $('trash').textContent = picked ? `選んだ ${picked} 枚をゴミ箱へ` : '選んだ写真をゴミ箱へ';
  $('pickAll').checked = shown.length > 0 && shown.every(x => x.picked);
}

function stockView(x) {
  const el = document.createElement('div');
  el.className = `item ${x.picked ? 'picked' : ''}`;
  const check = document.createElement('label');
  check.className = 'check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = !!x.picked;
  box.onchange = () => { x.picked = box.checked; renderStock(); };
  check.append(box, 'ゴミ箱へ移すものに選ぶ');
  let pic;
  if (stock.thumbs[x.id]) {
    pic = document.createElement('img');
    pic.src = stock.thumbs[x.id];
    pic.alt = '';
  } else {
    pic = document.createElement('div');
    pic.className = 'thumb-none';
    pic.textContent = '🖼';
  }
  const name = document.createElement('input');
  name.type = 'text';
  name.value = x.edited ?? x.name;
  const save = document.createElement('button');
  save.textContent = '保存';
  save.disabled = x.edited == null;
  name.oninput = () => {
    x.edited = name.value === x.name ? null : name.value;
    save.disabled = x.edited == null;
  };
  name.onkeydown = ev => { if (ev.key === 'Enter' && !ev.isComposing && x.edited != null) save.click(); };
  const state = document.createElement('div');
  state.className = 'state';
  const meta = document.createElement('div');
  meta.className = 'meta';
  const when = x.updated ? new Date(x.updated).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const showMeta = () => { meta.textContent = `${x.file}${when ? `・${when}` : ''}・${Math.round(x.size / 1024)}KB`; };
  showMeta();
  save.onclick = async () => {
    const clean = cleanStockName(name.value);
    if (!clean.ok) { state.className = 'state err'; state.textContent = `✗ ${clean.message}`; return; }
    const c = collector();
    if (!c) return;
    save.disabled = true;
    state.className = 'state';
    state.textContent = '名前を変えています…';
    const r = await renameStockPhoto(c, x.id, clean.name);
    if (!r.ok) {
      save.disabled = false;
      state.className = 'state err';
      state.textContent = `✗ 名前を変えられませんでした: ${r.message}`;
      return;
    }
    x.file = r.name;
    x.name = stockLabel(r.name);
    x.edited = null;
    name.value = x.name;
    showMeta();
    state.className = 'state ok';
    state.textContent = '✓ 名前を変えました';
  };
  const rename = document.createElement('div');
  rename.className = 'rename';
  rename.append(name, save);
  el.append(check, pic, rename, state, meta);
  return el;
}

$('trash').onclick = async () => {
  const picked = stock.list.filter(x => x.picked);
  const c = collector();
  if (!c || !picked.length || stock.busy) return;
  const names = picked.slice(0, 5).map(x => `・${x.name}`).join('\n') + (picked.length > 5 ? `\n…ほか ${picked.length - 5} 枚` : '');
  if (!confirm(`${picked.length} 枚をドライブのゴミ箱へ移します（30日は戻せます）。\n\n${names}`)) return;
  stock.busy = true;
  renderStock();
  stockBusyMsg(`${picked.length} 枚をゴミ箱へ移しています…`);
  try {
    const r = await trashStockPhotos(c, picked.map(x => x.id));
    if (!r.ok) { stockMsg(`ゴミ箱へ移せませんでした: ${r.message}`, false); return; }
    const gone = new Set(picked.map(x => x.id));
    stock.list = stock.list.filter(x => !gone.has(x.id));
    for (const id of gone) delete stock.thumbs[id];
    stockMsg(`✓ ${r.trashed} 枚をゴミ箱へ移しました（残り ${stock.list.length} 枚）`);
  } finally {
    stock.busy = false;
    renderStock();
  }
};

// 送っていない写真・保存していない名前があるまま閉じようとしたら止める（打った内容を黙って失わない）
addEventListener('beforeunload', ev => {
  if (sending || items.some(x => x.state === 'wait' || x.state === 'failed') || stock.list.some(x => x.edited != null)) ev.preventDefault();
});
