// はじめの画面: 1枚作る／フレームにまとめる（広告）／保管したポップから作る、の入口と、レギュラー・履歴の2つの欄

import * as store from '../store.js';
import { createPop, formatShotTime, isBlankPop, moveToRegular, popFromRegular, popFromShared, popLists, popTitle } from '../model.js';
import { confirmBox, h, toast } from '../ui.js';
import { flushOutbox, onOutboxChange, outboxStatus } from '../sender.js';
import { recordError } from '../crash.js';
import { openSavedPicker } from './stock.js';
import { askPasscode } from './passcode.js';
import { WRONG_PASSCODE } from '../collect.js';

function card(pop, { onOpen, actions, sub = '' }) {
  return h('div', { class: 'card' },
    h('button', { class: 'card-main', onclick: onOpen, 'aria-label': popTitle(pop) },
      pop.thumb ? h('img', { src: pop.thumb, alt: '', loading: 'lazy' }) : h('div', { class: 'thumb-empty', text: '📷' }),
      h('span', { class: 'card-title', text: popTitle(pop) }),
      sub ? h('span', { class: 'card-sub', text: sub }) : null,
    ),
    h('div', { class: 'card-actions' }, actions),
  );
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

export async function showHome(root, app) {
  app.setTitle('青果ポップ', { back: false });
  const pops = await store.listPops();
  const { regulars, recent } = popLists(pops);   // 広告の画面にも同じものが並ぶ
  // 「1枚作る」の後、編集画面のままアプリを閉じると空のポップが残る（離れるときの片付けが走らない）。ここで片付ける
  for (const p of pops.filter(isBlankPop)) {
    store.deletePop(p.id).catch(err => recordError('空のポップの片付け', err));
  }

  const openNew = async () => {
    const pop = createPop();
    await store.putPop(pop);
    app.go(`#/make/${pop.id}`);   // 新しく作るときは、かんたん作成（1段ずつ）で
  };
  const useRegular = async reg => {
    const pop = popFromRegular(reg);
    await store.putPop(pop);
    app.go(`#/make/${pop.id}`);   // 価格・産地を確かめて出すだけの短い流れ
  };
  // みんなで使える場所に保管したポップ（他の端末で作ったものも）から、同じ中身で今日のポップを作る。
  // 写真を先に端末へ入れてから、それを指すポップを保存する。失敗は一覧の画面に出す（投げると閉じずに残る）
  const useSaved = () => openSavedPicker({
    onPick: async ({ content, photo }) => {
      const photoId = photo ? await store.putPhoto(photo) : null;
      const pop = popFromShared(content, { photoId });
      await store.putPop(pop);
      app.go(`#/make/${pop.id}`);   // レギュラーと同じく、価格・産地を確かめて出すだけの短い流れ
    },
  });
  const makeRegular = async pop => {
    try {
      await store.putPop(moveToRegular(pop));
      toast(`「${popTitle(pop)}」をレギュラーにしました`);
    } catch (err) {
      toast(`レギュラーにできませんでした: ${err.message}`, { error: true });
    }
    app.refresh();
  };
  const remove = async (pop, what) => {
    if (!await confirmBox(`「${popTitle(pop)}」の${what}を削除します。元に戻せません。`, '削除する')) return;
    await store.deletePop(pop.id);
    toast('削除しました');
    app.refresh();
  };

  // 事務所へ送れていないものがあるときだけ出す（理由も出す）。タップで今すぐ送り直す。合言葉を断られたときはその場で入れ直してから
  let wrongPasscode = false;
  const outboxNote = h('button', {
    class: 'notice', hidden: true,
    onclick: async () => {
      if (wrongPasscode && !await askPasscode({ wrong: true })) return;
      const r = await flushOutbox();
      if (r.error) toast(`送れませんでした: ${r.error}`, { error: true });
      else if (!r.failed) toast(r.sent ? `${r.sent} 件送りました` : '送るものはありません');
      // 送れなかったものは、この知らせに理由が出る
    },
  });
  const showOutbox = async () => {
    try {
      const st = await outboxStatus();
      wrongPasscode = st.lastError === WRONG_PASSCODE;
      outboxNote.hidden = !st.count;
      outboxNote.textContent = st.lastError
        ? `⚠ 事務所へ送れていないものが ${st.count} 件あります（${st.lastError}）${wrongPasscode ? ' → 押して合言葉を入れ直す' : ' → 押して送り直す'}`
        : `事務所へ送っています（残り ${st.count} 件）`;
      outboxNote.classList.toggle('error', !!st.lastError);
    } catch (err) {
      outboxNote.hidden = false;
      outboxNote.textContent = `⚠ 事務所へ送る控えを読めませんでした: ${err.message}`;
    }
  };
  showOutbox();
  const dispose = onOutboxChange(() => { showOutbox(); });

  // 開いてすぐ「1枚を作るのか・何枚かを1枚にまとめるのか」を選べるように、入口を2つ並べる
  root.replaceChildren(
    outboxNote,
    h('div', { class: 'start-row' },
      h('button', { class: 'primary start', onclick: openNew },
        h('span', { class: 'start-icon', text: '＋' }), h('b', { text: '1枚作る' }), h('small', { text: '写真からポップを1枚' })),
      h('button', { class: 'start', onclick: () => app.go('#/ad') },
        h('span', { class: 'start-icon', text: '🧩' }), h('b', { text: 'フレームにまとめる' }), h('small', { text: '作った画像を並べて1枚' })),
    ),
    h('button', { class: 'big', onclick: useSaved }, '📂 保管したポップから作る（価格などを直して使い回す）'),
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
      : h('p', { class: 'empty' }, '良いポップができたら、下の履歴の「★ レギュラーにする」で、ここから何度でも呼び出せます。'),
    h('h2', {}, '履歴', h('small', { text: ' タップで続きを直す・もう一度出す' })),
    recent.length
      ? h('div', { class: 'grid' }, recent.map(p => card(p, {
        onOpen: () => app.go(`#/edit/${p.id}`),
        sub: formatShotTime(p.updatedAt),
        actions: [
          // レギュラーから作ったものは移すと同じレギュラーが2つになるので出さない（元は「元を直す」で直す）
          p.fromRegularId ? null : h('button', { class: 'mini', onclick: () => makeRegular(p) }, '★ レギュラーにする'),
          h('button', { class: 'mini danger', onclick: () => remove(p, 'ポップ') }, '削除'),
        ],
      })))
      : h('p', { class: 'empty' }, 'まだありません。「＋ 1枚作る」で作ったポップがここに並びます。'),
  );
  return dispose;
}
