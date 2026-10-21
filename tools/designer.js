// 金額キャッチのデザイン編集画面（PC 用。tools/serve.py で開く）。
// 編集中のデザインをアプリ本体の描画（renderPop → price-design.js）にそのまま渡して見せるので、
// ここで見えるものと、保存後にアプリで出るものは同じになる。
// 操作は図形ソフトと同じ: クリックで部品を選ぶ → ドラッグで移動・四隅の □ で拡大縮小。

import { CATCH_DESIGN } from '../js/catch-design.js';
import { editorApi as api } from '../js/price-design.js';
import { catchDesignProblems, catchFontList } from '../js/catch-check.js';
import { googleFontsUrl } from '../js/layout.js';
import { createPop, priceTexts, SIZES } from '../js/model.js';
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
const LABELS = { burst: '背景（ギザギザ）', num: '数字', yen: '「円」', tax: '税込コメント' };
const DEFAULT_ORDER = ['burst', 'num', 'yen', 'tax'];
const TEXT_KEYS = ['num', 'yen', 'tax'];
const SIZE_RANGE = { num: [30, 320], yen: [10, 160], tax: [8, 80] };

// ---- 編集中のデザインと履歴 ----
/** 重なり順が無い古いデザインにも既定の順を入れる（保存の検査で止まらないように）。 */
function withOrder(d) {
  return Array.isArray(d.order) ? d : { ...d, order: [...DEFAULT_ORDER] };
}
let design = withOrder(structuredClone(CATCH_DESIGN));
let savedJson = JSON.stringify(withOrder(structuredClone(CATCH_DESIGN)));
let committed = JSON.stringify(design);
const undoStack = [], redoStack = [];
let selected = 'num';   // 選んでいる部品（null＝何も選んでいない）

const getP = path => path.split('.').reduce((o, k) => o[k], design);
const setP = (path, v) => {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], design)[last] = v;
};
const round1 = v => Math.round(v * 10) / 10;
const order = () => (api ? api.partOrder(design) : design.order || DEFAULT_ORDER);

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
const measureCtx = document.createElement('canvas').getContext('2d');   // 部品の範囲を測るだけ
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

// ---- 選択の枠と □（ハンドル）----
function geometry(pop) {
  const f = api.catchFrame(photoBoxOf(pop), design);
  return {
    toPx: (x, y) => [f.x + x * f.k, f.y + y * f.k],
    toDesign: (px, py) => [(px - f.x) / f.k, (py - f.y) / f.k],
  };
}
const handleR = () => 9 * overlay.width / Math.max(1, overlay.getBoundingClientRect().width);
const boundsOf = (key, pop = currentPop()) => api.partBounds(measureCtx, key, design, priceTexts(pop, SETTINGS));
/** 囲みの四隅（左上・右上・右下・左下）。向かいの角は (i + 2) % 4。 */
const cornersOf = box => [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]];

function polyPath(g, poly) {
  const p = new Path2D();
  poly.forEach(([x, y], i) => {
    const [px, py] = g.toPx(x, y);
    if (i) p.lineTo(px, py); else p.moveTo(px, py);
  });
  p.closePath();
  return p;
}

