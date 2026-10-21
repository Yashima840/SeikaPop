// 試作キットと js/price-design.js のあいだで「書き換える範囲」をやり取りする（ファイルに触らない純粋な関数）。

export const MARK_START = '// ===== ここから: デザイン担当が書き換える範囲 =====';
export const MARK_END = '// ===== ここまで: デザイン担当が書き換える範囲 =====';
export const PLACEHOLDER = '/*__PRICE_DESIGN__*/';
export const DESIGN_PLACEHOLDER = '/*__CATCH_DESIGN__*/';

/** 印に挟まれた範囲（印を含む）を取り出す。印が無い・2組あるときは理由つきで止める。 */
export function extractRegion(text) {
  const src = String(text).replace(/\r\n/g, '\n');
  const a = src.indexOf(MARK_START), b = src.indexOf(MARK_END);
  if (a < 0 || b < 0) throw new Error('「ここから〜ここまで」の印が見つかりません（印の行を消さずに返してもらってください）');
  if (src.indexOf(MARK_START, a + 1) >= 0 || src.indexOf(MARK_END, b + 1) >= 0) throw new Error('印が2組以上あります');
  if (b < a) throw new Error('「ここまで」が「ここから」より前にあります');
  const region = src.slice(a, b + MARK_END.length);
  for (const name of ['PRICE_FONTS', 'drawPrice']) {
    if (!new RegExp(`(const|let|var|function)\\s+${name}\\b`).test(region)) throw new Error(`範囲の中に ${name} の定義がありません`);
  }
  return region;
}

/** 既存のファイル（price-design.js や試作キット）の範囲だけを差し替えた文字を返す。 */
export function replaceRegion(text, region) {
  const src = String(text).replace(/\r\n/g, '\n');
  const old = extractRegion(src);
  return src.replace(old, () => region);
}

/** 試作キットの雛形へ、デザインのデータ（catch-design.js の中身）と範囲を埋め込む。 */
export function kitFromTemplate(template, region, design) {
  for (const p of [PLACEHOLDER, DESIGN_PLACEHOLDER]) if (!template.includes(p)) throw new Error(`雛形に ${p} がありません`);
  return template
    .replace(DESIGN_PLACEHOLDER, () => `const CATCH_DESIGN = ${JSON.stringify(design, null, 2)};`)
    .replace(PLACEHOLDER, () => region);
}

/** 試作キットに埋め込まれたデザインのデータを読み出す（キットが古くなっていないかの確かめ用）。 */
export function designInKit(kitText) {
  const m = /const CATCH_DESIGN = (\{[\s\S]*?\n\});/.exec(String(kitText).replace(/\r\n/g, '\n'));
  if (!m) throw new Error('試作キットにデザインのデータがありません');
  return JSON.parse(m[1]);
}
