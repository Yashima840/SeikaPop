// フレームにまとめる画面（広告）:①フレームを選ぶ ②はじめの画面と同じポップ（レギュラー・履歴）からタップした順に枠へ入れる ③共有・保存。
// 枠に入る画像は、選んだポップの今の中身からその場で作る（はじめの画面で直したものがそのまま入る）。
// 作りかけ（フレーム・選んだポップ・見出し）は自動で保存し、次に開いたときに続きから。

import * as store from '../store.js';
import { exportProblems, formatShotTime, popLists, popShotKey, popTitle, slotsToPopIds } from '../model.js';
import {
  AD_TITLES, adProblems, createAd, CUSTOM_COLOR_DEFAULT, dayInput, normalizePeriod, PERIOD_COLORS, PERIOD_DAYS_MAX, periodEnd, periodText, CUSTOM_COLORS, customColorOf, CUSTOM_ID, CUSTOM_MAX_PER_ROW, CUSTOM_NAME_MAX, customFrame, customFrameProblems,
  defaultLogo, dropMissing, fitSlots, FOOTER_TEXT, frameFor, FRAME_ORDER, FRAMES, LOGO, logoRect, logoSizeOf, normalizeLogo, normalizeRows, placeLogo, resizeLogo, saveCustomFrame, shotFromAd, toggleShot, usedRows,
} from '../frames.js';
import { adjustedCopy, blobToImage } from '../image.js';
import { adToFile, ensureAdFonts, ensureFonts, renderAd, renderPop } from '../render.js';
import { confirmBox, debounce, downloadFile, frameThrottle, h, toast } from '../ui.js';
import { queueAd } from '../sender.js';
import { collectorOf, saveTargets } from '../collect.js';
import { recordError } from '../crash.js';
import { ensureCollector } from './passcode.js';

const FONT_WAIT_MS = 8000;   // 書体を待つのはここまで（電波が弱くて届かなくても、端末の字で枠に入れる）

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

/**
 * ポップの今の中身を画像（Canvas）にする。写真の補正・仕上げは編集画面と同じ。
 * スマホ（特に iPhone）は Canvas に使える量が少なく、使い切ると次の画像が作れない（描いても何も出ない・描く途中で止まる）。
 * 途中で使った写真の Canvas はすぐ手放し、作れなかったときは理由を投げる。
 */
async function popImage(pop, settings) {
  let photo = null;
  const blob = pop.photoId ? await store.getPhoto(pop.photoId) : null;
  if (blob) {
    photo = adjustedCopy(await blobToImage(blob), pop.adjust || {},
      { sepia: !!pop.photoSepia, vintage: !!pop.photoVintage });
  }
  // 書体が届かないまま待ち続けると、後の枠が全部描けなくなる
  await Promise.race([ensureFonts(pop, settings), new Promise(resolve => setTimeout(resolve, FONT_WAIT_MS))]);
  const cv = document.createElement('canvas');
  try {
    renderPop(cv, pop, photo, settings);
    if (!cv.width || !cv.getContext('2d')) throw new Error('canvas unavailable');
  } catch (err) {
    cv.width = cv.height = 0;
    throw new Error(`スマホの画像用の空きが足りないかもしれません（${err.message}）。アプリを閉じて開き直してください`);
  } finally {
    if (photo instanceof HTMLCanvasElement) photo.width = photo.height = 0;   // 補正した写真の Canvas を手放す
  }
  return cv;
}

// かんたん作成の段（画像を選ぶ段と、文字などの設定の段に分ける）
const AD_STEPS = {
  frame: { label: '形', title: 'フレームの形を選ぶ' },
  pops: { label: 'ポップ', title: '入れるポップを選ぶ' },
  text: { label: '文字・飾り', title: '見出し・期間のバッジ・ロゴ' },
  out: { label: '出す', title: '仕上がりを確かめて出す' },
};
const AD_STEP_ORDER = ['frame', 'pops', 'text', 'out'];

