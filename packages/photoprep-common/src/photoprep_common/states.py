"""Session states and the rules both the API and the worker must agree on."""

from enum import StrEnum

MAX_CHANGES = 2
MAX_ANALYSES = 3

ADVICE_KINDS = ("grooming_tip", "capture_setup_tip", "clarify", "offer_finish")


class State(StrEnum):
    CONSULTING = "CONSULTING"
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
