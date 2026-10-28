"""PC で SeikaPop を開く（デザイン作業用のローカルサーバー）。

    python tools/serve.py          # 起動してブラウザで作業場（PC の作業の入口）を開く
    python tools/serve.py --lan    # 同じ Wi-Fi のスマホからも見られるようにする
    pythonw tools/serve.py         # 黒い窓を出さずに動かす（start.bat はこれ。止めるのは作業場の「終了」）

python -m http.server と違い、ブラウザにファイルを控えさせない（Cache-Control: no-store）。
控えられると、JS やデザインを直してもブラウザが古いまま表示し、直したのに変わらないように見える。
また、デザイン編集画面（tools/designer.html）の「保存」を受けて js/catch-design.js（金額キャッチ）と
js/label-design.js（産地・商品名・数量と単位の3行）を書き換える。
"""
import argparse
import datetime
import functools
import http.server
import json
import re
import shutil
import socket
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8765
# 開くのは作業場だけ（各画面はそこから辿る。何枚もタブが開くと、どれで何をするのか分からなくなる）
HUB = "/tools/"
PAGES = {
    "作業場（ここから始める）": HUB,
    "デザイン編集（金額主役）": "/tools/designer.html",
    "アプリ": "/",
    "見本帳（全デザイン×全サイズ）": "/tools/gallery.html",
    "台紙の書体を見比べる": "/tools/badge-fonts.html",
    "金額キャッチの試作キット": "/tools/price-kit/price-kit.html",
    "外部AI案の比較": "/tools/price-kit/compare.html",
    "合言葉を決める": "/tools/collector/link.html",
    "写真ストックの管理": "/tools/stock-upload.html",
}
CATCH_JS = ROOT / "js" / "catch-design.js"
BACKUP_DIR = ROOT / "tools" / "designer-backup"
SAVE_PATH = "/api/catch-design"
LABEL_JS = ROOT / "js" / "label-design.js"
LABEL_SAVE_PATH = "/api/label-design"
STOP_PATH = "/api/stop"
INFO_PATH = "/api/info"
# clasp で受け取り口を上げるときの控え（店ごと・Git に入れない）。あれば作業場が Apps Script のプロジェクトを直接開ける
CLASP_JSON = ROOT / "tools" / "collector" / ".clasp.json"
# 窓が無いとき（pythonw）の出力先。保存の控えや失敗の理由を後から読めるように
LOG = ROOT / "tools" / "serve.log"
LABEL_HEADER = """// 「金額主役」の 産地・商品名・数量と単位 の3行のデザイン（tools/designer.html の「保存」で書き換わる。手で直してもよい）
// 座標は、写真の枠の左下を (0, 0) とした「デザイン単位」（幅1080pxの画像で 1 単位＝1px）。右・下がプラス。
// x, y は1行目の文字の基準点（align の位置・文字の下端の線）。
// size は最大の大きさ。maxW を超えると maxLines まで折り返し、それでも入らなければ minSize まで縮める。
// unit.follow が true のときは、x, y は「商品名の最後の行の終わり」からのずれ（名前の長さに付いていく）。
// unit.under が true なら「商品名の最後の行の頭」からのずれ（商品名の下に置く）。
// fromTop が true の行は、写真の枠の左上が原点（写真の大きさが変わっても上に留まる）。付いていく単位は商品名に合わせる。
"""
MAX_BODY = 200_000
CATCH_HEADER = """// 金額キャッチのデザイン（tools/designer.html の「保存」で書き換わる。手で直してもよい）
// 座標は、写真の枠の右下を (0, 0) とした「デザイン単位」。左・上がマイナス。
// 大きさは fit.scale（写真の幅 1000px あたり、デザイン単位1つを何 px にするか）。
// 写真がとても横長（高さが幅の半分未満）のときだけ、高さに合わせて縮める。
// order は重なり順（先頭がいちばん奥、最後がいちばん手前）。
"""


