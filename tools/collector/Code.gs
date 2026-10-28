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
//   action: 'stock-list'（一覧）／'stock-thumbs'（小さい見本）／'stock-get'（写真の本体）／'stock-thumbs-put'（端末で縮めた見本を預かる）。
//   PC の作業場の管理画面から: 'stock-rename'（名前を変える）／'stock-trash'（ゴミ箱へ移す。30日はドライブから戻せる）。
//   小さい見本はアプリが写真と一緒に送ってくる（200px の JPEG）。1つのファイル（THUMBS_FILE_NAME）にまとめて持ち、まとめて返す
//   （ドライブが作る見本は PNG で重く、1枚ずつ取り出すので遅いため）。無い写真だけドライブの見本を返し、アプリが縮めて預け直す。
//   読めるのはこのフォルダの中のファイルだけ（id を指定されても、ほかの場所のファイルは返さない）。
//
// 保管したポップ（「青果ポップ 成果物」フォルダ）: どの端末からでも呼び出して、価格などを直して使い回す。
//   action: 'saved-list'（作り直し用のデータ .json がある分の一覧）／'saved-thumbs'・'saved-thumbs-put'（見本。写真ストックと同じ仕組み）／
//   'saved-get'（作り直し用のデータ）。返事には saved: 1 を付ける（この版の受け取り口だと分かるように）。
//   'saved-lock'（消してはいけないものに鍵をかける・外す。.json の「説明」欄に SAVED_LOCK を書く＝ドライブでも見える）／
//   'saved-trash'（.json と .jpg をゴミ箱へ。鍵のかかったものは断る。30日はドライブのゴミ箱から戻せる）。

var FOLDER_NAME = '青果ポップ 成果物';
var STOCK_FOLDER_NAME = '青果ポップ 写真ストック';
var STOCK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];   // どの端末のブラウザでも開ける形だけ（HEIC は Android で開けない）
var STOCK_MAX_BYTES = 20 * 1024 * 1024;   // 1枚の上限（大きすぎるとスマホへの送り返しに時間がかかる）
var STOCK_LIST_MAX = 500;
var STOCK_THUMBS_MAX = 30;
var THUMBS_FILE_NAME = '青果ポップ 写真ストックの見本（消しても作り直されます）.json';
var STOCK_THUMB_MAX_CHARS = 60000;   // 見本1枚の上限（base64 の文字数。アプリの見本はふつう 1万文字ほど）
var SAVED_THUMBS_FILE_NAME = '青果ポップ 成果物の見本（消しても作り直されます）.json';
var SAVED_MAX_BYTES = 30 * 1024 * 1024;   // 作り直し用のデータ1件の上限（写真が入っている）
var SAVED_LOCK = '🔒 ロック中（青果ポップのアプリからは消せません）';   // 鍵のかかった .json の「説明」欄

