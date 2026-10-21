"""PC で SeikaPop を開く（デザイン作業用のローカルサーバー）。

    python tools/serve.py          # 起動してブラウザでアプリと見本帳を開く
    python tools/serve.py --lan    # 同じ Wi-Fi のスマホからも見られるようにする

python -m http.server と違い、ブラウザにファイルを控えさせない（Cache-Control: no-store）。
控えられると、JS やデザインを直してもブラウザが古いまま表示し、直したのに変わらないように見える。
"""
import argparse
import functools
import http.server
import socket
import sys
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8765
PAGES = {
    "アプリ": "/",
    "見本帳（全デザイン×全サイズ）": "/tools/gallery.html",
    "金額キャッチの試作キット": "/tools/price-kit/price-kit.html",
    "外部AI案の比較": "/tools/price-kit/compare.html",
}


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
            webbrowser.open(base + PAGES["アプリ"])
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
        threading.Timer(0.5, lambda: [webbrowser.open(base + PAGES[k]) for k in ("アプリ", "見本帳（全デザイン×全サイズ）")]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
