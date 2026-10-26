// 青果ポップ（SeikaPop）の受け取り口（Google Apps Script のウェブアプリ）。
// 店員さんのスマホから届いたポップを、このアカウントの Google ドライブ「青果ポップ 成果物」フォルダへ置く。
// 設置の手順は同じフォルダの README.md。
// 合言葉はこのファイルに書かない（スクリプトのプロパティ PASSCODE に入れる）。
//
// 置くもの（1件につき）:
//   <日時>_<名前>_<商品名>_<印>.jpg   … 出した画像（目で見る用）
//   <日時>_<名前>_<商品名>_<印>.json  … 作り直し用のデータ（写真・価格・デザインの選び方）。広告には無い
// 同じポップをもう一度送ってきたら、前のファイルはゴミ箱へ移して最新の1件にする（30日はゴミ箱から戻せる）。
//
// 写真ストック（「青果ポップ 写真ストック」フォルダ）: どの端末からでも呼び出して使う写真の置き場。
//   PC の担当はドライブのフォルダへ写真を直接入れる。店員さんのスマホは kind: 'stock' で写真を送って足す。
//   action: 'stock-list'（一覧）／'stock-thumbs'（小さい見本）／'stock-get'（写真の本体）。
//   読めるのはこのフォルダの中のファイルだけ（id を指定されても、ほかの場所のファイルは返さない）。

var FOLDER_NAME = '青果ポップ 成果物';
var STOCK_FOLDER_NAME = '青果ポップ 写真ストック';
var STOCK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];   // どの端末のブラウザでも開ける形だけ（HEIC は Android で開けない）
var STOCK_MAX_BYTES = 20 * 1024 * 1024;   // 1枚の上限（大きすぎるとスマホへの送り返しに時間がかかる）
var STOCK_LIST_MAX = 500;
var STOCK_THUMBS_MAX = 30;

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
    // stock: 1 ＝写真ストックに対応した版（古い版の受け取り口と見分けるため、アプリがこれを見る）
    if (body.ping) return reply_({ ok: true, stock: 1 });   // 「送り先を確かめる」。何も置かない
    if (body.action === 'stock-list') return reply_(stockList_(props));
    if (body.action === 'stock-thumbs') return reply_(stockThumbs_(props, body.ids));
    if (body.action === 'stock-get') return reply_(stockGet_(props, body.id));
    if (!body.key || !body.name || !body.image || !body.image.data) return reply_({ ok: false, message: '画像が入っていません' });

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);   // 同じポップが続けて届いても、置き換えが食い違わないように1件ずつ
    try {
      var folder = body.kind === 'stock' ? stockFolder_(props) : folder_(props);
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
    return reply_({ ok: true, stock: 1 });
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

function stockFolder_(props) {
  var id = props.getProperty('STOCK_FOLDER_ID');
  if (id) {
    try {
      var f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (err) {
      // フォルダを消された。下で作り直す
    }
  }
  var folder = DriveApp.createFolder(STOCK_FOLDER_NAME);
  props.setProperty('STOCK_FOLDER_ID', folder.getId());
  return folder;
}

// 写真ストックの一覧（新しい順）。PC で入れた HEIC などは一覧に出さず、数だけ返す（担当が気付けるように）
function stockList_(props) {
  var it = stockFolder_(props).getFiles();
  var items = [], skipped = 0;
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed()) continue;
    if (STOCK_TYPES.indexOf(f.getMimeType()) < 0 || f.getSize() > STOCK_MAX_BYTES) { skipped++; continue; }
    items.push({ id: f.getId(), name: f.getName(), type: f.getMimeType(), size: f.getSize(), updated: f.getLastUpdated().toISOString() });
  }
  items.sort(function (a, b) { return a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0; });
  return { ok: true, stock: 1, items: items.slice(0, STOCK_LIST_MAX), skipped: skipped, more: Math.max(0, items.length - STOCK_LIST_MAX) };
}

// ストックの中のファイルか（違う場所のファイルの id を渡されても読ませない）
function stockFile_(props, id) {
  if (typeof id !== 'string' || !/^[\w-]{10,}$/.test(id)) return null;
  var folderId = stockFolder_(props).getId();
  try {
    var f = DriveApp.getFileById(id);
    if (f.isTrashed()) return null;
    var parents = f.getParents();
    while (parents.hasNext()) if (parents.next().getId() === folderId) return f;
  } catch (err) {
    // 消された・見られない id。下で「ありません」にする
  }
  return null;
}

function stockThumbs_(props, ids) {
  var thumbs = {};
  (Array.isArray(ids) ? ids : []).slice(0, STOCK_THUMBS_MAX).forEach(function (id) {
    var f = stockFile_(props, id);
    if (!f) return;
    try {
      var t = f.getThumbnail();   // ドライブが作る小さい見本（まだ作られていないと null）
      if (t) thumbs[id] = { type: t.getContentType() || 'image/png', data: Utilities.base64Encode(t.getBytes()) };
    } catch (err) {
      // 見本が作れないファイル。アプリは名前だけで出す
    }
  });
  return { ok: true, stock: 1, thumbs: thumbs };
}

function stockGet_(props, id) {
  var f = stockFile_(props, id);
  if (!f) return { ok: false, message: 'ストックにその写真がありません（消されたかもしれません）' };
  if (f.getSize() > STOCK_MAX_BYTES) return { ok: false, message: '写真が大きすぎます（20MB まで）' };
  var b = f.getBlob();
  return { ok: true, stock: 1, image: { type: f.getMimeType(), data: Utilities.base64Encode(b.getBytes()) }, name: f.getName() };
}

function digest_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
