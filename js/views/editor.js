// 編集画面: 上にプレビュー（指で写真の位置・拡大）、下に入力欄。打つたびに自動で保存する。

import * as store from '../store.js';
import {
  DEFAULT_ADJUST, DEFAULT_CROP, exportProblems, formatPrice, isBlankPop, isTaxExcluded, NAME_FONTS, parsePriceInput,
  priceTexts, regularFromPop, shotFromPop, SIZES, taxRateOf, updateRegularFrom,
} from '../model.js';
import { dragCrop, zoomCrop, ZOOM_MAX } from '../layout.js';
import { adjustedCopy, autoAdjustFor, blobToImage, shrinkPhoto } from '../image.js';
import { ensureFonts, photoBoxOf, renderPop, renderToFile, thumbnailOf } from '../render.js';
import { TEMPLATE_ORDER, TEMPLATES } from '../templates.js';
import { debounce, downloadFile, frameThrottle, h, toast } from '../ui.js';
import { queuePop, queueStockPhoto } from '../sender.js';
import { collectorOf, saveTargets } from '../collect.js';
import { openStockPicker } from './stock.js';
import { recordError } from '../crash.js';

// 青果と食品の両方に使う（食品は「1人前」「1本入」など）
const UNITS = ['1袋', '1個', '1パック', '1本', '1玉', '1房', '100g', '1盛', '1人前', '1本入', '1個入'];

function chips(items, onPick, current) {
  return h('div', { class: 'chips' }, items.map(([value, label]) =>
    h('button', { type: 'button', class: value === current ? 'chip on' : 'chip', onclick: () => onPick(value) }, label)));
}

function field(label, input, extra) {
  return h('label', { class: 'field' }, h('span', { class: 'label', text: label }), input, extra);
}

// かんたん作成（ウィザード）の段。レギュラーから作ったポップは、価格・産地を確かめて出すだけの短い流れ
const STEPS = {
  photo: { label: '写真', title: '写真を入れる', hint: '撮った写真は自動で明るく整えます。位置は上の見本を指で動かす・2本指で拡大。' },
  name: { label: '名前', title: '商品名と産地', hint: '産地は食品ならメーカー名。入れなくても作れます。' },
  price: { label: '価格', title: '価格と単位', hint: '税抜で入れると、設定の税率で計算した税込も入ります。' },
  design: { label: 'デザイン', title: 'デザインを選ぶ', hint: '今入れた中身で描いています。押すと上の見本が替わります。' },
  check: { label: '確認', title: '今日の価格・産地を確かめる', hint: 'レギュラーから呼び出したので、前回の内容が入っています。' },
  out: { label: '出す', title: '仕上がりを確かめて出す', hint: '' },
};
const NEW_STEPS = ['photo', 'name', 'price', 'design', 'out'];
const REGULAR_STEPS = ['check', 'out'];

