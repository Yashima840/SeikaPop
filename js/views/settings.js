// 設定: バックアップ・保存の状態・エラーの記録。設定用リンクを開いたときの画面（#/setup?…）も
// 合言葉と名前は使うときに聞く（passcode.js）、税込の端数はポップの価格の欄で選ぶ

import * as store from '../store.js';
import { backupFileName } from '../backup.js';
import { clearErrorLog, readErrorLog } from '../crash.js';
import { collectorOf, parseSetupCode } from '../collect.js';
import { saveCollector } from './passcode.js';
import { downloadFile, h, toast } from '../ui.js';

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
      if (await saveCollector(r.url, r.passcode, senderInput.value.trim(), settings)) app.go('#/');
      else toast('合言葉が違います（事務所で今の合言葉を聞いてください）', { error: true });
    } catch (err) {
      toast(`送り先を保存できませんでした: ${err.message}`, { error: true });
    }
  };
  root.replaceChildren(h('section', { class: 'form' },
    h('p', {}, 'この端末で作ったポップを、事務所の Google ドライブへ自動で送るようにします。'),
    isStandalone() ? null : h('p', { class: 'hint' },
      '※ iPhone でホーム画面のアイコンから使っている場合、ここで設定してもアイコンの方には届きません。',
      'アイコンから開いたアプリで「みんなで使える場所に保管」などを使うと合言葉を聞かれるので、そこで入れてください（このリンクを貼り付けても設定できます）。'),
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'あなたの名前' }), senderInput),
    h('button', { class: 'primary big', onclick: apply }, '設定する'),
  ));
}

export async function showSettings(root, app) {
  app.setTitle('設定', { back: true });

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
        toast(`読み込みました（追加 ${r.added} 件・更新 ${r.updated} 件・こちらが新しいので残した ${r.skipped} 件・作った画像 ${r.shotsAdded} 枚・カスタムフレーム ${r.framesAdded} 件）`);
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
}
