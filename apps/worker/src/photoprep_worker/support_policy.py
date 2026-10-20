"""Execution feasibility, not a prediction of which support the person prefers."""

from photoprep_common.states import MAX_ANALYSES, MAX_CHANGES

from .decision_inputs import DecisionInputs
from .decision_pattern import Eligibility


def support_eligibility(inputs: DecisionInputs) -> Eligibility:
    if inputs.analyses_used >= MAX_ANALYSES:
        return Eligibility(("offer_finish",), "analysis_limit")
    if inputs.changes_used >= MAX_CHANGES:
        return Eligibility(("offer_finish",), "change_limit")
    if {"no_touch_brow", "no_touch_bangs"}.issubset(inputs.restrictions):
        return Eligibility(("offer_finish",), "restriction")

    observation = inputs.observation
    restricted = (
        f"no_touch_{inputs.scope}" in inputs.restrictions
        or inputs.scope == "look_first"
        and any(r.startswith("no_touch_") for r in inputs.restrictions)
    )
    evidence = any(value.strip() for value in observation.visible)
    poor_capture = observation.lighting != "good" or observation.framing != "ok"
    incomparable = inputs.phase == "after" and inputs.comparable is not True
    allowed = []
    if evidence and not restricted and not poor_capture and not incomparable:
        allowed.append("grooming_tip")
    if poor_capture or incomparable:
        allowed.append("capture_setup_tip")
    if inputs.phase == "before" and not inputs.clarified:
        allowed.append("clarify")
    allowed.append("offer_finish")
    reason = (
        "restriction"
        if restricted
        else "unobservable"
        if poor_capture or incomparable
        else "insufficient_evidence"
        if not evidence
        else "available_support"
    )
    if len(allowed) == 1 and inputs.clarified:
        reason = "clarification_limit"
    return Eligibility(tuple(allowed), reason)
