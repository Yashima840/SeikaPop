// 広告を作る画面: ①フレームを選ぶ ②はじめの画面と同じポップ（レギュラー・履歴）からタップした順に枠へ入れる ③共有・保存。
// 枠に入る画像は、選んだポップの今の中身からその場で作る（はじめの画面で直したものがそのまま入る）。
// 作りかけ（フレーム・選んだポップ・見出し）は自動で保存し、次に開いたときに続きから。

import * as store from '../store.js';
import { exportProblems, formatShotTime, popLists, popShotKey, popTitle, slotsToPopIds } from '../model.js';
import {
  AD_TITLES, adProblems, createAd, CUSTOM_ID, CUSTOM_MAX_PER_ROW, customFrame, dropMissing, fitSlots, frameFor,
  FRAME_ORDER, FRAMES, normalizeRows, shotFromAd, toggleShot, usedRows,
} from '../frames.js';
import { adjustedCopy, blobToImage } from '../image.js';
import { adToFile, ensureAdFonts, ensureFonts, renderAd, renderPop } from '../render.js';
import { debounce, downloadFile, frameThrottle, h, toast } from '../ui.js';
import { queueAd } from '../sender.js';

function chips(items, onPick, current) {
  return h('div', { class: 'chips' }, items.map(([value, label]) =>
    h('button', { type: 'button', class: value === current ? 'chip on' : 'chip', onclick: () => onPick(value) }, label)));
}

/** ポップの1枚（badge＝右上の枠の番号、selected＝枠に入れている、blocked＝まだ出せない（確認待ち））。 */
function popCard(pop, { onOpen, badge = '', selected = false, blocked = false }) {
  return h('div', { class: ['card shot', selected ? 'picked' : '', blocked ? 'blocked' : ''].filter(Boolean).join(' ') },
    h('button', { class: 'card-main', onclick: onOpen, 'aria-label': popTitle(pop), 'aria-pressed': selected ? 'true' : 'false' },
      pop.thumb ? h('img', { src: pop.thumb, alt: '', loading: 'lazy' }) : h('div', { class: 'thumb-empty', text: '📷' }),
      badge ? h('span', { class: 'pick-num', text: badge }) : null,
      h('span', { class: 'card-title', text: popTitle(pop) }),
      h('span', { class: 'card-sub', text: blocked ? '⚠ 確認待ち' : formatShotTime(pop.updatedAt) }),
    ),
  );
}

