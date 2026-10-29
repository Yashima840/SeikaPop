// 合言葉を聞く画面（今の画面の上に重ねて開く）。合言葉が要る機能を初めて使うとき・合言葉が変わったときに出す。
// 設定画面を開かなくても、その場で入れてそのまま続きができるように。

import * as store from '../store.js';
import { BUILT_IN_COLLECTOR_URL, collectorOf, parsePasscodeInput } from '../collect.js';
import { flushOutbox, pingCollector } from '../sender.js';
import { h, toast } from '../ui.js';

/**
 * 送り先を確かめてから入れる。url が空なら組み込みの受け取り口。
 * 合言葉が違うと分かったときは入れない（false）。電波が無いなどで確かめられないときは入れて知らせる。
 * settings: 設定を手元に持って書き戻す画面（設定画面）は、その入れ物を渡す（古い中身で上書きしないように）。
 */
export async function saveCollector(url, passcode, sender, settings = null) {
  const r = await pingCollector(url || BUILT_IN_COLLECTOR_URL, passcode);
  if (r.stop) return false;
  settings ||= await store.getSettings();
  settings.collector = { url, passcode, sender };
  await store.putSettings(settings);
  if (r.ok) toast('合言葉を覚えました（事務所に届くことを確かめました）');
  else toast(`合言葉を覚えましたが、届くかは確かめられませんでした: ${r.message}`, { error: true });
  flushOutbox();
  return true;
}

/** 合言葉が入っていれば true。無ければ聞いて、入れられたら true（閉じたら false）。 */
export async function ensureCollector(reason) {
  if (collectorOf(await store.getSettings()).ready) return true;
  return askPasscode({ reason });
}

/**
 * 合言葉と名前を聞く。入れられたら true、閉じたら false。
 * wrong: 今の合言葉が受け取り口に断られた（事務所で変えた）ときの聞き直し。
 */
export async function askPasscode({ reason = '', wrong = false } = {}) {
  const c = collectorOf(await store.getSettings());
  return new Promise(resolve => {
    const senderInput = h('input', { value: c.sender, placeholder: '例: 田中', autocomplete: 'name' });
    // iPhone が先頭を大文字にしたり、言葉を直したりしないように止める
    const codeInput = h('input', {
      type: 'text', placeholder: '例: tomato-negi-kaki-482', autocomplete: 'off', autocapitalize: 'off',
      autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done',
    });
    const errorEl = h('p', { class: 'field-error', text: '' });
    let busy = false;
    const close = ok => { sheet.remove(); resolve(ok); };
    const submit = async () => {
      if (busy) return;
      const r = parsePasscodeInput(codeInput.value);
      // 読めないときも打った文字は消さない
      if (!r.ok) { errorEl.textContent = r.message; return; }
      const sender = senderInput.value.trim();
      if (!sender) { errorEl.textContent = '名前も入れてください（誰が作ったか分かるように）'; return; }
      busy = true;
      okBtn.disabled = true;
      errorEl.textContent = '確かめています…';
      try {
        if (await saveCollector(r.url, r.passcode, sender)) { close(true); return; }
        errorEl.textContent = '合言葉が違います（事務所で今の合言葉を聞いて、もう一度入れてください）';
      } catch (err) {
        errorEl.textContent = `合言葉を覚えられませんでした: ${err.message}`;
      } finally {
        busy = false;
        okBtn.disabled = false;
      }
    };
    codeInput.addEventListener('keydown', ev => { if (ev.key === 'Enter') submit(); });
    const okBtn = h('button', { type: 'button', class: 'primary big', onclick: submit }, '使えるようにする');
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': '合言葉' },
      h('div', { class: 'sheet-bar' },
        h('b', { text: '🔑 合言葉を入れる' }),
        h('button', { type: 'button', class: 'mini', onclick: () => close(false) }, 'やめる')),
      h('div', { class: 'sheet-body form' },
        h('p', {}, wrong
          ? '合言葉が変わったようです。事務所で今の合言葉を聞いて、入れ直してください。'
          : `${reason ? `${reason}には` : ''}事務所の合言葉が要ります。1回入れれば、この端末が覚えます。`),
        h('p', { class: 'hint' }, '入れると、事務所の Google ドライブ（みんなで使える場所）にポップを保管したり、写真ストック・保管したポップを使えます。'),
        h('label', { class: 'field' }, h('span', { class: 'label', text: 'あなたの名前（誰が作ったか分かるように）' }), senderInput),
        h('label', { class: 'field' }, h('span', { class: 'label', text: '合言葉（事務所で聞いてください）' }), codeInput),
        errorEl,
        okBtn));
    document.body.append(sheet);
    (c.sender ? codeInput : senderInput).focus();
  });
}
