"""金額の台紙（img/badges/*.png）を、元の絵 img/badges/source/*.png から作る。絵を足したら作り直す。

    python tools/make_badges.py

元の絵は白・黒・灰色など一色の背景に描いた台紙（文字は入っていない。透明の PNG でもよい）。背景の色は四隅の平均で決める。
外周から背景の色の画素をたどって透明にし、ふちに残るにじみは「背景の色に混ざった色」として抜く
（写真の上で背景の色の縁が出ないように）。
文字を置く枠は js/model.js の PRICE_BADGES に書く（元の絵の幅・高さに対する割合）。
"""
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "img" / "badges" / "source"
OUT = ROOT / "img" / "badges"
NEAR = 20  # 背景の色（四隅の色）からこれ以内の画素を背景とみなす


def cut_out(im: Image.Image) -> Image.Image:
    """外周につながった一色の背景を透明にする（大きさは変えない。枠の割合がずれないように）。"""
    if "A" in im.getbands() and im.getchannel("A").getextrema()[0] < 255:
        return im.convert("RGBA")  # もう透明になっている
    im = im.convert("RGB")
    w, h = im.size
    px = im.load()
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    ref = tuple(round(sum(c[i] for c in corners) / 4) for i in range(3))
    is_bg = lambda c: max(abs(v - r) for v, r in zip(c, ref)) <= NEAR
    # その色が背景の色からどれだけ離れているか（0＝背景そのもの、1＝その向きの端の色まで離れている）
    reach = lambda v, r: (v - r) / (255 - r) if v > r else (r - v) / r if v < r else 0
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
                a = max(reach(v, rf) for v, rf in zip((r, g, b), ref))
                if a <= 0.02:
                    po[x, y] = (0, 0, 0, 0)
                else:
                    un = lambda c, rf: max(0, min(255, round((c - (1 - a) * rf) / a)))
                    po[x, y] = (un(r, ref[0]), un(g, ref[1]), un(b, ref[2]), round(a * 255))
            else:
                po[x, y] = (r, g, b, 255)
    return out


for src in sorted(SRC.glob("*.png")):
    img = cut_out(Image.open(src))
    img.save(OUT / src.name, optimize=True)
    print(src.name, img.size, (OUT / src.name).stat().st_size // 1024, "KB")
