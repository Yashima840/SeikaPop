// 広告を作る画面: ①フレームを選ぶ ②作った画像の一覧からタップした順に枠へ入れる ③共有・保存。
// 作りかけ（フレーム・選んだ画像・見出し）は自動で保存し、次に開いたときに続きから。

import * as store from '../store.js';
import { sortHistory } from '../model.js';
import {
  AD_TITLES, adProblems, createAd, dropMissing, fitSlots, FRAME_ORDER, FRAMES, shotFromAd, toggleShot,
} from '../frames.js';
import { blobToImage } from '../image.js';
import { adToFile, ensureAdFonts, renderAd } from '../render.js';
import { debounce, downloadFile, frameThrottle, h, toast } from '../ui.js';
import { shotCard } from './history.js';
import { queueAd } from '../sender.js';

function chips(items, onPick, current) {
  return h('div', { class: 'chips' }, items.map(([value, label]) =>
    h('button', { type: 'button', class: value === current ? 'chip on' : 'chip', onclick: () => onPick(value) }, label)));
}

function loadOverlay(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`フレームの飾り画像（${src}）を読み込めませんでした`));
    img.src = src;
  });
}

export async function showAd(root, app) {
  app.setTitle('広告を作る', { back: true });
  const settings = await store.getSettings();
  const shots = sortHistory(await store.listShots());

  let ad = { ...createAd(), ...await store.getAdDraft() };
  if (!FRAMES[ad.frameId]) ad.frameId = FRAME_ORDER[0];
  const frameOf = () => FRAMES[ad.frameId];
  ad.slots = fitSlots(ad.slots, frameOf().slots.length).slots;
  const missing = dropMissing(ad.slots, shots.map(s => s.id));
  ad.slots = missing.slots;
  if (missing.removed) toast(`履歴から削除された画像 ${missing.removed} 枚を枠から外しました`);

  // ---- 画像（選んだ分だけ読み込む）とフレームの飾り ----
  const images = new Map();       // shotId → 画像
  const overlays = new Map();     // frameId → { img } か { error }
  async function loadChosen() {
    for (const id of ad.slots) {
      if (!id || images.has(id)) continue;
      const blob = await store.getShotImage(id);
      if (!blob) {
        ad.slots = ad.slots.map(s => (s === id ? null : s));
        toast('画像の本体が見つからなかったので枠から外しました', { error: true });
        save();
        rebuild();
        continue;
      }
      images.set(id, await blobToImage(blob));
    }
    const f = frameOf();
    if (f.overlay && !overlays.has(ad.frameId)) {
      try {
        overlays.set(ad.frameId, { img: await loadOverlay(f.overlay) });
      } catch (err) {
        overlays.set(ad.frameId, { error: err.message });
      }
    }
  }
  const overlayState = () => overlays.get(ad.frameId) || {};
  const problems = () => {
    const out = adProblems(ad, frameOf());
    if (overlayState().error) out.push(overlayState().error);
    return out;
  };

  // ---- プレビュー ----
  const canvas = h('canvas', { class: 'preview-canvas' });
  const statusEl = h('span', { class: 'status', text: '' });
  const draw = frameThrottle(async () => {
    try {
      await loadChosen();
    } catch (err) {
      toast(`画像を読み込めませんでした: ${err.message}`, { error: true });
    }
    await ensureAdFonts(ad, settings, () => toast('文字の書体を読み込めませんでした（電波を確認してください）。端末の字で表示します'));
    renderAd(canvas, frameOf(), ad, ad.slots.map(id => images.get(id) || null), settings,
      { overlay: overlayState().img || null, preview: true });
    updateExportState();
  });

  // ---- 作りかけの保存 ----
  const save = debounce(async () => {
    try {
      await store.putAdDraft({ ...ad, updatedAt: new Date().toISOString() });
      statusEl.textContent = '保存済み';
      statusEl.classList.remove('error');
    } catch (err) {
      statusEl.textContent = '保存できませんでした';
      statusEl.classList.add('error');
      toast(`作りかけを保存できませんでした: ${err.message}`, { error: true });
    }
  }, 400);
  const changed = () => {
    statusEl.textContent = '保存中…';
    draw();
    save();
    rebuild();
  };

  // ---- 入力 ----
  const form = h('div', { class: 'form' });
  const titleInput = h('input', {
    value: ad.title, placeholder: '例: 本日のおすすめ', enterkeyhint: 'done',
    oninput: () => { ad.title = titleInput.value; statusEl.textContent = '保存中…'; draw(); save(); },
  });
  const pickFrame = id => {
    const r = fitSlots(ad.slots, FRAMES[id].slots.length);
    ad.frameId = id;
    ad.slots = r.slots;
    if (r.dropped) toast(`枠が足りないので、後から選んだ ${r.dropped} 枚を外しました`);
    changed();
  };
  const pickShot = id => {
    const r = toggleShot(ad.slots, id);
    if (r.full) { toast('枠がいっぱいです（外したい画像をもう一度タップしてください）'); return; }
    ad.slots = r.slots;
    changed();
  };

  function rebuild() {
    const n = ad.slots.length, filled = ad.slots.filter(Boolean).length;
    form.replaceChildren(
      h('section', {},
        h('h3', {}, '① フレーム'),
        chips(FRAME_ORDER.map(id => [id, `${FRAMES[id].label}（${FRAMES[id].note}）`]), pickFrame, ad.frameId),
      ),
      h('section', {},
        h('h3', {}, `② 画像を選ぶ（${filled}/${n}）`),
        h('p', { class: 'hint' }, 'タップした順に 1, 2, … の枠へ入ります。もう一度タップで外します。📌 ピンの画像が上に並びます。'),
        shots.length
          ? h('div', { class: 'grid' }, shots.map(shot => {
            const at = ad.slots.indexOf(shot.id);
            return shotCard(shot, { onOpen: () => pickShot(shot.id), badge: at >= 0 ? String(at + 1) : '', selected: at >= 0 });
          }))
          : h('p', { class: 'empty' },
            'まだ作った画像がありません。ポップの編集画面で「共有する」「画像を保存」「履歴に残すだけ」を押すと、ここに並びます。'),
      ),
      h('section', {},
        h('h3', {}, '③ 文字'),
        h('label', { class: 'field' }, h('span', { class: 'label', text: '見出し' }), titleInput,
          chips(AD_TITLES.map(t => [t, t]), v => { ad.title = v; titleInput.value = v; changed(); }, ad.title)),
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: ad.showDate, onchange: ev => { ad.showDate = ev.target.checked; changed(); } }),
          '今日の日付を入れる'),
        settings.shopName ? null : h('p', { class: 'hint' }, '店名は設定（右上の ⚙）で入れると下の帯に入ります。'),
      ),
    );
  }

  // ---- 出す ----
  const problemsEl = h('ul', { class: 'problems' });
  const shareBtn = h('button', { class: 'primary big', onclick: () => doExport(true) }, '共有する（LINE・Instagram など）');
  const saveBtn = h('button', { onclick: () => doExport(false) }, '画像を保存');
  function updateExportState() {
    const p = problems();
    problemsEl.replaceChildren(...p.map(t => h('li', { text: t })));
    shareBtn.disabled = saveBtn.disabled = p.length > 0;
  }

  async function doExport(share) {
    if (problems().length) return;
    const frame = frameOf();
    let made;
    try {
      await save.flush();
      await loadChosen();
      made = await adToFile(frame, ad, ad.slots.map(id => images.get(id)), settings, overlayState().img || null);
    } catch (err) {
      toast(`広告を作れませんでした: ${err.message}`, { error: true });
      return;
    }
    // 共有画面を開く前に待つと共有を断る端末があるので、履歴へは並行して残す
    // （同じ組み合わせが既にあれば addShot が足さない）
    const shot = shotFromAd(ad, frame, made);
    const kept = store.addShot(shot, made.file)
      .catch(err => toast(`広告を履歴に残せませんでした: ${err.message}`, { error: true }));
    queueAd(shot, made.file).catch(err => toast(`事務所へ送る準備ができませんでした: ${err.message}`, { error: true }));
    try {
      if (share && navigator.canShare?.({ files: [made.file] })) {
        try {
          await navigator.share({ files: [made.file], title: ad.title });
        } catch (err) {
          if (err?.name !== 'AbortError') throw err;  // 共有画面で「キャンセル」した＝失敗ではない
        }
      } else {
        downloadFile(made.file);
        toast(share ? 'この端末は共有に対応していないため、画像を保存しました' : '画像を保存しました');
      }
    } catch (err) {
      toast(`画像を出せませんでした: ${err.message}`, { error: true });
    } finally {
      await kept;
    }
  }

  rebuild();
  root.replaceChildren(
    h('div', { class: 'preview' }, canvas, h('div', { class: 'preview-bar' }, statusEl)),
    form,
    h('div', { class: 'export' }, h('h3', {}, '出す'), problemsEl, shareBtn, saveBtn),
  );
  draw();

  const leave = () => save.flush();
  leave.flush = save.flush;
  return leave;
}
