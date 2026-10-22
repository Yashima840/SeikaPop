// 「金額主役」のデザイン編集画面（PC 用。tools/serve.py で開く）。
// 金額キャッチ（catch-design.js）と、産地・商品名・数量と単位の3行（label-design.js）を編集する。
// 編集中のデザインをアプリ本体の描画（renderPop → price-design.js・labels.js）にそのまま渡して見せるので、
// ここで見えるものと、保存後にアプリで出るものは同じになる。
// 操作は図形ソフトと同じ: クリックで部品を選ぶ → ドラッグで移動・四隅の □ で拡大縮小。

import { CATCH_DESIGN } from '../js/catch-design.js';
import { LABEL_DESIGN } from '../js/label-design.js';
import { editorApi as api } from '../js/price-design.js';
import { catchDesignProblems, catchFontList } from '../js/catch-check.js';
import {
  ALIGNS, canvasMeasure, LABEL_KEYS, LABEL_NAMES, labelBounds, labelDesignProblems, labelFontList, labelFrame, layoutLabels,
} from '../js/labels.js';
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
const LABELS = { burst: '背景（ギザギザ）', num: '数字', yen: '「円」', tax: '税込コメント', ...LABEL_NAMES };
const DEFAULT_ORDER = ['burst', 'num', 'yen', 'tax'];
const TEXT_KEYS = ['num', 'yen', 'tax'];
const SIZE_RANGE = { num: [30, 320], yen: [10, 160], tax: [8, 80], origin: [12, 160], name: [20, 240], unit: [12, 160] };
const isLabel = key => LABEL_KEYS.includes(key);

// ---- 編集中のデザインと履歴 ----
// design＝金額キャッチ（catch-design.js）、labels＝3行（label-design.js）。保存先は別々だが、元に戻す は一緒に扱う
/** 重なり順が無い古いデザインにも既定の順を入れる（保存の検査で止まらないように）。 */
function withOrder(d) {
  return Array.isArray(d.order) ? d : { ...d, order: [...DEFAULT_ORDER] };
}
let design = withOrder(structuredClone(CATCH_DESIGN));
let labels = structuredClone(LABEL_DESIGN);
let savedJson = JSON.stringify(withOrder(structuredClone(CATCH_DESIGN)));
let savedLabelsJson = JSON.stringify(LABEL_DESIGN);
const snapshot = () => JSON.stringify({ design, labels });
let committed = snapshot();
const undoStack = [], redoStack = [];
let selected = 'num';   // 選んでいる部品（null＝何も選んでいない）

/** 部品の設定（金額キャッチの部品は design、3行は labels）。 */
const partData = key => (isLabel(key) ? labels[key] : design[key]);
// 欄が読み書きする場所。'labels.' で始まれば3行、それ以外は金額キャッチ
const baseOf = path => (path.startsWith('labels.') ? { labels } : design);
const getP = path => path.split('.').reduce((o, k) => o[k], baseOf(path));
const setP = (path, v) => {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], baseOf(path))[last] = v;
};
const round1 = v => Math.round(v * 10) / 10;
const order = () => (api ? api.partOrder(design) : design.order || DEFAULT_ORDER);
/** 選べる部品（奥から順）。3行は金額キャッチより手前で選ぶ。 */
const pickOrder = () => [...(api ? order() : []), ...LABEL_KEYS];

/** アプリの描画が読むデザイン（catch-design.js・label-design.js の中身）を、編集中のもので置き換える。 */
function applyToRenderer() {
  for (const k of Object.keys(CATCH_DESIGN)) delete CATCH_DESIGN[k];
  Object.assign(CATCH_DESIGN, structuredClone(design));
  for (const k of Object.keys(LABEL_DESIGN)) delete LABEL_DESIGN[k];
  Object.assign(LABEL_DESIGN, structuredClone(labels));
}