function loadImage(src, what) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`${what}（${src}）を読み込めませんでした`));
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
  ad.period = normalizePeriod(ad.period);
  ad.logo = normalizeLogo(ad.logo);
  if (!CUSTOM_COLORS.some(c => c.id === ad.headColor)) ad.headColor = '';
  delete ad.showDate;   // 前の「今日の日付を入れる」（日付はもう入れない）
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
  const failed = new Map();       // popId → 画像を作れなかった理由（次に描くときに作り直す）
  const overlays = new Map();     // frameId → { img } か { error }
  const logo = {};                // 店のロゴ: { img } か { error }（入れるときに一度だけ読む）
  async function loadChosen() {
    const want = new Set(ad.slots.filter(Boolean));
    // 枠から外したポップの画像は手放す（溜めると、スマホでは次の画像を作る空きが無くなる）
    for (const [id, cv] of images) {
      if (!want.has(id)) { cv.width = cv.height = 0; images.delete(id); }
    }
    for (const id of failed.keys()) if (!want.has(id)) failed.delete(id);
    // 1枚作れなくても残りは作る（理由は「出す」の欄に出す）
    for (const id of want) {
      if (images.has(id)) continue;
      try {
        images.set(id, await popImage(popById.get(id), settings));
        failed.delete(id);
      } catch (err) {
        failed.set(id, err.message);
        recordError('ad popImage', err);
      }
    }
    if (ad.logo.on && !logo.img) {
      try {
        logo.img = await loadImage(LOGO.src, '店のロゴ');
        delete logo.error;
      } catch (err) {
        logo.error = `${err.message}（電波を確かめて開き直すか、ロゴを外してください）`;
      }
    }
    const f = frameOf();
    if (f.overlay && !overlays.has(ad.frameId)) {
      try {
        overlays.set(ad.frameId, { img: await loadImage(f.overlay, 'フレームの飾り画像') });
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
      if (failed.has(id)) out.push(`「${popTitle(popById.get(id))}」の画像を作れませんでした: ${failed.get(id)}`);
    }
    if (overlayState().error) out.push(overlayState().error);
    if (ad.logo.on && logo.error) out.push(logo.error);
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
    await Promise.race([
      ensureAdFonts(ad, settings, () => toast('文字の書体を読み込めませんでした（電波を確認してください）。端末の字で表示します')),
      new Promise(resolve => setTimeout(resolve, FONT_WAIT_MS)),
    ]);
    try {
      renderAd(canvas, frameOf(), ad, ad.slots.map(id => images.get(id) || null), settings,
        { overlay: overlayState().img || null, logo: logo.img || null, preview: true });
    } catch (err) {
      recordError('ad preview', err);
      toast(`見本を描けませんでした: ${err.message}（アプリを閉じて開き直してください）`, { error: true });
    }
    updateExportState();   // 描けなくても「出す」の欄は今の選び方に合わせる（前の「あと n 枚」を残さない）
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
    updateExportState();   // 描き終わるのを待たずに「あと n 枚」を合わせる
  };

  // ---- 入力 ----
  const form = h('div', { class: 'form' });
  const titleInput = h('input', {
    value: ad.title, placeholder: '例: 本日のおすすめ', enterkeyhint: 'done',
    oninput: () => { ad.title = titleInput.value; statusEl.textContent = '保存中…'; draw(); save(); },
  });
  // ---- 期間のバッジ（入れたいときだけ）。始まりの日と日数を選ぶと、終わりの日を出してバッジの文字を作る ----
  // 欄は一度だけ作る（日付を選んでいる途中で作り直すと、選びかけが消えるため）
  const periodChanged = () => { statusEl.textContent = '保存中…'; draw(); save(); updateExportState(); showPeriod(); };
  const fromInput = h('input', {
    type: 'date', value: ad.period.from,
    onchange: () => { ad.period.from = fromInput.value; periodChanged(); },
  });
  // 日数は数字で入れる（読めない数は消さずに残し、理由を出す。出力は adProblems が止める）
  const daysInput = h('input', {
    type: 'number', inputmode: 'numeric', min: 1, max: PERIOD_DAYS_MAX, step: 1, class: 'days-input',
    value: String(ad.period.days), 'aria-label': '何日間',
    oninput: () => { ad.period.days = daysInput.value.trim() === '' ? null : Number(daysInput.value); periodChanged(); },
  });
  const colorEl = h('div', { class: 'chips' });
  const periodNote = h('p', { class: 'hint' });
  function showPeriod() {
    colorEl.replaceChildren(...PERIOD_COLORS.map(c => h('button', {
      type: 'button', class: ad.period.color === c.id ? 'chip on' : 'chip',
      style: `background:${c.bg};color:${c.color};border-color:${c.bg}`,
      onclick: () => { ad.period.color = c.id; periodChanged(); },
    }, ad.period.color === c.id ? `✓ ${c.label}` : c.label)));
    const end = periodEnd(ad.period.from, ad.period.days);
    periodNote.classList.toggle('error', !end);
    periodNote.textContent = end
      ? `終わりは ${end.replace(/^\d{4}-0?(\d+)-0?(\d+)$/, '$1/$2')}。バッジ: ${periodText(ad.period.from, ad.period.days)}`
      : !ad.period.from ? '始まりの日を選んでください' : `日数は 1〜${PERIOD_DAYS_MAX} の数字で入れてください`;
  }
  showPeriod();
  const periodBox = h('div', { class: 'period-box', hidden: !ad.period.on },
    h('div', { class: 'field' }, h('span', { class: 'label', text: '始まりの日' }),
      h('div', { class: 'period-row' }, fromInput, h('span', {}, '～'), daysInput, h('span', {}, '日間'))),
    h('div', { class: 'field' }, h('span', { class: 'label', text: 'バッジの色' }), colorEl),
    periodNote);
  const periodCheck = h('input', {
    type: 'checkbox', checked: ad.period.on,
    onchange: ev => {
      // 前に入れた始まりの日がもう過ぎていたら、今日からにする（日数はそのまま）
      if (ev.target.checked && ad.period.from < dayInput(new Date())) {
        ad.period.from = dayInput(new Date());
        fromInput.value = ad.period.from;
      }
      ad.period.on = ev.target.checked;
      periodBox.hidden = !ad.period.on;
      periodChanged();
    },
  });
  // 見出しの色（どのフレームでも替えられる。'' はフレームの色のまま）
  const headColorChips = () => h('div', { class: 'chips' },
    h('button', { type: 'button', class: ad.headColor ? 'chip' : 'chip on', onclick: () => { ad.headColor = ''; changed(); } }, 'フレームの色'),
    CUSTOM_COLORS.map(c => h('button', {
      type: 'button', class: ad.headColor === c.id ? 'chip on' : 'chip',
      style: `background:${c.bg};color:#fff;border-color:${c.bg}`,
      onclick: () => { ad.headColor = c.id; changed(); },
    }, ad.headColor === c.id ? `✓ ${c.label}` : c.label)));

  // ---- 店のロゴ（見出しの帯の左に入れる。見本の上で指で動かせる・ピンチ（パソコンは Ctrl＋ホイール）で大きさを変える）----
  const logoChanged = () => { statusEl.textContent = '保存中…'; draw(); save(); updateExportState(); };
  const logoBack = h('button', {
    type: 'button', class: 'chip', hidden: !ad.logo.on,
    onclick: () => { ad.logo = defaultLogo(); logoChanged(); },
  }, 'ロゴを左上・元の大きさに戻す');
  const logoCheck = h('input', {
    type: 'checkbox', checked: ad.logo.on,
    onchange: ev => { ad.logo.on = ev.target.checked; logoBack.hidden = !ad.logo.on; logoChanged(); },
  });
  // 見本のロゴに触れたときだけ動かす（ほかの所に触れたら、いつも通り画面を送れるように）
  const canvasPoint = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    return { x: (cx - r.left) * canvas.width / r.width, y: (cy - r.top) * canvas.height / r.height };
  };
  const onLogo = (cx, cy) => {
    const at = logo.img && logoRect(ad, frameOf());
    if (!at) return false;
    const p = canvasPoint(cx, cy);
    return p.x >= at.x && p.x <= at.x + at.w && p.y >= at.y && p.y <= at.y + at.h;
  };
  // 1本目の指がロゴに触れたら動かす。そのまま2本目を置いたらピンチで大きさを変える（2本目はロゴの外でもよい）
  let dragging = null;   // { dx, dy }＝触れた所とロゴの真ん中のずれ
  const fingers = new Map();   // ロゴを触っている指 pointerId → { x, y }（画面の座標）
  let pinch = null;            // { dist, size }＝ピンチを始めたときの指の間と大きさ
  /** 動かしていない（帯の左の）ロゴは、今の真ん中に置き直してから大きさを変える（大きさを変えても真ん中が動かないように）。 */
  const pinLogo = () => {
    if (ad.logo.x !== null && ad.logo.x !== undefined) return;
    const at = logoRect(ad, frameOf());
    ad.logo = { ...ad.logo, x: Math.round(at.x + at.w / 2), y: Math.round(at.y + at.h / 2) };
  };
  const fingerDist = () => { const [a, b] = [...fingers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  canvas.addEventListener('touchstart', ev => {
    // 画面が動いたり拡大されたりしないように（ロゴに触れたとき・ロゴを触ったまま2本目を置いたとき）
    if ((ev.touches.length === 1 && onLogo(ev.touches[0].clientX, ev.touches[0].clientY)) || fingers.size) ev.preventDefault();
  }, { passive: false });
  canvas.addEventListener('pointerdown', ev => {
    if (fingers.size === 1 && ev.pointerType === 'touch') {
      fingers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      canvas.setPointerCapture?.(ev.pointerId);
      pinLogo();
      pinch = { dist: fingerDist(), size: logoSizeOf(ad.logo) };
      ev.preventDefault();
      return;
    }
    if (fingers.size || !onLogo(ev.clientX, ev.clientY)) return;
    const at = logoRect(ad, frameOf()), p = canvasPoint(ev.clientX, ev.clientY);
    dragging = { dx: at.x + at.w / 2 - p.x, dy: at.y + at.h / 2 - p.y };
    fingers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    canvas.setPointerCapture?.(ev.pointerId);
    ev.preventDefault();
  });
  canvas.addEventListener('pointermove', ev => {
    if (!fingers.has(ev.pointerId)) {
      if (!fingers.size) canvas.style.cursor = onLogo(ev.clientX, ev.clientY) ? 'grab' : '';
      return;
    }
    fingers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch) {
      if (pinch.dist > 0) ad.logo = resizeLogo({ ...ad.logo, size: pinch.size }, fingerDist() / pinch.dist);
    } else if (dragging) {
      const p = canvasPoint(ev.clientX, ev.clientY);
      ad.logo = { ...ad.logo, on: true, ...placeLogo(frameOf(), p.x + dragging.dx, p.y + dragging.dy, logoSizeOf(ad.logo, frameOf())) };
    }
    statusEl.textContent = '保存中…';
    draw();
  });
  const dragEnd = ev => {
    if (!fingers.delete(ev.pointerId)) return;
    if (pinch) {
      // ピンチの途中で指を1本離したら、残った指では動かさない（離した瞬間にロゴが跳ねないように）
      pinch = null;
      dragging = null;
    }
    if (!fingers.size) {
      dragging = null;
      logoChanged();
    }
  };
  canvas.addEventListener('pointerup', dragEnd);
  canvas.addEventListener('pointercancel', dragEnd);
  // パソコン: ロゴの上で Ctrl＋ホイール（ノートのタッチパッドでは2本指のピンチも同じ合図になる）
  canvas.addEventListener('wheel', ev => {
    if (!ev.ctrlKey || !onLogo(ev.clientX, ev.clientY)) return;
    ev.preventDefault();   // ブラウザの拡大にしない
    pinLogo();
    ad.logo = resizeLogo(ad.logo, Math.exp(-ev.deltaY * 0.002));
    logoChanged();
  }, { passive: false });

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

  // ---- かんたん作成の段（ポップを作るときと同じく1段ずつ。「全部を1画面で」でいつもの画面に切り替えられる）----
  let wizard = true;
  let step = 0;
  const goStep = i => {
    step = Math.max(0, Math.min(AD_STEP_ORDER.length - 1, i));
    rebuild();
    window.scrollTo(0, 0);
  };

  function rebuild() {
    const n = ad.slots.length, filled = ad.slots.filter(Boolean).length;
    const sections = {
      frame: () => [
        frameChips(),
        builder ? builderView()
          : savedNowFor() ? h('div', { class: 'row' },
            h('button', { onclick: () => openBuilder(savedNowFor()) }, `「${savedNowFor().name}」を直す`),
            h('button', { class: 'danger', onclick: () => deleteSaved(savedNowFor()) }, '削除'))
            : null,
      ],
      pops: () => [
        h('p', { class: 'hint' }, 'タップした順に 1, 2, … の枠へ入ります。もう一度タップで外します。はじめの画面と同じポップが並び、今の中身（価格・写真）で入ります。'),
        listed.length ? [
          ...groupGrid('★ レギュラー', groups.regulars),
          ...groupGrid('履歴', groups.recent),
        ] : h('p', { class: 'empty' },
          'まだポップがありません。はじめの画面の「＋ 1枚作る」で作ると、ここに並びます。'),
      ],
      text: () => [
        h('label', { class: 'field' }, h('span', { class: 'label', text: '見出し' }), titleInput,
          chips(AD_TITLES.map(t => [t, t]), v => { ad.title = v; titleInput.value = v; changed(); }, ad.title)),
        h('div', { class: 'field' }, h('span', { class: 'label', text: '見出しの色' }), headColorChips()),
        h('label', { class: 'check' }, periodCheck, '期間のバッジを入れる（例: 10/17(土)～10/19(月) 3日間限り）'),
        periodBox,
        h('label', { class: 'check' }, logoCheck, '店のロゴを入れる（見本のロゴを指で動かせます。2本指で広げると大きく、パソコンは Ctrl＋ホイール）'),
        logoBack,
        h('p', { class: 'hint' }, `下の帯には「${FOOTER_TEXT}」が入ります。`),
      ],
    };
    const titleOf = key => (key === 'pops' ? `${AD_STEPS.pops.title}（${filled}/${n}）` : AD_STEPS[key].title);
    exportEl.hidden = wizard && AD_STEP_ORDER[step] !== 'out';
    if (wizard) {
      const key = AD_STEP_ORDER[step];
      const last = step === AD_STEP_ORDER.length - 1;
      const nextLabel = key === 'pops' && filled < n ? `次へ →（あと ${n - filled} 枚は後で選べます）` : '次へ →';
      form.replaceChildren(
        h('div', { class: 'steps' }, AD_STEP_ORDER.map((k, i) => h('button', {
          type: 'button', class: i === step ? 'step on' : i < step ? 'step done' : 'step',
          onclick: () => goStep(i),
        }, h('b', { text: String(i + 1) }), AD_STEPS[k].label))),
        key === 'out' ? null : h('section', {},
          h('h3', {}, `${step + 1}. ${titleOf(key)}`),
          ...sections[key](),
        ),
        h('div', { class: 'row wizard-nav' },
          step > 0 ? h('button', { onclick: () => goStep(step - 1) }, '← 戻る') : null,
          last ? null : h('button', { class: 'primary', onclick: () => goStep(step + 1) }, nextLabel),
        ),
        h('p', { class: 'center' }, h('button', { class: 'mini', onclick: () => { wizard = false; rebuild(); window.scrollTo(0, 0); } }, '全部を1画面で')),
      );
      return;
    }
    form.replaceChildren(...['frame', 'pops', 'text'].map((key, i) => h('section', {},
      h('h3', {}, `${'①②③'[i]} ${titleOf(key)}`),
      ...sections[key](),
    )));
  }

  // ---- 出す ----
  // 置く場所はチェックで選ぶ（編集画面と同じ。最初から印あり）
  let collectorReady = collectorOf(settings).ready;
  const choice = { shared: collectorReady, phone: true };
  // 合言葉がまだ無い端末は、初めて「みんなで使える場所に保管」に印を付けたときに聞く
  const ensureShared = async () => (collectorReady ||= await ensureCollector('みんなで使える場所に保管する'));
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
  // needs: 印を付けたときに要るものを用意する（みんなで使える場所＝合言葉）。用意できなければ印を外す
  function choiceBox(key, label, { note = '', needs = null } = {}) {
    return h('label', { class: 'check' },
      h('input', {
        type: 'checkbox', checked: choice[key],
        onchange: async ev => {
          choice[key] = ev.target.checked;
          if (ev.target.checked && needs && !await needs()) { ev.target.checked = false; choice[key] = false; }
          updateExportState();
        },
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
      made = await adToFile(frame, ad, ad.slots.map(id => images.get(id)), settings,
        { overlay: overlayState().img || null, logo: logo.img || null });
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

  const exportEl = h('div', { class: 'export' }, h('h3', {}, '出す'), shareBtn,
      h('h3', { class: 'sub' }, '保存する場所'),
      choiceBox('shared', 'みんなで使える場所に保管', collectorReady
        ? { note: '事務所のドライブに集まります。共有したときもここに入ります' }
        : { needs: ensureShared, note: '事務所のドライブに集まります（初めて印を付けたときに合言葉を聞きます）' }),
      choiceBox('phone', 'この端末に保存', { note: 'スマホは写真（ダウンロード）、パソコンはダウンロードのフォルダーに入ります' }),
      problemsEl,
      // 作りかけは画面を離れるときの後始末で保存されるので、そのままはじめの画面へ
      h('div', { class: 'save-row' }, saveBtn, h('button', { class: 'end', onclick: () => app.go('#/') }, '終了')));
  rebuild();
  root.replaceChildren(
    h('div', { class: 'preview' }, canvas, h('div', { class: 'preview-bar' }, statusEl)),
    form,
    exportEl,
  );
  draw();

  const leave = () => save.flush();
  leave.flush = save.flush;
  return leave;
}
