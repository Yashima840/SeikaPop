// アプリの版（スマホが新しい版に気付くための印）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isNewerPublished, VERSION, versionInSw } from '../js/version.js';

test('sw.js の VERSION と js/version.js の VERSION は同じ（片方だけ上げると、ずっと「新しい版があります」と出る）', () => {
  assert.equal(versionInSw(readFileSync(new URL('../sw.js', import.meta.url), 'utf8')), VERSION);
});

test('sw.js の SHELL に version.js が入っている（電波の無いときも開けるように）', () => {
  assert.match(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /'\.\/js\/version\.js'/);
});

test('公開している sw.js から版を読む', () => {
  assert.equal(versionInSw("const VERSION = 'v42';\nconst X = 1;"), 'v42');
  assert.equal(versionInSw('<html>404</html>'), '');
  assert.equal(versionInSw(null), '');
});

test('公開している版が違うときだけ知らせる（読めなかったときは黙る）', () => {
  assert.equal(isNewerPublished('v42', 'v41'), true);
  assert.equal(isNewerPublished('v41', 'v41'), false);
  assert.equal(isNewerPublished('', 'v41'), false);
});
