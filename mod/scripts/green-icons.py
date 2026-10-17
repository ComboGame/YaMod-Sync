"""Перекрашивает иконки клиента Яндекс Музыки в зелёный акцент мода.

Звезда клиента жёлтая на тёмном фоне. Каждый пиксель раскладывается на «тёмную
основу» и долю жёлтого в нём; жёлтая доля заменяется той же долей зелёного —
так сохраняются и фон, и сглаженные края. Результат кладётся в mod/branding/,
откуда его берёт патчер (patcher.ts, шаг «Ресурсы»).

    python scripts/green-icons.py <папка assets собранного клиента>

Нужен Pillow. Перезапускать только при смене иконки клиента или акцента.
"""

import sys
from pathlib import Path

from PIL import Image

GREEN = (0x1B, 0xD9, 0x6A)


def yellow_of(image: Image.Image) -> tuple[int, int, int]:
    """Самый яркий насыщенно-жёлтый пиксель: эталон «чистой» звезды."""
    best, score = (255, 220, 0), -1
    for r, g, b, a in image.getdata():
        if a < 250:
            continue
        s = min(r, g) - b
        if s > score:
            best, score = (r, g, b), s
    return best


def recolor(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    yellow = yellow_of(image)
    span = max(1, min(yellow[0], yellow[1]) - yellow[2])
    out = []
    for r, g, b, a in image.getdata():
        t = max(0.0, min(1.0, (min(r, g) - b) / span))
        out.append(
            tuple(max(0, min(255, round(c - t * y + t * n))) for c, y, n in zip((r, g, b), yellow, GREEN)) + (a,)
        )
    result = Image.new("RGBA", image.size)
    result.putdata(out)
    return result


def main() -> None:
    assets = Path(sys.argv[1])
    target = Path(__file__).resolve().parent.parent / "branding"
    (target / "icons").mkdir(parents=True, exist_ok=True)

    ico = Image.open(assets / "icon.ico")
    sizes = sorted(ico.info.get("sizes", {(256, 256)}))
    big = recolor(ico.convert("RGBA").resize((256, 256), Image.LANCZOS) if ico.size != (256, 256) else ico)
    big.save(target / "icon.png")
    big.save(target / "icon.ico", sizes=sizes)

    for png in sorted((assets / "icons").glob("*.png")):
        recolor(Image.open(png)).save(target / "icons" / png.name)
    print(f"готово: {target}")


if __name__ == "__main__":
    main()