/** ポップの今の中身を画像（Canvas）にする。写真の補正・仕上げは編集画面と同じ。 */
async function popImage(pop, settings) {
  let photo = null;
  const blob = pop.photoId ? await store.getPhoto(pop.photoId) : null;
  if (blob) {
    photo = adjustedCopy(await blobToImage(blob), pop.adjust || {},
      { sepia: !!pop.photoSepia, vintage: !!pop.photoVintage });
  }
  await ensureFonts(pop, settings);
  const cv = document.createElement('canvas');
  renderPop(cv, pop, photo, settings);
  return cv;
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
  const groups = popLists(await store.listPops());
  const listed = [...groups.regulars, ...groups.recent];
  const popById = new Map(listed.map(p => [p.id, p]));

  let ad = { ...createAd(), ...await store.getAdDraft() };
  ad.customRows = normalizeRows(ad.customRows);
  if (!frameFor(ad)) ad.frameId = FRAME_ORDER[0];
  const frameOf = () => frameFor(ad);
  ad.slots = fitSlots(slotsToPopIds(ad.slots, await store.listShots()), frameOf().slots.length).slots;
  const missing = dropMissing(ad.slots, listed.map(p => p.id));
  ad.slots = missing.slots;
  if (missing.removed) toast(`削除されたポップ ${missing.removed} 枚を枠から外しました`);

  // ---- 画像（選んだポップの分だけ、今の中身から作る）とフレームの飾り ----
  const images = new Map();       // popId → 画像
  const overlays = new Map();     // frameId → { img } か { error }
  async function loadChosen() {
    for (const id of ad.slots) {
      if (!id || images.has(id)) continue;
      images.set(id, await popImage(popById.get(id), settings));
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
    // 選んだ後に確認の印が外れた等（レギュラーから作ったポップは、価格・産地の確認が済むまで出さない）
    for (const id of new Set(ad.slots.filter(Boolean))) {
      const p = exportProblems(popById.get(id));
      if (p.length) out.push(`「${popTitle(popById.get(id))}」: ${p.join('・')}`);
    }
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
    if (id === CUSTOM_ID && !customFrame(ad.customRows)) { openBuilder(); return; }   // まだ作っていない
    builder = null;
    const r = fitSlots(ad.slots, frameFor({ ...ad, frameId: id }).slots.length);
    ad.frameId = id;
    ad.slots = r.slots;
    if (r.dropped) toast(`枠が足りないので、後から選んだ ${r.dropped} 枚を外しました`);
    changed();
  };

  // ---- カスタムフレームを組む（6行のボタン。押した行に 1〜3 枚、押さない行は使わない）----
  let builder = null;   // 組んでいる途中: { rows, picking＝枚数を選んでいる行（無ければ -1）}
  const openBuilder = () => { builder = { rows: [...ad.customRows], picking: -1 }; rebuild(); };
  const setRow = (i, n) => { builder.rows[i] = n; builder.picking = -1; rebuild(); };
  const finishBuilder = () => {
    if (!customFrame(builder.rows)) { toast('写真を入れる行を1つ以上選んでください', { error: true }); return; }
    ad.customRows = normalizeRows(builder.rows);
    pickFrame(CUSTOM_ID);
  };
  function builderView() {
    const used = usedRows(builder.rows), count = used.reduce((a, b) => a + b, 0);
    const row = (n, i) => h('div', { class: n ? 'b-row on' : 'b-row' },
      builder.picking === i
        ? h('div', { class: 'b-pick' },
          h('span', { class: 'b-label', text: `${i + 1}行目` }),
          ...Array.from({ length: CUSTOM_MAX_PER_ROW }, (_, k) =>
            h('button', { type: 'button', class: n === k + 1 ? 'chip on' : 'chip', onclick: () => setRow(i, k + 1) }, `${k + 1}枚`)),
          h('button', { type: 'button', class: 'chip', onclick: () => setRow(i, 0) }, '使わない'))
        : h('button', { type: 'button', class: 'b-main', onclick: () => { builder.picking = i; rebuild(); } },
          h('span', { class: 'b-label', text: `${i + 1}行目` }),
          n ? h('span', { class: 'b-cells' }, Array.from({ length: n }, () => h('span', { class: 'b-cell' })))
            : h('span', { class: 'b-empty', text: '＋ 押して写真の枚数を選ぶ' }),
          n ? h('span', { class: 'b-count', text: `${n}枚` }) : null));
    return h('div', { class: 'builder' },
      h('p', { class: 'hint' }, '写真を入れたい行のボタンを押して、1行に何枚（1〜3枚）入れるかを選びます。押さなかった行は使いません。'),
      h('div', { class: 'b-frame' },
        h('div', { class: 'b-head', text: '見出し' }),
        ...builder.rows.map(row),
        h('div', { class: 'b-foot', text: '店名・日付' })),
      h('div', { class: 'row' },
        h('button', { class: 'primary', disabled: !count, onclick: finishBuilder },
          count ? `作成（${used.length}行 ${count}枚）` : '作成'),
        h('button', { onclick: () => { builder = null; rebuild(); } }, 'やめる')));
  }
  const pickPop = id => {
    const p = exportProblems(popById.get(id));
    // 枠に入っているものは外せるようにする（入れるときだけ止める）
    if (p.length && !ad.slots.includes(id)) { toast(`まだ入れられません: ${p.join('・')}（はじめの画面から開いて直してください）`, { error: true }); return; }
    const r = toggleShot(ad.slots, id);
    if (r.full) { toast('枠がいっぱいです（外したい画像をもう一度タップしてください）'); return; }
    ad.slots = r.slots;
    changed();
  };

  const groupGrid = (label, list) => (list.length ? [
    h('h4', { class: 'group', text: label }),
    h('div', { class: 'grid' }, list.map(pop => {
      const at = ad.slots.indexOf(pop.id);
      return popCard(pop, {
        onOpen: () => pickPop(pop.id), badge: at >= 0 ? String(at + 1) : '', selected: at >= 0,
        blocked: exportProblems(pop).length > 0,
      });
    })),
  ] : []);

  function rebuild() {
    const n = ad.slots.length, filled = ad.slots.filter(Boolean).length;
    form.replaceChildren(
      h('section', {},
        h('h3', {}, '① フレーム'),
        chips([
          ...FRAME_ORDER.map(id => [id, `${FRAMES[id].label}（${FRAMES[id].note}）`]),
          [CUSTOM_ID, customFrame(ad.customRows) ? `${customFrame(ad.customRows).label}` : '＋ カスタム'],
        ], pickFrame, ad.frameId),
        builder ? builderView()
          : ad.frameId === CUSTOM_ID ? h('div', { class: 'row' }, h('button', { onclick: openBuilder }, 'カスタムの行を作り直す')) : null,
      ),
      h('section', {},
        h('h3', {}, `② ポップを選ぶ（${filled}/${n}）`),
        h('p', { class: 'hint' }, 'タップした順に 1, 2, … の枠へ入ります。もう一度タップで外します。はじめの画面と同じポップが並び、今の中身（価格・写真）で入ります。'),
        listed.length ? [
          ...groupGrid('★ レギュラー', groups.regulars),
          ...groupGrid('履歴', groups.recent),
        ] : h('p', { class: 'empty' },
          'まだポップがありません。はじめの画面の「＋ 1枚作る」で作ると、ここに並びます。'),
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
    // 同じ組み合わせかどうかは、ポップの中身の版（直した日時）まで見る（直したら別の広告として残す）
    const shot = shotFromAd({ ...ad, slots: ad.slots.map(id => popShotKey(popById.get(id))) }, frame, made);
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