function drawHandles(pop) {
  const c = overlay.getContext('2d');
  c.clearRect(0, 0, overlay.width, overlay.height);
  if (!view.handles || !api) return;
  const g = geometry(pop), r = handleR();
  c.save();
  // 選べる部品の輪郭（うすく）
  c.lineWidth = r / 6;
  c.setLineDash([r * 0.6, r * 0.5]);
  c.strokeStyle = 'rgba(0,170,255,0.75)';
  for (const key of order()) if (key !== selected) c.stroke(polyPath(g, boundsOf(key, pop).poly));
  if (selected) {
    const b = boundsOf(selected, pop);
    c.setLineDash([]);
    c.strokeStyle = 'rgba(255,0,200,0.95)';
    c.lineWidth = r / 4;
    c.stroke(polyPath(g, b.poly));
    // 最大幅の目安（これより長い数字・税込は縮める）
    c.setLineDash([r * 0.7, r * 0.5]);
    const t = design[selected];
    const guide = (x0, x1, y) => {
      const [ax, ay] = g.toPx(x0, y), [bx, by] = g.toPx(x1, y);
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
    };
    if (selected === 'num') guide(t.x - t.maxW, t.x, t.y + 8);
    if (selected === 'tax') guide(t.x - t.maxW / 2, t.x + t.maxW / 2, t.y + 6);
    c.setLineDash([]);
    // ギザギザの角
    if (selected === 'burst') {
      for (const [x, y] of design.burst.points) {
        const [px, py] = g.toPx(x, y);
        c.beginPath(); c.arc(px, py, r * 0.7, 0, Math.PI * 2);
        c.fillStyle = '#fff'; c.fill();
        c.strokeStyle = '#0090ff'; c.lineWidth = r / 4; c.stroke();
      }
    } else {
      const [ax, ay] = g.toPx(t.x, t.y);   // 文字の基準点
      c.fillStyle = 'rgba(255,0,200,0.95)';
      c.beginPath(); c.arc(ax, ay, r * 0.35, 0, Math.PI * 2); c.fill();
    }
    // 拡大縮小の □
    for (const [x, y] of cornersOf(b.box)) {
      const [px, py] = g.toPx(x, y);
      c.fillStyle = '#fff';
      c.fillRect(px - r, py - r, r * 2, r * 2);
      c.strokeStyle = 'rgba(255,0,200,0.95)';
      c.lineWidth = r / 4;
      c.strokeRect(px - r, py - r, r * 2, r * 2);
    }
  }
  c.restore();
}

function canvasPoint(ev) {
  const rect = overlay.getBoundingClientRect();
  return [(ev.clientX - rect.left) * overlay.width / rect.width, (ev.clientY - rect.top) * overlay.height / rect.height];
}

/** 指しているもの: 選んだ部品の □ → ギザギザの角（選んでいるとき）→ 手前の部品から順に中身。 */
function hitTest(px, py) {
  const g = geometry(currentPop()), r = handleR();
  if (selected) {
    const b = boundsOf(selected);
    const corners = cornersOf(b.box);
    for (let i = 0; i < 4; i++) {
      const [hx, hy] = g.toPx(...corners[i]);
      if (Math.abs(px - hx) <= r * 1.3 && Math.abs(py - hy) <= r * 1.3) {
        return { type: 'resize', part: selected, anchor: corners[(i + 2) % 4] };
      }
    }
    if (selected === 'burst') {
      const pts = design.burst.points;
      for (let i = 0; i < pts.length; i++) {
        const [hx, hy] = g.toPx(...pts[i]);
        if (Math.hypot(px - hx, py - hy) <= r * 1.2) return { type: 'point', index: i };
      }
    }
  }
  const under = partsAt(px, py, g);
  return under.length ? { type: 'move', part: under[0], under } : null;
}

/** その点に重なっている部品（手前から順）。 */
function partsAt(px, py, g = geometry(currentPop())) {
  const c = overlay.getContext('2d');
  return [...order()].reverse().filter(key => c.isPointInPath(polyPath(g, boundsOf(key).poly), px, py));
}

function select(key) {
  if (selected === key) return;
  selected = key;
  if (key) openSections.add(LABELS[key]);
  buildPanel();
  scheduleDraw();
}

/** 部品を (dx, dy) だけ動かした形を、元の形 o から作る。 */
function moved(key, o, dx, dy) {
  if (key === 'burst') design.burst.points = o.burst.points.map(([x, y]) => [round1(x + dx), round1(y + dy)]);
  else { design[key].x = round1(o[key].x + dx); design[key].y = round1(o[key].y + dy); }
}

/**
 * 拡大縮小。anchor（向かいの角）を動かさずに広げる。
 * 背景は縦横を別々に伸ばせる（Shift で縦横比を保つ）。文字は縦横比を保ったまま、大きさ・縁取り・最大幅を同じ割合で変える。
 */
function resized(key, o, anchor, start, cur, keepRatio) {
  const [ax, ay] = anchor;
  if (key === 'burst') {
    let sx = (cur[0] - ax) / ((start[0] - ax) || 1), sy = (cur[1] - ay) / ((start[1] - ay) || 1);
    if (keepRatio) sx = sy = Math.max(sx, sy);
    sx = Math.max(0.05, sx); sy = Math.max(0.05, sy);
    design.burst.points = o.burst.points.map(([x, y]) => [round1(ax + (x - ax) * sx), round1(ay + (y - ay) * sy)]);
    return;
  }
  const s = Math.max(0.05, Math.hypot(cur[0] - ax, cur[1] - ay) / (Math.hypot(start[0] - ax, start[1] - ay) || 1));
  const t = design[key], ot = o[key];
  t.size = round1(ot.size * s);
  t.strokes = ot.strokes.map(st => ({ ...st, width: round1(st.width * s) }));
  if ('maxW' in ot) t.maxW = round1(ot.maxW * s);
  t.x = round1(ax + (ot.x - ax) * s);
  t.y = round1(ay + (ot.y - ay) * s);
}

