// 事務所のドライブから選ぶ画面（写真ストック・保管したポップ。今の画面の上に重ねて開く）。
// 前に読んだ一覧と見本をすぐ並べ、裏で最新の一覧を問い合わせて入れ替える（電波が弱い売り場でも待たせない）。
// 受け取り口への問い合わせは1回に1〜2秒かかるので、回数を減らす:
//   一覧と見本は1回で受け取る（have）／アプリを開いたときに裏で先に読んでおく（warmDrive）／
//   一度開いた写真・ポップは端末に控えて2回目から問い合わせない（driveFiles）／指が触れたら読み始める。

import * as store from '../store.js';
import { driveCacheKey, filterStock } from '../collect.js';
import {
  fetchSavedList, fetchSavedPop, fetchSavedThumbs, fetchStockImage, fetchStockList, fetchStockThumbs,
  lightenSavedThumbs, lightenStockThumbs, lockSavedPop, trashSavedPop,
} from '../sender.js';
import { recordError } from '../crash.js';
import { confirmBox, h } from '../ui.js';
import { askPasscode, ensureCollector } from './passcode.js';

const THUMBS_PER_ASK = 30;   // 受け取り口が1回に返す見本の数（Code.gs の STOCK_THUMBS_MAX）
const THUMBS_PARALLEL = 3;   // 見本の問い合わせを同時に出す数（1回ずつ待つと、その分だけ待たされる）
const WARM_AFTER_MS = 10 * 60 * 1000;   // 先読みは前に読んでからこれだけ経っていたら
const PREPARE_DELAY_MS = 60;   // 指が触れてから読み始めるまで（スクロールで触れただけの写真まで読まないように）

const STOCK = {
  title: '📦 写真ストック', use: '写真ストックを使う', kind: 'stock',
  hint: '事務所のドライブ「青果ポップ 写真ストック」の写真です。タップするとこのポップの写真になります。',
  icon: '🖼', loading: '大きい写真は少し時間がかかります',
  noMatch: q => `「${q}」に合う写真はありません`,
  list: have => fetchStockList(null, have), thumbs: fetchStockThumbs, lighten: lightenStockThumbs,
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
  title: '📂 保管したポップ', use: '保管したポップを使う', kind: 'saved',
  hint: '「みんなで使える場所に保管」したポップです。タップすると同じ中身で今日のポップを作ります（価格・産地を確かめてから出せます）。',
  icon: '🏷', loading: '写真も一緒に読むので少し時間がかかります',
  noMatch: q => `「${q}」に合うポップはありません`,
  list: fetchSavedList, thumbs: fetchSavedThumbs, lighten: lightenSavedThumbs,
  getCache: store.getSavedCache, putCache: store.putSavedCache,
  async load(item) {
    const r = await fetchSavedPop(item.data);
    if (!r.ok) throw new Error(r.message);
    return { content: r.content, photo: r.photo };
  },
  count: r => r.items.length ? `${r.items.length} 件` : 'まだ保管したポップがありません（出すときに「みんなで使える場所に保管」に印を付けると入ります）',
  // 消してはいけないものはロック（鍵のかかったものは削除のボタンが押せず、受け取り口も断る）
  actions: (item, view) => [
    h('button', {
      type: 'button', class: item.locked ? 'mini on' : 'mini',
      title: item.locked ? '押すとロックを外します' : '押すと消せなくなります',
      onclick: () => view.run(async () => {
        const r = await lockSavedPop(item.data, !item.locked);
        if (!r.ok) throw new Error(r.message);
        item.locked = !item.locked;
        view.update(item.locked ? `「${item.name}」をロックしました（消せなくなります）` : `「${item.name}」のロックを外しました`);
      }),
    }, item.locked ? '🔒 ロック中' : '🔓 ロックする'),
    h('button', {
      type: 'button', class: 'mini danger', disabled: item.locked, title: item.locked ? 'ロック中は消せません' : null,
      onclick: () => view.run(async () => {
        if (!await confirmBox(`「${item.name}」を消します。どの端末の一覧からも消えます（30日はドライブのゴミ箱から戻せます）。`, '削除する')) return;
        const r = await trashSavedPop(item.data);
        if (r.locked) { item.locked = true; view.update(); }   // 他の端末でロックされていた
        if (!r.ok) throw new Error(r.message);
        view.drop(item, `「${item.name}」を消しました`);
      }),
    }, '削除'),
  ],
};

