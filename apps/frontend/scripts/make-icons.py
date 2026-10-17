"""Draw the app icons (PWA, home screen, favicon). Run from apps/worker, which already has Pillow:

    cd apps/worker && uv run python ../frontend/scripts/make-icons.py

The mark is a plain face outline with two brows. Icons are committed; this only regenerates them.
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public"
BACKGROUND = (25, 118, 210)  # the MUI primary the app already uses
WHITE = (255, 255, 255)
SCALE = 4  # draw large, shrink for smooth edges


def draw(size: int, *, safe: float) -> Image.Image:
    """``safe`` is the share of the canvas the mark may use (maskable icons need a wide margin)."""
    big = size * SCALE
    image = Image.new("RGB", (big, big), BACKGROUND)
    pen = ImageDraw.Draw(image)
    unit = big * safe
    cx = cy = big / 2
    # face
    face_w, face_h = unit * 0.5, unit * 0.66
    pen.ellipse(
        (cx - face_w / 2, cy - face_h / 2 + unit * 0.04, cx + face_w / 2, cy + face_h / 2 + unit * 0.04),
        outline=WHITE,
        width=int(unit * 0.045),
    )
    # brows sit inside the face, eyes below them
    width = int(unit * 0.045)
    for sign in (-1, 1):
        mid = cx + sign * unit * 0.125
        half = unit * 0.075
        pen.arc(
            (mid - half, cy - unit * 0.115, mid + half, cy - unit * 0.015),
            200,
            340,
            fill=WHITE,
            width=width,
        )
        eye = unit * 0.022
        pen.ellipse(
            (mid - eye, cy + unit * 0.045 - eye, mid + eye, cy + unit * 0.045 + eye), fill=WHITE
        )
    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    icons = OUT / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    draw(192, safe=0.9).save(icons / "icon-192.png")
    draw(512, safe=0.9).save(icons / "icon-512.png")
    draw(512, safe=0.62).save(icons / "icon-maskable-512.png")  # inside the 80% safe zone
    draw(180, safe=0.9).save(icons / "apple-touch-icon.png")


if __name__ == "__main__":
    main()
