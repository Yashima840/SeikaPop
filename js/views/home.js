// はじめの画面: 1枚作る／まとめて1枚（広告）の入口・レギュラー・作った画像・作りかけのポップ

import * as store from '../store.js';
import { createPop, popFromRegular, popTitle, sortByUpdated } from '../model.js';
import { confirmBox, h, toast } from '../ui.js';
import { onOutboxChange, outboxStatus } from '../sender.js';
import { historySection } from './history.js';

const RECENT_MAX = 30;

function card(pop, { onOpen, actions }) {
  return h('div', { class: 'card' },
    h('button', { class: 'card-main', onclick: onOpen, 'aria-label': popTitle(pop) },
      pop.thumb ? h('img', { src: pop.thumb, alt: '', loading: 'lazy' }) : h('div', { class: 'thumb-empty', text: '📷' }),
      h('span', { class: 'card-title', text: popTitle(pop) }),
    ),
    h('div', { class: 'card-actions' }, actions),
  );
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

export async function showHome(root, app) {
  app.setTitle('青果ポップ', { back: false });
  const pops = sortByUpdated(await store.listPops());
  const regulars = pops.filter(p => p.isRegular);
  const recent = pops.filter(p => !p.isRegular).slice(0, RECENT_MAX);

  const openNew = async () => {
    const pop = createPop();
    await store.putPop(pop);
    app.go(`#/edit/${pop.id}`);
  };
  const useRegular = async reg => {
    const pop = popFromRegular(reg);
    await store.putPop(pop);
    app.go(`#/edit/${pop.id}`);
  };
  const remove = async (pop, what) => {
    if (!await confirmBox(`「${popTitle(pop)}」の${what}を削除します。元に戻せません。`, '削除する')) return;
    await store.deletePop(pop.id);
    toast('削除しました');
    app.refresh();
  };

  // 事務所へ送れていないものがあるときだけ出す（タップで設定画面の詳しい理由へ）
  const outboxNote = h('button', { class: 'notice', hidden: true, onclick: () => app.go('#/settings') });
  const showOutbox = async () => {
    try {
      const st = await outboxStatus();
      outboxNote.hidden = !st.count;
      outboxNote.textContent = st.lastError
        ? `⚠ 事務所へ送れていないものが ${st.count} 件あります（${st.lastError}）`
        : `事務所へ送っています（残り ${st.count} 件）`;
      outboxNote.classList.toggle('error', !!st.lastError);
    } catch (err) {
      outboxNote.hidden = false;
      outboxNote.textContent = `⚠ 事務所へ送る控えを読めませんでした: ${err.message}`;
    }
  };
  showOutbox();
  const dispose = onOutboxChange(() => { showOutbox(); });

  const history = await historySection(app);

  // 開いてすぐ「1枚を作るのか・何枚かを1枚にまとめるのか」を選べるように、入口を2つ並べる
  root.replaceChildren(
    outboxNote,
    h('div', { class: 'start-row' },
      h('button', { class: 'primary start', onclick: openNew },
        h('span', { class: 'start-icon', text: '＋' }), h('b', { text: '1枚作る' }), h('small', { text: '写真からポップを1枚' })),
      h('button', { class: 'start', onclick: () => app.go('#/ad') },
        h('span', { class: 'start-icon', text: '🧩' }), h('b', { text: 'まとめて1枚' }), h('small', { text: '作った画像をフレームに並べる（広告）' })),
    ),
    isStandalone() ? null : h('p', { class: 'hint' },
      'ホーム画面に追加すると、アプリのように開けて保存も消えにくくなります',
      h('br'), '（iPhone: 共有ボタン →「ホーム画面に追加」／Android: メニュー →「ホーム画面に追加」）'),
    h('h2', {}, '★ レギュラー', h('small', { text: ' タップで今日のポップを作る' })),
    regulars.length
      ? h('div', { class: 'grid' }, regulars.map(reg => card(reg, {
        onOpen: () => useRegular(reg),
        actions: [
          h('button', { class: 'mini', onclick: () => app.go(`#/edit/${reg.id}`) }, '元を直す'),
          h('button', { class: 'mini danger', onclick: () => remove(reg, 'レギュラー') }, '削除'),
        ],
      })))
      : h('p', { class: 'empty' }, '良いポップができたら、編集画面の「★ レギュラーに登録」で、ここから何度でも呼び出せます。'),
    ...history,
    h('h2', {}, '✏ 作りかけ・最近のポップ', h('small', { text: ' タップで続きを直す' })),
    recent.length
      ? h('div', { class: 'grid' }, recent.map(p => card(p, {
        onOpen: () => app.go(`#/edit/${p.id}`),
        actions: [h('button', { class: 'mini danger', onclick: () => remove(p, 'ポップ') }, '削除')],
      })))
      : h('p', { class: 'empty' }, 'まだありません。'),
  );
  return dispose;
}
