// アプリの版。sw.js の VERSION と同じ値にする（npm test が食い違いを止める）。
// 画面の動きを変えて公開するたびに上げる（スマホが新しい版に気付けるように）。

export const VERSION = 'v47';

/** 公開している sw.js の中身から版を読む。読めなければ ''。 */
export function versionInSw(text) {
  return /const VERSION = '([^']+)'/.exec(String(text ?? ''))?.[1] || '';
}

/** 公開している版が、今開いている版と違う（＝開き直すと替わる）か。読めなかったときは知らせない。 */
export function isNewerPublished(published, current = VERSION) {
  return !!published && published !== current;
}
