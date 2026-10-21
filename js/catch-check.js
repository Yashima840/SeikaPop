// 金額キャッチのデザイン（catch-design.js の形）を確かめる。画面・Canvas に触らない純粋な関数。
// 編集画面は保存の前にこれを通し、問題があれば保存させない。

const COLOR = /^#[0-9a-f]{6}$/i;
const PARTS = { num: '数字', yen: '「円」', tax: '税込の併記' };

const finite = v => typeof v === 'number' && Number.isFinite(v);

function textProblems(t, label, out) {
  if (!t || typeof t !== 'object') { out.push(`${label}の設定がありません`); return; }
  if (typeof t.font !== 'string' || !t.font.trim()) out.push(`${label}の書体の名前が空です`);
  if (!/^[1-9]00$/.test(String(t.weight))) out.push(`${label}の太さは 100〜900 の100刻みにしてください`);
  for (const k of ['x', 'y', 'size', 'slant']) if (!finite(t[k])) out.push(`${label}の ${k} が数ではありません`);
  if (finite(t.size) && t.size <= 0) out.push(`${label}の大きさが 0 以下です`);
  if (finite(t.slant) && Math.abs(t.slant) > 0.6) out.push(`${label}の傾きが大きすぎます（-0.6〜0.6）`);
  if ('maxW' in t && !(finite(t.maxW) && t.maxW > 0)) out.push(`${label}の最大幅が正しくありません`);
  if (!COLOR.test(t.fill)) out.push(`${label}の色が #rrggbb の形ではありません`);
  if (!Array.isArray(t.strokes) || t.strokes.length > 4) { out.push(`${label}の縁取りは 0〜4 本にしてください`); return; }
  t.strokes.forEach((s, i) => {
    if (!COLOR.test(s?.color)) out.push(`${label}の縁取り ${i + 1} の色が #rrggbb の形ではありません`);
    if (!(finite(s?.width) && s.width >= 0)) out.push(`${label}の縁取り ${i + 1} の太さが正しくありません`);
  });
}

/** 保存してはいけない理由の一覧（空なら保存してよい）。 */
export function catchDesignProblems(d) {
  const out = [];
  if (!d || typeof d !== 'object') return ['デザインの形が壊れています'];
  if (d.version !== 1) out.push('version が 1 ではありません');
  if (!(finite(d.fit?.scale) && d.fit.scale > 0 && d.fit.scale <= 10)) out.push('キャッチの大きさ（fit.scale）は 0 より大きく 10 以下にしてください');
  if (!(finite(d.fit?.maxH) && d.fit.maxH > 0 && d.fit.maxH <= 1)) out.push('高さの上限（fit.maxH）は 0 より大きく 1 以下にしてください');
  const b = d.burst;
  const pts = Array.isArray(b?.points) ? b.points : [];
  if (pts.length < 3) out.push('ギザギザの点は 3 つ以上必要です');
  else if (!pts.every(p => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]))) out.push('ギザギザの点の座標が壊れています');
  else if (!(Math.min(...pts.map(p => p[0])) < 0 && Math.min(...pts.map(p => p[1])) < 0)) {
    out.push('ギザギザが写真の内側（左上）にありません');
  }
  if (!COLOR.test(b?.fill) || !COLOR.test(b?.line)) out.push('ギザギザの色が #rrggbb の形ではありません');
  if (!(finite(b?.lineWidth) && b.lineWidth >= 0)) out.push('ギザギザの縁の太さが正しくありません');
  for (const [k, label] of Object.entries(PARTS)) textProblems(d[k], label, out);
  // 総額表示: 税込の金額は、数字に比べて読めないほど小さくしてはいけない
  if (finite(d.tax?.size) && finite(d.num?.size) && d.num.size > 0 && d.tax.size < d.num.size * 0.1) {
    out.push('税込の併記が小さすぎます（数字の大きさの 1/10 以上にしてください。総額表示のため）');
  }
  return out;
}

/** 使っている書体の一覧（同じ書体・太さは1つにまとめる）。 */
export function catchFontList(d) {
  const seen = new Map();
  for (const k of Object.keys(PARTS)) {
    const t = d[k];
    if (t?.font) seen.set(`${t.font}|${t.weight}`, { family: t.font, weight: String(t.weight) });
  }
  return [...seen.values()];
}