let drag = null;
overlay.addEventListener('pointerdown', ev => {
  if (ev.button !== 0 || !view.handles || !api) return;
  const [px, py] = canvasPoint(ev);
  const hit = hitTest(px, py);
  if (!hit) { select(null); return; }
  // 選んでいる部品の上でもう一度押したら、離したときに（動かしていなければ）下の部品へ選択を移す
  const cycle = hit.type === 'move' && hit.under.includes(selected) && hit.under.length > 1
    ? hit.under[(hit.under.indexOf(selected) + 1) % hit.under.length] : null;
  if (hit.type === 'move') hit.part = cycle ? selected : hit.part;   // 押したまま動かせば、選んでいる部品を動かす
  if (hit.type === 'move' && !cycle) select(hit.part);
  const g = geometry(currentPop());
  drag = { hit, g, start: g.toDesign(px, py), orig: structuredClone(design), cycle };
  overlay.setPointerCapture(ev.pointerId);
});
overlay.addEventListener('pointermove', ev => {
  const [px, py] = canvasPoint(ev);
  // ボタンを離した合図を取りこぼしても、押していない状態で動いたらドラッグを終える
  // （終わらないままだと、保存ボタンへ手を動かす間もデザインを動かし続けてしまう）
  if (drag && ev.buttons === 0) { endDrag(); return; }
  if (!drag) {
    if (view.handles && api) {
      const hit = hitTest(px, py);
      overlay.style.cursor = !hit ? 'default' : hit.type === 'resize' ? 'nwse-resize' : hit.type === 'point' ? 'crosshair' : 'move';
    }
    return;
  }
  const cur = drag.g.toDesign(px, py);
  const { hit, orig, start } = drag;
  if (hit.type === 'point') {
    const [x, y] = orig.burst.points[hit.index];
    design.burst.points[hit.index] = [round1(x + cur[0] - start[0]), round1(y + cur[1] - start[1])];
  } else if (hit.type === 'move') {
    moved(hit.part, orig, cur[0] - start[0], cur[1] - start[1]);
  } else {
    resized(hit.part, orig, hit.anchor, start, cur, ev.shiftKey);
  }
  live();
  syncInputs();
});
function endDrag() {
  if (!drag) return;
  const { cycle } = drag;
  const changed = JSON.stringify(design) !== committed;
  drag = null;
  commit();
  syncInputs();
  if (cycle && !changed) select(cycle);   // 動かさずに離した＝下の部品を選ぶクリックだった
}
overlay.addEventListener('pointerup', endDrag);
overlay.addEventListener('pointercancel', endDrag);
overlay.addEventListener('lostpointercapture', endDrag);
window.addEventListener('pointerup', endDrag);
window.addEventListener('blur', endDrag);

// 背景を選んでいるとき: 辺をダブルクリック → そこに角を足す
overlay.addEventListener('dblclick', ev => {
  if (!view.handles || !api || selected !== 'burst') return;
  const [px, py] = canvasPoint(ev);
  const g = geometry(currentPop()), r = handleR();
  const pts = design.burst.points.map(p => g.toPx(...p));
  let best = null;
  pts.forEach(([ax, ay], i) => {
    const [bx, by] = pts[(i + 1) % pts.length];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2));
    const d = Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
    if (d <= r * 1.5 && (!best || d < best.d)) best = { d, i };
  });
  if (!best) return;
  const [x, y] = g.toDesign(px, py);
  design.burst.points.splice(best.i + 1, 0, [round1(x), round1(y)]);
  commit();
});

// 背景を選んでいるとき: 角を右クリック → 消す（3つは残す）
overlay.addEventListener('contextmenu', ev => {
  if (!view.handles || !api || selected !== 'burst') return;
  const hit = hitTest(...canvasPoint(ev));
  if (hit?.type !== 'point') return;
  ev.preventDefault();
  if (design.burst.points.length <= 3) { setStatus('角は3つより減らせません', 'err'); return; }
  design.burst.points.splice(hit.index, 1);
  commit();
});

