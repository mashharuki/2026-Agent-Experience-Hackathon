"""PR review: the generated advice is checked in code, not only asked for in the prompt (FR-008)."""

import pytest

from photoprep_worker.explain import ExplainError, build_advice
from photoprep_worker.schemas import Observation
from tests.fakes import FakeBedrock

OBS = Observation(visible=[], uncertain=[], lighting="good", framing="ok", confidence=0.9)


def advise(text, *, language="en", scope="brow", restrictions=()):
    ctx = {"scope": scope, "wish": None, "restrictions": list(restrictions), "phase": "before"}
    advice, _ = build_advice("grooming_tip", OBS, FakeBedrock(text), language=language, **ctx)
    return advice.text


def refused(text, **kw):
    with pytest.raises(ExplainError):
        advise(text, **kw)


class TestAlwaysForbidden:
    @pytest.mark.parametrize(
        "text",
        [
            "Trim your brows a little to even them out.",
            "You could pluck the stray hairs.",
            "Use tweezers on the outer edge.",
            "Shave the gap between them.",
            "A bit of makeup would help.",
            "Buy a brow gel for this.",
            "Cut the bangs a little shorter.",
        ],
    )
    def test_english(self, text):
        refused(text)

    @pytest.mark.parametrize(
        "text",
        [
            "眉を少しカットしてみましょう。",
            "はみ出した毛を抜いてみましょう。",
            "余分な部分を剃ってそろえます。",
            "アイブロウでメイクをして整えましょう。",
            "専用のジェルを購入してみてください。",
            "前髪を切ってみましょう。",
        ],
    )
    def test_japanese(self, text):
        refused(text, language="ja")

    def test_a_gentle_undoable_suggestion_passes(self):
        assert advise("Gently brush your bangs back with your fingers.", scope="bangs")
        assert advise("眉ブラシで毛の流れをそろえてみましょう。", language="ja")


class TestExplicitRestrictions:
    def test_no_touch_brow_means_no_mention_of_the_brows_even_for_another_scope(self):
        refused(
            "Smooth your bangs, then brush your brows too.",
            scope="bangs",
            restrictions=["no_touch_brow"],
        )
        refused(
            "眉も一緒に整えましょう。", language="ja", scope="bangs", restrictions=["no_touch_brow"]
        )

    def test_no_touch_bangs_means_no_mention_of_the_bangs(self):
        refused("Brush your brows, then lift your bangs.", restrictions=["no_touch_bangs"])
        refused("前髪も軽く持ち上げましょう。", language="ja", restrictions=["no_touch_bangs"])

    def test_keep_brow_shape_rules_out_reshaping_but_allows_smoothing_the_hair_direction(self):
        refused("Reshape your brows to a softer arch.", restrictions=["keep_brow_shape"])
        refused("Make your brows thinner at the tail.", restrictions=["keep_brow_shape"])
        refused(
            "眉の形を整えて、アーチを作りましょう。",
            language="ja",
            restrictions=["keep_brow_shape"],
        )
        assert advise(
            "Brush the hairs in one direction, keeping the shape.", restrictions=["keep_brow_shape"]
        )

    def test_a_restriction_does_not_affect_unrelated_advice(self):
        assert advise(
            "Gently brush your bangs back.", scope="bangs", restrictions=["keep_brow_shape"]
        )

    def test_a_refusal_is_an_error_not_canned_advice(self):
        with pytest.raises(ExplainError):
            advise("Trim them.")
