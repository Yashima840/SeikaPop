// 設定: 店名・バックアップ・保存の状態・エラーの記録

import * as store from '../store.js';
import { backupFileName } from '../backup.js';
import { parseTaxRateInput, TAX_ROUNDINGS, taxRateOf } from '../model.js';
import { clearErrorLog, readErrorLog } from '../crash.js';
import { debounce, downloadFile, h, toast } from '../ui.js';

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

  root.replaceChildren(
    h('section', { class: 'form' },
      h('h3', {}, 'お店'),
      h('label', { class: 'field' }, h('span', { class: 'label', text: '店名（ポップの隅に小さく入ります）' }), shopInput),
    ),
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

  const leave = () => saveSettings.flush();
  leave.flush = saveSettings.flush;
  return leave;
}
