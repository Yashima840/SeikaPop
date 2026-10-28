// フレームにまとめる画面（広告）:①フレームを選ぶ ②はじめの画面と同じポップ（レギュラー・履歴）からタップした順に枠へ入れる ③共有・保存。
// 枠に入る画像は、選んだポップの今の中身からその場で作る（はじめの画面で直したものがそのまま入る）。
// 作りかけ（フレーム・選んだポップ・見出し）は自動で保存し、次に開いたときに続きから。

import * as store from '../store.js';
import { exportProblems, formatShotTime, popLists, popShotKey, popTitle, slotsToPopIds } from '../model.js';
import {
  AD_TITLES, adProblems, createAd, CUSTOM_COLOR_DEFAULT, CUSTOM_COLORS, customColorOf, CUSTOM_ID, CUSTOM_MAX_PER_ROW, CUSTOM_NAME_MAX, customFrame, customFrameProblems,
  dropMissing, fitSlots, frameFor, FRAME_ORDER, FRAMES, normalizeRows, saveCustomFrame, shotFromAd, toggleShot, usedRows,
} from '../frames.js';
import { adjustedCopy, blobToImage } from '../image.js';
import { adToFile, ensureAdFonts, ensureFonts, renderAd, renderPop } from '../render.js';
import { confirmBox, debounce, downloadFile, frameThrottle, h, toast } from '../ui.js';
import { queueAd } from '../sender.js';
import { collectorOf, saveTargets } from '../collect.js';

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
  app.setTitle('フレームにまとめる', { back: true });
  const settings = await store.getSettings();
  const groups = popLists(await store.listPops());
  const listed = [...groups.regulars, ...groups.recent];
  const popById = new Map(listed.map(p => [p.id, p]));

  let saved = await store.listCustomFrames();   // 名前を付けて保存したカスタムフレーム
  let ad = { ...createAd(), ...await store.getAdDraft() };
  ad.customRows = normalizeRows(ad.customRows);
  // 選んでいた保存済みのカスタムが直されていたら、その形に合わせる（消されていたら形だけ残す）
  const savedNow = saved.find(f => f.id === ad.customId);
  if (savedNow) { ad.customRows = savedNow.rows; ad.customName = savedNow.name; ad.customColor = savedNow.color; } else ad.customId = null;
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
  /** フレームを替える。custom＝カスタムのとき { id, name, rows }（保存済みのもの）。 */
  const pickFrame = (id, custom = null) => {
    builder = null;
    const next = custom ? { ...ad, frameId: CUSTOM_ID, customId: custom.id, customName: custom.name, customRows: custom.rows, customColor: custom.color } : { ...ad, frameId: id };
    const r = fitSlots(ad.slots, frameFor(next).slots.length);
    ad = { ...next, slots: r.slots };
    if (r.dropped) toast(`枠が足りないので、後から選んだ ${r.dropped} 枚を外しました`);
    changed();
  };

  // ---- カスタムフレームを組む（6行のボタン。押した行に 1〜3 枚、押さない行は使わない）と、名前を付けて保存 ----
  // 組んでいる途中: { id＝直している保存済みのもの（新しく作るときは null）, name, rows, color＝見出しの色,
  //   picking＝選んでいる行（0〜5）か見出し（'head'）。無ければ -1 }
  let builder = null;
  const openBuilder = (from = null) => {
    builder = from
      ? { id: from.id, name: from.name, rows: [...from.rows], color: from.color, picking: -1 }
      : { id: null, name: `カスタム${saved.length + 1}`, rows: normalizeRows([]), color: CUSTOM_COLOR_DEFAULT, picking: -1 };
    rebuild();
  };
  const setRow = (i, n) => { builder.rows[i] = n; builder.picking = -1; rebuild(); };
  /** 保存して、そのフレームを使う。asNew＝直している途中でも新しい1件として保存する。 */
  const saveBuilder = async (asNew = false) => {
    const target = { id: asNew ? null : builder.id, name: builder.name, rows: builder.rows, color: builder.color };
    const p = customFrameProblems(target, saved);
    if (p.length) { toast(p.join('・'), { error: true }); return; }
    const r = saveCustomFrame(saved, target);
    try {
      await store.putCustomFrames(r.list);
    } catch (err) {
      toast(`カスタムを保存できませんでした: ${err.message}`, { error: true });
      return;
    }
    saved = r.list;
    toast(`「${r.entry.name}」を保存しました`);
    pickFrame(CUSTOM_ID, r.entry);
  };
  const deleteSaved = async f => {
    if (!await confirmBox(`カスタム「${f.name}」を削除します。元に戻せません。`, '削除する')) return;
    const list = saved.filter(x => x.id !== f.id);
    try {
      await store.putCustomFrames(list);
    } catch (err) {
      toast(`削除できませんでした: ${err.message}`, { error: true });
      return;
    }
    saved = list;
    toast(`「${f.name}」を削除しました`);
    if (ad.customId === f.id) pickFrame(FRAME_ORDER[0]); else { builder = null; rebuild(); }
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
    const shape = count ? `（${used.length}行 ${count}枚）` : '';
    // 行のボタンを押すたびに作り直すので、名前は打つたびに builder へ控える
    const nameInput = h('input', {
      value: builder.name, maxlength: CUSTOM_NAME_MAX, placeholder: '例: 週末の特売', enterkeyhint: 'done',
      oninput: () => { builder.name = nameInput.value; },
    });
    return h('div', { class: 'builder' },
      h('p', { class: 'hint' }, '写真を入れたい行のボタンを押して、1行に何枚（1〜3枚）入れるかを選びます。押さなかった行は使いません。'),
      h('div', { class: 'b-frame' },
        builder.picking === 'head'
          ? h('div', { class: 'b-pick b-colors' },
            h('span', { class: 'b-label', text: '見出しの色' }),
            ...CUSTOM_COLORS.map(c => h('button', {
              type: 'button', class: builder.color === c.id ? 'chip on' : 'chip',
              style: `background:${c.bg};color:#fff;border-color:${c.bg}`,
              onclick: () => { builder.color = c.id; builder.picking = -1; rebuild(); },
            }, builder.color === c.id ? `✓ ${c.label}` : c.label)))
          : h('button', {
            type: 'button', class: 'b-head', style: `background:${customColorOf(builder.color).bg}`,
            onclick: () => { builder.picking = 'head'; rebuild(); },
          }, `見出し（${customColorOf(builder.color).label}）▼ 押して色を選ぶ`),
        ...builder.rows.map(row),
        h('div', { class: 'b-foot', text: '店名・日付' })),
      h('label', { class: 'field' }, h('span', { class: 'label', text: '名前（保存して何度でも使えます）' }), nameInput),
      h('div', { class: 'row' },
        h('button', { class: 'primary', disabled: !count, onclick: () => saveBuilder(false) },
          builder.id ? `上書き保存して使う${shape}` : `保存して使う${shape}`),
        builder.id ? h('button', { disabled: !count, onclick: () => saveBuilder(true) }, '新しく保存') : null,
        h('button', { onclick: () => { builder = null; rebuild(); } }, 'やめる')));
  }
  /** フレームの候補: 決まったもの → 保存したカスタム → 新しく作る。 */
  function frameChips() {
    const current = ad.frameId !== CUSTOM_ID ? ad.frameId : ad.customId ? `saved:${ad.customId}` : 'unsaved';
    const items = [
      ...FRAME_ORDER.map(id => [id, `${FRAMES[id].label}（${FRAMES[id].note}）`]),
      ...saved.map(f => [`saved:${f.id}`, `★ ${customFrame(f.rows, f.name).label}`]),
      // 前の版で作った名前の無いカスタムを使っている作りかけ（保存を促す）
      ...(current === 'unsaved' ? [['unsaved', `${frameOf().label}（未保存）`]] : []),
      ['new', '＋ カスタムを作る'],
    ];
    return chips(items, v => {
      if (v === 'new') openBuilder();
      else if (v === 'unsaved') openBuilder({ id: null, name: `カスタム${saved.length + 1}`, rows: ad.customRows, color: ad.customColor });
      else if (v.startsWith('saved:')) pickFrame(CUSTOM_ID, saved.find(f => `saved:${f.id}` === v));
      else pickFrame(v);
    }, current);
  }
  const savedNowFor = () => saved.find(f => f.id === ad.customId);
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
        frameChips(),
        builder ? builderView()
          : savedNowFor() ? h('div', { class: 'row' },
            h('button', { onclick: () => openBuilder(savedNowFor()) }, `「${savedNowFor().name}」を直す`),
            h('button', { class: 'danger', onclick: () => deleteSaved(savedNowFor()) }, '削除'))
            : null,
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
  // 置く場所はチェックで選ぶ（編集画面と同じ。最初から印あり）
  const collectorReady = collectorOf(settings).ready;
  const choice = { shared: collectorReady, phone: true };
  const problemsEl = h('ul', { class: 'problems' });
  const shareBtn = h('button', { class: 'primary big', onclick: () => doExport(true) }, '共有する（LINE・Instagram など）');
  const saveBtn = h('button', { class: 'big', onclick: () => doExport(false) }, '保存する');
  function updateExportState() {
    const p = problems();
    const none = saveTargets(choice, collectorReady).none;
    problemsEl.replaceChildren(...[...p, ...(none ? ['保存する場所に1つ以上チェックを入れてください'] : [])]
      .map(t => h('li', { text: t })));
    shareBtn.disabled = p.length > 0;
    saveBtn.disabled = p.length > 0 || none;
  }
  function choiceBox(key, label, { disabled = false, note = '' } = {}) {
    return h('label', { class: 'check' },
      h('input', {
        type: 'checkbox', checked: choice[key], disabled,
        onchange: ev => { choice[key] = ev.target.checked; updateExportState(); },
      }),
      h('span', {}, label, note ? h('small', { class: 'check-note', text: note }) : null));
  }

  /** share: true＝共有（みんなで使える場所へはチェックどおり）／false＝チェックした場所へ保存。 */
  async function doExport(share) {
    const t = saveTargets(choice, collectorReady);
    if (problems().length || (!share && t.none)) return;
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
    const sent = t.shared
      ? queueAd(shot, made.file).catch(err => {
        toast(`みんなで使える場所へ送る準備ができませんでした: ${err.message}`, { error: true });
        return false;
      })
      : Promise.resolve(false);
    try {
      if (share && navigator.canShare?.({ files: [made.file] })) {
        try {
          await navigator.share({ files: [made.file], title: ad.title });
        } catch (err) {
          if (err?.name !== 'AbortError') throw err;  // 共有画面で「キャンセル」した＝失敗ではない
        }
      } else if (share) {
        downloadFile(made.file);
        toast('この端末は共有に対応していないため、画像を保存しました');
      } else {
        const done = [];
        if (await sent) done.push('みんなで使える場所へ送ります');
        if (t.phone) {
          downloadFile(made.file);
          done.push('この端末に保存しました');
        }
        if (done.length) toast(done.join('・'));
      }
    } catch (err) {
      toast(`画像を出せませんでした: ${err.message}`, { error: true });
    } finally {
      await Promise.all([kept, sent]);
    }
  }

  rebuild();
  root.replaceChildren(
    h('div', { class: 'preview' }, canvas, h('div', { class: 'preview-bar' }, statusEl)),
    form,
    h('div', { class: 'export' }, h('h3', {}, '出す'), shareBtn,
      h('h3', { class: 'sub' }, '保存する場所'),
      choiceBox('shared', 'みんなで使える場所に保管', collectorReady
        ? { note: '事務所のドライブに集まります。共有したときもここに入ります' }
        : { disabled: true, note: '合言葉がまだ入っていません（⚙ 設定 →「みんなで使える場所」で入れます）' }),
      choiceBox('phone', 'この端末に保存', { note: 'スマホは写真（ダウンロード）、パソコンはダウンロードのフォルダーに入ります' }),
      problemsEl, saveBtn),
  );
  draw();

  const leave = () => save.flush();
  leave.flush = save.flush;
  return leave;
}
