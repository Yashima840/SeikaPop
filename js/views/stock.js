// 写真ストックから選ぶ画面（編集画面の上に重ねて開く）。
// 前に読んだ一覧と見本をすぐ並べ、裏で最新の一覧を問い合わせて入れ替える（電波が弱い売り場でも待たせない）。

import * as store from '../store.js';
import { filterStock } from '../collect.js';
import { fetchStockImage, fetchStockList, fetchStockThumbs, putStockThumbs, stockThumbOf } from '../sender.js';
import { recordError } from '../crash.js';
import { h } from '../ui.js';

const THUMBS_PER_ASK = 30;   // 受け取り口が1回に返す見本の数（Code.gs の STOCK_THUMBS_MAX）

/**
 * ストックを開く。写真を選んだら onPick(blob, item) を待ってから閉じる。
 * onPick が失敗を投げたら、閉じずに理由を出す（選び直せるように）。
 */
export function openStockPicker({ onPick }) {
  let items = [], thumbs = {}, query = '', busy = false, closed = false;

  const statusEl = h('p', { class: 'stock-status', text: '' });
  const grid = h('div', { class: 'grid stock-grid' });
  const search = h('input', {
    type: 'search', placeholder: '名前で探す（例: トマト）', enterkeyhint: 'search',
    oninput: () => { query = search.value; renderGrid(); },
  });
  const close = () => { closed = true; sheet.remove(); };
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': '写真ストック' },
    h('div', { class: 'sheet-bar' },
      h('b', { text: '📦 写真ストック' }),
      h('button', { type: 'button', class: 'mini', onclick: () => refresh() }, '↻ 読み直す'),
      h('button', { type: 'button', class: 'mini', onclick: close }, '閉じる')),
    h('div', { class: 'sheet-body' },
      h('p', { class: 'hint' }, '事務所のドライブ「青果ポップ 写真ストック」の写真です。タップするとこのポップの写真になります。'),
      search, statusEl, grid));

  const setStatus = (text, error = false) => {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', error);
  };

  function renderGrid() {
    const shown = filterStock(items, query);
    grid.replaceChildren(...shown.map(item => h('div', { class: 'card shot' },
      h('button', { class: 'card-main', 'aria-label': item.name, onclick: () => pick(item) },
        thumbs[item.id] ? h('img', { src: thumbs[item.id], alt: '', loading: 'lazy' }) : h('div', { class: 'thumb-empty', text: '🖼' }),
        h('span', { class: 'card-title', text: item.name })))));
    if (items.length && !shown.length) grid.replaceChildren(h('p', { class: 'empty', text: `「${query}」に合う写真はありません` }));
  }

  async function pick(item) {
    if (busy) return;
    busy = true;
    setStatus(`「${item.name}」を読み込み中…（大きい写真は少し時間がかかります）`);
    try {
      const r = await fetchStockImage(item.id);
      if (!r.ok) throw new Error(r.message);
      await onPick(r.blob, item);
      close();
    } catch (err) {
      setStatus(`読み込めませんでした: ${err.message}`, true);
    } finally {
      busy = false;
    }
  }

  const saveCache = () => store.putStockCache({ items, thumbs, fetchedAt: new Date().toISOString() })
    .catch(() => { /* 控えは次に早く出すためだけのもの。書けなくても一覧は使える */ });

  async function loadThumbs() {
    const missing = items.map(x => x.id).filter(id => !thumbs[id]);
    for (let i = 0; i < missing.length && !closed; i += THUMBS_PER_ASK) {
      const r = await fetchStockThumbs(missing.slice(i, i + THUMBS_PER_ASK));
      if (!r.ok) { setStatus(`見本を読み込めませんでした: ${r.message}`, true); return; }
      Object.assign(thumbs, r.thumbs);
      renderGrid();
      if (r.heavy.length) lighten(r.heavy);
    }
    saveCache();
  }

  /**
   * 受け取り口に軽い見本が無かった写真（ドライブに直接入れた写真など）は、ドライブの重い見本を端末で縮めて預け直す。
   * 次からは、どの端末にも軽い見本が届く。うまくいかなくても一覧はそのまま使えるので、記録だけ残す。
   */
  async function lighten(ids) {
    try {
      const small = {};
      for (const id of ids) {
        small[id] = 'data:image/jpeg;base64,' + await store.blobToBase64(await stockThumbOf(await (await fetch(thumbs[id])).blob()));
      }
      Object.assign(thumbs, small);
      saveCache();
      const r = await putStockThumbs(small);
      if (!r.ok) recordError('stock thumbs put', new Error(r.message));
    } catch (err) {
      recordError('stock thumbs lighten', err);
    }
  }

  async function refresh() {
    setStatus(items.length ? '最新の一覧を確かめています…' : '一覧を読み込み中…');
    const r = await fetchStockList();
    if (closed) return;
    if (!r.ok) { setStatus(items.length ? `最新の一覧を読めませんでした（前に読んだ一覧です）: ${r.message}` : r.message, true); return; }
    items = r.items;
    // 消えた写真の見本は捨てる（控えが膨らまないように）
    thumbs = Object.fromEntries(Object.entries(thumbs).filter(([id]) => items.some(x => x.id === id)));
    const skipped = r.skipped ? `（HEIC など、スマホで開けない形の写真 ${r.skipped} 枚は出していません）` : '';
    setStatus(items.length ? `${items.length} 枚${skipped}` : `ストックはまだ空です${skipped}`);
    renderGrid();
    saveCache();
    loadThumbs();
  }

  document.body.append(sheet);
  store.getStockCache().then(c => {
    if (closed) return;
    items = c.items || [];
    thumbs = c.thumbs || {};
    renderGrid();
  }).catch(() => { /* 控えが読めなくても、下の問い合わせで並べる */ }).finally(refresh);
}
