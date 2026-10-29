// 画面の小さな部品（要素の組み立て・お知らせ・確認窓・間引き）。

/** 要素を作る。文字は textContent で入れる（入力した文字をHTMLとして解釈させない）。 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

let toastTimer = null;
export function toast(message, { error = false, ms = 3200 } = {}) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), error ? Math.max(ms, 6000) : ms);
}

/** 確認窓。true＝OK。ブラウザ標準の confirm はアプリ風の画面で浮くので使わない。 */
export function confirmBox(message, okLabel = 'OK') {
  const dlg = document.getElementById('confirmDlg');
  dlg.querySelector('.msg').textContent = message;
  dlg.querySelector('.ok').textContent = okLabel;
  return new Promise(resolve => {
    const onClose = () => { dlg.removeEventListener('close', onClose); resolve(dlg.returnValue === 'ok'); };
    dlg.addEventListener('close', onClose);
    dlg.returnValue = '';
    dlg.showModal();
  });
}

/** 最後の呼び出しから ms 後に1回だけ走らせる。flush() で待たずに走らせる。 */
export function debounce(fn, ms) {
  let timer = null, pending = null;
  const call = (...args) => {
    pending = args;
    clearTimeout(timer);
    timer = setTimeout(() => { const a = pending; pending = null; fn(...a); }, ms);
  };
  call.flush = async () => {
    clearTimeout(timer);
    if (pending) { const a = pending; pending = null; await fn(...a); }
  };
  return call;
}

/** 描画を1フレームに1回へまとめる（打つたびに描き直すと重い）。非同期の描画が重なっても順に走る。 */
export function frameThrottle(fn) {
  let queued = false, running = false, again = false;
  const tick = async () => {
    queued = false;
    if (running) { again = true; return; }
    running = true;
    try { await fn(); } finally {
      running = false;
      if (again) { again = false; schedule(); }
    }
  };
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(tick); } };
  return schedule;
}

/** iPhone・iPad か（iPad はパソコンの Safari を名乗るので、指で触れるかでも見る）。 */
export function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// 「この端末に保存」の注意書き（編集画面・広告で同じもの）
export const DEVICE_SAVE_NOTE = 'iPhone は出てくる画面で「画像を保存」を押すと写真アプリに入ります。Android・パソコンはダウンロードのフォルダーに入ります';

/**
 * 画像をこの端末に保存する。iPhone・iPad はダウンロードにすると「ファイル」アプリに入って写真アプリに出ないので、
 * 共有の画面を開く（「画像を保存」で写真アプリへ）。ほかはダウンロード。
 * 戻り値: 'shared'＝共有の画面を出した／'cancel'＝共有の画面でやめた／'downloaded'＝ダウンロードした。
 * 押してから時間が経って共有を断られたら、確認窓で押し直してもらう（押した直後でないと共有の画面は開けない）。
 */
export async function saveToDevice(file, title = '') {
  if (!isIOS() || !navigator.canShare?.({ files: [file] })) {
    downloadFile(file);
    return 'downloaded';
  }
  const share = async () => {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancel';   // 共有画面で「キャンセル」した＝失敗ではない
      throw err;
    }
  };
  try {
    return await share();
  } catch (err) {
    if (err?.name !== 'NotAllowedError') throw err;
    if (!await confirmBox('保存の用意ができました。押すと保存の画面が開きます（「画像を保存」を押すと写真アプリに入ります）。', '保存の画面を開く')) return 'cancel';
    return share();
  }
}

/** saveToDevice の結果を、知らせる文言に。やめたときは null。 */
export function deviceSaveMessage(result) {
  if (result === 'shared') return '保存の画面を出しました（「画像を保存」で写真アプリに入ります）';
  if (result === 'downloaded') return 'この端末に保存しました';
  return null;
}

export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  // 保存が始まる前に解放すると失敗する端末があるので、少し置いてから
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
