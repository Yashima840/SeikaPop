// 金額キャッチのデザイン編集画面（PC 用。tools/serve.py で開く）。
// 編集中のデザインをアプリ本体の描画（renderPop → price-design.js）にそのまま渡して見せるので、
// ここで見えるものと、保存後にアプリで出るものは同じになる。

import { CATCH_DESIGN } from '../js/catch-design.js';
import { catchFrame } from '../js/price-design.js';
import { catchDesignProblems, catchFontList } from '../js/catch-check.js';
import { googleFontsUrl } from '../js/layout.js';
import { createPop, SIZES } from '../js/model.js';
import { ensureFonts, photoBoxOf, renderPop } from '../js/render.js';

const $ = id => document.getElementById(id);
const SETTINGS = { shopName: '青果の見本 本店', taxRate: 8, taxRounding: 'decimal' };
const PRICES = [
  ['298（税抜）', 298, 'excl'], ['98', 98, 'excl'], ['1,980', 1980, 'excl'], ['12,800', 12800, 'excl'],
  ['158（税込で入力）', 158, 'incl'], ['1,234,567', 1234567, 'excl'],
];
// 候補の Google Fonts（日本語の字があるものと、数字向けの欧文書体）。ここに無いものは「その他」で名前を入れる
const FONT_CHOICES = [
  'Anton', 'Oswald', 'Bebas Neue', 'Archivo Black', 'Roboto Condensed', 'Barlow Condensed', 'Teko',
  'Noto Sans JP', 'M PLUS 1p', 'M PLUS Rounded 1c', 'Zen Kaku Gothic New', 'Dela Gothic One', 'Mochiy Pop One',
  'RocknRoll One', 'Reggae One', 'Rampart One', 'Potta One', 'Kosugi Maru', 'Zen Maru Gothic', 'Yusei Magic',
  'Zen Old Mincho', 'Shippori Mincho', 'DotGothic16',
];
const PARTS = [['num', '数字'], ['yen', '「円」'], ['tax', '税込の併記']];
const SIZE_RANGE = { num: [30, 320], yen: [10, 160], tax: [8, 80] };

// ---- 編集中のデザインと履歴 ----
let design = structuredClone(CATCH_DESIGN);
let savedJson = JSON.stringify(design);
let committed = savedJson;
const undoStack = [], redoStack = [];

const getP = path => path.split('.').reduce((o, k) => o[k], design);
const setP = (path, v) => {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], design)[last] = v;
};
const round1 = v => Math.round(v * 10) / 10;

/** アプリの描画が読むデザイン（catch-design.js の中身）を、編集中のもので置き換える。 */
function applyToRenderer() {
  for (const k of Object.keys(CATCH_DESIGN)) delete CATCH_DESIGN[k];
  Object.assign(CATCH_DESIGN, structuredClone(design));
}

/** 動かしている途中（履歴には積まない）。 */
function live() {
  applyToRenderer();
  scheduleDraw();
  updateStatus();
}

/** ひとまとまりの操作が終わった（元に戻す の単位）。 */
function commit() {
  const j = JSON.stringify(design);
  if (j === committed) return;
  undoStack.push(committed);
  if (undoStack.length > 300) undoStack.shift();
  redoStack.length = 0;
  committed = j;
  live();
  scheduleGrid();
  loadDesignFonts();
}

function restore(json) {
  design = JSON.parse(json);
  committed = json;
  live();
  scheduleGrid();
  buildPanel();
  loadDesignFonts();
}
const undo = () => { if (undoStack.length) { redoStack.push(committed); restore(undoStack.pop()); } };
const redo = () => { if (redoStack.length) { undoStack.push(committed); restore(redoStack.pop()); } };

