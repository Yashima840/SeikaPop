"""金額の台紙（img/badges/*.png）を、元の絵 img/badges/source/*.png から作る。絵を足したら作り直す。

    python tools/make_badges.py

元の絵は白か黒の背景に描いた台紙（文字は入っていない。透明の PNG でもよい）。背景の色は四隅で見分ける。
外周から背景の色の画素をたどって透明にし、ふちに残るにじみは「背景の色に混ざった色」として抜く
（写真の上で白や黒の縁が出ないように）。
文字を置く枠は js/model.js の PRICE_BADGES に書く（元の絵の幅・高さに対する割合）。
"""
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "img" / "badges" / "source"
OUT = ROOT / "img" / "badges"
NEAR = 20  # 背景の色（白か黒）からこれ以内の画素を背景とみなす


def cut_out(im: Image.Image) -> Image.Image:
    """外周につながった白か黒の背景を透明にする（大きさは変えない。枠の割合がずれないように）。"""
    if "A" in im.getbands() and im.getchannel("A").getextrema()[0] < 255:
        return im.convert("RGBA")  # もう透明になっている
    im = im.convert("RGB")
    w, h = im.size
    px = im.load()
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    white = sum(sum(c) for c in corners) > 4 * 3 * 128
    ref = 255 if white else 0
    is_bg = lambda c: max(abs(v - ref) for v in c) <= NEAR
    bg = bytearray(w * h)
    q = deque([(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)])
    while q:
        x, y = q.popleft()
        i = y * w + x
        if bg[i] or not is_bg(px[x, y]):
            continue
        bg[i] = 1
        if x > 0: q.append((x - 1, y))
        if x < w - 1: q.append((x + 1, y))
        if y > 0: q.append((x, y - 1))
        if y < h - 1: q.append((x, y + 1))
    mask = Image.frombytes("L", (w, h), bytes(255 if b else 0 for b in bg))
    # 背景のすぐ内側（ふち）だけ、背景の色との混ざり具合から透明度を戻す
    edge = mask.filter(ImageFilter.MaxFilter(5)).load()
    out = Image.new("RGBA", (w, h))
    po = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if bg[y * w + x]:
                po[x, y] = (0, 0, 0, 0)
            elif edge[x, y]:
                a = 1 - min(r, g, b) / 255 if white else max(r, g, b) / 255
                if a <= 0.02:
                    po[x, y] = (0, 0, 0, 0)
                else:
                    un = lambda c: max(0, min(255, round((c - (1 - a) * ref) / a)))
                    po[x, y] = (un(r), un(g), un(b), round(a * 255))
            else:
                po[x, y] = (r, g, b, 255)
    return out


for src in sorted(SRC.glob("*.png")):
    img = cut_out(Image.open(src))
    img.save(OUT / src.name, optimize=True)
    print(src.name, img.size, (OUT / src.name).stat().st_size // 1024, "KB")
