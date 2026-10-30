"""Render English and Chinese promotional tiles from the store logo."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "store"
LOGO = OUT / "logo-300x300.png"

LATIN_BOLD = Path("C:/Windows/Fonts/segoeuib.ttf")
LATIN_REG = Path("C:/Windows/Fonts/segoeui.ttf")
CJK_BOLD = Path("C:/Windows/Fonts/msyhbd.ttc")
CJK_REG = Path("C:/Windows/Fonts/msyh.ttc")


def load_font(path: Path, size: int):
    try:
        return ImageFont.truetype(str(path), size)
    except OSError:
        return ImageFont.load_default()


def tile(size, logo_px, title_px, sub_px, note_px, title, sub, note, fonts):
    bold, reg, small = fonts
    w, h = size
    img = Image.new("RGB", size, (11, 16, 32))
    d = ImageDraw.Draw(img)

    band_top = int(h * 0.62)
    band_h = max(6, int(h * 0.035))
    for i in range(band_h):
        t = i / max(1, band_h - 1)
        d.line(
            [(0, band_top + i), (w, band_top + i)],
            fill=(int(56 + 69 * t), int(189 + 22 * t), int(248 + 4 * t)),
        )

    logo = Image.open(LOGO).convert("RGBA").resize((logo_px, logo_px), Image.LANCZOS)
    img.paste(logo, (int(w * 0.08), (h - logo_px) // 2), logo)

    left = int(w * 0.08) + logo_px + int(w * 0.05)
    top = int(h * 0.26)
    d.text((left, top), title, font=bold, fill=(229, 231, 235))
    d.text((left, top + int(title_px * 1.35)), sub, font=reg, fill=(203, 213, 225))
    d.text(
        (left, top + int(title_px * 1.35) + int(sub_px * 1.8)),
        note,
        font=small,
        fill=(148, 163, 184),
    )
    return img


def fonts_for(bold_path, reg_path, title_px, sub_px, note_px):
    return (
        load_font(bold_path, title_px),
        load_font(reg_path, sub_px),
        load_font(reg_path, note_px),
    )


OUT.mkdir(parents=True, exist_ok=True)

tile(
    (440, 280), 96, 27, 14, 9,
    "FocusLine", "Read one line at a time.", "Web pages and PDFs  ·  Free",
    fonts_for(LATIN_BOLD, LATIN_REG, 27, 14, 9),
).save(OUT / "promo-440x280.png")
tile(
    (1400, 560), 260, 84, 34, 20,
    "FocusLine", "Read one line at a time.",
    "Web pages and PDFs  ·  No account  ·  No permission warnings",
    fonts_for(LATIN_BOLD, LATIN_REG, 84, 34, 20),
).save(OUT / "promo-1400x560.png")

tile(
    (440, 280), 96, 25, 14, 9,
    "FocusLine", "只留你正在读的那一行", "网页和 PDF  ·  免费",
    fonts_for(CJK_BOLD, CJK_REG, 25, 14, 9),
).save(OUT / "promo-zh-440x280.png")
tile(
    (1400, 560), 260, 76, 32, 19,
    "FocusLine", "只留你正在读的那一行",
    "网页和 PDF  ·  无需账号  ·  安装无权限警告",
    fonts_for(CJK_BOLD, CJK_REG, 76, 32, 19),
).save(OUT / "promo-zh-1400x560.png")

print("promo tiles written to", OUT)
