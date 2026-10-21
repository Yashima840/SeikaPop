// js/price-design.js の今のデザインを埋め込んだ試作キット（price-kit.html）を作る。
//   node tools/price-kit/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractRegion, kitFromTemplate } from './kit.mjs';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const DESIGN_JS = join(HERE, '..', '..', 'js', 'price-design.js');
export const KIT_HTML = join(HERE, 'price-kit.html');

export function buildKit() {
  const region = extractRegion(readFileSync(DESIGN_JS, 'utf8'));
  const template = readFileSync(join(HERE, 'kit-template.html'), 'utf8').replace(/\r\n/g, '\n');
  writeFileSync(KIT_HTML, kitFromTemplate(template, region));
  return KIT_HTML;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(`作りました: ${buildKit()}`);
}