/**
 * ストックを開く。写真を選んだら onPick(blob, item) を待ってから閉じる。
 * onPick が失敗を投げたら、閉じずに理由を出す（選び直せるように）。
 */
export function openStockPicker({ onPick }) {
  return openDrivePicker(STOCK, onPick);
}

/** 保管したポップを開く。選んだら onPick({ content, photo }, item) を待ってから閉じる（失敗の扱いはストックと同じ）。 */
export function openSavedPicker({ onPick }) {
  return openDrivePicker(SAVED, onPick);
}

/** 開くものを読む。端末に控えてあればそれを使い、無ければ問い合わせて控える。 */
async function loadCached(src, item) {
  const key = driveCacheKey(src.kind, item);
  try {
    const hit = await store.getDriveFile(key);
    if (hit) return hit;
  } catch (err) {
    recordError(`${src.title} cache read`, err);   // 控えが読めなくても、問い合わせれば開ける
  }
  const value = await src.load(item);
  store.putDriveFile(key, value).catch(err => recordError(`${src.title} cache write`, err));   // 控えられなくても今は開ける
  return value;
}

/** 一覧と、一緒に届いた見本を控えに入れる。消えたものの見本は捨てる（控えが膨らまないように）。 */
function mergeList(r, oldThumbs) {
  const thumbs = { ...oldThumbs, ...r.thumbs };
  return { items: r.items, thumbs: Object.fromEntries(Object.entries(thumbs).filter(([id]) => r.items.some(x => x.id === id))) };
}

/**
 * 見本を何回かに分けて同時に問い合わせる（1回ずつ待つと、その分だけ待たされる）。届いた分ごとに onBatch(r) を呼ぶ。
 * 止まった理由（失敗の文言）を返す。無事なら ''。stop() が true になったら打ち切る。
 */
async function fetchThumbs(src, ids, onBatch, stop = () => false) {
  const batches = [];
  for (let i = 0; i < ids.length; i += THUMBS_PER_ASK) batches.push(ids.slice(i, i + THUMBS_PER_ASK));
  let failed = '';
  const worker = async () => {
    while (batches.length && !stop() && !failed) {
      const r = await src.thumbs(batches.shift());
      if (!r.ok) { failed = r.message; return; }
      onBatch(r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(THUMBS_PARALLEL, batches.length) }, worker));
  return failed;
}

let warmedAt = 0;
/**
 * アプリを開いた・表に戻ったときに、倉庫の一覧と見本を裏で読んでおく（開いたときに最新がそろっているように）。
 * 合言葉が無い・電波が無いときは何もしない。失敗は記録だけ（倉庫を開けば、その場でもう一度問い合わせる）。
 */
export async function warmDrive(now = Date.now()) {
  if (now - warmedAt < WARM_AFTER_MS) return;
  warmedAt = now;
  for (const src of [SAVED, STOCK]) {
    try {
      const c = await src.getCache();
      if (c.fetchedAt && now - Date.parse(c.fetchedAt) < WARM_AFTER_MS) continue;
      const r = await src.list(Object.keys(c.thumbs || {}));
      if (r.notSet) return;   // 合言葉がまだ（どちらも問い合わせられない）
      if (!r.ok) continue;
      const next = mergeList(r, c.thumbs || {});
      // 一覧と一緒に届かなかった見本（古い版の受け取り口）も読んでおく。ドライブの重い見本は、倉庫を開いたときに縮めて預け直す
      await fetchThumbs(src, next.items.map(x => x.id).filter(id => !next.thumbs[id]), b => {
        for (const [id, t] of Object.entries(b.thumbs)) if (!b.heavy.includes(id)) next.thumbs[id] = t;
      });
      await src.putCache({ ...next, fetchedAt: new Date().toISOString() });
    } catch (err) {
      recordError(`${src.title} warm`, err);
    }
  }
}

