// 描画の位置・大きさを決める計算（Canvas に触らない純粋な関数）。
// 文字の幅は measure(text, size) を外から渡す＝テストでは文字数×大きさで代用できる。

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 写真を枠いっぱいに敷く（cover）ときの、元画像の切り出し範囲。
 * crop.x / crop.y は -1〜1（余りのどちら端に寄せるか）、crop.zoom は 1 以上。
 * 枠の縦横比が変わっても（テンプレート・サイズを切り替えても）同じ crop で破綻しない。
 */
export function coverSource(imgW, imgH, boxW, boxH, crop) {
  const zoom = Math.max(1, Number(crop?.zoom) || 1);
  const scale = Math.max(boxW / imgW, boxH / imgH) * zoom;  // 出力1px あたりの元画像 px の逆数
  const sw = boxW / scale;
  const sh = boxH / scale;
  const cx = clamp(Number(crop?.x) || 0, -1, 1);
  const cy = clamp(Number(crop?.y) || 0, -1, 1);
  return { sx: (imgW - sw) / 2 * (1 + cx), sy: (imgH - sh) / 2 * (1 + cy), sw, sh, scale };
}

/**
 * 画像を枠の中に丸ごと収める（contain）ときの描く位置・大きさ。中央に置く。
 * 広告のフレームではポップの画像を切らない（価格や「税込」が欠けると総額表示にならない）ためにこれを使う。
 */