def save_catch_design(design):
    """デザインを js/catch-design.js へ書き、前の版を控え、試作キットを作り直す。(控えのパス, 注意) を返す。

    中身の細かい検査は編集画面が js/catch-check.js で済ませている。ここでは形だけ見る
    （壊れたものを書くと、アプリ全体が開かなくなるため）。
    """
    if not isinstance(design, dict) or design.get("version") != 1:
        raise ValueError("デザインの形が違います（version 1 ではありません）")
    if not isinstance(design.get("order"), list):
        raise ValueError("デザインに重なり順（order）がありません")
    for key in ("fit", "burst", "num", "yen", "tax"):
        if not isinstance(design.get(key), dict):
            raise ValueError(f"デザインに {key} がありません")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = BACKUP_DIR / f"catch-design.{stamp}.js"
    shutil.copy2(CATCH_JS, backup)
    body = json.dumps(design, ensure_ascii=False, indent=2)
    # 座標の組 [x, y] は1行にまとめる（数字1つごとに改行されると、手で読み直すのがつらい）
    body = re.sub(r"\[\s*(-?[\d.]+(?:e-?\d+)?),\s*(-?[\d.]+(?:e-?\d+)?)\s*\]", r"[\1, \2]", body)
    text = CATCH_HEADER + "export const CATCH_DESIGN = " + body + ";\n"
    tmp = CATCH_JS.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    tmp.replace(CATCH_JS)  # 途中で止まっても半端なファイルを残さない
    note = ""
    try:
        r = subprocess.run(["node", "tools/price-kit/build.mjs"], cwd=ROOT, capture_output=True, text=True,
                           encoding="utf-8", timeout=60)
        if r.returncode != 0:
            note = "試作キットを作り直せませんでした: " + (r.stderr or r.stdout).strip()[-300:]
    except (OSError, subprocess.TimeoutExpired) as err:
        note = f"試作キットを作り直せませんでした（node が見つからない等）: {err}"
    return backup.relative_to(ROOT).as_posix(), note


def write_js(path, header, const_name, design):
    """前の版を tools/designer-backup/ へ控えてから、デザインを JS のファイルへ書く。控えのパスを返す。"""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = BACKUP_DIR / f"{path.stem}.{stamp}.js"
    shutil.copy2(path, backup)
    body = json.dumps(design, ensure_ascii=False, indent=2)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(header + f"export const {const_name} = " + body + ";\n", encoding="utf-8", newline="\n")
    tmp.replace(path)  # 途中で止まっても半端なファイルを残さない
    return backup.relative_to(ROOT).as_posix()


def save_label_design(design):
    """3行のデザインを js/label-design.js へ書く。(控えのパス, 注意) を返す。

    中身の細かい検査は編集画面が js/labels.js で済ませている。ここでは形だけ見る。
    """
    if not isinstance(design, dict) or design.get("version") != 1:
        raise ValueError("3行のデザインの形が違います（version 1 ではありません）")
    for key in ("origin", "name", "unit"):
        if not isinstance(design.get(key), dict):
            raise ValueError(f"3行のデザインに {key} がありません")
    return write_js(LABEL_JS, LABEL_HEADER, "LABEL_DESIGN", design), ""


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".webmanifest": "application/manifest+json",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # 作業場が「スマホで開くアドレス」を出すのに使う（同じ Wi-Fi 向けに起動したか・この PC のアドレス）
        if self.path == INFO_PATH:
            lan = self.server.lan
            info = {"lan": lan, "ip": lan_address() if lan else None, "port": PORT}
            # 受け取り口のプロジェクトはこの PC の作業場にだけ教える（同じ Wi-Fi の他の端末には出さない）
            if self.client_address[0] in ("127.0.0.1", "::1"):
                info["scriptId"] = clasp_script_id()
            self.send_json(200, info)
            return
        super().do_GET()

    def do_POST(self):
        savers = {SAVE_PATH: save_catch_design, LABEL_SAVE_PATH: save_label_design}
        if self.path not in savers and self.path != STOP_PATH:
            self.send_json(404, {"ok": False, "message": "ありません"})
            return
        # 書き換え・終了はこの PC のブラウザから、編集画面・作業場を通したときだけ。
        # 独自の見出しを必須にすると、他のサイトからは（ブラウザの決まりで）送れない
        if self.client_address[0] not in ("127.0.0.1", "::1") or self.headers.get("X-SeikaPop") not in ("designer", "hub"):
            self.send_json(403, {"ok": False, "message": "この PC の編集画面・作業場からだけ操作できます"})
            return
        if self.path == STOP_PATH:
            self.send_json(200, {"ok": True})
            print("作業場の「終了」で止めました。", flush=True)
            # serve_forever の中から shutdown を呼ぶと待ち合って止まらないので、別のスレッドで呼ぶ
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= MAX_BODY:
            self.send_json(413, {"ok": False, "message": "データが大きすぎるか空です"})
            return
        try:
            backup, note = savers[self.path](json.loads(self.rfile.read(length).decode("utf-8")))
        except (ValueError, UnicodeDecodeError) as err:
            self.send_json(400, {"ok": False, "message": str(err)})
            return
        except OSError as err:
            self.send_json(500, {"ok": False, "message": f"ファイルに書けませんでした: {err}"})
            return
        print(f"デザインを保存しました（前の版の控え: {backup}）" + (f"\n  ※ {note}" if note else ""), flush=True)
        self.send_json(200, {"ok": True, "backup": backup, "note": note})

    def log_message(self, format, *args):
        # 読み込みのたびに出ると肝心の案内が流れるので、失敗（4xx・5xx）だけ出す
        if len(args) > 1 and str(args[1])[:1] in "45":
            super().log_message(format, *args)


