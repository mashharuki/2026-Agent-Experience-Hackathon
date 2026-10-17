"""Validate and sanitise an uploaded photo before it goes to a model."""

import io
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_BYTES = 2 * 1024 * 1024
MAX_PIXELS = 25_000_000  # decompression-bomb guard (a 2 MiB PNG can decode to gigabytes)
MAX_EDGE = 1568  # larger images cost more tokens without helping the observation
ALLOWED_FORMATS = {"JPEG", "PNG"}

Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class ImageError(Exception):
    """The upload is not an acceptable image."""


@dataclass(frozen=True)
class PreparedImage:
    data: bytes  # JPEG, metadata stripped
    width: int
    height: int


def prepare_image(raw: bytes) -> PreparedImage:
    if not raw or len(raw) > MAX_BYTES:
        raise ImageError("size")
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            if probe.format not in ALLOWED_FORMATS:
                raise ImageError("format")
            if probe.width * probe.height > MAX_PIXELS:
                raise ImageError("pixels")
            image = ImageOps.exif_transpose(probe)  # honour rotation, then drop all metadata
            image = image.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, SyntaxError) as err:
        raise ImageError("decode") from err
    image.thumbnail((MAX_EDGE, MAX_EDGE))
    out = io.BytesIO()
    image.save(out, "JPEG", quality=85)  # no exif= argument: nothing is carried over
    return PreparedImage(data=out.getvalue(), width=image.width, height=image.height)
