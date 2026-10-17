"""Session state machine (data-model.md, FR-004, FR-007, FR-022).

Pure functions: no I/O. The store applies the same rules atomically with conditional
updates; these checks produce the right error before a write is attempted.
"""

from enum import StrEnum

from .errors import AppError

MAX_CHANGES = 2
MAX_ANALYSES = 3


class State(StrEnum):
    CONSULTING = "CONSULTING"
    ANALYZING = "ANALYZING"
    ADVICE_SHOWN = "ADVICE_SHOWN"
    CAPTURE_ADJUST = "CAPTURE_ADJUST"
    TRYING = "TRYING"
    COMPARING = "COMPARING"
    DONE = "DONE"


# The photo phase each state can submit for analysis. While TRYING only the "after"
# check is possible, so no new advice is generated while the user is tidying up (FR-004).
_ANALYSIS_PHASE: dict[State, str] = {
    State.CONSULTING: "before",
    State.CAPTURE_ADJUST: "before",
    State.ADVICE_SHOWN: "before",  # "another suggestion"
    State.TRYING: "after",
    State.COMPARING: "before",  # one more try starts from the latest photo
}

ADVICE_KINDS = ("grooming_tip", "capture_setup_tip", "clarify", "offer_finish")


def phase_for(state: State) -> str | None:
    return _ANALYSIS_PHASE.get(state)


def check_can_request_analysis(
    state: State, phase: str, *, analyses_used: int, changes_used: int
) -> None:
    if state is State.DONE:
        raise AppError(409, "session_ended")
    expected = _ANALYSIS_PHASE.get(state)
    if expected is None or expected != phase:
        raise AppError(409, "conflict")
    if state is State.COMPARING and changes_used >= MAX_CHANGES:
        raise AppError(409, "change_limit_reached")
    if analyses_used >= MAX_ANALYSES:
        raise AppError(429, "analysis_limit_reached")


def check_can_start_change(state: State, *, changes_used: int) -> None:
    if state is State.DONE:
        raise AppError(409, "session_ended")
    if state is not State.ADVICE_SHOWN:
        raise AppError(409, "conflict")
    if changes_used >= MAX_CHANGES:
        raise AppError(409, "change_limit_reached")


def state_after_job(kind: str, phase: str, comparable: bool | None) -> State:
    """Where the session goes when an analysis job finishes successfully."""
    if kind not in ADVICE_KINDS:
        raise ValueError(f"unknown advice kind: {kind}")
    if kind == "offer_finish":
        return State.DONE
    if phase == "after":
        # Light or position changed too much to compare: ask for a retake, never judge.
        return State.COMPARING if comparable else State.CAPTURE_ADJUST
    return {
        "grooming_tip": State.ADVICE_SHOWN,
        "capture_setup_tip": State.CAPTURE_ADJUST,
        "clarify": State.CONSULTING,
    }[kind]