class Server(http.server.ThreadingHTTPServer):
    # 標準は同じポートの使い回しを許す設定で、Windows ではこれだと2回起動したときに
    # 同じポートを二重に取れてしまい、どちらが応えるか分からなくなる。使用中なら失敗させる
    allow_reuse_address = False
    lan = False   # 同じ Wi-Fi のスマホにも見せているか（--lan）

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):  # Windows だけにある
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def clasp_script_id():
    """tools/collector/.clasp.json のスクリプト ID。無い・読めないときは None（作業場は登録した先か一覧を開く）。"""
    try:
        sid = json.loads(CLASP_JSON.read_text(encoding="utf-8")).get("scriptId")
    except (OSError, ValueError):
        return None
    return sid if isinstance(sid, str) and re.fullmatch(r"[\w-]{20,}", sid) else None


def lan_address():
    """同じ Wi-Fi から見るときの、この PC の IP アドレス（分からなければ None）。"""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 80))  # 実際には送らない。経路から自分のアドレスを知るだけ
            return s.getsockname()[0]
    except OSError:
        return None


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--lan", action="store_true", help="同じ Wi-Fi のスマホからも見られるようにする")
    ap.add_argument("--no-browser", action="store_true", help="ブラウザを開かない")
    args = ap.parse_args()
    if sys.stdout is None:
        # pythonw で窓無しに起動した。print やアクセスの記録（標準エラー）の行き先が無いと落ちるので、ファイルへ
        sys.stdout = sys.stderr = open(LOG, "w", encoding="utf-8", buffering=1)  # 止まるまで開いておく
        print(datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S 窓無しで起動"))

    base = f"http://127.0.0.1:{PORT}"
    handler = functools.partial(NoCacheHandler, directory=str(ROOT))
    try:
        server = Server(("0.0.0.0" if args.lan else "127.0.0.1", PORT), handler)
        server.lan = args.lan
    except OSError:
        # もう起動している（前の窓が開いたまま）なら、ブラウザだけ開く
        print(f"ポート {PORT} は使用中です。起動済みとみなしてブラウザだけ開きます。")
        print("（別のソフトが使っている場合は、そちらを止めてからやり直してください）")
        if not args.no_browser:
            webbrowser.open(base + HUB)
        return 1

    how = "この窓を閉じると止まります" if sys.stdout.isatty() else "作業場の「終了」で止まります"
    print(f"SeikaPop を起動しました。{how}。\n")
    for label, path in PAGES.items():
        print(f"  {label:<16} {base}{path}")
    if args.lan:
        ip = lan_address()
        print(f"\n  スマホから（同じ Wi-Fi）  http://{ip or '<この PC の IP アドレス>'}:{PORT}/")
        print("  ※ http なので共有ボタン・ホーム画面への追加は動きません（画像の保存で代わりになります）")
    print("\n直したら、ブラウザで再読み込み（F5）すれば反映されます。")

    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(base + HUB)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