// ---- 重なり順 ----
/** key を to（'front' 最前面・'back' 最背面・'up' 1つ手前・'down' 1つ奥）へ。 */
function reorder(key, to) {
  const o = [...order()];
  const i = o.indexOf(key);
  o.splice(i, 1);
  const at = { front: o.length, back: 0, up: Math.min(o.length, i + 1), down: Math.max(0, i - 1) }[to];
  o.splice(at, 0, key);
  design.order = o;
  commit();
  buildPanel();
}

function layerSection() {
  const list = el('div', { className: 'layers' });
  const o = order();
  [...o].reverse().forEach((key, idx) => {   // 上に表示するほど手前
    const name = el('button', { className: key === selected ? 'name on' : 'name', textContent: `${idx === 0 ? '最前面: ' : idx === o.length - 1 ? '最背面: ' : ''}${LABELS[key]}` });
    name.addEventListener('click', () => select(key));
    const btn = (text, to, disabled, title) => {
      const b = el('button', { textContent: text, disabled, title });
      b.addEventListener('click', () => reorder(key, to));
      return b;
    };
    list.append(el('div', { className: 'layer' }, name,
      btn('⤒', 'front', idx === 0, '最前面へ'), btn('↑', 'up', idx === 0, '1つ手前へ'),
      btn('↓', 'down', idx === o.length - 1, '1つ奥へ'), btn('⤓', 'back', idx === o.length - 1, '最背面へ')));
  });
  return section('重なり順（上ほど手前）', [list,
    el('p', { className: 'help', textContent: '選んでいる部品は Ctrl+Shift+↑ で最前面、Ctrl+Shift+↓ で最背面へ。' })]);
}

// ---- 右の設定パネル ----
const openSections = new Set(['重なり順（上ほど手前）', '全体', LABELS.num]);
let syncers = [];   // ドラッグ中に数値を追従させる欄

function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children.filter(c => c != null));
  return e;
}

function section(title, rows, { highlight = false } = {}) {
  const d = el('details', { className: highlight ? 'sec selected' : 'sec' });
  d.open = openSections.has(title);
  d.addEventListener('toggle', () => (d.open ? openSections.add(title) : openSections.delete(title)));
  d.append(el('summary', { textContent: title }), el('div', {}, ...rows.filter(Boolean)));
  return d;
}

function numRow(label, path, min, max, step) {
  const range = el('input', { type: 'range', min, max, step });
  const num = el('input', { type: 'number', step });
  const sync = () => { range.value = getP(path); if (document.activeElement !== num) num.value = getP(path); };
  sync();
  const onInput = src => () => {
    const v = Number(src.value);
    if (!Number.isFinite(v) || src.value === '') return;   // 打ちかけ（空・「-」だけ）は反映しない
    setP(path, v);
    (src === range ? num : range).value = v;
    live();
  };
  range.addEventListener('input', onInput(range));
  num.addEventListener('input', onInput(num));
  range.addEventListener('change', commit);
  num.addEventListener('change', () => { sync(); commit(); });
  syncers.push(sync);
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
  const select_ = el('select');
  for (const name of FONT_CHOICES) select_.append(el('option', { value: name, textContent: name }));
  select_.append(el('option', { value: '', textContent: 'その他（名前を入れる）' }));
  const custom = el('input', { type: 'text', placeholder: 'Google Fonts の名前' });
  const weight = el('select');
  for (let w = 100; w <= 900; w += 100) weight.append(el('option', { value: String(w), textContent: String(w) }));
  const state = el('span', { className: 'fontstate' });
  state.dataset.part = part;
  const known = FONT_CHOICES.includes(t().font);
  select_.value = known ? t().font : '';
  custom.hidden = known;
  custom.value = known ? '' : t().font;
  weight.value = String(t().weight);
  const set = () => {
    const family = select_.value || custom.value.trim();
    custom.hidden = !!select_.value;
    if (!family) return;
    t().font = family;
    t().weight = weight.value;
    commit();
  };
  select_.addEventListener('change', set);
  custom.addEventListener('change', set);
  weight.addEventListener('change', set);
  return [
    el('div', { className: 'row two' }, el('span', { textContent: '書体・太さ' }), select_, weight),
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
      color.addEventListener('input', () => { design[part].strokes[i].color = color.value; live(); });
      color.addEventListener('change', commit);
      const onW = src => () => {
        const v = Number(src.value);
        if (!Number.isFinite(v) || v < 0 || src.value === '') return;
        design[part].strokes[i].width = v;
        (src === range ? num : range).value = v;
        live();
      };
      range.addEventListener('input', onW(range));
      num.addEventListener('input', onW(num));
      range.addEventListener('change', commit);
      num.addEventListener('change', commit);
      syncers.push(() => { range.value = design[part].strokes[i]?.width ?? 0; num.value = range.value; });
      const del = el('button', { textContent: '×', title: 'この縁取りを消す' });
      del.addEventListener('click', () => { design[part].strokes.splice(i, 1); commit(); render(); });
      box.append(el('div', { className: 'stroke' }, el('span', { textContent: String(i + 1) }), color, range, num, del));
    });
    if (list.length < 4) {
      const add = el('button', { className: 'add', textContent: '＋ 縁取りを足す（内側に）' });
      add.addEventListener('click', () => { design[part].strokes.push({ color: '#ffffff', width: 6 }); commit(); render(); });
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
    numRow('横の位置', `${part}.x`, -900, 100, 0.5),
    numRow('縦の位置', `${part}.y`, -600, 100, 0.5),
    colorRow('文字の色', `${part}.fill`),
    strokesEditor(part),
  ];
}

