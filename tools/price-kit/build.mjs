// js/price-design.js の描き方と js/catch-design.js のデザインを埋め込んだ試作キット（price-kit.html）を作る。
//   node tools/price-kit/build.mjs
// 編集画面（tools/designer.html）で保存したときは、ローカルサーバー（tools/serve.py）がこれを呼ぶ。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractRegion, kitFromTemplate } from './kit.mjs';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const DESIGN_JS = join(HERE, '..', '..', 'js', 'price-design.js');
export const CATCH_JS = join(HERE, '..', '..', 'js', 'catch-design.js');
export const KIT_HTML = join(HERE, 'price-kit.html');

export async function buildKit() {
  const region = extractRegion(readFileSync(DESIGN_JS, 'utf8'));
  // 同じ実行の中で保存し直しても最新を読むよう、毎回別の URL で読み込む
  const { CATCH_DESIGN } = await import(`${pathToFileURL(CATCH_JS).href}?t=${Date.now()}`);
  const template = readFileSync(join(HERE, 'kit-template.html'), 'utf8').replace(/\r\n/g, '\n');
  writeFileSync(KIT_HTML, kitFromTemplate(template, region, CATCH_DESIGN));
  return KIT_HTML;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(`作りました: ${await buildKit()}`);
}
