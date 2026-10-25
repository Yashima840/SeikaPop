// 設定: 店名・事務所へ送る・バックアップ・保存の状態・エラーの記録。設定用リンクを開いたときの画面（#/setup?…）も

import * as store from '../store.js';
import { backupFileName } from '../backup.js';
import { parseTaxRateInput, TAX_ROUNDINGS, taxRateOf } from '../model.js';
import { clearErrorLog, readErrorLog } from '../crash.js';
import { collectorOf, parseSetupCode } from '../collect.js';
import { flushOutbox, onOutboxChange, outboxStatus, pingCollector } from '../sender.js';
import { confirmBox, debounce, downloadFile, h, toast } from '../ui.js';

export const APP_VERSION = '0.1.0';

async function storageInfo() {
  const out = [];
  try {
    if (navigator.storage?.persisted) {
      out.push(await navigator.storage.persisted()
        ? '保存は「消えにくい」設定になっています'
        : '保存は端末の空き容量が減ると消されることがあります（ホーム画面に追加すると消えにくくなります）');
    }
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      out.push(`使用量: 約 ${(e.usage / 1024 / 1024).toFixed(1)} MB`);
    }
  } catch (err) {
    out.push(`保存の状態を調べられませんでした: ${err.message}`);
  }
  return out;
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

/** 送り先を入れて、通じるか確かめる。 */
async function applyCollector(settings, url, passcode, sender) {
  settings.collector = { url, passcode, sender };
  await store.putSettings(settings);
  const r = await pingCollector(url, passcode);
  if (r.ok) toast('送り先を設定しました（事務所に届くことを確かめました）');
  else toast(`送り先は設定しましたが、確かめられませんでした: ${r.message}`, { error: true });
  flushOutbox();
}

/** 「事務所へ送る」の欄。戻り値の dispose で表示の更新を止める。 */
async function collectorSection(settings, rerender) {
  const c = collectorOf(settings);
  const statusList = h('ul', { class: 'info' });
  const showStatus = async () => {
    try {
      const st = await outboxStatus();
      // replaceChildren は null を「null」という文字にしてしまうので除く
      statusList.replaceChildren(...[
        h('li', { text: c.ready ? '送り先: 設定済み' : '送り先: まだ設定されていません（事務所から届く設定用リンクを下に貼り付けてください）' }),
        st.count ? h('li', { text: `まだ送れていないもの: ${st.count} 件（アプリを開いたときや電波が戻ったときに送り直します）` }) : null,
        st.lastError ? h('li', { class: 'field-error', text: `送れなかった理由: ${st.lastError}` }) : null,
      ].filter(Boolean));
    } catch (err) {
      statusList.replaceChildren(h('li', { class: 'field-error', text: `送る控えを読めませんでした: ${err.message}` }));
    }
  };
  await showStatus();
  const dispose = onOutboxChange(() => { showStatus(); });

  const senderInput = h('input', {
    value: c.sender, placeholder: '例: 田中',
    onchange: async () => {
      try {
        settings.collector = { ...settings.collector, sender: senderInput.value.trim() };
        await store.putSettings(settings);
        toast('名前を保存しました', { ms: 1200 });
      } catch (err) {
        toast(`名前を保存できませんでした: ${err.message}`, { error: true });
      }
    },
  });
  const codeInput = h('textarea', { rows: 2, placeholder: '事務所から届いた設定用リンクを長押し →「コピー」して、ここに貼り付け' });
  const codeError = h('span', { class: 'field-error', text: '' });
  const readCode = async () => {
    const r = parseSetupCode(codeInput.value);
    codeError.textContent = r.ok ? '' : r.message;   // 読めないときも貼った文字は消さない
    if (!r.ok) return;
    try {
      await applyCollector(settings, r.url, r.passcode, senderInput.value.trim());
      rerender();
    } catch (err) {
      toast(`送り先を保存できませんでした: ${err.message}`, { error: true });
    }
  };
  const test = async () => {
    toast('確かめています…');
    const r = await pingCollector(c.url, c.passcode);
    toast(r.ok ? '事務所に届くことを確かめました' : r.message, { error: !r.ok });
  };
  const sendNow = async () => {
    const r = await flushOutbox();
    if (r.error) toast(`送れませんでした: ${r.error}`, { error: true });
    else if (r.failed) toast(`${r.sent} 件送りました。送れなかったものがあります（理由は下に出ています）`, { error: true });
    else toast(r.sent ? `${r.sent} 件送りました` : '送るものはありません');
  };
  const remove = async () => {
    if (!await confirmBox('この端末から事務所へ送るのをやめます。まだ送れていないものは端末に残ります。', 'やめる')) return;
    try {
      settings.collector = { sender: c.sender };
      await store.putSettings(settings);
      rerender();
    } catch (err) {
      toast(`設定を保存できませんでした: ${err.message}`, { error: true });
    }
  };

  const el = h('section', { class: 'form' },
    h('h3', {}, '事務所へ送る'),
    h('p', { class: 'hint' }, '設定すると、共有・保存・履歴に残したポップが、事務所の Google ドライブへ自動で送られます（操作は増えません）。'),
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'あなたの名前（誰が作ったか分かるように）' }), senderInput),
    statusList,
    c.ready
      ? h('div', { class: 'row' },
        h('button', { onclick: sendNow }, '今すぐ送る'),
        h('button', { onclick: test }, '送り先を確かめる'),
        h('button', { class: 'danger', onclick: remove }, '送るのをやめる'))
      : null,
    h('label', { class: 'field' },
      h('span', { class: 'label', text: c.ready ? '送り先を変える（新しい設定用リンクを貼り付け）' : '設定用リンクを貼り付け' }),
      codeInput, codeError),
    h('button', { onclick: readCode }, '貼り付けたリンクで設定する'),
  );
  return { el, dispose };
}