function buildPanel() {
  syncers = [];
  const partSection = key => section(LABELS[key], key === 'burst'
    ? [
      colorRow('塗り', 'burst.fill'),
      colorRow('縁の色', 'burst.line'),
      numRow('縁の太さ', 'burst.lineWidth', 0, 40, 0.5),
      el('p', { className: 'help', textContent: '左の見本で背景を選ぶと角が出ます: 角をドラッグ／辺をダブルクリックで角を足す／角を右クリックで消す。四隅の □ で拡大縮小（Shift で縦横比を保つ）。' }),
    ]
    : textRows(key), { highlight: key === selected });
  $('panel').replaceChildren(
    layerSection(),
    section('全体', [
      numRow('大きさ（写真の幅に対する倍率）', 'fit.scale', 0.3, 5, 0.01),
      el('p', { className: 'help', textContent: 'キャッチ全体の大きさ。部品ごとの大きさは、見本で選んで四隅の □ で変えます。' }),
    ]),
    ...['burst', ...TEXT_KEYS].map(partSection),
  );
  refreshFontStates();
}
function syncInputs() { for (const sync of syncers) sync(); }

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
  if (ev.target.matches?.('input, select, textarea')) return;   // 入力欄の中では普段どおり
  const k = ev.key.toLowerCase();
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && k === 's') { ev.preventDefault(); save(); return; }
  if (mod && k === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(); return; }
  if (mod && (k === 'y' || (k === 'z' && ev.shiftKey))) { ev.preventDefault(); redo(); return; }
  if (!selected || !k.startsWith('arrow')) return;
  ev.preventDefault();
  if (mod && ev.shiftKey && (k === 'arrowup' || k === 'arrowdown')) { reorder(selected, k === 'arrowup' ? 'front' : 'back'); return; }
  // 矢印で少しずつ動かす（Shift で10ずつ）
  const step = ev.shiftKey ? 10 : 1;
  const [dx, dy] = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[k];
  moved(selected, structuredClone(design), dx, dy);
  commit();
  syncInputs();
});
window.addEventListener('beforeunload', ev => {
  if (JSON.stringify(design) !== savedJson) { ev.preventDefault(); ev.returnValue = ''; }
});
window.addEventListener('resize', scheduleDraw);   // □ の大きさは画面上の大きさで決めている

// ---- 起動 ----
if (!api) {
  const f = $('fatal');
  f.style.display = 'block';
  f.textContent = '今の js/price-design.js は外部の案（コード）に入れ替わっているため、この画面では部品を選んで動かせません。'
    + '色や大きさの欄は、その案が catch-design.js を使っている場合だけ効きます。';
}
applyToRenderer();
buildChips();
buildPanel();
updateStatus();
await ensureFonts(currentPop(), SETTINGS);   // 商品名などアプリの書体
loadDesignFonts();
draw();
drawGrid();
