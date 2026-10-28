// 事務所のドライブから選ぶ画面（写真ストック・保管したポップ。今の画面の上に重ねて開く）。
// 前に読んだ一覧と見本をすぐ並べ、裏で最新の一覧を問い合わせて入れ替える（電波が弱い売り場でも待たせない）。

import * as store from '../store.js';
import { filterStock } from '../collect.js';
import {
  fetchSavedList, fetchSavedPop, fetchSavedThumbs, fetchStockImage, fetchStockList, fetchStockThumbs,
  lightenSavedThumbs, lightenStockThumbs,
} from '../sender.js';
import { recordError } from '../crash.js';
import { h } from '../ui.js';

const THUMBS_PER_ASK = 30;   // 受け取り口が1回に返す見本の数（Code.gs の STOCK_THUMBS_MAX）

const STOCK = {
  title: '📦 写真ストック',
  hint: '事務所のドライブ「青果ポップ 写真ストック」の写真です。タップするとこのポップの写真になります。',
  icon: '🖼', loading: '大きい写真は少し時間がかかります',
  noMatch: q => `「${q}」に合う写真はありません`,
  list: fetchStockList, thumbs: fetchStockThumbs, lighten: lightenStockThumbs,
  getCache: store.getStockCache, putCache: store.putStockCache,
  async load(item) {
    const r = await fetchStockImage(item.id);
    if (!r.ok) throw new Error(r.message);
    return r.blob;
  },
  count(r) {
    const skipped = r.skipped ? `（HEIC など、スマホで開けない形の写真 ${r.skipped} 枚は出していません）` : '';
    return r.items.length ? `${r.items.length} 枚${skipped}` : `ストックはまだ空です${skipped}`;
  },
};

const SAVED = {
  title: '📂 保管したポップ',
  hint: '「みんなで使える場所に保管」したポップです。タップすると同じ中身で今日のポップを作ります（価格・産地を確かめてから出せます）。',
  icon: '🏷', loading: '写真も一緒に読むので少し時間がかかります',
  noMatch: q => `「${q}」に合うポップはありません`,
  list: fetchSavedList, thumbs: fetchSavedThumbs, lighten: lightenSavedThumbs,
  getCache: store.getSavedCache, putCache: store.putSavedCache,
  async load(item) {
    const r = await fetchSavedPop(item.data);
    if (!r.ok) throw new Error(r.message);
    return r;
  },
  count: r => r.items.length ? `${r.items.length} 件` : 'まだ保管したポップがありません（出すときに「みんなで使える場所に保管」に印を付けると入ります）',
};

/**
 * ストックを開く。写真を選んだら onPick(blob, item) を待ってから閉じる。
 * onPick が失敗を投げたら、閉じずに理由を出す（選び直せるように）。
 */
export function openStockPicker({ onPick }) {
  openDrivePicker(STOCK, onPick);
}

/** 保管したポップを開く。選んだら onPick({ content, photo }, item) を待ってから閉じる（失敗の扱いはストックと同じ）。 */
export function openSavedPicker({ onPick }) {
  openDrivePicker(SAVED, onPick);
}

function openDrivePicker(src, onPick) {
  let items = [], thumbs = {}, query = '', busy = false, closed = false;

  const statusEl = h('p', { class: 'stock-status', text: '' });
  const grid = h('div', { class: 'grid stock-grid' });
  const search = h('input', {
    type: 'search', placeholder: '名前で探す（例: トマト）', enterkeyhint: 'search',
    oninput: () => { query = search.value; renderGrid(); },
  });
  const close = () => { closed = true; sheet.remove(); };
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': src.title },
    h('div', { class: 'sheet-bar' },
      h('b', { text: src.title }),
      h('button', { type: 'button', class: 'mini', onclick: () => refresh() }, '↻ 読み直す'),
      h('button', { type: 'button', class: 'mini', onclick: close }, '閉じる')),
    h('div', { class: 'sheet-body' },
      h('p', { class: 'hint' }, src.hint),
      search, statusEl, grid));

  const setStatus = (text, error = false) => {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', error);
  };

  function renderGrid() {
    const shown = filterStock(items, query);
    grid.replaceChildren(...shown.map(item => h('div', { class: 'card shot' },
      h('button', { class: 'card-main', 'aria-label': item.name, onclick: () => pick(item) },
        thumbs[item.id] ? h('img', { src: thumbs[item.id], alt: '', loading: 'lazy' }) : h('div', { class: 'thumb-empty', text: src.icon }),
        h('span', { class: 'card-title', text: item.name })))));
    if (items.length && !shown.length) grid.replaceChildren(h('p', { class: 'empty', text: src.noMatch(query) }));
  }

  async function pick(item) {
    if (busy) return;
    busy = true;
    setStatus(`「${item.name}」を読み込み中…（${src.loading}）`);
    try {
      await onPick(await src.load(item), item);
      close();
    } catch (err) {
      setStatus(`読み込めませんでした: ${err.message}`, true);
    } finally {
      busy = false;
    }
  }

  const saveCache = () => src.putCache({ items, thumbs, fetchedAt: new Date().toISOString() })
    .catch(() => { /* 控えは次に早く出すためだけのもの。書けなくても一覧は使える */ });

  async function loadThumbs() {
    const missing = items.map(x => x.id).filter(id => !thumbs[id]);
    for (let i = 0; i < missing.length && !closed; i += THUMBS_PER_ASK) {
      const r = await src.thumbs(missing.slice(i, i + THUMBS_PER_ASK));
      if (!r.ok) { setStatus(`見本を読み込めませんでした: ${r.message}`, true); return; }
      Object.assign(thumbs, r.thumbs);
      renderGrid();
      if (r.heavy.length) lighten(r.heavy);
    }
    saveCache();
  }

  // ドライブの重い見本は縮めて預け直す（うまくいかなくても一覧はそのまま使えるので、記録だけ残す）
  async function lighten(ids) {
    try {
      Object.assign(thumbs, await src.lighten(thumbs, ids));
      saveCache();
    } catch (err) {
      recordError(`${src.title} thumbs lighten`, err);
    }
  }

  async function refresh() {
    setStatus(items.length ? '最新の一覧を確かめています…' : '一覧を読み込み中…');
    const r = await src.list();
    if (closed) return;
    if (!r.ok) { setStatus(items.length ? `最新の一覧を読めませんでした（前に読んだ一覧です）: ${r.message}` : r.message, true); return; }
    items = r.items;
    // 消えたものの見本は捨てる（控えが膨らまないように）
    thumbs = Object.fromEntries(Object.entries(thumbs).filter(([id]) => items.some(x => x.id === id)));
    setStatus(src.count(r));
    renderGrid();
    saveCache();
    loadThumbs();
  }

  document.body.append(sheet);
  src.getCache().then(c => {
    if (closed) return;
    items = c.items || [];
    thumbs = c.thumbs || {};
    renderGrid();
  }).catch(() => { /* 控えが読めなくても、下の問い合わせで並べる */ }).finally(refresh);
}
