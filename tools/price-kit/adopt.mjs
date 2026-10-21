// AI から返ってきた試作キット（またはその範囲だけを貼ったファイル）のデザインを、アプリへ取り込む。
//   node tools/price-kit/adopt.mjs tools/price-kit/candidates/chatgpt.html
// 取り込む前の js/price-design.js は tools/price-kit/backup/ に控える（戻すときはそれを adopt する）。
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { extractRegion, replaceRegion } from './kit.mjs';
import { buildKit, DESIGN_JS, HERE } from './build.mjs';

const file = process.argv[2];
if (!file) {
  console.error('使い方: node tools/price-kit/adopt.mjs <返ってきたファイル>');
  process.exit(1);
}
try {
  const region = extractRegion(readFileSync(file, 'utf8'));
  // 構文だけ確かめる（動くかどうかは npm test と見本帳で確かめる）
  new vm.Script(`${region}\n;[PRICE_FONTS, drawPrice];`, { filename: file });

  const stamp = new Date().toLocaleString('sv-SE').replace(/[-: ]/g, '').slice(0, 14);
  mkdirSync(join(HERE, 'backup'), { recursive: true });
  const backup = join(HERE, 'backup', `price-design.${stamp}.js`);
  copyFileSync(DESIGN_JS, backup);
  writeFileSync(DESIGN_JS, replaceRegion(readFileSync(DESIGN_JS, 'utf8'), region));
  buildKit();
  console.log(`取り込みました: ${DESIGN_JS}`);
  console.log(`前のデザインの控え: ${backup}`);
  console.log('次に: npm test → npm run lint → tools/gallery.html で「金額主役」を見る');
} catch (err) {
  console.error(`取り込めませんでした: ${err.message}`);
  process.exit(1);
}