// ---- 書体（Google Fonts を1つずつ読む。名前や太さが無いものは × を出し、保存させない）----
const fonts = new Map();   // "family|weight" → { status: 'loading' | 'ok' | 'err', promise }
function loadFont(f) {
  const key = `${f.family}|${f.weight}`;
  if (!fonts.has(key)) {
    const entry = { status: 'loading' };
    entry.promise = new Promise(resolve => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = googleFontsUrl([f]);
      link.onload = async () => {
        try {
          await document.fonts.load(`${f.weight} 40px "${f.family}"`, '0123456789,.円税込()');
          entry.status = 'ok';
        } catch (err) {
          console.warn(err);
          entry.status = 'err';
        }
        resolve();
      };
      link.onerror = () => { entry.status = 'err'; link.remove(); resolve(); };
      document.head.append(link);
    });
    fonts.set(key, entry);
  }
  return fonts.get(key);
}
function loadDesignFonts() {
  for (const f of catchFontList(design)) {
    const e = loadFont(f);
    if (e.status === 'loading') e.promise.then(() => { live(); scheduleGrid(); refreshFontStates(); });
  }
  refreshFontStates();
}
function fontProblems() {
  return catchFontList(design)
    .filter(f => fonts.get(`${f.family}|${f.weight}`)?.status === 'err')
    .map(f => `書体「${f.family}」の太さ ${f.weight} は Google Fonts にありません（名前か太さを変えてください）`);
}

// ---- 見本のポップ ----
function samplePhoto() {
  const cv = document.createElement('canvas');
  cv.width = 1600; cv.height = 1200;
  const c = cv.getContext('2d');
  c.fillStyle = '#6b4a2b'; c.fillRect(0, 0, 1600, 1200);
  for (let i = 0; i < 14; i++) {
    const x = 200 + (i % 5) * 300, y = 250 + Math.floor(i / 5) * 330;
    const g = c.createRadialGradient(x - 40, y - 50, 20, x, y, 170);
    g.addColorStop(0, '#ffb15e'); g.addColorStop(1, '#e8620c');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, 160, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#2f7d2a'; c.beginPath(); c.ellipse(x, y - 150, 50, 18, 0, 0, Math.PI * 2); c.fill();
  }
  return cv;
}
const SAMPLE = samplePhoto();
const view = { size: 'square', price: 0, photo: null, handles: true };

function popFor(size, priceIndex) {
  const [, price, priceTax] = PRICES[priceIndex];
  return {
    ...createPop(), name: 'にんじん', unit: '1袋', origin: '北海道産他', catch: '甘くてやわらか',
    badge: '本日のおすすめ', template: 'bold', size, price, priceTax, showDate: true,
  };
}
const currentPop = () => popFor(view.size, view.price);

// ---- 描画 ----
const preview = $('preview'), overlay = $('overlay');
let drawQueued = false;
function scheduleDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}
function draw() {
  const pop = currentPop();
  renderPop(preview, pop, view.photo || SAMPLE, SETTINGS);
  if (overlay.width !== preview.width) overlay.width = preview.width;
  if (overlay.height !== preview.height) overlay.height = preview.height;
  drawHandles(pop);
}

let gridTimer = 0;
function scheduleGrid() {
  clearTimeout(gridTimer);
  gridTimer = setTimeout(drawGrid, 400);   // 18枚描くので、動かし終わってから
}
function drawGrid() {
  const grid = $('grid');
  if (!grid.children.length) {
    for (const size of Object.keys(SIZES)) {
      PRICES.forEach(([label], i) => {
        const cv = document.createElement('canvas');
        cv.dataset.size = size;
        cv.dataset.price = i;
        cv.title = 'クリックで上に表示';
        cv.addEventListener('click', () => { view.size = size; view.price = i; buildChips(); scheduleDraw(); });
        const fig = document.createElement('figure');
        fig.append(cv, `${SIZES[size].label} / ${label}`);
        grid.append(fig);
      });
    }
  }
  for (const cv of grid.querySelectorAll('canvas')) {
    renderPop(cv, popFor(cv.dataset.size, Number(cv.dataset.price)), view.photo || SAMPLE, SETTINGS);
  }
}