/** 設定用リンク（#/setup?u=…&k=…）を開いたときの画面。 */
export async function showSetup(root, app, href) {
  app.setTitle('事務所へ送る設定', { back: true });
  const settings = await store.getSettings();
  const r = parseSetupCode(href);
  if (!r.ok) {
    root.replaceChildren(h('section', { class: 'form' }, h('p', { class: 'field-error', text: r.message })));
    return;
  }
  const senderInput = h('input', { value: collectorOf(settings).sender, placeholder: '例: 田中' });
  const apply = async () => {
    if (!senderInput.value.trim()) { toast('名前を入れてください（誰が作ったか分かるように）', { error: true }); return; }
    try {
      await applyCollector(settings, r.url, r.passcode, senderInput.value.trim());
      app.go('#/settings');
    } catch (err) {
      toast(`送り先を保存できませんでした: ${err.message}`, { error: true });
    }
  };
  root.replaceChildren(h('section', { class: 'form' },
    h('p', {}, 'この端末で作ったポップを、事務所の Google ドライブへ自動で送るようにします。'),
    isStandalone() ? null : h('p', { class: 'hint' },
      '※ iPhone でホーム画面のアイコンから使っている場合、ここで設定してもアイコンの方には届きません。',
      'このリンクをコピーして、アイコンから開いたアプリの「設定 → 事務所へ送る」に貼り付けてください。'),
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'あなたの名前' }), senderInput),
    h('button', { class: 'primary big', onclick: apply }, '設定する'),
  ));
}

