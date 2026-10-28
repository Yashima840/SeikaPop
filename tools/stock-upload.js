// 写真をストックへ送る（PC の作業場）。選んだ写真を縮めて1枚ずつ送り、送れなかったものは理由を出して一覧に残す。
// 送るのは sender.js、名前と印は collect.js。合言葉はこの画面に入れるだけで、どこにも保存しない。

import * as store from '../js/store.js';
import { collectorOf, parsePasscodeInput, stockFileKey, stockTitleOf } from '../js/collect.js';
import { shrinkPhoto } from '../js/image.js';
import { pingCollector, sendStockPhoto } from '../js/sender.js';

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

// 送っていない写真があるまま閉じようとしたら止める（選び直しの手間を黙って増やさない）
addEventListener('beforeunload', ev => {
  if (sending || items.some(x => x.state === 'wait' || x.state === 'failed')) ev.preventDefault();
});