/** wizard: かんたん作成（1段ずつ）で開く。「くわしく直す」でいつもの画面に切り替えられる。 */
export async function showEditor(root, app, popId, { wizard = false } = {}) {
  let pop = await store.getPop(popId);
  if (!pop) { toast('ポップが見つかりませんでした', { error: true }); app.go('#/'); return null; }
  const settings = await store.getSettings();
  app.setTitle(pop.isRegular ? 'レギュラーの元を編集' : 'ポップを作る', { back: true });

  let photoImg = null;      // 元の写真
  let photoShown = null;    // 補正を当てた写真（描画に使う）
  if (pop.photoId) {
    const blob = await store.getPhoto(pop.photoId);
    if (blob) photoImg = await blobToImage(blob);
    else toast('写真が見つかりませんでした（撮り直してください）', { error: true });
  }
  const refreshAdjusted = () => { photoShown = photoImg ? adjustedCopy(photoImg, pop.adjust, { sepia: !!pop.photoSepia, vintage: !!pop.photoVintage }) : null; };
  refreshAdjusted();

  // ---- プレビュー ----
  const canvas = h('canvas', { class: 'preview-canvas' });
  const statusEl = h('span', { class: 'status', text: '' });
  const draw = frameThrottle(async () => {
    await ensureFonts(pop, settings, () => toast('文字の書体を読み込めませんでした（電波を確認してください）。端末の字で表示します'));
    renderPop(canvas, pop, photoShown, settings, { preview: true });
  });

  // ---- 保存（打つたびに少し待って保存。失敗したら必ず知らせる）----
  const save = debounce(async () => {
    pop.updatedAt = new Date().toISOString();
    try {
      if (canvas.width) pop.thumb = thumbnailOf(canvas);
      await store.putPop(pop);
      statusEl.textContent = '保存済み';
      statusEl.classList.remove('error');
    } catch (err) {
      statusEl.textContent = '保存できませんでした';
      statusEl.classList.add('error');
      toast(`保存できませんでした: ${err.message}`, { error: true });
    }
  }, 500);
  const changed = ({ rebuild = false } = {}) => {
    statusEl.textContent = '保存中…';
    draw();
    save();
    if (rebuild) rebuildForm();
    updateExportState();
  };

  // ---- 写真の位置（ドラッグ）・拡大（ピンチ・ホイール）----
  const pointers = new Map();
  let pinchDist = 0;
  const canvasScale = () => canvas.width / canvas.getBoundingClientRect().width;
  canvas.addEventListener('pointerdown', ev => {
    if (!photoImg) { pickPhoto(false); return; }
    canvas.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  canvas.addEventListener('pointermove', ev => {
    const prev = pointers.get(ev.pointerId);
    if (!prev || !photoShown) return;
    const cur = { x: ev.clientX, y: ev.clientY };
    pointers.set(ev.pointerId, cur);
    if (pointers.size === 1) {
      const k = canvasScale();
      const box = photoBoxOf(pop);
      pop.crop = dragCrop(pop.crop, (cur.x - prev.x) * k, (cur.y - prev.y) * k,
        photoShown.width, photoShown.height, box.w, box.h);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) pop.crop = zoomCrop(pop.crop, dist / pinchDist);
      pinchDist = dist;
      zoomInput.value = pop.crop.zoom;
    }
    changed();
  });
  const endPointer = ev => { pointers.delete(ev.pointerId); if (pointers.size < 2) pinchDist = 0; };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', ev => {
    if (!photoImg) return;
    ev.preventDefault();
    pop.crop = zoomCrop(pop.crop, ev.deltaY < 0 ? 1.06 : 1 / 1.06);
    zoomInput.value = pop.crop.zoom;
    changed();
  }, { passive: false });

  // ---- 写真を撮る・選ぶ ----
  const fileCamera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const fileLibrary = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const pickPhoto = camera => (camera ? fileCamera : fileLibrary).click();
  /** 撮った・選んだ・ストックから呼んだ写真を、このポップの写真にする。fromStock＝ストックの写真（整え済みなので自動補正しない）。 */
  const usePhoto = async (file, { fromStock = false } = {}) => {
    statusEl.textContent = '写真を読み込み中…';
    const blob = await shrinkPhoto(file);
    const img = await blobToImage(blob);
    const id = await store.putPhoto(blob);
    photoImg = img;
    pop.photoId = id;
    pop.crop = { ...DEFAULT_CROP };
    pop.adjust = fromStock ? { ...DEFAULT_ADJUST } : autoAdjustFor(img);   // 朝は手間をかけられないので、撮った写真はまず自動で整える
    refreshAdjusted();
    // 新しい写真を指していることを先に保存してから片付ける（逆だと新しい写真が消される）
    await store.putPop(pop);
    await store.removeUnusedPhotos();  // 差し替えた前の写真を片付ける（レギュラーが使っていれば残る）
    changed({ rebuild: true });
    toast(fromStock ? 'ストックの写真にしました' : '写真を自動で明るく整えました（「写真の調整」で変えられます）');
  };
  const onFile = async ev => {
    const file = ev.target.files?.[0];
    ev.target.value = '';  // 同じ写真をもう一度選んでも反応するように
    if (!file) return;
    try {
      await usePhoto(file);
    } catch (err) {
      statusEl.textContent = '';
      toast(`写真を読み込めませんでした: ${err.message}`, { error: true });
    }
  };
  fileCamera.addEventListener('change', onFile);
  fileLibrary.addEventListener('change', onFile);
  // ストックから選ぶ（失敗はストックの画面に出して、選び直せるようにする）
  const pickFromStock = () => openStockPicker({ onPick: blob => usePhoto(blob, { fromStock: true }) });
  // 今の写真（補正前の元の写真）をストックに足す。送れなければ控えて送り直す
  const addToStock = async () => {
    try {
      const ok = await queueStockPhoto(pop.photoId, pop.name);
      toast(ok ? 'ストックへ送ります（届くと、どの端末の「📦 ストックから」にも出ます）'
        : '合言葉がまだ入っていないので送れません（⚙ 設定 →「みんなで使える場所」）', { error: !ok });
    } catch (err) {
      toast(`ストックへ送れませんでした: ${err.message}`, { error: true });
    }
  };

  // ---- 入力欄 ----
  const zoomInput = h('input', {
    type: 'range', min: 1, max: ZOOM_MAX, step: 0.01, value: pop.crop.zoom,
    oninput: () => { pop.crop = { ...pop.crop, zoom: Number(zoomInput.value) }; changed(); },
  });
  const form = h('div', { class: 'form' });
  const exportBox = h('div', { class: 'export' });

  const adjustSlider = (key, label) => {
    let timer = null;
    const input = h('input', {
      type: 'range', min: -100, max: 100, step: 1, value: pop.adjust[key] || 0,
      oninput: () => {
        pop.adjust = { ...pop.adjust, [key]: Number(input.value) };
        clearTimeout(timer);
        // 写真全体の計算は重いので、動かし終わりを少し待ってから
        timer = setTimeout(() => { refreshAdjusted(); changed(); }, 90);
      },
    });
    return field(label, input);
  };

  const priceError = h('span', { class: 'field-error', text: '' });
  const priceNote = h('span', { class: 'field-note', text: '' });
  // 税抜で入れたときは、ポップに入る税込の金額をその場で見せる（税率の設定違いに気付けるように）
  const showPriceNote = () => {
    const t = priceTexts(pop, settings);
    priceNote.textContent = t?.incl ? `税込 ${t.incl}円（税率 ${taxRateOf(settings)}%）` : '';
  };
  const priceInput = h('input', {
    type: 'text', inputmode: 'numeric', placeholder: '例: 298', value: formatPrice(pop.price),
    enterkeyhint: 'next',
    oninput: () => {
      const r = parsePriceInput(priceInput.value);
      priceError.textContent = r.ok ? '' : r.message;   // 読めなくても打った字は消さない
      if (r.ok) { pop.price = r.value; showPriceNote(); changed(); }
    },
  });
  showPriceNote();

  const textInput = (key, placeholder, { multiline = false } = {}) => {
    const el = h(multiline ? 'textarea' : 'input', {
      placeholder, value: pop[key] || '', rows: multiline ? 2 : null, enterkeyhint: 'next',
      oninput: () => { pop[key] = el.value; changed(); },
    });
    if (multiline) el.value = pop[key] || '';
    return el;
  };

  // ---- かんたん作成の段 ----
  const steps = pop.fromRegularId ? REGULAR_STEPS : NEW_STEPS;
  let step = 0;
  const goStep = i => {
    step = Math.max(0, Math.min(steps.length - 1, i));
    rebuildForm();
    window.scrollTo(0, 0);
  };
  const toFullEditor = () => {
    wizard = false;
    rebuildForm();
    window.scrollTo(0, 0);
  };

  /** デザインの候補を、今の中身で描いて並べる（重いので、この段を出したときだけ描く） */
  function designPicker() {
    const grid = h('div', { class: 'design-grid' });
    for (const id of TEMPLATE_ORDER) {
      const cv = h('canvas', { class: 'design-thumb' });
      grid.append(h('button', {
        type: 'button', class: pop.template === id ? 'design-pick on' : 'design-pick',
        onclick: () => { pop.template = id; changed({ rebuild: true }); },
      }, cv, h('span', { text: TEMPLATES[id].label })));
      const p = { ...pop, template: id };
      ensureFonts(p, settings)
        .then(() => renderPop(cv, p, photoShown, settings, { preview: true }))
        .catch(err => recordError('デザインの見本', err));
    }
    return grid;
  }

  function rebuildForm() {
    const nameInput = textInput('name', '例: 完熟トマト');
    const memoInput = textInput('catch', '例: 入荷数・仕入れ先への連絡など', { multiline: true });
    const unitInput = textInput('unit', '例: 1袋');
    const originInput = textInput('origin', '例: 熊本県産／○○食品');
    const setText = (key, input, value) => { pop[key] = value; input.value = value; changed(); };

    const photoButtons = () => h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: () => pickPhoto(true) }, '📷 撮影'),
      h('button', { onclick: () => pickPhoto(false) }, '🖼 写真から選ぶ'),
      h('button', { onclick: pickFromStock }, '📦 ストックから'),
    );
    const priceFields = () => [
      h('div', { class: 'two' },
        // 「各」のチェックは価格の欄の左（label の中に入力を2つ入れると押した先がずれるので、div で組む）
        h('div', { class: 'field' },
          h('span', { class: 'label', text: isTaxExcluded(pop) ? '価格（税抜・円）' : '価格（税込・円）' }),
          h('div', { class: 'price-row' },
            h('label', { class: 'each-box' },
              h('input', { type: 'checkbox', checked: !!pop.each, onchange: ev => { pop.each = ev.target.checked; changed(); } }),
              '各'),
            priceInput,
          ),
          priceError, priceNote,
        ),
        field('単位', unitInput),
      ),
      chips([['excl', '税抜で入れる'], ['incl', '税込で入れる']],
        v => { pop.priceTax = v; showPriceNote(); changed({ rebuild: true }); }, isTaxExcluded(pop) ? 'excl' : 'incl'),
      chips(UNITS.map(u => [u, u]), v => setText('unit', unitInput, v), pop.unit),
    ];
    const sizeChips = () => chips(Object.entries(SIZES).map(([id, s]) => [id, `${s.label}（${s.note}）`]),
      v => { pop.size = v; changed({ rebuild: true }); }, pop.size);

    exportBox.hidden = wizard && steps[step] !== 'out';
    if (wizard) {
      const key = steps[step];
      const info = STEPS[key];
      const body = {
        photo: () => [photoButtons(), photoImg ? h('p', { class: 'hint', text: '写真が入りました。撮り直すときは上のボタンをもう一度。' }) : null],
        name: () => [field('商品名', nameInput), field('産地（食品はメーカー名）', originInput)],
        price: priceFields,
        design: () => [designPicker(), h('div', { class: 'field' }, h('span', { class: 'label', text: '大きさ' }), sizeChips())],
        check: () => [field('産地（食品はメーカー名）', originInput), ...priceFields()],
        out: () => [],
      }[key]();
      const last = step === steps.length - 1;
      const nextLabel = key === 'photo' && !photoImg ? '写真なしで次へ →' : '次へ →';
      form.replaceChildren(
        h('div', { class: 'steps' }, steps.map((k, i) => h('button', {
          type: 'button', class: i === step ? 'step on' : i < step ? 'step done' : 'step',
          onclick: () => goStep(i),
        }, h('b', { text: String(i + 1) }), STEPS[k].label))),
        h('section', {},
          h('h3', {}, `${step + 1}. ${info.title}`),
          info.hint ? h('p', { class: 'hint', text: info.hint }) : null,
          ...body,
        ),
        h('div', { class: 'row wizard-nav' },
          step > 0 ? h('button', { onclick: () => goStep(step - 1) }, '← 戻る') : null,
          last ? null : h('button', { class: 'primary', onclick: () => goStep(step + 1) }, nextLabel),
        ),
        h('p', { class: 'center' }, h('button', { class: 'mini', onclick: toFullEditor }, 'くわしく直す（いつもの画面）')),
      );
      // 名前の段は、商品名を打って Enter（改行）で次へ
      if (key === 'name') nameInput.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.isComposing) goStep(step + 1); });
      return;
    }

    form.replaceChildren(
      h('section', {},
        h('h3', {}, '写真'),
        photoButtons(),
        // お洒落に見せる仕上げ（補正の「自動補正」「補正なし」では外れない）
        photoImg ? h('div', { class: 'row effects' },
          h('label', { class: 'each-box' },
            h('input', { type: 'checkbox', checked: !!pop.photoFade, onchange: ev => { pop.photoFade = ev.target.checked; changed(); } }),
            'まわりをぼかす'),
          h('label', { class: 'each-box' },
            h('input', { type: 'checkbox', checked: !!pop.photoSepia, onchange: ev => { pop.photoSepia = ev.target.checked; refreshAdjusted(); changed(); } }),
            'セピア調'),
          h('label', { class: 'each-box' },
            h('input', { type: 'checkbox', checked: !!pop.photoVintage, onchange: ev => { pop.photoVintage = ev.target.checked; refreshAdjusted(); changed(); } }),
            'フィルム風'),
        ) : null,
        photoImg ? h('details', { class: 'adjust' },
          h('summary', {}, '写真の調整（位置は上の見本を指で動かす・2本指で拡大）'),
          field('拡大', zoomInput),
          adjustSlider('brightness', '明るさ'),
          adjustSlider('contrast', 'くっきり'),
          adjustSlider('saturation', '鮮やかさ'),
          adjustSlider('warmth', '色味（寒色⇔暖色）'),
          h('div', { class: 'row' },
            h('button', { onclick: () => { pop.adjust = autoAdjustFor(photoImg); refreshAdjusted(); changed({ rebuild: true }); } }, '自動補正'),
            h('button', { onclick: () => { pop.adjust = { ...DEFAULT_ADJUST }; refreshAdjusted(); changed({ rebuild: true }); } }, '補正なし'),
            h('button', { onclick: () => { pop.crop = { ...DEFAULT_CROP }; changed({ rebuild: true }); } }, '位置を戻す'),
          ),
        ) : null,
        // 良い写真が撮れたら、どの端末からも呼び出せるように事務所のストックへ（送るのは補正前の元の写真）
        photoImg ? h('div', { class: 'row' }, h('button', { onclick: addToStock }, '📤 この写真をストックに入れる')) : null,
      ),
      h('section', {},
        h('h3', {}, 'デザイン'),
        chips(TEMPLATE_ORDER.map(id => [id, TEMPLATES[id].label]), v => { pop.template = v; changed({ rebuild: true }); }, pop.template),
        sizeChips(),
      ),
      h('section', {},
        h('h3', {}, '文字'),
        // 画像に入るのは 産地（メーカー名）・商品名・価格・単位 だけ。見出しと日付はフレーム（広告）で入れる
        field('産地（食品はメーカー名）', originInput),
        field('商品名', nameInput),
        h('div', { class: 'field' },
          h('span', { class: 'label', text: '商品名の書体' }),
          // 候補はその書体で見せる（書体の定義は ensureFonts が読み込む。読めなければ端末の字）
          h('div', { class: 'chips' }, NAME_FONTS.map(f => h('button', {
            type: 'button', class: (pop.nameFont || '') === f.id ? 'chip on' : 'chip',
            style: f.family ? `font-family: "${f.family}"; font-weight: ${f.weight}` : null,
            onclick: () => { pop.nameFont = f.id; changed({ rebuild: true }); },
          }, f.label))),
        ),
        ...priceFields(),
        field('メモ（画像には入りません）', memoInput),
      ),
    );
  }

  // ---- 出力・レギュラー ----
  // 置く場所はチェックで選ぶ（みんなで使える場所＝事務所のドライブ・このスマホは最初から印あり。開くたびに戻す）
  const collectorReady = collectorOf(settings).ready;
  const choice = { shared: collectorReady, phone: true, regular: false };
  const shareBtn = h('button', { class: 'primary big', onclick: () => doShare() }, '共有する（LINE・Instagram など）');
  const saveBtn = h('button', { class: 'big', onclick: () => doSave() }, '保存する');
  const problemsEl = h('ul', { class: 'problems' });
  const confirmRow = pop.fromRegularId ? h('label', { class: 'check confirm' },
    h('input', { type: 'checkbox', checked: pop.confirmed, onchange: ev => { pop.confirmed = ev.target.checked; changed(); } }),
    '今日の価格・産地を確認しました（レギュラーから呼び出したので前回のままかもしれません）') : null;

  function updateExportState() {
    const problems = exportProblems(pop);
    if (saveTargets(choice, collectorReady).none) problems.push('保存する場所に1つ以上チェックを入れてください');
    problemsEl.replaceChildren(...problems.map(p => h('li', { text: p })));
    shareBtn.disabled = exportProblems(pop).length > 0;
    saveBtn.disabled = problems.length > 0;
  }

  function choiceBox(key, label, { disabled = false, note = '' } = {}) {
    return h('label', { class: 'check' },
      h('input', {
        type: 'checkbox', checked: choice[key], disabled,
        onchange: ev => { choice[key] = ev.target.checked; updateExportState(); },
      }),
      h('span', {}, label, note ? h('small', { class: 'check-note', text: note }) : null));
  }

  /** 出した画像を履歴に残す（バックアップに入る）。失敗しても共有・保存は止めない（知らせるだけ）。 */
  async function keepInHistory(made) {
    try {
      await store.addShot(shotFromPop(pop, made), made.file);
    } catch (err) {
      toast(`画像を履歴に残せませんでした: ${err.message}`, { error: true });
    }
  }

  async function makeImage() {
    try {
      await save.flush();
      return await renderToFile(pop, photoShown, settings);
    } catch (err) {
      toast(`画像を作れませんでした: ${err.message}`, { error: true });
      return null;
    }
  }

  /** みんなで使える場所へ送る控えを作る（送るのは裏で）。控えられたら true。 */
  async function sendShared(made) {
    try {
      return await queuePop(pop, made.file);
    } catch (err) {
      toast(`みんなで使える場所へ送る準備ができませんでした: ${err.message}`, { error: true });
      return false;
    }
  }

  async function doShare() {
    if (exportProblems(pop).length) return;
    const made = await makeImage();
    if (!made) return;
    // 共有画面を開く前に待つと、端末によっては「タップから時間が経った」として共有を断られるので並行して進める
    const side = Promise.all([keepInHistory(made), choice.shared && collectorReady ? sendShared(made) : null]);
    try {
      const { file } = made;
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: pop.name });
        } catch (err) {
          if (err?.name !== 'AbortError') throw err;  // 共有画面で「キャンセル」した＝失敗ではない
        }
      } else {
        downloadFile(file);
        toast('この端末は共有に対応していないため、画像を保存しました');
      }
    } catch (err) {
      toast(`画像を出せませんでした: ${err.message}`, { error: true });
    } finally {
      await side;
    }
  }

  /** チェックした場所へ置く。レギュラーは画像が要らないので先に済ませる。 */
  async function doSave() {
    const t = saveTargets(choice, collectorReady);
    if (exportProblems(pop).length || t.none) return;
    const done = [];
    if (t.regular) {
      const msg = await saveRegular();
      if (!msg) return;
      done.push(msg);
    }
    if (t.shared || t.phone) {
      const made = await makeImage();
      if (!made) return;
      const kept = keepInHistory(made);
      if (t.shared && await sendShared(made)) done.push('みんなで使える場所へ送ります');
      if (t.phone) {
        try {
          downloadFile(made.file);
          done.push('このスマホに保存しました');
        } catch (err) {
          toast(`画像を保存できませんでした: ${err.message}`, { error: true });
          await kept;
          return;
        }
      }
      await kept;
    }
    if (done.length) toast(done.join('・'));
  }

  /** レギュラーへ登録（元が無いとき）か、元のレギュラーを今の内容で更新。できたら知らせる文言、だめなら null。 */
  async function saveRegular() {
    try {
      await save.flush();
      if (pop.fromRegularId) {
        const reg = await store.getPop(pop.fromRegularId);
        if (!reg) { toast('元のレギュラーが見つかりませんでした（削除されたかもしれません）', { error: true }); return null; }
        await store.putPop(updateRegularFrom(reg, pop));
        return 'レギュラーを今の内容で更新しました';
      }
      const reg = regularFromPop(pop);
      await store.putPop(reg);
      pop.fromRegularId = reg.id;
      pop.confirmed = true;   // 今まさに確かめた内容で登録したので
      changed();
      choice.regular = false;
      renderExportBox();      // 次からは「更新」の欄になる
      return 'レギュラーに登録しました（はじめの画面から呼び出せます）';
    } catch (err) {
      toast(`レギュラーに入れられませんでした: ${err.message}`, { error: true });
      return null;
    }
  }

  function renderExportBox() {
    // replaceChildren は null を「null」という文字にしてしまうので除く
    exportBox.replaceChildren(...[
      h('h3', {}, '出す'),
      confirmRow,
      shareBtn,
      h('h3', { class: 'sub' }, '保存する場所'),
      choiceBox('shared', 'みんなで使える場所に保管', collectorReady
        ? { note: '事務所のドライブに集まります。共有したときもここに入ります' }
        : { disabled: true, note: '合言葉がまだ入っていません（⚙ 設定 →「みんなで使える場所」で入れます）' }),
      choiceBox('phone', 'このスマホに保存', { note: '写真（ダウンロード）に入ります' }),
      pop.isRegular
        ? h('p', { class: 'hint' }, 'これはレギュラーの元です。ここで直すと、次に呼び出したときから反映されます。')
        : choiceBox('regular', pop.fromRegularId ? '★ レギュラーを今の内容で更新' : '★ レギュラーに登録',
          { note: pop.fromRegularId ? '呼び出し元のレギュラーを、この内容に書き換えます' : 'はじめの画面から呼び出せるようにします' }),
      problemsEl,
      saveBtn,
    ].filter(Boolean));
    updateExportState();
  }

  rebuildForm();
  renderExportBox();
  root.replaceChildren(
    h('div', { class: 'preview' }, canvas, h('div', { class: 'preview-bar' }, statusEl)),
    form, exportBox, fileCamera, fileLibrary,
  );
  draw();

  // 画面を離れるとき: 書きかけを保存し、何も入れていない新規は片付ける
  const leave = async () => {
    await save.flush();
    if (isBlankPop(pop)) await store.deletePop(pop.id);
  };
  leave.flush = save.flush;
  return leave;
}