async function openDrivePicker(src, onPick) {
  // 合言葉がまだ無ければ、ここで聞く（やめたら開かない）
  if (!await ensureCollector(src.use)) return;
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

  // 指が触れたら読み始める（離してから読むより、押している間の分だけ早く開く）。スクロールで触れただけなら取りやめる
  const preparing = new Map();
  let prepareTimer = null;
  const prepare = item => {
    if (!preparing.has(item.id)) {
      const p = loadCached(src, item);
      preparing.set(item.id, p);
      p.catch(() => preparing.delete(item.id));   // 失敗したら、押し直したときに読み直す（理由は pick が出す）
    }
    return preparing.get(item.id);
  };
  const cancelPrepare = () => clearTimeout(prepareTimer);

  function renderGrid() {
    const shown = filterStock(items, query);
    grid.replaceChildren(...shown.map(item => h('div', { class: 'card shot' },
      h('button', {
        class: 'card-main', 'aria-label': item.name, onclick: () => pick(item),
        onpointerdown: () => { cancelPrepare(); prepareTimer = setTimeout(() => prepare(item), PREPARE_DELAY_MS); },
        onpointercancel: cancelPrepare,
      },
        thumbs[item.id] ? h('img', { src: thumbs[item.id], alt: '', loading: 'lazy' }) : h('div', { class: 'thumb-empty', text: src.icon }),
        h('span', { class: 'card-title', text: item.name })),
      src.actions ? h('div', { class: 'card-actions' }, src.actions(item, view)) : null)));
    if (items.length && !shown.length) grid.replaceChildren(h('p', { class: 'empty', text: src.noMatch(query) }));
  }

  // カードのボタン（ロック・削除）から使う。読み込み中・操作中は重ねて動かさない。失敗は理由を出す
  const view = {
    async run(fn) {
      if (busy) return;
      busy = true;
      try {
        await fn();
      } catch (err) {
        setStatus(`できませんでした: ${err.message}`, true);
      } finally {
        busy = false;
      }
    },
    update(message) {
      if (message) setStatus(message);
      renderGrid();
      saveCache();
    },
    drop(item, message) {
      items = items.filter(x => x !== item);
      delete thumbs[item.id];
      view.update(message);
    },
  };

  async function pick(item) {
    if (busy) return;
    busy = true;
    setStatus(`「${item.name}」を読み込み中…（${src.loading}）`);
    try {
      cancelPrepare();
      await onPick(await prepare(item), item);
      close();
    } catch (err) {
      setStatus(`読み込めませんでした: ${err.message}`, true);
    } finally {
      busy = false;
    }
  }

  const saveCache = () => src.putCache({ items, thumbs, fetchedAt: new Date().toISOString() })
    .catch(() => { /* 控えは次に早く出すためだけのもの。書けなくても一覧は使える */ });

  // 一覧と一緒に届かなかった見本（ドライブが作る重い見本・古い版の受け取り口）を問い合わせる
  async function loadThumbs() {
    const missing = items.map(x => x.id).filter(id => !thumbs[id]);
    const failed = await fetchThumbs(src, missing, r => {
      Object.assign(thumbs, r.thumbs);
      renderGrid();
      if (r.heavy.length) lighten(r.heavy);
    }, () => closed);
    if (failed) { setStatus(`見本を読み込めませんでした: ${failed}`, true); return; }
    if (missing.length) saveCache();
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
    let r = await src.list(Object.keys(thumbs));
    if (closed) return;
    // 事務所で合言葉を変えた。その場で聞き直して、もう一度読む
    if (r.stop && await askPasscode({ wrong: true })) {
      r = await src.list(Object.keys(thumbs));
      if (closed) return;
    }
    if (!r.ok) { setStatus(items.length ? `最新の一覧を読めませんでした（前に読んだ一覧です）: ${r.message}` : r.message, true); return; }
    ({ items, thumbs } = mergeList(r, thumbs));
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
