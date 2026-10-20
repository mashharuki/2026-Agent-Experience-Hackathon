"""Session states and the rules both the API and the worker must agree on."""

from enum import StrEnum

MAX_CHANGES = 2
MAX_ANALYSES = 3

ADVICE_KINDS = ("grooming_tip", "capture_setup_tip", "clarify", "offer_finish")


class State(StrEnum):
    CONSULTING = "CONSULTING"
    CLARIFYING = "CLARIFYING"
    ANALYZING = "ANALYZING"
    ADVICE_SHOWN = "ADVICE_SHOWN"
    CAPTURE_ADJUST = "CAPTURE_ADJUST"
    TRYING = "TRYING"
    COMPARING = "COMPARING"
    DONE = "DONE"


def state_after_job(kind: str, phase: str, comparable: bool | None) -> State:
    """Where the session goes when an analysis job finishes successfully."""
    if kind not in ADVICE_KINDS:
        raise ValueError(f"unknown advice kind: {kind}")
    if phase == "after":
        if kind == "offer_finish" and not comparable:
            return State.DONE
        # The user just tidied up: they always get to compare, even when no further change
        # is offered (offer_finish). If light or position changed too much to compare, ask
        # for a retake instead of judging.
        return State.COMPARING if comparable else State.CAPTURE_ADJUST
    if kind == "offer_finish":
        return State.DONE
    return {
        "grooming_tip": State.ADVICE_SHOWN,
        "capture_setup_tip": State.CAPTURE_ADJUST,
        "clarify": State.CLARIFYING,
    }[kind]
