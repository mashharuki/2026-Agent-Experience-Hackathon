"""Test doubles for the worker's ports. Bedrock and the Decider are MOCKS: results from
these tests say nothing about real model quality."""

import io
import json
from datetime import UTC, datetime, timedelta

from PIL import Image

from photoprep_worker.decider import Choice


class FixedClock:
    def __init__(self) -> None:
        self.current = datetime(2026, 10, 18, 9, 0, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.current

    def advance(self, **kw: float) -> None:
        self.current += timedelta(**kw)


def jpeg_bytes(size=(800, 600), color=(120, 90, 80), exif=False) -> bytes:
    image = Image.new("RGB", size, color)
    buffer = io.BytesIO()
    kwargs = {}
    if exif:
        exif_data = Image.Exif()
        exif_data[0x010F] = "SecretCameraMaker"  # Make
        exif_data[0x8825] = {1: "N", 2: (35.0, 41.0, 0.0)}  # GPS block
        kwargs["exif"] = exif_data
    image.save(buffer, "JPEG", **kwargs)
    return buffer.getvalue()


class FakeImages:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []

    def get(self, key: str) -> bytes | None:
        return self.objects.get(key)

    def delete(self, key: str) -> None:
        self.deleted.append(key)
        self.objects.pop(key, None)


GOOD_OBSERVATION = {
    "visible": ["眉の毛流れが一部乱れて見える"],
    "uncertain": [],
    "lighting": "good",
    "framing": "ok",
    "confidence": 0.8,
}


class FakeBedrock:
    """Returns queued texts in order; records every call (never the image bytes)."""

    def __init__(self, *texts: str) -> None:
        self.texts = list(texts)
        self.calls: list[dict] = []
        self.fail_on: int | None = None

    def converse(self, system: str, content: list[dict]) -> str:
        self.calls.append({"system": system, "content": content})
        if self.fail_on is not None and len(self.calls) == self.fail_on:
            raise RuntimeError("bedrock unavailable")
        return self.texts.pop(0)


def observation_text(**overrides) -> str:
    return json.dumps({**GOOD_OBSERVATION, **overrides}, ensure_ascii=False)


class FakeDecider:
    def __init__(self, selected="grooming_tip", confidence=0.85) -> None:
        self.selected = selected
        self.confidence = confidence
        self.states: list[str] = []
        self.fail = False

    def choose(self, state_text: str) -> Choice:
        self.states.append(state_text)
        if self.fail:
            raise RuntimeError("decider failed")
        others = [
            k
            for k in ("grooming_tip", "capture_setup_tip", "clarify", "offer_finish")
            if k != self.selected
        ]
        probs = {self.selected: 0.7, **{k: 0.1 for k in others}}
        return Choice(selected=self.selected, probabilities=probs, confidence=self.confidence)
