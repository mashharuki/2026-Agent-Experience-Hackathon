"""T040/T042: schemas reject malformed model output; images are validated and sanitised."""

import io

import pytest
from PIL import Image
from pydantic import ValidationError

from photoprep_worker.images import MAX_BYTES, ImageError, prepare_image
from photoprep_worker.schemas import Advice, DecisionRecord, Observation
from tests.fakes import GOOD_OBSERVATION, jpeg_bytes


class TestObservation:
    def test_valid(self):
        assert Observation.model_validate(GOOD_OBSERVATION).lighting == "good"

    @pytest.mark.parametrize(
        "patch",
        [
            {"lighting": "sunny"},
            {"framing": "perfect"},
            {"confidence": 1.5},
            {"confidence": -0.1},
            {"visible": ["x"] * 7},
            {"visible": ["あ" * 121]},
            {"unexpected": 1},
            {"visible": "not a list"},
        ],
    )
    def test_malformed_output_is_rejected(self, patch):
        with pytest.raises(ValidationError):
            Observation.model_validate({**GOOD_OBSERVATION, **patch})


class TestAdvice:
    def test_text_limit_matches_the_api_contract(self):
        Advice(kind="grooming_tip", text="あ" * 400, basis="observation")
        with pytest.raises(ValidationError):
            Advice(kind="grooming_tip", text="あ" * 401, basis="observation")

    def test_only_the_four_documented_kinds(self):
        with pytest.raises(ValidationError):
            Advice(kind="buy_cream", text="x", basis="observation")


class TestDecisionRecord:
    def test_cannot_carry_images_or_free_text(self):
        fields = set(DecisionRecord.model_fields)
        assert not {"image", "photo", "wish", "text", "observation", "bytes"} & fields
        with pytest.raises(ValidationError):
            DecisionRecord(
                job_id="j",
                session_id="s",
                question_version="v1",
                probabilities={"clarify": 1.0},
                confidence=0.5,
                decider_choice="clarify",
                selected="clarify",
                guard_override=None,
                invoked=["none"],
                created_at="2026-10-18T09:00:00+00:00",
                image=b"x",
            )


class TestPrepareImage:
    def test_jpeg_is_accepted_and_returned_as_jpeg(self):
        prepared = prepare_image(jpeg_bytes())
        assert prepared.data[:2] == b"\xff\xd8" and (prepared.width, prepared.height) == (800, 600)

    def test_png_is_accepted(self):
        buffer = io.BytesIO()
        Image.new("RGB", (100, 100), (1, 2, 3)).save(buffer, "PNG")
        assert prepare_image(buffer.getvalue()).data[:2] == b"\xff\xd8"

    def test_metadata_is_stripped(self):
        raw = jpeg_bytes(exif=True)
        assert b"SecretCameraMaker" in raw  # the fixture really carries EXIF
        prepared = prepare_image(raw)
        assert b"SecretCameraMaker" not in prepared.data
        assert len(Image.open(io.BytesIO(prepared.data)).getexif()) == 0

    def test_large_images_are_downscaled(self):
        prepared = prepare_image(jpeg_bytes(size=(4000, 3000)))
        assert max(prepared.width, prepared.height) <= 1568

    @pytest.mark.parametrize(
        "raw", [b"", b"not an image", b"GIF89a" + b"\x00" * 50, b"\xff\xd8\xff" + b"\x00" * 10]
    )
    def test_non_images_are_rejected(self, raw):
        with pytest.raises(ImageError):
            prepare_image(raw)

    def test_oversized_files_are_rejected_before_decoding(self):
        with pytest.raises(ImageError):
            prepare_image(b"\xff\xd8\xff" + b"0" * MAX_BYTES)

    def test_gif_is_not_an_allowed_format(self):
        buffer = io.BytesIO()
        Image.new("RGB", (10, 10)).save(buffer, "GIF")
        with pytest.raises(ImageError):
            prepare_image(buffer.getvalue())

    def test_decompression_bombs_are_rejected(self):
        buffer = io.BytesIO()
        Image.new("L", (9000, 9000)).save(buffer, "PNG")  # 81 MP, tiny file
        assert len(buffer.getvalue()) < MAX_BYTES
        with pytest.raises(ImageError):
            prepare_image(buffer.getvalue())