export function containRect(imgW, imgH, box) {
  // 合わせる側の辺は枠の値そのものを使う（掛け算の端数で枠から 0.00…1px はみ出さないように）
  const wide = box.w / imgW <= box.h / imgH;
  const w = wide ? box.w : imgW * box.h / imgH;
  const h = wide ? imgH * box.w / imgW : box.h;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/** 枠の上で (dx, dy) 出力px だけ指でずらしたときの新しい crop。 */
export function dragCrop(crop, dx, dy, imgW, imgH, boxW, boxH) {
  const { sw, sh, scale } = coverSource(imgW, imgH, boxW, boxH, crop);
  const next = { ...crop };
  const slackX = (imgW - sw) / 2;
  const slackY = (imgH - sh) / 2;
  // 指を右へ動かす＝写真が右へ動く＝切り出し範囲は左へ
  if (slackX > 0.5) next.x = clamp((crop.x || 0) - dx / scale / slackX, -1, 1);
  if (slackY > 0.5) next.y = clamp((crop.y || 0) - dy / scale / slackY, -1, 1);
  return next;
}

/**
 * 金額の台紙の置き場所 { x, y, w, h }（左上と大きさ）。pos（台紙の中心。画像の幅・高さに対する割合）が
 * 無ければ auto（デザインが決めた左上）に置く。どちらでも画像からはみ出さないように寄せる。
 */
export function placeBadge(W, H, w, h, pos, auto) {
  const x = pos ? pos.x * W - w / 2 : auto.x;
  const y = pos ? pos.y * H - h / 2 : auto.y;
  return { x: clamp(x, 0, Math.max(0, W - w)), y: clamp(y, 0, Math.max(0, H - h)), w, h };
}

/** 2つの範囲 {x, y, w, h} が重なるか（辺が触れるだけなら重ならない）。 */
export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** 置き場所 rect の台紙を dx, dy（画像の px）動かした後の pos（中心の割合）。大きさが変わっても同じ辺りに来るように割合で持つ。 */
export function moveBadge(rect, dx, dy, W, H) {
  const r = placeBadge(W, H, rect.w, rect.h, { x: (rect.x + rect.w / 2 + dx) / W, y: (rect.y + rect.h / 2 + dy) / H });
  const round = v => Math.round(v * 10000) / 10000;
  return { x: round((r.x + r.w / 2) / W), y: round((r.y + r.h / 2) / H) };
}

export const ZOOM_MAX = 4;
export function zoomCrop(crop, factor) {
  return { ...crop, zoom: clamp((crop.zoom || 1) * factor, 1, ZOOM_MAX) };
}

/** 幅 maxWidth に収まる文字の大きさ（幅は大きさに比例するので1回測れば決まる）。 */
export function fitFontSize(text, maxWidth, measure, maxSize, minSize) {
  const w = measure(text, maxSize);
  if (w <= maxWidth) return maxSize;
  return Math.max(minSize, Math.floor(maxSize * maxWidth / w));
}

// 行の頭に来てはいけない字（句読点・小書き・閉じ括弧など）。来たら前の行へぶら下げる。
const NO_LINE_START = '、。，．・ー〜」』）】!?！？)…ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ';

function ellipsize(line, maxWidth, measure) {
  let chars = Array.from(line);
  while (chars.length && measure(chars.join('') + '…') > maxWidth) chars = chars.slice(0, -1);
  return chars.join('') + '…';
}

// 区切りの良い所（ここで折り返すと読みやすい）: 開き括弧の前・空白や中黒の後
const OPEN_BRACKETS = '（(「『【';
const BREAK_AFTER = ' 　・/';

/** 行の後ろ半分にある「区切りの良い所」の位置（無ければ -1）。 */
function niceBreak(chars) {
  for (let i = chars.length - 1; i >= Math.ceil(chars.length / 2); i--) {
    if (OPEN_BRACKETS.includes(chars[i])) return i;
    if (BREAK_AFTER.includes(chars[i - 1])) return i;
  }
  return -1;
}

/**
 * 折り返す（日本語向け）。基本は1文字単位で、行の後ろ半分に括弧・空白などの
 * 区切りがあればそこで折る（「シャインマスカッ／ト」のような割れ方を避ける）。
 * 改行はそのまま生かす。入り切らない分は … で止める。
 */
export function wrapText(text, maxWidth, measure, maxLines = Infinity) {
  const src = String(text ?? '');
  if (!src.trim()) return [];
  const lines = [];
  for (const para of src.split(/\r?\n/)) {
    let line = [];
    for (const ch of Array.from(para)) {
      const next = line.join('') + ch;
      if (line.length && measure(next) > maxWidth && !NO_LINE_START.includes(ch)) {
        const cut = OPEN_BRACKETS.includes(ch) || BREAK_AFTER.includes(line[line.length - 1]) ? -1 : niceBreak(line);
        if (cut > 0) {
          lines.push(line.slice(0, cut).join('').trimEnd());
          line = [...line.slice(cut), ch];
        } else {
          lines.push(line.join('').trimEnd());
          line = BREAK_AFTER.includes(ch) && ch !== '・' ? [] : [ch];
        }
      } else {
        line.push(ch);
      }
    }
    lines.push(line.join(''));
  }
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = ellipsize(kept[maxLines - 1], maxWidth, measure);
  return kept;
}

function charKind(ch) {
  if (/[ァ-ヺー]/.test(ch)) return 'kata';
  if (/[ぁ-ゖ]/.test(ch)) return 'hira';
  if (/[一-龯々]/.test(ch)) return 'kanji';
  if (/[A-Za-z0-9Ａ-Ｚａ-ｚ０-９]/.test(ch)) return 'latin';
  return 'other';
}

/** 行の境目が言葉の切れ目らしいか（同じ字種が続く所＝言葉の途中とみなす）。 */
export function splitsAreNice(lines) {
  for (let i = 1; i < lines.length; i++) {
    const a = Array.from(lines[i - 1]).at(-1) || '';
    const b = Array.from(lines[i])[0] || '';
    const ka = charKind(a), kb = charKind(b);
    if (ka !== 'other' && ka === kb) return false;
  }
  return true;
}

/**
 * 見出し・商品名の行割りと大きさを決める。
 * 1行で十分大きく入るなら1行、入らなければ maxLines まで折り返して大きさを保つ。
 */
export function layoutLines(text, maxWidth, measure, { maxSize, minSize, maxLines = 1 }) {
  const t = String(text ?? '').trim();
  if (!t) return { size: maxSize, lines: [] };
  if (!t.includes('\n')) {
    const size = fitFontSize(t, maxWidth, measure, maxSize, minSize);
    const oneLineMin = maxLines > 1 ? Math.max(minSize, maxSize * 0.6) : minSize;
    if (size >= oneLineMin && measure(t, size) <= maxWidth + 0.5) return { size, lines: [t] };
  }
  const step = Math.max(1, Math.round(maxSize * 0.05));
  // まず「言葉の切れ目で折れる」大きさを探す（少し小さくしてでも読みやすさを取る）。
  // 無ければ、行数に収まるいちばん大きい大きさ。
  const niceFloor = Math.max(minSize, maxSize * 0.7);
  for (let size = maxSize; size >= niceFloor; size -= step) {
    const lines = wrapText(t, maxWidth, s => measure(s, size));
    if (lines.length <= maxLines && splitsAreNice(lines)) return { size, lines };
  }
  for (let size = maxSize; size >= minSize; size -= step) {
    const lines = wrapText(t, maxWidth, s => measure(s, size));
    if (lines.length <= maxLines) return { size, lines };
  }
  return { size: minSize, lines: wrapText(t, maxWidth, s => measure(s, minSize), maxLines) };
}

/** 毎回同じ並びになる乱数（段ボールの模様をプレビューと出力で揃えるため）。 */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Google Fonts の読み込み先（[{ family: 'Dela Gothic One', weight: '400' }] → css2 の URL）。 */
export function googleFontsUrl(fonts) {
  const weights = new Map();
  for (const f of fonts) {
    const ws = weights.get(f.family) || new Set();
    ws.add(String(f.weight || '400'));
    weights.set(f.family, ws);
  }
  const families = [...weights].map(([family, ws]) =>
    `family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${[...ws].sort((a, b) => a - b).join(';')}`);
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}
