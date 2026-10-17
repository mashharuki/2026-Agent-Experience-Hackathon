"""T045: deterministic guards over the Decider's choice (FR-007, FR-008, FR-011)."""

import pytest

from photoprep_worker.decider import Choice
from photoprep_worker.guards import GuardContext, apply_guards


def choice(selected, confidence=0.9):
    return Choice(selected=selected, probabilities={selected: 1.0}, confidence=confidence)


def ctx(**kw):
    base = dict(scope="brow", restrictions=[], changes_used=0, lighting="good", framing="ok")
    return GuardContext(**{**base, **kw})


def test_a_clean_choice_passes_through_untouched():
    result = apply_guards(choice("grooming_tip"), ctx())
    assert (result.selected, result.override) == ("grooming_tip", None)


@pytest.mark.parametrize("kind", ["capture_setup_tip", "clarify", "offer_finish"])
def test_safe_kinds_are_never_overridden(kind):
    result = apply_guards(
        choice(kind), ctx(restrictions=["no_touch_brow"], changes_used=2, lighting="backlit")
    )
    assert result.selected == kind and result.override is None


def test_no_third_change_is_proposed():
    result = apply_guards(choice("grooming_tip"), ctx(changes_used=2))
    assert (result.selected, result.override) == ("offer_finish", "change_limit")


def test_a_brow_tip_is_blocked_when_the_user_will_not_touch_the_brow():
    """The T008 spike: the Decider still chose grooming_tip for this exact situation."""
    result = apply_guards(choice("grooming_tip", 0.419), ctx(restrictions=["no_touch_brow"]))
    assert (result.selected, result.override) == ("clarify", "restriction")


def test_a_restriction_on_another_area_does_not_block():
    assert (
        apply_guards(choice("grooming_tip"), ctx(restrictions=["no_touch_bangs"])).override is None
    )


def test_look_first_with_any_no_touch_restriction_asks_instead_of_guessing():
    result = apply_guards(
        choice("grooming_tip"), ctx(scope="look_first", restrictions=["no_touch_bangs"])
    )
    assert (result.selected, result.override) == ("clarify", "restriction")


def test_keep_brow_shape_is_enforced_in_the_explanation_not_by_blocking():
    assert (
        apply_guards(choice("grooming_tip"), ctx(restrictions=["keep_brow_shape"])).override is None
    )


@pytest.mark.parametrize(
    ("lighting", "framing"),
    [
        ("backlit", "ok"),
        ("dim", "ok"),
        ("uneven", "ok"),
        ("good", "too_small"),
        ("good", "no_face"),
        ("good", "cut_off"),
    ],
)
def test_no_judging_what_cannot_be_seen(lighting, framing):
    result = apply_guards(choice("grooming_tip"), ctx(lighting=lighting, framing=framing))
    assert (result.selected, result.override) == ("capture_setup_tip", "unobservable")


def test_unknown_conditions_do_not_block_on_their_own():
    assert (
        apply_guards(choice("grooming_tip"), ctx(lighting="unknown", framing="unknown")).override
        is None
    )


def test_low_confidence_asks_only_when_a_threshold_is_configured():
    weak = choice("grooming_tip", 0.4)
    assert apply_guards(weak, ctx()).override is None  # no threshold chosen yet (T090 decides)
    result = apply_guards(weak, ctx(), min_confidence=0.5)
    assert (result.selected, result.override) == ("clarify", "low_confidence")


def test_priority_limit_then_restriction_then_unobservable_then_confidence():
    everything = ctx(changes_used=2, restrictions=["no_touch_brow"], lighting="backlit")
    assert (
        apply_guards(choice("grooming_tip", 0.1), everything, min_confidence=0.9).override
        == "change_limit"
    )
    no_limit = ctx(restrictions=["no_touch_brow"], lighting="backlit")
    assert (
        apply_guards(choice("grooming_tip", 0.1), no_limit, min_confidence=0.9).override
        == "restriction"
    )