/** 動かしている途中（履歴には積まない）。 */
function live() {
  applyToRenderer();
  scheduleDraw();
  updateStatus();
}

/** ひとまとまりの操作が終わった（元に戻す の単位）。 */
function commit() {
  const j = snapshot();
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
  ({ design, labels } = JSON.parse(json));
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
          // 見本の商品名・産地・単位の字も読む（3行に日本語の書体を選んだとき、端末の字で描かれないように）
          await document.fonts.load(`${f.weight} 40px "${f.family}"`, `0123456789,.円税込()${SAMPLE_TEXT}`);
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
const allFonts = () => [...catchFontList(design), ...labelFontList(labels)];
function loadDesignFonts() {
  for (const f of allFonts()) {
    const e = loadFont(f);
    if (e.status === 'loading') e.promise.then(() => { live(); scheduleGrid(); refreshFontStates(); });
  }
  refreshFontStates();
}
function fontProblems() {
  return [...new Map(allFonts().map(f => [`${f.family}|${f.weight}`, f])).values()]
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
// 3行の崩れを見る見本（短い・長い・産地や単位なし）
const NAMES = [
  ['にんじん', { name: 'にんじん', unit: '1袋', origin: '北海道産他' }],
  ['長い名前', { name: 'シャインマスカット（大粒・種なし）', unit: '1房', origin: '山梨県産' }],
  ['産地・単位なし', { name: 'キャベツ', unit: '', origin: '' }],
];
const SAMPLE_TEXT = NAMES.map(([, n]) => Object.values(n).join('')).join('') + '〈〉【】';
const view = { size: 'square', price: 0, name: 0, photo: null, handles: true };

function popFor(size, priceIndex, nameIndex = view.name) {
  const [, price, priceTax] = PRICES[priceIndex];
  return {
    ...createPop(), ...NAMES[nameIndex][1], catch: '甘くてやわらか',
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
// 金額キャッチは写真の右下、3行は写真の左下が原点（デザインの座標 ⇔ 画像の px）
function geometry(pop, key) {
  const box = photoBoxOf(pop);
  const f = isLabel(key) ? labelFrame(box, SIZES[pop.size].w / 1080) : api.catchFrame(box, design);
  return {
    toPx: (x, y) => [f.x + x * f.k, f.y + y * f.k],
    toDesign: (px, py) => [(px - f.x) / f.k, (py - f.y) / f.k],
  };
}
const handleR = () => 9 * overlay.width / Math.max(1, overlay.getBoundingClientRect().width);
const layoutOf = pop => layoutLabels(pop, canvasMeasure(measureCtx), labels);
/** 部品の範囲（その部品の座標で）。中身が空で描かない行は null。 */
const boundsOf = (key, pop = currentPop()) => (isLabel(key)
  ? labelBounds(layoutOf(pop), key, labels)
  : api.partBounds(measureCtx, key, design, priceTexts(pop, SETTINGS)));
/** 文字の基準点（3行は1行目の位置。商品名に付いていく単位は、付いた先の位置）。 */
const anchorOf = (key, pop) => {
  if (!isLabel(key)) return [design[key].x, design[key].y];
  const line = layoutOf(pop)[key]?.lines[0];
  return line ? [line.x, line.y] : [labels[key].x, labels[key].y];
};
/** 囲みの四隅（左上・右上・右下・左下）。向かいの角は (i + 2) % 4。 */
const cornersOf = box => [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]];
/** 元に戻す・ドラッグの起点に使う、今の形の写し。 */
const origState = () => ({ ...structuredClone(design), labels: structuredClone(labels) });

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
  if (!view.handles) return;
  const r = handleR();
  c.save();
  // 選べる部品の輪郭（うすく）
  c.lineWidth = r / 6;
  c.setLineDash([r * 0.6, r * 0.5]);
  c.strokeStyle = 'rgba(0,170,255,0.75)';
  for (const key of pickOrder()) {
    const b = key !== selected && boundsOf(key, pop);
    if (b) c.stroke(polyPath(geometry(pop, key), b.poly));
  }
  const b = selected && boundsOf(selected, pop);
  if (b) {
    const g = geometry(pop, selected);
    c.setLineDash([]);
    c.strokeStyle = 'rgba(255,0,200,0.95)';
    c.lineWidth = r / 4;
    c.stroke(polyPath(g, b.poly));
    // 最大幅の目安（これより長い数字・税込は縮める。3行は折り返す・縮める）
    c.setLineDash([r * 0.7, r * 0.5]);
    const t = partData(selected);
    const [axd, ayd] = anchorOf(selected, pop);
    const guide = (x0, x1, y) => {
      const [ax, ay] = g.toPx(x0, y), [bx, by] = g.toPx(x1, y);
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
    };
    if (selected === 'num') guide(t.x - t.maxW, t.x, t.y + 8);
    if (selected === 'tax') guide(t.x - t.maxW / 2, t.x + t.maxW / 2, t.y + 6);
    if (isLabel(selected)) {
      const x0 = { left: axd, center: axd - t.maxW / 2, right: axd - t.maxW }[t.align];
      guide(x0, x0 + t.maxW, ayd + 8);
    }
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
      const [ax, ay] = g.toPx(axd, ayd);   // 文字の基準点
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
  const pop = currentPop(), r = handleR();
  const b = selected && boundsOf(selected, pop);
  if (b) {
    const g = geometry(pop, selected);
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
  const under = partsAt(px, py, pop);
  return under.length ? { type: 'move', part: under[0], under } : null;
}

/** その点に重なっている部品（手前から順）。 */
function partsAt(px, py, pop = currentPop()) {
  const c = overlay.getContext('2d');
  return [...pickOrder()].reverse().filter(key => {
    const b = boundsOf(key, pop);
    return b && c.isPointInPath(polyPath(geometry(pop, key), b.poly), px, py);
  });
}

function select(key) {
  if (selected === key) return;
  selected = key;
  if (key) openSections.add(LABELS[key]);
  buildPanel();
  scheduleDraw();
}

/** 部品を (dx, dy) だけ動かした形を、元の形 o（origState）から作る。 */
function moved(key, o, dx, dy) {
  if (key === 'burst') design.burst.points = o.burst.points.map(([x, y]) => [round1(x + dx), round1(y + dy)]);
  else if (isLabel(key)) { labels[key].x = round1(o.labels[key].x + dx); labels[key].y = round1(o.labels[key].y + dy); }
  else { design[key].x = round1(o[key].x + dx); design[key].y = round1(o[key].y + dy); }
}

/**
 * 拡大縮小。anchor（向かいの角）を動かさずに広げる。
 * 背景は縦横を別々に伸ばせる（Shift で縦横比を保つ）。文字は縦横比を保ったまま、大きさ・縁取り・最大幅を同じ割合で変える。
 * 3行は文字の基準点（揃えの位置）を動かさずに大きさを変える（ドラッグで決めた置き場所がずれないように）。
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
  const t = partData(key), ot = isLabel(key) ? o.labels[key] : o[key];
  t.size = round1(ot.size * s);
  t.strokes = ot.strokes.map(st => ({ ...st, width: round1(st.width * s) }));
  if ('maxW' in ot) t.maxW = round1(ot.maxW * s);
  if (isLabel(key)) {
    t.minSize = Math.min(t.size, round1(ot.minSize * s));
    if (ot.bg) t.bg = { ...ot.bg, padX: round1(ot.bg.padX * s), padY: round1(ot.bg.padY * s), radius: round1(ot.bg.radius * s) };
    return;
  }
  t.x = round1(ax + (ot.x - ax) * s);
  t.y = round1(ay + (ot.y - ay) * s);
}

let drag = null;
overlay.addEventListener('pointerdown', ev => {
  if (ev.button !== 0 || !view.handles) return;
  const [px, py] = canvasPoint(ev);
  const hit = hitTest(px, py);
  if (!hit) { select(null); return; }
  // 選んでいる部品の上でもう一度押したら、離したときに（動かしていなければ）下の部品へ選択を移す
  const cycle = hit.type === 'move' && hit.under.includes(selected) && hit.under.length > 1
    ? hit.under[(hit.under.indexOf(selected) + 1) % hit.under.length] : null;
  if (hit.type === 'move') hit.part = cycle ? selected : hit.part;   // 押したまま動かせば、選んでいる部品を動かす
  if (hit.type === 'move' && !cycle) select(hit.part);
  // 座標は、動かす部品の原点で測る（金額キャッチは写真の右下、3行は左下）
  const g = geometry(currentPop(), hit.type === 'point' ? 'burst' : hit.part);
  drag = { hit, g, start: g.toDesign(px, py), orig: origState(), cycle };
  overlay.setPointerCapture(ev.pointerId);
});
overlay.addEventListener('pointermove', ev => {
  const [px, py] = canvasPoint(ev);
  // ボタンを離した合図を取りこぼしても、押していない状態で動いたらドラッグを終える
  // （終わらないままだと、保存ボタンへ手を動かす間もデザインを動かし続けてしまう）
  if (drag && ev.buttons === 0) { endDrag(); return; }
  if (!drag) {
    if (view.handles) {
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
  const changed = snapshot() !== committed;
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
  const g = geometry(currentPop(), 'burst'), r = handleR();
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
  const t = () => partData(part);
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
    const t = partData(s.dataset.part);
    const st = fonts.get(`${t.font}|${t.weight}`)?.status;
    s.textContent = st === 'ok' ? '✓ 読み込み済み' : st === 'err' ? '× この書体・太さはありません' : '読み込み中…';
    s.className = st === 'err' ? 'fontstate err' : 'fontstate';
  }
  updateStatus();
}

function strokesEditor(part) {
  const box = el('div', { className: 'strokes' });
  const render = () => {
    const list = partData(part).strokes;
    box.replaceChildren(el('div', { className: 'help', textContent: '縁取り（1 がいちばん外側。外側ほど太くする）' }));
    list.forEach((s, i) => {
      const color = el('input', { type: 'color', value: s.color });
      const range = el('input', { type: 'range', min: 0, max: 80, step: 0.5, value: s.width });
      const num = el('input', { type: 'number', step: 0.5, value: s.width });
      color.addEventListener('input', () => { partData(part).strokes[i].color = color.value; live(); });
      color.addEventListener('change', commit);
      const onW = src => () => {
        const v = Number(src.value);
        if (!Number.isFinite(v) || v < 0 || src.value === '') return;
        partData(part).strokes[i].width = v;
        (src === range ? num : range).value = v;
        live();
      };
      range.addEventListener('input', onW(range));
      num.addEventListener('input', onW(num));
      range.addEventListener('change', commit);
      num.addEventListener('change', commit);
      // 数の欄はつまみの刻み（0.5）で丸めずに、本当の値を出す
      syncers.push(() => { const w = partData(part).strokes[i]?.width ?? 0; range.value = w; num.value = w; });
      const del = el('button', { textContent: '×', title: 'この縁取りを消す' });
      del.addEventListener('click', () => { partData(part).strokes.splice(i, 1); commit(); render(); });
      box.append(el('div', { className: 'stroke' }, el('span', { textContent: String(i + 1) }), color, range, num, del));
    });
    if (list.length < 4) {
      const add = el('button', { className: 'add', textContent: '＋ 縁取りを足す（内側に）' });
      add.addEventListener('click', () => { partData(part).strokes.push({ color: '#ffffff', width: 6 }); commit(); render(); });
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

/** 選ぶだけの欄（揃え方など）。 */
function choiceRow(label, path, choices) {
  const box = el('div', { className: 'chips' });
  const render = () => box.replaceChildren(...Object.entries(choices).map(([value, text]) => {
    const b = el('button', { textContent: text, className: getP(path) === value ? 'on' : '' });
    b.addEventListener('click', () => { setP(path, value); commit(); render(); });
    return b;
  }));
  render();
  return el('div', { className: 'row two' }, el('span', { textContent: label }), box);
}

function checkRow(label, checked, onChange) {
  const input = el('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { className: 'row two' }, el('span'), el('span', {}, input, ` ${label}`));
}

function textInputRow(label, path, placeholder) {
  const input = el('input', { type: 'text', value: getP(path), placeholder, maxLength: 4 });
  input.addEventListener('input', () => { setP(path, input.value); live(); });
  input.addEventListener('change', commit);
  return el('div', { className: 'row' }, el('span', { textContent: label }), input, el('span'));
}

/** 産地・商品名・数量と単位 の1行ぶんの欄。 */
function labelRows(part) {
  const p = `labels.${part}`, t = labels[part];
  const [lo, hi] = SIZE_RANGE[part];
  const bg = t.bg;
  return [
    ...fontRow(part),
    numRow('大きさ', `${p}.size`, lo, hi, 0.5),
    numRow('縮める下限', `${p}.minSize`, 8, hi, 0.5),
    numRow('最大幅（超えたら折り返し・縮小）', `${p}.maxW`, 40, 1100, 1),
    numRow('行数（最大）', `${p}.maxLines`, 1, 3, 1),
    choiceRow('揃え方', `${p}.align`, ALIGNS),
    numRow('傾き', `${p}.slant`, -0.5, 0.5, 0.01),
    part === 'unit' ? checkRow('商品名の後ろに付いていく（位置は名前の終わりからのずれ）', t.follow, on => {
      // 付け外しで見た目の位置が飛ばないよう、今の位置を新しい基準で表し直す
      const before = anchorOf('unit', currentPop());
      labels.unit.follow = on;
      labels.unit.x = 0; labels.unit.y = 0;
      const base = anchorOf('unit', currentPop());
      labels.unit.x = round1(before[0] - base[0]);
      labels.unit.y = round1(before[1] - base[1]);
      commit(); buildPanel();
    }) : null,
    numRow(part === 'unit' && t.follow ? '横のずれ' : '横の位置', `${p}.x`, -400, 1100, 0.5),
    numRow(part === 'unit' && t.follow ? '縦のずれ' : '縦の位置', `${p}.y`, -1300, 500, 0.5),
    colorRow('文字の色', `${p}.fill`),
    strokesEditor(part),
    checkRow('背景の帯を付ける', !!bg, on => {
      labels[part].bg = on ? { fill: '#2e7d32', padX: 20, padY: 10, radius: 24 } : null;
      commit(); buildPanel();
    }),
    bg ? colorRow('帯の色', `${p}.bg.fill`) : null,
    bg ? numRow('帯の横の余白', `${p}.bg.padX`, 0, 80, 0.5) : null,
    bg ? numRow('帯の縦の余白', `${p}.bg.padY`, 0, 60, 0.5) : null,
    bg ? numRow('帯の角の丸み', `${p}.bg.radius`, 0, 80, 0.5) : null,
    textInputRow('前に付ける字', `${p}.prefix`, '例: 〈'),
    textInputRow('後ろに付ける字', `${p}.suffix`, '例: 〉'),
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
    ...LABEL_KEYS.map(key => section(LABELS[key], labelRows(key), { highlight: key === selected })),
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
function allProblems() { return [...catchDesignProblems(design), ...labelDesignProblems(labels), ...fontProblems()]; }
const catchDirty = () => JSON.stringify(design) !== savedJson;
const labelsDirty = () => JSON.stringify(labels) !== savedLabelsJson;
function updateStatus() {
  const problems = allProblems();
  $('problems').replaceChildren(...problems.map(p => el('li', { textContent: p })));
  const dirty = catchDirty() || labelsDirty();
  $('saveBtn').disabled = problems.length > 0 || !dirty;
  $('undoBtn').disabled = !undoStack.length;
  $('redoBtn').disabled = !redoStack.length;
  $('revertBtn').disabled = !dirty;
  if (problems.length) setStatus('直すところがあります（左上の赤字）', 'err');
  else setStatus(dirty ? '保存していない変更があります' : '保存済み', dirty ? 'dirty' : '');
}

async function post(path, json) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-SeikaPop': 'designer' },
    body: json,
  });
  const r = await res.json().catch(() => ({ message: `サーバーの応答が読めません（${res.status}）` }));
  if (!res.ok || !r.ok) throw new Error(r.message || `サーバーが ${res.status} を返しました`);
  return r;
}

/** 変わった方だけ保存する（金額キャッチ → js/catch-design.js、3行 → js/label-design.js）。 */
async function save() {
  if (allProblems().length) return;
  setStatus('保存中…');
  const done = [], notes = [];
  try {
    if (catchDirty()) {
      const json = JSON.stringify(design);
      const r = await post('/api/catch-design', json);
      savedJson = json;
      done.push(`金額キャッチ（前の版は ${r.backup}）`);
      if (r.note) notes.push(r.note);
    }
    if (labelsDirty()) {
      const json = JSON.stringify(labels);
      const r = await post('/api/label-design', json);
      savedLabelsJson = json;
      done.push(`産地・商品名・単位（前の版は ${r.backup}）`);
    }
    updateStatus();
    setStatus(`保存しました: ${done.join('・')}${notes.length ? ` ※${notes.join(' ')}` : ''}`, notes.length ? 'err' : '');
  } catch (err) {
    updateStatus();
    const part = done.length ? `${done.join('・')}は保存しましたが、残りを` : '';
    setStatus(`${part}保存できませんでした: ${err.message}（start.bat で起動したページで開いていますか？）`, 'err');
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
  chips('nameChips', NAMES.map(([label], i) => [i, label]), view.name, v => { view.name = v; scheduleGrid(); });
}

$('saveBtn').addEventListener('click', save);
$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);
$('revertBtn').addEventListener('click', () => {
  undoStack.push(committed);   // 戻した後でも「元に戻す」で今の編集に帰れる
  redoStack.length = 0;
  restore(JSON.stringify({ design: JSON.parse(savedJson), labels: JSON.parse(savedLabelsJson) }));
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
  if (mod && ev.shiftKey && (k === 'arrowup' || k === 'arrowdown')) {
    if (!isLabel(selected)) reorder(selected, k === 'arrowup' ? 'front' : 'back');   // 重なり順は金額キャッチの部品だけ
    return;
  }
  // 矢印で少しずつ動かす（Shift で10ずつ）
  const step = ev.shiftKey ? 10 : 1;
  const [dx, dy] = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[k];
  moved(selected, origState(), dx, dy);
  commit();
  syncInputs();
});
window.addEventListener('beforeunload', ev => {
  if (catchDirty() || labelsDirty()) { ev.preventDefault(); ev.returnValue = ''; }
});
window.addEventListener('resize', scheduleDraw);   // □ の大きさは画面上の大きさで決めている

// ---- 起動 ----
if (!api) {
  const f = $('fatal');
  f.style.display = 'block';
  f.textContent = '今の js/price-design.js は外部の案（コード）に入れ替わっているため、この画面では金額キャッチの部品を選んで動かせません'
    + '（色や大きさの欄は、その案が catch-design.js を使っている場合だけ効きます）。産地・商品名・数量と単位はいつもどおり動かせます。';
}
applyToRenderer();
buildChips();
buildPanel();
updateStatus();
await ensureFonts(currentPop(), SETTINGS);   // 商品名などアプリの書体
loadDesignFonts();
draw();
drawGrid();
