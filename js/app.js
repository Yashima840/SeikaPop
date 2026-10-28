// 起動と画面の切り替え（#/ ・ #/edit/<id> ・ #/make/<id>（かんたん作成）・ #/settings ・ #/ad ・ #/setup?…）
// 作った画像の一覧は、はじめの画面に入った（前の #/history は、はじめの画面として開く）

import { installCrashHandlers, recordError } from './crash.js';
import { toast } from './ui.js';
import { showHome } from './views/home.js';
import { showEditor } from './views/editor.js';
import { showSettings, showSetup } from './views/settings.js';
import { flushOutbox } from './sender.js';
import { showAd } from './views/ad.js';

const report = installCrashHandlers(msg => toast(msg, { error: true }));

const root = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('backBtn');
let backTo = '#/';
let leaveCurrent = null;   // 今の画面を離れるときの後始末（書きかけの保存など）
let routing = Promise.resolve();

const app = {
  go(hash) {
    if (location.hash === hash) route(); else location.hash = hash;
  },
  refresh() { route(); },
  /** back: false＝戻るボタンを出さない／true＝はじめの画面へ／'#/…'＝その画面へ */
  setTitle(text, { back }) {
    titleEl.textContent = text;
    backBtn.hidden = !back;
    backTo = typeof back === 'string' ? back : '#/';
  },
};

function route() {
  // 切り替えが重なっても順に走らせる（前の画面の保存が済んでから次を出す）
  routing = routing.then(async () => {
    try {
      if (leaveCurrent) { const f = leaveCurrent; leaveCurrent = null; await f(); }
    } catch (err) {
      report('leave', err);
    }
    const hash = location.hash || '#/';
    try {
      window.scrollTo(0, 0);
      const m = hash.match(/^#\/(edit|make)\/(.+)$/);
      if (m) leaveCurrent = await showEditor(root, app, decodeURIComponent(m[2]), { wizard: m[1] === 'make' });
      else if (hash === '#/settings') leaveCurrent = await showSettings(root, app);
      else if (hash.startsWith('#/setup?')) leaveCurrent = await showSetup(root, app, location.href);
      else if (hash === '#/ad') leaveCurrent = await showAd(root, app);
      else leaveCurrent = await showHome(root, app);
    } catch (err) {
      report(`route ${hash}`, err);
    }
  });
  return routing;
}

backBtn.addEventListener('click', () => app.go(backTo));
document.getElementById('settingsBtn').addEventListener('click', () => app.go('#/settings'));
window.addEventListener('hashchange', route);
// スマホはアプリを閉じても裏に残していて、次に開くと読み直さずに前の画面のまま出す（＝古い版のまま）。
// しばらく裏にあったあと、はじめの画面で表に戻ったときは読み直して最新の版にする
// （編集中・広告を作っている途中は読み直さない。共有画面から戻ったときに画面が替わると困るため）
const RELOAD_AFTER_MS = 10 * 60 * 1000;
let hiddenAt = 0;
// スマホでアプリを裏へ回したまま閉じられても、書きかけが残るように
// （画面は離れないので後始末は呼ばず、待っている保存だけを急がせる）
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    Promise.resolve(leaveCurrent?.flush?.()).catch(err => report('flush on hide', err));
    return;
  }
  const onHome = (location.hash || '#/') === '#/';
  if (hiddenAt && Date.now() - hiddenAt >= RELOAD_AFTER_MS && onHome && navigator.onLine !== false) {
    location.reload();
    return;
  }
  flushOutbox();   // 共有画面から戻ったときなど。送れなかった分を送り直す
  if (navigator.onLine === false) return;   // 電波が無いときは確かめられない（失敗を記録に溜めない）
  navigator.serviceWorker?.getRegistration()
    .then(reg => reg?.update())
    .catch(err => recordError('serviceWorker.update', err));
});
// 事務所へ送れなかった分は、電波が戻ったときにも送り直す（flushOutbox は例外を投げない）
window.addEventListener('online', () => { flushOutbox(); });

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch(err => recordError('serviceWorker.register', err));
}
if (navigator.storage?.persist) {
  navigator.storage.persist().catch(err => recordError('storage.persist', err));
}

route();
flushOutbox();
