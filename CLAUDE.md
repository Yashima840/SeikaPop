# SeikaPop 開発ルール

青果店の朝、スマホだけで電子ポップを作るPWA。使う人は売り場で片手・急いでいる。
全体像は `README.md`。

## 前提

- **ビルド無し・外部ライブラリ無し**の素の JavaScript モジュール。足すなら理由を README に書く。
- iPhone（Safari）と Android（Chrome）の両方で動くこと。HTTPS でしか動かない機能
  （`navigator.share`・Service Worker・`crypto.randomUUID`）は**無くても動く代わりを必ず持つ**
  （LAN の http で試すことがあるため）。
- 計算・判定は `model.js` / `layout.js` / `backup.js` / `frames.js` / `labels.js`（置き方・検査）/ `collect.js`（事務所へ集める）と `image.js` の画素処理に置き、
  画面・Canvas・IndexedDB に触らない（`npm test` で確かめられるように）。新しい判定もここへ。
- 保存は `store.js` の関数だけを通す（将来クラウド版に差し替えるため）。
- 事務所への送信は `sender.js` だけが行う。送れないものは端末に控えて送り直し、理由を画面に出す（黙って捨てない）。
  合言葉はリポジトリに書かない（受け取り口のスクリプト プロパティと、配る設定用リンクにだけある）。

## 守ること

- **打った内容を黙って失わない。** 保存は自動（間引き）＋画面を離れる・裏へ回るときに急がせる。
  保存の失敗は必ず画面に出す。価格欄など読めない入力は消さずに残して理由を出す。
- **レギュラーから作ったポップは、価格・産地の確認の印が付くまで出力させない**
  （前回の価格・産地のまま出す事故を防ぐ。`exportProblems`）。
- 価格は税抜・税込のどちらで入れたかを `priceTax` で持つ（無い古いポップは税込）。ポップには必ず税込が読める形で入れる
  （総額表示。税抜で入れたら設定の税率で計算した税込を併記）。価格の文字は `priceTexts` / `taxNote` だけで作る。
- 写真は複数のポップ（レギュラーと今日の分）で共有する。消すのは**どのポップからも
  使われていない写真だけ**（`removeUnusedPhotos`）。新しい写真を指す保存を**先に**済ませてから片付ける。
- 日付・ファイル名は端末の時刻で（`toISOString` は UTC＝日本の朝9時前は前日になる）。
- 想定外の失敗は `crash.js` が記録する（設定 → エラーの記録）。`catch {}` を書くなら理由を1行。
- デザインを直したら `tools/gallery.html` で全デザイン×全サイズ×長い名前を見て崩れを確かめる。
- 金額キャッチの見た目は `js/catch-design.js`（データ）で持ち、`tools/designer.html`（`start.bat` で開く作業場から辿る）で編集・保存する。
  「金額主役」の産地・商品名・数量と単位の3行も同じ画面で編集し、`js/label-design.js` に保存する（検査は `labelDesignProblems`）。
  検査は `js/catch-check.js`（税込の併記を小さくしすぎない等）。描き方は `js/price-design.js` の印の範囲だけ。外部AIに頼む手順は `tools/price-kit/PROMPT.md`。
  範囲を手で直したら `node tools/price-kit/build.mjs` で試作キットを作り直す（`npm test` が食い違いを止める）。
- ファイルを足したら `sw.js` の `SHELL` に足し、`VERSION` を上げる。
- PC 用の画面を足したら `tools/index.html`（作業場＝`start.bat` で開く唯一の入口）に足し、画面には「← 作業場」の戻り口を付ける。

## 確認

```bash
npm test
npm run lint   # 指摘ゼロを保つ
```
