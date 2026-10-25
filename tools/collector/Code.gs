// 青果ポップ（SeikaPop）の受け取り口（Google Apps Script のウェブアプリ）。
// 店員さんのスマホから届いたポップを、このアカウントの Google ドライブ「青果ポップ 成果物」フォルダへ置く。
// 設置の手順は同じフォルダの README.md。
// 合言葉はこのファイルに書かない（スクリプトのプロパティ PASSCODE に入れる）。
//
// 置くもの（1件につき）:
//   <日時>_<名前>_<商品名>_<印>.jpg   … 出した画像（目で見る用）
//   <日時>_<名前>_<商品名>_<印>.json  … 作り直し用のデータ（写真・価格・デザインの選び方）。広告には無い
// 同じポップをもう一度送ってきたら、前のファイルはゴミ箱へ移して最新の1件にする（30日はゴミ箱から戻せる）。

var FOLDER_NAME = '青果ポップ 成果物';

function doPost(e) {
  try {
    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      return reply_({ ok: false, message: '送られてきた中身が読めません' });
    }
    var props = PropertiesService.getScriptProperties();
    var passcode = props.getProperty('PASSCODE');
    if (!passcode) return reply_({ ok: false, message: '受け取り口に合言葉（PASSCODE）が設定されていません' });
    if (!body || body.format !== 'seikapop-delivery') return reply_({ ok: false, message: '青果ポップからの送信ではありません' });
    if (body.passcode !== passcode) return reply_({ ok: false, code: 'passcode', message: '合言葉が違います' });
    if (body.ping) return reply_({ ok: true });   // 「送り先を確かめる」。何も置かない
    if (!body.key || !body.name || !body.image || !body.image.data) return reply_({ ok: false, message: '画像が入っていません' });

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);   // 同じポップが続けて届いても、置き換えが食い違わないように1件ずつ
    try {
      var folder = folder_(props);
      var slot = 'sent:' + digest_(body.key);
      var old = props.getProperty(slot);
      if (old) {
        JSON.parse(old).forEach(function (id) {
          try {
            DriveApp.getFileById(id).setTrashed(true);
          } catch (err) {
            // 事務所で既に消した・別の場所へ移したもの。新しい方を置くだけなので続ける
          }
        });
      }
      var ids = [];
      var type = body.image.type || 'image/jpeg';
      var ext = type === 'image/png' ? '.png' : '.jpg';
      ids.push(folder.createFile(Utilities.newBlob(Utilities.base64Decode(body.image.data), type, body.name + ext)).getId());
      if (body.pop) {
        var asset = {
          format: 'seikapop-asset', version: 1,
          key: body.key, kind: body.kind, title: body.title, sender: body.sender,
          createdAt: body.createdAt, receivedAt: new Date().toISOString(),
          pop: body.pop, photo: body.photo || null,
        };
        ids.push(folder.createFile(Utilities.newBlob(JSON.stringify(asset), 'application/json', body.name + '.json')).getId());
      }
      props.setProperty(slot, JSON.stringify(ids));
    } finally {
      lock.releaseLock();
    }
    return reply_({ ok: true });
  } catch (err) {
    return reply_({ ok: false, message: String(err && err.message || err) });
  }
}

// ブラウザでウェブアプリの URL を開いたときの表示（設置できたかの確認用）
function doGet() {
  return reply_({ ok: true, app: '青果ポップの受け取り口', note: 'この画面が出れば設置できています' });
}

function folder_(props) {
  var id = props.getProperty('FOLDER_ID');
  if (id) {
    try {
      var f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (err) {
      // フォルダを消された。下で作り直す
    }
  }
  var folder = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

function digest_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