// 見本をまとめて持つ先。写真ストックと保管したポップで、同じ仕組みを別のファイルで使う
var STOCK_THUMBS = { prop: 'STOCK_THUMBS_FILE_ID', name: THUMBS_FILE_NAME, folder: stockFolder_ };
var SAVED_THUMBS = { prop: 'SAVED_THUMBS_FILE_ID', name: SAVED_THUMBS_FILE_NAME, folder: folder_ };

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
    if (body.action === 'stock-thumbs') return reply_(thumbs_(props, STOCK_THUMBS, body.ids));
    if (body.action === 'stock-get') return reply_(stockGet_(props, body.id));
    if (body.action === 'stock-thumbs-put') return reply_(thumbsPut_(props, STOCK_THUMBS, body.thumbs));
    if (body.action === 'saved-list') return reply_(savedList_(props));
    if (body.action === 'saved-thumbs') return reply_(thumbs_(props, SAVED_THUMBS, body.ids));
    if (body.action === 'saved-thumbs-put') return reply_(thumbsPut_(props, SAVED_THUMBS, body.thumbs));
    if (body.action === 'saved-get') return reply_(savedGet_(props, body.id));
    if (body.action === 'saved-lock') return reply_(savedLock_(props, body.id, body.locked === true));
    if (body.action === 'saved-trash') return reply_(savedTrash_(props, body.id));
    if (body.action === 'stock-rename') return reply_(stockRename_(props, body.id, body.name));
    if (body.action === 'stock-trash') return reply_(stockTrash_(props, body.ids));
    if (!body.key || !body.name || !body.image || !body.image.data) return reply_({ ok: false, message: '画像が入っていません' });

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);   // 同じポップが続けて届いても、置き換えが食い違わないように1件ずつ
    try {
      var folder = body.kind === 'stock' ? stockFolder_(props) : folder_(props);
      var slot = 'sent:' + digest_(body.key);
      var old = props.getProperty(slot);
      var wasLocked = false;   // 鍵をかけたポップを出し直したら、新しい方にも鍵をかける
      if (old) {
        JSON.parse(old).forEach(function (id) {
          try {
            var f = DriveApp.getFileById(id);
            if (!f.isTrashed() && f.getDescription() === SAVED_LOCK) wasLocked = true;
            f.setTrashed(true);
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
        var data = folder.createFile(Utilities.newBlob(JSON.stringify(asset), 'application/json', body.name + '.json'));
        if (wasLocked) data.setDescription(SAVED_LOCK);
        ids.push(data.getId());
      }
      props.setProperty(slot, JSON.stringify(ids));
      if (body.kind === 'stock') {
        var gone = old ? JSON.parse(old) : [];
        updateThumbs_(props, STOCK_THUMBS, function (index) {
          gone.forEach(function (id) { delete index[id]; });
          if (isThumb_(body.thumb)) index[ids[0]] = { type: body.thumb.type, data: body.thumb.data };
        });
      }
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
  return fileIn_(stockFolder_(props), id);
}

// フォルダの中のファイルか。違えば null
function fileIn_(folder, id) {
  if (typeof id !== 'string' || !/^[\w-]{10,}$/.test(id)) return null;
  var folderId = folder.getId();
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

// 見本を返す（box＝STOCK_THUMBS か SAVED_THUMBS。保管したポップは、出した画像の id で見本を持つ）
function thumbs_(props, box, ids) {
  var thumbs = {};
  var index = readThumbs_(props, box);
  var folder = box.folder(props);
  (Array.isArray(ids) ? ids : []).slice(0, STOCK_THUMBS_MAX).forEach(function (id) {
    if (typeof id === 'string' && index[id]) { thumbs[id] = index[id]; return; }   // 預かっている軽い見本
    var f = fileIn_(folder, id);
    if (!f) return;
    try {
      var t = f.getThumbnail();   // ドライブが作る見本（重い。まだ作られていないと null）。drive: アプリに縮めて預け直してもらう印
      if (t) thumbs[id] = { type: t.getContentType() || 'image/png', data: Utilities.base64Encode(t.getBytes()), drive: true };
    } catch (err) {
      // 見本が作れないファイル。アプリは名前だけで出す
    }
  });
  return { ok: true, stock: 1, saved: 1, thumbs: thumbs };
}

// 端末で縮めた見本を預かる（そのフォルダの中のファイルの分だけ）
function thumbsPut_(props, box, thumbs) {
  var folder = box.folder(props);
  var ids = Object.keys(thumbs && typeof thumbs === 'object' ? thumbs : {}).slice(0, STOCK_THUMBS_MAX).filter(function (id) {
    return isThumb_(thumbs[id]) && fileIn_(folder, id);
  });
  if (!ids.length) return { ok: true, stock: 1, saved: 1, put: 0 };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    updateThumbs_(props, box, function (index) {
      ids.forEach(function (id) { index[id] = { type: thumbs[id].type, data: thumbs[id].data }; });
    });
  } finally {
    lock.releaseLock();
  }
  return { ok: true, stock: 1, saved: 1, put: ids.length };
}

// 名前を変える（拡張子は元のまま。ドライブで使えない記号は「_」に）
function stockRename_(props, id, name) {
  var f = stockFile_(props, id);
  if (!f) return { ok: false, message: 'ストックにその写真がありません（消されたかもしれません）' };
  var clean = String(name || '').trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 60);
  if (!clean) return { ok: false, message: '名前が空です' };
  var ext = (/\.[A-Za-z0-9]{2,5}$/.exec(f.getName()) || [''])[0];
  f.setName(clean + ext);
  return { ok: true, stock: 1, name: f.getName() };
}

// ゴミ箱へ移す（30日はドライブのゴミ箱から戻せる）。預かっている見本も捨てる
function stockTrash_(props, ids) {
  var files = (Array.isArray(ids) ? ids : []).slice(0, STOCK_LIST_MAX).map(function (id) { return stockFile_(props, id); })
    .filter(function (f) { return f; });
  if (!files.length) return { ok: true, stock: 1, trashed: 0 };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    files.forEach(function (f) { f.setTrashed(true); });
    updateThumbs_(props, STOCK_THUMBS, function () {});   // ゴミ箱へ移した写真の見本は、ここで捨てられる
  } finally {
    lock.releaseLock();
  }
  return { ok: true, stock: 1, trashed: files.length };
}

function isThumb_(t) {
  return !!t && t.type === 'image/jpeg' && typeof t.data === 'string' && t.data.length > 0 && t.data.length <= STOCK_THUMB_MAX_CHARS;
}

function thumbsFile_(props, box) {
  var id = props.getProperty(box.prop);
  if (!id) return null;
  try {
    var f = DriveApp.getFileById(id);
    return f.isTrashed() ? null : f;
  } catch (err) {
    return null;   // 消された。次に預かるときに作り直す
  }
}

// 預かっている見本 { ファイルの id: { type, data } }。読めなければ空（アプリはドライブの見本で並べ、預け直す）
function readThumbs_(props, box) {
  var f = thumbsFile_(props, box);
  if (!f) return {};
  try {
    var index = JSON.parse(f.getBlob().getDataAsString());
    return index && typeof index === 'object' ? index : {};
  } catch (err) {
    return {};   // 壊れている。次に預かるときに書き直される
  }
}

// 見本を書き換える（呼ぶ側でロックを取る）。フォルダから消えたファイルの分は捨てる（ファイルが膨らまないように）
function updateThumbs_(props, box, change) {
  var index = readThumbs_(props, box);
  change(index);
  var alive = {};
  var it = box.folder(props).getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (!f.isTrashed()) alive[f.getId()] = true;
  }
  Object.keys(index).forEach(function (id) { if (!alive[id]) delete index[id]; });
  var text = JSON.stringify(index);
  var file = thumbsFile_(props, box);
  if (file) {
    file.setContent(text);
  } else {
    file = DriveApp.createFile(box.name, text, 'application/json');
    props.setProperty(box.prop, file.getId());
  }
}

