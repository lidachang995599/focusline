"""Generate FocusLine icons (a dark tile with a bright reading band)."""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

S = 512
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Rounded tile
d.rounded_rectangle([8, 8, S - 8, S - 8], radius=112, fill=(11, 16, 32, 255))

# Dimmed top / bottom wash (slightly lighter than the tile so the band pops)
d.rounded_rectangle([8, 8, S - 8, S - 8], radius=112, outline=(30, 41, 59, 255), width=6)

# Reading band
band_top, band_bottom = 206, 306
for i in range(band_bottom - band_top):
    t = i / max(1, (band_bottom - band_top - 1))
    r = int(56 + (125 - 56) * t)
    g = int(189 + (211 - 189) * t)
    b = int(248 + (252 - 248) * t)
    d.line([(14, band_top + i), (S - 14, band_top + i)], fill=(r, g, b, 255))

# Soft glow above and below the band
for offset, alpha in ((14, 40), (10, 60), (6, 80)):
    d.rectangle([14, band_top - offset, S - 14, band_top - 1], fill=(125, 211, 252, alpha))
    d.rectangle([14, band_bottom + 1, S - 14, band_bottom + offset], fill=(125, 211, 252, alpha))

# Small handle dot on the right, hinting the band is draggable
d.rounded_rectangle([S - 120, 232, S - 64, 280], radius=22, fill=(15, 23, 42, 235), outline=(148, 163, 184, 210), width=4)

for size in (16, 32, 48, 128):
    resized = img.resize((size, size), Image.LANCZOS)
    resized.save(OUT / f"{size}.png")

print("icons written to", OUT)
