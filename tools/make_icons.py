"""アプリのアイコン（icons/icon-*.png）を作る。見た目を変えたら作り直す。

    python tools/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = "C:/Windows/Fonts/YuGothB.ttc"


def make(size: int) -> Image.Image:
    k = size / 512
    im = Image.new("RGB", (size, size), "#2f7d43")
    d = ImageDraw.Draw(im)
    # maskable のため、大事な絵は中央 80% に収める
    d.ellipse([96 * k, 96 * k, 416 * k, 416 * k], fill="#ffd23f")
    d.ellipse([112 * k, 112 * k, 400 * k, 400 * k], outline="#ffffff", width=max(1, int(8 * k)))
    font = ImageFont.truetype(FONT, int(190 * k))
    d.text((256 * k, 262 * k), "旬", font=font, fill="#d32f2f", anchor="mm")
    return im


for s in (180, 192, 512):
    make(s).save(ROOT / "icons" / f"icon-{s}.png", optimize=True)
    print("icon", s)
