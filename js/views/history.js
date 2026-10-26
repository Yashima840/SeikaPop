// 作った画像の履歴: ピン（最上段に固定・消えない）・出し直し・削除。はじめの画面の一区画として出す。

import * as store from '../store.js';
import { formatShotTime, HISTORY_MAX, historyOverflow, setPinned, shotFileName, sortHistory } from '../model.js';
import { confirmBox, downloadFile, h, toast } from '../ui.js';

/** 履歴の1枚。広告の画面でも使う（badge＝右上の印、selected＝選んでいる枠）。 */
export function shotCard(shot, { onOpen, actions = [], badge = '', selected = false }) {
  const cls = ['card', 'shot', shot.pinnedAt ? 'pinned' : '', selected ? 'picked' : ''].filter(Boolean).join(' ');
  return h('div', { class: cls },
    h('button', { class: 'card-main', onclick: onOpen, 'aria-label': shot.title, 'aria-pressed': selected ? 'true' : null },
      h('img', { src: shot.thumb, alt: '', loading: 'lazy' }),
      shot.pinnedAt ? h('span', { class: 'pin-mark', text: '📌' }) : null,
      badge ? h('span', { class: 'pick-num', text: badge }) : null,
      h('span', { class: 'card-title', text: shot.title }),
      h('span', { class: 'card-sub', text: formatShotTime(shot.createdAt) }),
    ),
    actions.length ? h('div', { class: 'card-actions' }, actions) : null,
  );
}

async function reshare(shot) {
  try {
    const blob = await store.getShotImage(shot.id);
    if (!blob) { toast('この画像の本体が見つかりませんでした', { error: true }); return; }
    const file = new File([blob], shotFileName(shot), { type: blob.type || 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: shot.title });
      } catch (err) {
        if (err?.name !== 'AbortError') throw err;  // 共有画面で「キャンセル」した＝失敗ではない
      }
      return;
    }
    downloadFile(file);
    toast('この端末は共有に対応していないため、画像を保存しました');
  } catch (err) {
    toast(`画像を出せませんでした: ${err.message}`, { error: true });
  }
}

/** はじめの画面に置く「作った画像」の区画（見出し・説明・一覧）。 */
export async function historySection(app) {
  const shots = sortHistory(await store.listShots());

  const togglePin = async shot => {
    const next = setPinned(shot, !shot.pinnedAt);
    // ピンを外すと上限の外に出て、その場で消える画像がある。黙って消さずに先に聞く
    const willGo = historyOverflow(shots.map(s => (s.id === shot.id ? next : s)));
    if (willGo.length && !await confirmBox(
      `ピンの無い画像は新しい${HISTORY_MAX}枚まで残します。ピンを外すと古い画像 ${willGo.length} 枚が履歴から消えます。`, 'ピンを外す')) return;
    try {
      await store.putShotMeta(next);
      toast(next.pinnedAt ? 'ピンを付けました（一番上に固定・自動では消えません）' : 'ピンを外しました');
    } catch (err) {
      toast(`ピンを保存できませんでした: ${err.message}`, { error: true });
    }
    app.refresh();
  };
  const remove = async shot => {
    if (!await confirmBox(`「${shot.title}」の画像を履歴から削除します。元に戻せません。`, '削除する')) return;
    try {
      await store.deleteShot(shot.id);
      toast('削除しました');
    } catch (err) {
      toast(`削除できませんでした: ${err.message}`, { error: true });
    }
    app.refresh();
  };

  return [
    h('h2', {}, '🖼 作った画像', h('small', { text: ' タップでもう一度共有' })),
    h('p', { class: 'hint' },
      `📌 ピンを付けた画像は一番上に固定され、自動では消えません。ピンの無い画像は新しい${HISTORY_MAX}枚まで残ります。`),
    shots.length
      ? h('div', { class: 'grid' }, shots.map(shot => shotCard(shot, {
        onOpen: () => reshare(shot),
        actions: [
          h('button', { class: shot.pinnedAt ? 'mini on' : 'mini', onclick: () => togglePin(shot) },
            shot.pinnedAt ? '📌 ピンを外す' : '📌 ピン'),
          h('button', { class: 'mini danger', onclick: () => remove(shot) }, '削除'),
        ],
      })))
      : h('p', { class: 'empty' },
        'まだありません。ポップの編集画面で「共有する」「画像を保存」「履歴に残すだけ」を押すと、ここに並びます。'),
  ];
}
