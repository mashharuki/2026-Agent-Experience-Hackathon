"""T111: advice follows the session language (FR-028). Observation and Decider input stay internal."""

import re

import pytest

from photoprep_worker.explain import build_advice
from photoprep_worker.pipeline import process_job
from photoprep_worker.schemas import Observation
from tests.conftest import JOB, SESSION
from tests.fakes import FakeBedrock

JAPANESE = re.compile(r"[ぁ-んァ-ン一-龥]")


def obs(**kw):
    base = {"visible": [], "uncertain": [], "lighting": "good", "framing": "ok", "confidence": 0.9}
    return Observation(**{**base, **kw})


def advice_text(kind, language, **kw):
    ctx = {
        "scope": "brow",
        "wish": None,
        "restrictions": [],
        "phase": "before",
        "language": language,
    }
    text, _ = build_advice(
        kind, kw.pop("observation", obs()), FakeBedrock("Brush the brows."), **{**ctx, **kw}
    )
    return text.text


@pytest.mark.parametrize("reason", ["backlit", "dim", "uneven"])
def test_lighting_tips_are_english_without_japanese(reason):
    assert not JAPANESE.search(
        advice_text("capture_setup_tip", "en", observation=obs(lighting=reason))
    )


@pytest.mark.parametrize("reason", ["too_small", "off_center", "cut_off", "no_face"])
def test_framing_tips_are_english_without_japanese(reason):
    assert not JAPANESE.search(
        advice_text("capture_setup_tip", "en", observation=obs(framing=reason))
    )


def test_default_capture_tip_and_not_comparable_prefix_are_english():
    text = advice_text("capture_setup_tip", "en", phase="after", comparable=False)
    assert text and not JAPANESE.search(text)
    assert advice_text("capture_setup_tip", "ja", phase="after", comparable=False) != text


@pytest.mark.parametrize("scope", ["brow", "bangs", "look_first"])
def test_clarify_questions_are_english(scope):
    assert not JAPANESE.search(advice_text("clarify", "en", scope=scope))


def test_clarify_when_the_range_is_restricted_is_english():
    text = advice_text("clarify", "en", scope="brow", restrictions=["no_touch_brow"])
    assert text and not JAPANESE.search(text)


def test_finish_is_english():
    assert not JAPANESE.search(advice_text("offer_finish", "en"))


def test_japanese_stays_japanese_by_default():
    assert JAPANESE.search(advice_text("offer_finish", "ja"))
    ctx = {"scope": "brow", "wish": None, "restrictions": [], "phase": "before"}
    text, _ = build_advice("offer_finish", obs(), FakeBedrock(), **ctx)  # no language: ja
    assert JAPANESE.search(text.text)


def test_the_explanation_prompt_asks_for_english_and_carries_english_labels():
    bedrock = FakeBedrock("Brush the brows.")
    ctx = {"scope": "brow", "wish": "neat", "restrictions": ["no_touch_bangs"], "phase": "before"}
    build_advice("grooming_tip", obs(visible=["messy brows"]), bedrock, language="en", **ctx)
    call = bedrock.calls[0]
    assert "English" in call["system"] and not JAPANESE.search(call["system"])
    assert not JAPANESE.search(call["content"][0]["text"])


def test_the_pipeline_uses_the_language_saved_on_the_session(world):
    world.seed()
    world.store.update(f"SESSION#{SESSION}", "META", set={"language": "en"})
    process_job(world.deps, JOB)
    explain_call = world.bedrock.calls[1]
    assert "English" in explain_call["system"]