export async function showSettings(root, app) {
  app.setTitle('設定', { back: true });
  const settings = await store.getSettings();

  const saveSettings = debounce(async () => {
    try {
      await store.putSettings(settings);
      toast('設定を保存しました', { ms: 1200 });
    } catch (err) {
      toast(`設定を保存できませんでした: ${err.message}`, { error: true });
    }
  }, 600);
  const shopInput = h('input', {
    value: settings.shopName, placeholder: '例: 青果の○○ ○○店',
    oninput: () => { settings.shopName = shopInput.value; saveSettings(); },
  });

  const taxError = h('span', { class: 'field-error', text: '' });
  const taxInput = h('input', {
    type: 'text', inputmode: 'numeric', value: String(taxRateOf(settings)),
    oninput: () => {
      const r = parseTaxRateInput(taxInput.value);
      taxError.textContent = r.ok ? '' : r.message;   // 読めない値は保存しない（打った字は残す）
      if (r.ok) { settings.taxRate = r.value; saveSettings(); }
    },
  });
  const roundingChips = h('div', { class: 'chips' });
  const showRounding = () => roundingChips.replaceChildren(...Object.entries(TAX_ROUNDINGS).map(([id, label]) =>
    h('button', {
      type: 'button', class: (settings.taxRounding || 'decimal') === id ? 'chip on' : 'chip',
      onclick: () => { settings.taxRounding = id; showRounding(); saveSettings(); },
    }, label)));
  showRounding();

  const exportAll = async () => {
    try {
      const data = await store.exportBackup();
      const file = new File([JSON.stringify(data)], backupFileName(), { type: 'application/json' });
      downloadFile(file);
      toast(`ポップ ${data.pops.length} 件・写真 ${data.photos.length} 枚・作った画像 ${data.shots.length} 枚を書き出しました`);
    } catch (err) {
      toast(`書き出せませんでした: ${err.message}`, { error: true });
    }
  };
  const importInput = h('input', {
    type: 'file', accept: 'application/json,.json', hidden: true,
    onchange: async ev => {
      const file = ev.target.files?.[0];
      ev.target.value = '';
      if (!file) return;
      try {
        const r = await store.importBackup(JSON.parse(await file.text()));
        toast(`読み込みました（追加 ${r.added} 件・更新 ${r.updated} 件・こちらが新しいので残した ${r.skipped} 件・作った画像 ${r.shotsAdded} 枚）`);
      } catch (err) {
        toast(`読み込めませんでした: ${err.message}`, { error: true });
      }
    },
  });

  const logBox = h('pre', { class: 'log' });
  const showLog = () => {
    const log = readErrorLog();
    logBox.textContent = log.length
      ? log.slice().reverse().map(e => `${e.at}  ${e.where}\n${e.message}\n${e.stack}`).join('\n\n')
      : '記録はありません';
  };
  showLog();

  const collector = await collectorSection(settings, () => app.refresh());

  root.replaceChildren(
    h('section', { class: 'form' },
      h('h3', {}, 'お店'),
      h('label', { class: 'field' }, h('span', { class: 'label', text: '店名（ポップの隅に小さく入ります）' }), shopInput),
    ),
    collector.el,
    h('section', { class: 'form' },
      h('h3', {}, '税'),
      h('p', { class: 'hint' }, '価格を「税抜で入れる」にしたポップは、この税率で計算した税込の金額を併記します。'),
      h('label', { class: 'field' }, h('span', { class: 'label', text: '税率（%）  青果などの食料品は 8' }), taxInput, taxError),
      h('div', { class: 'field' }, h('span', { class: 'label', text: '税込の端数' }), roundingChips),
    ),
    h('section', { class: 'form' },
      h('h3', {}, 'バックアップ'),
      h('p', { class: 'hint' }, '今は作ったポップをこのスマホの中に保存しています。機種変更のときや念のため、ときどき書き出してください。'),
      h('div', { class: 'row' },
        h('button', { onclick: exportAll }, '書き出す'),
        h('button', { onclick: () => importInput.click() }, '読み込む（今のデータに追加）'),
      ),
      importInput,
      h('ul', { class: 'info' }, (await storageInfo()).map(t => h('li', { text: t }))),
    ),
    h('section', { class: 'form' },
      h('h3', {}, 'エラーの記録'),
      logBox,
      h('div', { class: 'row' },
        h('button', {
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(logBox.textContent);
              toast('コピーしました');
            } catch (err) {
              toast(`コピーできませんでした: ${err.message}`, { error: true });
            }
          },
        }, 'コピー'),
        h('button', { onclick: () => { clearErrorLog(); showLog(); } }, '消す'),
      ),
    ),
    h('p', { class: 'hint center', text: `青果ポップ ${APP_VERSION}` }),
  );

  const leave = () => { collector.dispose(); return saveSettings.flush(); };
  leave.flush = saveSettings.flush;
  return leave;
}
