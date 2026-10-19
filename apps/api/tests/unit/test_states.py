"""T027: the session state machine and its invariants (data-model.md)."""

import pytest

from photoprep_api.errors import AppError
from photoprep_api.states import (
    MAX_ANALYSES,
    MAX_CHANGES,
    State,
    check_can_request_analysis,
    check_can_start_change,
    phase_for,
    state_after_job,
)


def test_limits_match_the_spec():
    assert MAX_CHANGES == 2  # FR-007
    assert MAX_ANALYSES == 3  # FR-022


@pytest.mark.parametrize(
    ("state", "phase"),
    [
        (State.CONSULTING, "before"),
        (State.CAPTURE_ADJUST, "before"),
        (State.ADVICE_SHOWN, "before"),  # "another suggestion"
        (State.TRYING, "after"),  # "I tidied up, please check"
    ],
)
def test_analysis_allowed_in_state_with_matching_phase(state, phase):
    assert phase_for(state) == phase
    check_can_request_analysis(state, phase, analyses_used=0)


@pytest.mark.parametrize("state", [State.ANALYZING, State.COMPARING, State.DONE])
def test_analysis_never_allowed_while_analyzing_or_done(state):
    with pytest.raises(AppError) as err:
        check_can_request_analysis(state, "before", analyses_used=0)
    assert err.value.status == 409
    assert err.value.code == ("session_ended" if state is State.DONE else "conflict")


def test_wrong_phase_for_state_is_a_conflict():
    with pytest.raises(AppError) as err:
        check_can_request_analysis(State.TRYING, "before", analyses_used=1)
    assert (err.value.status, err.value.code) == (409, "conflict")


def test_no_new_advice_while_trying():
    """FR-004: while the user is tidying up, only the 'after' check is possible."""
    assert phase_for(State.TRYING) == "after"


def test_analysis_limit_is_three():
    check_can_request_analysis(State.CONSULTING, "before", analyses_used=MAX_ANALYSES - 1)
    with pytest.raises(AppError) as err:
        check_can_request_analysis(State.CONSULTING, "before", analyses_used=MAX_ANALYSES)
    assert (err.value.status, err.value.code) == (429, "analysis_limit_reached")


def test_the_comparison_needs_no_new_analysis_for_one_more_try():
    """The 'after' check already produced the next suggestion, so two changes fit in 3 analyses."""
    with pytest.raises(AppError) as err:
        check_can_request_analysis(State.COMPARING, "before", analyses_used=1)
    assert (err.value.status, err.value.code) == (409, "conflict")


def test_one_more_change_from_the_comparison_needs_a_next_suggestion_and_a_change_left():
    check_can_start_change(State.COMPARING, changes_used=1, last_advice_kind="grooming_tip")
    for kind in ("clarify", "offer_finish", "capture_setup_tip", None):
        with pytest.raises(AppError) as err:
            check_can_start_change(State.COMPARING, changes_used=1, last_advice_kind=kind)
        assert (err.value.status, err.value.code) == (409, "conflict")
    with pytest.raises(AppError) as err:
        check_can_start_change(
            State.COMPARING, changes_used=MAX_CHANGES, last_advice_kind="grooming_tip"
        )
    assert (err.value.status, err.value.code) == (409, "change_limit_reached")


@pytest.mark.parametrize("state", [State.CONSULTING, State.TRYING, State.ANALYZING, State.DONE])
def test_starting_a_change_only_from_advice(state):
    with pytest.raises(AppError):
        check_can_start_change(state, changes_used=0)


def test_third_change_is_refused():
    check_can_start_change(State.ADVICE_SHOWN, changes_used=MAX_CHANGES - 1)
    with pytest.raises(AppError) as err:
        check_can_start_change(State.ADVICE_SHOWN, changes_used=MAX_CHANGES)
    assert (err.value.status, err.value.code) == (409, "change_limit_reached")


@pytest.mark.parametrize(
    ("kind", "phase", "comparable", "expected"),
    [
        ("grooming_tip", "before", None, State.ADVICE_SHOWN),
        ("capture_setup_tip", "before", None, State.CAPTURE_ADJUST),
        ("clarify", "before", None, State.CLARIFYING),
        ("offer_finish", "before", None, State.DONE),
        ("grooming_tip", "after", True, State.COMPARING),
        ("clarify", "after", True, State.COMPARING),
        ("grooming_tip", "after", False, State.CAPTURE_ADJUST),  # light changed too much: retake
        ("offer_finish", "after", True, State.COMPARING),  # the user still gets to compare
        ("offer_finish", "after", False, State.CAPTURE_ADJUST),
    ],
)
def test_state_after_a_finished_job(kind, phase, comparable, expected):
    assert state_after_job(kind, phase, comparable) is expected


def test_unknown_advice_kind_is_rejected():
    with pytest.raises(ValueError):
        state_after_job("do_anything", "before", None)