// ---- 印（ハンドル）----
function geometry(pop) {
  const f = catchFrame(photoBoxOf(pop), design);
  return {
    toPx: (x, y) => [f.x + x * f.k, f.y + y * f.k],
    toDesign: (px, py) => [(px - f.x) / f.k, (py - f.y) / f.k],
  };
}
const handleR = () => 11 * overlay.width / Math.max(1, overlay.getBoundingClientRect().width);

// 文字の印は基準点から少しずらして置く（数字の右端と「円」の左端はほぼ同じ点なので、重なって選べなくなる）
const MARKS = [['num', '数', -1.6, -1.6], ['yen', '円', 1.6, -1.6], ['tax', '税', 0, 1.4]];
function markPositions(g, r) {
  return MARKS.map(([k, mark, ox, oy]) => {
    const [ax, ay] = g.toPx(design[k].x, design[k].y);
    return { k, mark, ax, ay, x: ax + ox * r, y: ay + oy * r };
  });
}

function burstPath(g) {
  const p = new Path2D();
  design.burst.points.forEach(([x, y], i) => {
    const [px, py] = g.toPx(x, y);
    if (i) p.lineTo(px, py); else p.moveTo(px, py);
  });
  p.closePath();
  return p;
}

function drawHandles(pop) {
  const c = overlay.getContext('2d');
  c.clearRect(0, 0, overlay.width, overlay.height);
  if (!view.handles || !catchFrame) return;
  const g = geometry(pop), r = handleR();
  c.save();
  c.lineWidth = r / 5;
  c.setLineDash([r * 0.7, r * 0.5]);
  c.strokeStyle = 'rgba(0,180,255,0.95)';
  c.stroke(burstPath(g));
  const guide = (x0, x1, y) => {
    const [ax, ay] = g.toPx(x0, y), [bx, by] = g.toPx(x1, y);
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
  };
  c.strokeStyle = 'rgba(255,0,200,0.9)';
  guide(design.num.x - design.num.maxW, design.num.x, design.num.y + 6);
  guide(design.tax.x - design.tax.maxW / 2, design.tax.x + design.tax.maxW / 2, design.tax.y + 4);
  c.setLineDash([]);
  for (const [x, y] of design.burst.points) {
    const [px, py] = g.toPx(x, y);
    c.beginPath(); c.arc(px, py, r * 0.75, 0, Math.PI * 2);
    c.fillStyle = '#fff'; c.fill();
    c.strokeStyle = '#0090ff'; c.lineWidth = r / 4; c.stroke();
  }
  c.font = `700 ${r * 1.2}px sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (const m of markPositions(g, r)) {
    c.strokeStyle = 'rgba(255,0,200,0.92)';
    c.lineWidth = r / 6;
    c.beginPath(); c.moveTo(m.ax, m.ay); c.lineTo(m.x, m.y); c.stroke();
    c.fillStyle = 'rgba(255,0,200,0.92)';
    c.beginPath(); c.arc(m.ax, m.ay, r * 0.3, 0, Math.PI * 2); c.fill();   // 本当の基準点
    c.fillRect(m.x - r, m.y - r, r * 2, r * 2);
    c.fillStyle = '#fff';
    c.fillText(m.mark, m.x, m.y + r * 0.05);
  }
  c.restore();
}

function canvasPoint(ev) {
  const rect = overlay.getBoundingClientRect();
  return [(ev.clientX - rect.left) * overlay.width / rect.width, (ev.clientY - rect.top) * overlay.height / rect.height];
}

/** 指している印。文字の印 → 角 → ギザギザの中（Shift のときだけ）の順に探す。 */
function hitTest(px, py, shift = false) {
  const g = geometry(currentPop()), r = handleR();
  for (const m of markPositions(g, r)) {
    if (Math.abs(px - m.x) <= r * 1.1 && Math.abs(py - m.y) <= r * 1.1) return { type: 'text', part: m.k };
  }
  const pts = design.burst.points;
  for (let i = 0; i < pts.length; i++) {
    const [hx, hy] = g.toPx(...pts[i]);
    if (Math.hypot(px - hx, py - hy) <= r * 1.2) return { type: 'point', index: i };
  }
  // 全体を動かすのは Shift を押しているときだけ（印の押し損ねで全体が動く事故を防ぐ）
  if (shift && overlay.getContext('2d').isPointInPath(burstPath(g), px, py)) return { type: 'all' };
  return null;
}

let drag = null;
overlay.addEventListener('pointerdown', ev => {
  if (ev.button !== 0 || !view.handles || !catchFrame) return;
  const [px, py] = canvasPoint(ev);
  const hit = hitTest(px, py, ev.shiftKey);
  if (!hit) return;
  const g = geometry(currentPop());   // 動かしている間は倍率を固定（角を動かすと倍率が変わることがあるため）
  drag = { hit, g, start: g.toDesign(px, py), orig: structuredClone(design) };
  overlay.setPointerCapture(ev.pointerId);
});
overlay.addEventListener('pointermove', ev => {
  const [px, py] = canvasPoint(ev);
  // ボタンを離した合図を取りこぼしても、押していない状態で動いたらドラッグを終える
  // （終わらないままだと、保存ボタンへ手を動かす間もデザインを動かし続けてしまう）
  if (drag && ev.buttons === 0) { endDrag(); return; }
  if (!drag) {
    if (view.handles && catchFrame) overlay.style.cursor = hitTest(px, py, ev.shiftKey) ? 'move' : 'default';
    return;
  }
  const [x, y] = drag.g.toDesign(px, py);
  const dx = x - drag.start[0], dy = y - drag.start[1];
  const o = drag.orig;
  const { hit } = drag;
  if (hit.type === 'point') {
    design.burst.points[hit.index] = [round1(o.burst.points[hit.index][0] + dx), round1(o.burst.points[hit.index][1] + dy)];
  } else if (hit.type === 'text') {
    design[hit.part].x = round1(o[hit.part].x + dx);
    design[hit.part].y = round1(o[hit.part].y + dy);
  } else {
    design.burst.points = o.burst.points.map(([px0, py0]) => [round1(px0 + dx), round1(py0 + dy)]);
    for (const [k] of PARTS) { design[k].x = round1(o[k].x + dx); design[k].y = round1(o[k].y + dy); }
  }
  live();
  refreshPositionInputs();
});
function endDrag() {
  if (!drag) return;
  drag = null;
  commit();
}
overlay.addEventListener('pointerup', endDrag);
overlay.addEventListener('pointercancel', endDrag);
overlay.addEventListener('lostpointercapture', endDrag);
window.addEventListener('pointerup', endDrag);
window.addEventListener('blur', endDrag);

// 辺をダブルクリック → そこに角を足す
overlay.addEventListener('dblclick', ev => {
  if (!view.handles || !catchFrame) return;
  const [px, py] = canvasPoint(ev);
  const g = geometry(currentPop()), r = handleR();
  const pts = design.burst.points.map(p => g.toPx(...p));
  let best = null;
  pts.forEach(([ax, ay], i) => {
    const [bx, by] = pts[(i + 1) % pts.length];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2));
    const d = Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
    if (d <= r * 1.5 && (!best || d < best.d)) best = { d, i, t };
  });
  if (!best) return;
  const [x, y] = g.toDesign(px, py);
  design.burst.points.splice(best.i + 1, 0, [round1(x), round1(y)]);
  commit();
});

// 角を右クリック → 消す（3つは残す）
overlay.addEventListener('contextmenu', ev => {
  if (!view.handles || !catchFrame) return;
  const hit = hitTest(...canvasPoint(ev));
  if (hit?.type !== 'point') return;
  ev.preventDefault();
  if (design.burst.points.length <= 3) { setStatus('角は3つより減らせません', 'err'); return; }
  design.burst.points.splice(hit.index, 1);
  commit();
});

// ---- 右の設定パネル ----
const openSections = new Set(['全体', 'ギザギザ', '数字']);
const positionInputs = [];   // ドラッグ中に数値を追従させる欄

function section(title, rows) {
  const d = document.createElement('details');
  d.className = 'sec';
  d.open = openSections.has(title);
  d.addEventListener('toggle', () => (d.open ? openSections.add(title) : openSections.delete(title)));
  const s = document.createElement('summary');
  s.textContent = title;
  const body = document.createElement('div');
  body.append(...rows.filter(Boolean));
  d.append(s, body);
  return d;
}

function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children.filter(c => c != null));
  return e;
}

function numRow(label, path, min, max, step, { position = false } = {}) {
  const range = el('input', { type: 'range', min, max, step });
  const num = el('input', { type: 'number', step });
  const sync = () => { range.value = getP(path); num.value = getP(path); };
  sync();
  const onInput = src => () => {
    const v = Number(src.value);
    if (!Number.isFinite(v)) return;   // 打ちかけ（空・「-」だけ）は反映しない
    setP(path, v);
    (src === range ? num : range).value = v;
    live();
  };
  range.addEventListener('input', onInput(range));
  num.addEventListener('input', onInput(num));
  range.addEventListener('change', commit);
  num.addEventListener('change', () => { sync(); commit(); });
  if (position) positionInputs.push(sync);
  return el('div', { className: 'row' }, el('span', { textContent: label }), range, num);
}

function colorRow(label, path) {
  const input = el('input', { type: 'color', value: getP(path) });
  input.addEventListener('input', () => { setP(path, input.value); live(); });
  input.addEventListener('change', commit);
  return el('div', { className: 'row' }, el('span', { textContent: label }), input, el('span'));
}

function fontRow(part) {
  const t = () => design[part];
  const select = el('select');
  for (const name of FONT_CHOICES) select.append(el('option', { value: name, textContent: name }));
  select.append(el('option', { value: '', textContent: 'その他（名前を入れる）' }));
  const custom = el('input', { type: 'text', placeholder: 'Google Fonts の名前', hidden: true });
  const weight = el('select');
  for (let w = 100; w <= 900; w += 100) weight.append(el('option', { value: String(w), textContent: String(w) }));
  const state = el('span', { className: 'fontstate' });
  state.dataset.part = part;
  const known = FONT_CHOICES.includes(t().font);
  select.value = known ? t().font : '';
  custom.hidden = known;
  custom.value = known ? '' : t().font;
  weight.value = String(t().weight);
  const set = () => {
    const family = select.value || custom.value.trim();
    custom.hidden = !!select.value;
    if (!family) return;
    t().font = family;
    t().weight = weight.value;
    commit();
  };
  select.addEventListener('change', set);
  custom.addEventListener('change', set);
  weight.addEventListener('change', set);
  return [
    el('div', { className: 'row two' }, el('span', { textContent: '書体・太さ' }), select, weight),
    el('div', { className: 'row two' }, el('span'), custom, state),
  ];
}

function refreshFontStates() {
  for (const s of document.querySelectorAll('.fontstate')) {
    const t = design[s.dataset.part];
    const st = fonts.get(`${t.font}|${t.weight}`)?.status;
    s.textContent = st === 'ok' ? '✓ 読み込み済み' : st === 'err' ? '× この書体・太さはありません' : '読み込み中…';
    s.className = st === 'err' ? 'fontstate err' : 'fontstate';
  }
  updateStatus();
}

function strokesEditor(part) {
  const box = el('div', { className: 'strokes' });
  const render = () => {
    const list = design[part].strokes;
    box.replaceChildren(el('div', { className: 'help', textContent: '縁取り（1 がいちばん外側。外側ほど太くする）' }));
    list.forEach((s, i) => {
      const color = el('input', { type: 'color', value: s.color });
      const range = el('input', { type: 'range', min: 0, max: 80, step: 0.5, value: s.width });
      const num = el('input', { type: 'number', step: 0.5, value: s.width });
      color.addEventListener('input', () => { s.color = color.value; live(); });
      color.addEventListener('change', commit);
      const onW = src => () => {
        const v = Number(src.value);
        if (!Number.isFinite(v) || v < 0) return;
        s.width = v;
        (src === range ? num : range).value = v;
        live();
      };
      range.addEventListener('input', onW(range));
      num.addEventListener('input', onW(num));
      range.addEventListener('change', commit);
      num.addEventListener('change', commit);
      const del = el('button', { textContent: '×', title: 'この縁取りを消す' });
      del.addEventListener('click', () => { list.splice(i, 1); commit(); render(); });
      box.append(el('div', { className: 'stroke' }, el('span', { textContent: String(i + 1) }), color, range, num, del));
    });
    if (list.length < 4) {
      const add = el('button', { className: 'add', textContent: '＋ 縁取りを足す（内側に）' });
      add.addEventListener('click', () => { list.push({ color: '#ffffff', width: 6 }); commit(); render(); });
      box.append(add);
    }
  };
  render();
  return box;
}

function textRows(part) {
  const [lo, hi] = SIZE_RANGE[part];
  return [
    ...fontRow(part),
    numRow('大きさ', `${part}.size`, lo, hi, 0.5),
    'maxW' in design[part] ? numRow(part === 'num' ? '最大幅（超えたら縮小）' : '最大幅', `${part}.maxW`, 20, 900, 1) : null,
    numRow('傾き', `${part}.slant`, -0.5, 0.5, 0.01),
    numRow('横の位置', `${part}.x`, -900, 100, 0.5, { position: true }),
    numRow('縦の位置', `${part}.y`, -600, 100, 0.5, { position: true }),
    colorRow('文字の色', `${part}.fill`),
    strokesEditor(part),
  ];
}

function buildPanel() {
  positionInputs.length = 0;
  $('panel').replaceChildren(
    section('全体', [
      numRow('大きさ（写真の幅に対する倍率）', 'fit.scale', 0.3, 5, 0.01),
      numRow('高さの上限（写真の高さに対する割合）', 'fit.maxH', 0.2, 1, 0.01),
      el('p', { className: 'help', textContent: 'ギザギザの高さが上限を超える写真（低い写真）では、その分だけ全体を縮めます。' }),
    ]),
    section('ギザギザ', [
      colorRow('塗り', 'burst.fill'),
      colorRow('縁の色', 'burst.line'),
      numRow('縁の太さ', 'burst.lineWidth', 0, 40, 0.5),
      el('p', { className: 'help', textContent: '形は左の見本で: 角をドラッグ／辺をダブルクリックで角を足す／角を右クリックで消す。' }),
    ]),
    ...PARTS.map(([k, label]) => section(label, textRows(k))),
  );
  // 位置の欄はドラッグで変わるので、その場で更新する
  refreshFontStates();
}
function refreshPositionInputs() { for (const sync of positionInputs) sync(); }

// ---- 状態・保存 ----
function setStatus(text, kind = '') {
  const s = $('status');
  s.textContent = text;
  s.className = kind;
}
function allProblems() { return [...catchDesignProblems(design), ...fontProblems()]; }
function updateStatus() {
  const problems = allProblems();
  $('problems').replaceChildren(...problems.map(p => el('li', { textContent: p })));
  const dirty = JSON.stringify(design) !== savedJson;
  $('saveBtn').disabled = problems.length > 0 || !dirty;
  $('undoBtn').disabled = !undoStack.length;
  $('redoBtn').disabled = !redoStack.length;
  $('revertBtn').disabled = !dirty;
  if (problems.length) setStatus('直すところがあります（左上の赤字）', 'err');
  else setStatus(dirty ? '保存していない変更があります' : '保存済み', dirty ? 'dirty' : '');
}

async function save() {
  if (allProblems().length) return;
  const json = JSON.stringify(design);
  setStatus('保存中…');
  try {
    const res = await fetch('/api/catch-design', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SeikaPop': 'designer' },
      body: json,
    });
    const r = await res.json().catch(() => ({ message: `サーバーの応答が読めません（${res.status}）` }));
    if (!res.ok || !r.ok) throw new Error(r.message || `サーバーが ${res.status} を返しました`);
    savedJson = json;
    updateStatus();
    setStatus(`保存しました（前の版は ${r.backup}）${r.note ? ` ※${r.note}` : ''}`, r.note ? 'err' : '');
  } catch (err) {
    setStatus(`保存できませんでした: ${err.message}（start.bat で起動したページで開いていますか？）`, 'err');
  }
}

// ---- 操作の配線 ----
function buildChips() {
  const chips = (id, items, current, pick) => {
    const box = $(id);
    box.querySelectorAll('button').forEach(b => b.remove());
    for (const [value, label] of items) {
      const b = el('button', { textContent: label, className: value === current ? 'on' : '' });
      b.addEventListener('click', () => { pick(value); buildChips(); scheduleDraw(); });
      box.append(b);
    }
  };
  chips('sizeChips', Object.entries(SIZES).map(([id, s]) => [id, s.label]), view.size, v => { view.size = v; });
  chips('priceChips', PRICES.map(([label], i) => [i, label]), view.price, v => { view.price = v; });
}

$('saveBtn').addEventListener('click', save);
$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);
$('revertBtn').addEventListener('click', () => {
  undoStack.push(committed);   // 戻した後でも「元に戻す」で今の編集に帰れる
  redoStack.length = 0;
  restore(savedJson);
});
$('showHandles').addEventListener('change', ev => { view.handles = ev.target.checked; scheduleDraw(); });
$('photoSample').addEventListener('click', () => {
  view.photo = null;
  $('photoSample').className = 'on';
  scheduleDraw(); scheduleGrid();
});
$('photoPick').addEventListener('click', () => $('photoFile').click());
$('photoFile').addEventListener('change', async ev => {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  try {
    view.photo = await createImageBitmap(file);
    $('photoSample').className = '';
    scheduleDraw(); scheduleGrid();
  } catch (err) {
    setStatus(`写真を読めませんでした: ${err.message}`, 'err');
  }
});
document.addEventListener('keydown', ev => {
  if (!(ev.ctrlKey || ev.metaKey)) return;
  if (ev.target.matches?.('input[type=text], input[type=number]')) return;   // 入力欄の中では普段どおり
  const k = ev.key.toLowerCase();
  if (k === 's') { ev.preventDefault(); save(); } else if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(); } else if (k === 'y' || (k === 'z' && ev.shiftKey)) { ev.preventDefault(); redo(); }
});
window.addEventListener('beforeunload', ev => {
  if (JSON.stringify(design) !== savedJson) { ev.preventDefault(); ev.returnValue = ''; }
});
window.addEventListener('resize', scheduleDraw);   // 印の大きさは画面上の大きさで決めている

// ---- 起動 ----
if (!catchFrame) {
  const f = $('fatal');
  f.style.display = 'block';
  f.textContent = '今の js/price-design.js は外部の案（コード）に入れ替わっているため、この画面では印を動かせません。'
    + '色や大きさの欄は、その案が catch-design.js を使っている場合だけ効きます。';
}
buildChips();
buildPanel();
updateStatus();
await ensureFonts(currentPop(), SETTINGS);   // 商品名などアプリの書体
loadDesignFonts();
draw();
drawGrid();
