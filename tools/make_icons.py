"""アプリのアイコン（icons/*.png）を、元の絵 icons/source/badge.png から作る。絵を替えたら作り直す。

    python tools/make_icons.py

元の絵は黒い背景の丸いバッジ。外周から黒い画素をたどって透明にする
（内側の濃い輪郭線は外とつながっていないので残る）。
"""
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "icons" / "source" / "badge.png"
OUT = ROOT / "icons"
DARK = 60  # これより暗い画素を背景とみなす
WHITE = (255, 255, 255, 255)


def cut_out(im: Image.Image) -> Image.Image:
    """外周につながった黒い背景を透明にして、絵の部分だけに切り詰める。"""
    im = im.convert("RGB")
    w, h = im.size
    px = im.load()
    bg = bytearray(w * h)
    q = deque([(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)])
    while q:
        x, y = q.popleft()
        i = y * w + x
        if bg[i] or max(px[x, y]) >= DARK:
            continue
        bg[i] = 1
        if x > 0: q.append((x - 1, y))
        if x < w - 1: q.append((x + 1, y))
        if y > 0: q.append((x, y - 1))
        if y < h - 1: q.append((x, y + 1))
    alpha = Image.frombytes("L", (w, h), bytes(0 if b else 255 for b in bg))
    # ふちのギザギザと黒いにじみを抑える: 少し削ってからぼかす
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    rgba = im.convert("RGBA")
    rgba.putalpha(alpha)
    return rgba.crop(rgba.getbbox())


def square(img: Image.Image, size: int, scale: float, bg=None) -> Image.Image:
    """size 四方の中央に、幅の scale 倍で置く。"""
    canvas = Image.new("RGBA", (size, size), bg or (0, 0, 0, 0))
    r = img.copy()
    side = round(size * scale)
    r.thumbnail((side, side), Image.LANCZOS)
    canvas.alpha_composite(r, ((size - r.width) // 2, (size - r.height) // 2))
    return canvas


def save(img: Image.Image, name: str, opaque: bool = False) -> None:
    # 256色に減らす（そのままだと 512px で 300KB を超え、初回の読み込みが重い）
    if opaque:
        img = img.convert("RGB").quantize(256, dither=Image.Dither.NONE)
    else:
        img = img.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    img.save(OUT / name, optimize=True)
    print(name, (OUT / name).stat().st_size // 1024, "KB")


badge = cut_out(Image.open(SRC))
save(square(badge, 32, 1.0), "favicon-32.png")
save(square(badge, 192, 1.0), "icon-192.png")
save(square(badge, 512, 1.0), "icon-512.png")
# iPhone は透明を黒く塗るので白地（角は iPhone が丸める）
save(square(badge, 180, 0.92, WHITE), "icon-180.png", opaque=True)
# Android の maskable は端が切られる（安全なのは中央の直径 80%）ので白地に小さめ
save(square(badge, 512, 0.78, WHITE), "icon-maskable-512.png", opaque=True)
