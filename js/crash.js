// 落ちた理由を必ず残す。記録が先、知らせるのは後（知らせる処理で落ちても記録は残る）。

const KEY = 'seikapop.errorlog';
const MAX = 50;
const notified = new Set();

export function readErrorLog() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];  // 記録が読めないだけでアプリは使えるので空として扱う
  }
}

export function clearErrorLog() {
  try { localStorage.removeItem(KEY); } catch { /* 消せなくても次の記録で上書きされる */ }
}

export function recordError(where, err) {
  const entry = {
    at: new Date().toISOString(),
    where,
    message: String(err?.message || err),
    stack: String(err?.stack || '').slice(0, 1500),
    ua: navigator.userAgent,
  };
  try {
    const log = readErrorLog();
    log.push(entry);
    localStorage.setItem(KEY, JSON.stringify(log.slice(-MAX)));
  } catch {
    // 記録に失敗してもアプリは止めない（記録は目的ではなく手段）
  }
  console.error(where, err);
  return entry;
}

/** 想定外の失敗を記録し、同じ内容は1回だけ画面に知らせる。 */
export function installCrashHandlers(notify) {
  const report = (where, err) => {
    const e = recordError(where, err);
    if (notified.has(e.message)) return;
    notified.add(e.message);
    try { notify(`エラーが起きました: ${e.message}（設定 → エラーの記録 に残しました）`); } catch { /* 知らせられなくても記録は済んでいる */ }
  };
  window.addEventListener('error', ev => report('window.error', ev.error || ev.message));
  window.addEventListener('unhandledrejection', ev => report('unhandledrejection', ev.reason));
  return report;
}
