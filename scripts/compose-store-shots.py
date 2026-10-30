"""Compose the captured screenshots into 1280x800 store shots with captions."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "docs" / "store" / "raw"
OUT = ROOT / "docs" / "store"

W, H = 1280, 800
CAPTION_H = 56
APP_H = H - CAPTION_H
FONT = Path("C:/Windows/Fonts/segoeuib.ttf")

SHOTS = [
    ("pdf-content.png", "01-pdf-reading.png", "Works on PDFs — line, dim and colour guide", "center"),
    ("line-dark.png", "02-reading-line.png", "One line. Everything else fades.", "right"),
    ("guide.png", "03-colour-guide.png", "Colour guide: words or sentences", "right"),
    ("pdf-reader.png", "04-reader-controls.png", "Open a link, drop a file, or paste a URL", "right"),
]


def font(size: int):
    try:
        return ImageFont.truetype(str(FONT), size)
    except OSError:
        return ImageFont.load_default()


def crop_to_aspect(img: Image.Image, aspect: float, anchor: str) -> Image.Image:
    w, h = img.size
    if w / h > aspect:
        new_w = int(h * aspect)
        if anchor == "right":
            left = w - new_w
        elif anchor == "left":
            left = 0
        else:
            left = (w - new_w) // 2
        return img.crop((left, 0, left + new_w, h))
    new_h = int(w / aspect)
    top = (h - new_h) // 2
    return img.crop((0, top, w, top + new_h))


caption_font = font(26)
for source, target, caption, anchor in SHOTS:
    shot = Image.open(RAW / source).convert("RGB")
    # The captures include the page scrollbars; drop them before cropping.
    shot = shot.crop((0, 0, shot.width - 16, shot.height - 10))
    app = crop_to_aspect(shot, W / APP_H, anchor)
    app = app.resize((W, APP_H), Image.LANCZOS)

    canvas = Image.new("RGB", (W, H), (11, 16, 32))
    canvas.paste(app, (0, 0))

    draw = ImageDraw.Draw(canvas)
    draw.line([(0, APP_H), (W, APP_H)], fill=(30, 41, 59), width=1)

    bbox = draw.textbbox((0, 0), caption, font=caption_font)
    text_w = bbox[2] - bbox[0]
    draw.text(
        ((W - text_w) / 2 - bbox[0], APP_H + (CAPTION_H - (bbox[3] - bbox[1])) / 2 - bbox[1]),
        caption,
        font=caption_font,
        fill=(203, 213, 225),
    )

    canvas.save(OUT / target, optimize=True)
    print("wrote", target)
