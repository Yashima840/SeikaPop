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

export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  // 保存が始まる前に解放すると失敗する端末があるので、少し置いてから
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