function stockGet_(props, id) {
  var f = stockFile_(props, id);
  if (!f) return { ok: false, message: 'ストックにその写真がありません（消されたかもしれません）' };
  if (f.getSize() > STOCK_MAX_BYTES) return { ok: false, message: '写真が大きすぎます（20MB まで）' };
  var b = f.getBlob();
  return { ok: true, stock: 1, image: { type: f.getMimeType(), data: Utilities.base64Encode(b.getBytes()) }, name: f.getName() };
}

// 保管したポップの一覧（新しい順）。作り直し用のデータ（.json）と出した画像（.jpg）がそろっている分だけ
// （広告は画像だけなので出ない）。id＝画像（見本もこの id で持つ）、data＝作り直し用のデータ
function savedList_(props) {
  var it = folder_(props).getFiles();
  var images = {}, datas = [];
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed()) continue;
    var name = f.getName();
    if (/\.json$/i.test(name)) datas.push(f);
    else if (/\.jpg$/i.test(name)) images[name.replace(/\.jpg$/i, '')] = f;
  }
  var items = [];
  datas.forEach(function (d) {
    var base = d.getName().replace(/\.json$/i, '');
    var img = images[base];
    if (!img) return;
    items.push({
      id: img.getId(), data: d.getId(), name: base, size: d.getSize(), updated: d.getLastUpdated().toISOString(),
      locked: d.getDescription() === SAVED_LOCK,
    });
  });
  items.sort(function (a, b) { return a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0; });
  return { ok: true, stock: 1, saved: 1, items: items.slice(0, STOCK_LIST_MAX), more: Math.max(0, items.length - STOCK_LIST_MAX) };
}

// 作り直し用のデータ（中身を読み、そのまま返す）
function savedGet_(props, id) {
  var f = savedData_(props, id);
  if (!f) return { ok: false, message: '保管したポップが見つかりません（消されたかもしれません）' };
  if (f.getSize() > SAVED_MAX_BYTES) return { ok: false, message: '保管したポップのデータが大きすぎます' };
  var asset;
  try {
    asset = JSON.parse(f.getBlob().getDataAsString());
  } catch (err) {
    return { ok: false, message: '保管したポップのデータが壊れていて読めません' };
  }
  return { ok: true, stock: 1, saved: 1, asset: asset };
}

// 保管したポップの作り直し用のデータ（.json）。違えば null
function savedData_(props, id) {
  var f = fileIn_(folder_(props), id);
  return f && /\.json$/i.test(f.getName()) ? f : null;
}

// 鍵をかける・外す（.json の「説明」欄。ドライブの詳細でも見える）
function savedLock_(props, id, locked) {
  var f = savedData_(props, id);
  if (!f) return { ok: false, message: '保管したポップが見つかりません（消されたかもしれません）' };
  f.setDescription(locked ? SAVED_LOCK : '');
  return { ok: true, stock: 1, saved: 1, locked: locked };
}

// .json と、同じ名前の .jpg をゴミ箱へ（30日はドライブのゴミ箱から戻せる）。鍵のかかったものは消さない
function savedTrash_(props, id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);   // 出し直しの置き換えと食い違わないように
  try {
    var f = savedData_(props, id);
    if (!f) return { ok: false, message: '保管したポップが見つかりません（もう消されたかもしれません）' };
    if (f.getDescription() === SAVED_LOCK) return { ok: false, saved: 1, locked: true, message: 'ロックしてあるので消せません（先にロックを外してください）' };
    var base = f.getName().replace(/\.json$/i, '');
    var images = folder_(props).getFilesByName(base + '.jpg');
    while (images.hasNext()) images.next().setTrashed(true);
    f.setTrashed(true);
    updateThumbs_(props, SAVED_THUMBS, function () {});   // ゴミ箱へ移した画像の見本は、ここで捨てられる
  } finally {
    lock.releaseLock();
  }
  return { ok: true, stock: 1, saved: 1, trashed: 1 };
}

function digest_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
