"""PC で SeikaPop を開く（デザイン作業用のローカルサーバー）。

    python tools/serve.py          # 起動してブラウザでデザイン編集とアプリを開く
    python tools/serve.py --lan    # 同じ Wi-Fi のスマホからも見られるようにする

python -m http.server と違い、ブラウザにファイルを控えさせない（Cache-Control: no-store）。
控えられると、JS やデザインを直してもブラウザが古いまま表示し、直したのに変わらないように見える。
また、デザイン編集画面（tools/designer.html）の「保存」を受けて js/catch-design.js を書き換える。
"""
import argparse
import datetime
import functools
import http.server
import json
import shutil
import socket
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8765
PAGES = {
    "デザイン編集（金額キャッチ）": "/tools/designer.html",
    "アプリ": "/",
    "見本帳（全デザイン×全サイズ）": "/tools/gallery.html",
    "金額キャッチの試作キット": "/tools/price-kit/price-kit.html",
    "外部AI案の比較": "/tools/price-kit/compare.html",
}
CATCH_JS = ROOT / "js" / "catch-design.js"
BACKUP_DIR = ROOT / "tools" / "designer-backup"
SAVE_PATH = "/api/catch-design"
MAX_BODY = 200_000
CATCH_HEADER = """// 金額キャッチのデザイン（tools/designer.html の「保存」で書き換わる。手で直してもよい）
// 座標は、写真の枠の右下を (0, 0) とした「デザイン単位」。左・上がマイナス。
// 大きさは fit.scale（写真の幅 1000px あたり、デザイン単位1つを何 px にするか）。
// ただしギザギザの高さが写真の高さの fit.maxH 倍を超えるときは、そこまで縮める。
"""


def save_catch_design(design):
    """デザインを js/catch-design.js へ書き、前の版を控え、試作キットを作り直す。(控えのパス, 注意) を返す。

    中身の細かい検査は編集画面が js/catch-check.js で済ませている。ここでは形だけ見る
    （壊れたものを書くと、アプリ全体が開かなくなるため）。
    """
    if not isinstance(design, dict) or design.get("version") != 1:
        raise ValueError("デザインの形が違います（version 1 ではありません）")
    for key in ("fit", "burst", "num", "yen", "tax"):
        if not isinstance(design.get(key), dict):
            raise ValueError(f"デザインに {key} がありません")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = BACKUP_DIR / f"catch-design.{stamp}.js"
    shutil.copy2(CATCH_JS, backup)
    text = CATCH_HEADER + "export const CATCH_DESIGN = " + json.dumps(design, ensure_ascii=False, indent=2) + ";\n"
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

    def do_POST(self):
        if self.path != SAVE_PATH:
            self.send_json(404, {"ok": False, "message": "ありません"})
            return
        # 書き換えはこの PC のブラウザから、編集画面を通したときだけ。
        # 独自の見出しを必須にすると、他のサイトからは（ブラウザの決まりで）送れない
        if self.client_address[0] not in ("127.0.0.1", "::1") or self.headers.get("X-SeikaPop") != "designer":
            self.send_json(403, {"ok": False, "message": "この PC の編集画面からだけ保存できます"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= MAX_BODY:
            self.send_json(413, {"ok": False, "message": "データが大きすぎるか空です"})
            return
        try:
            backup, note = save_catch_design(json.loads(self.rfile.read(length).decode("utf-8")))
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

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):  # Windows だけにある
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


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

    base = f"http://127.0.0.1:{PORT}"
    handler = functools.partial(NoCacheHandler, directory=str(ROOT))
    try:
        server = Server(("0.0.0.0" if args.lan else "127.0.0.1", PORT), handler)
    except OSError:
        # もう起動している（前の窓が開いたまま）なら、ブラウザだけ開く
        print(f"ポート {PORT} は使用中です。起動済みとみなしてブラウザだけ開きます。")
        print("（別のソフトが使っている場合は、そちらを止めてからやり直してください）")
        if not args.no_browser:
            webbrowser.open(base + PAGES["デザイン編集（金額キャッチ）"])
        return 1

    print("SeikaPop を起動しました。この窓を閉じると止まります。\n")
    for label, path in PAGES.items():
        print(f"  {label:<16} {base}{path}")
    if args.lan:
        ip = lan_address()
        print(f"\n  スマホから（同じ Wi-Fi）  http://{ip or '<この PC の IP アドレス>'}:{PORT}/")
        print("  ※ http なので共有ボタン・ホーム画面への追加は動きません（画像の保存で代わりになります）")
    print("\n直したら、ブラウザで再読み込み（F5）すれば反映されます。")

    if not args.no_browser:
        threading.Timer(0.5, lambda: [webbrowser.open(base + PAGES[k]) for k in ("デザイン編集（金額キャッチ）", "アプリ")]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
