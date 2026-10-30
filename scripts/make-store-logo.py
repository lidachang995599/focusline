"""Render the store logo (300x300) from the same artwork as the extension icon."""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "docs" / "store"
OUT.mkdir(parents=True, exist_ok=True)

S = 1200
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)


def sx(value: float) -> int:
    return int(round(value * S / 512))


# Rounded tile
d.rounded_rectangle(
    [sx(8), sx(8), S - sx(8), S - sx(8)], radius=sx(112), fill=(11, 16, 32, 255)
)
d.rounded_rectangle(
    [sx(8), sx(8), S - sx(8), S - sx(8)],
    radius=sx(112),
    outline=(30, 41, 59, 255),
    width=sx(6),
)

# Reading band
band_top, band_bottom = sx(206), sx(306)
for i in range(band_bottom - band_top):
    t = i / max(1, (band_bottom - band_top - 1))
    r = int(56 + (125 - 56) * t)
    g = int(189 + (211 - 189) * t)
    b = int(248 + (252 - 248) * t)
    d.line([(sx(14), band_top + i), (S - sx(14), band_top + i)], fill=(r, g, b, 255))

# Soft glow above and below the band
for offset, alpha in ((14, 40), (10, 60), (6, 80)):
    d.rectangle(
        [sx(14), band_top - sx(offset), S - sx(14), band_top - 1],
        fill=(125, 211, 252, alpha),
    )
    d.rectangle(
        [sx(14), band_bottom + 1, S - sx(14), band_bottom + sx(offset)],
        fill=(125, 211, 252, alpha),
    )

# Handle dot, hinting the band is draggable
d.rounded_rectangle(
    [S - sx(120), sx(232), S - sx(64), sx(280)],
    radius=sx(22),
    fill=(15, 23, 42, 235),
    outline=(148, 163, 184, 210),
    width=sx(4),
)

img.resize((300, 300), Image.LANCZOS).save(OUT / "logo-300x300.png")
print("logo written to", OUT / "logo-300x300.png")
