"""Deterministic guards between the Decider's choice and what is actually done.

The Decider is a model: in the T008 spike it chose ``grooming_tip`` even when the state
said "do not touch the brows". Rules about restrictions, limits and what cannot be seen
are therefore enforced here, in ordinary code, and every override is recorded.
"""

from dataclasses import dataclass

from photoprep_common.states import MAX_CHANGES

from .decider import Choice

_UNOBSERVABLE_LIGHTING = {"backlit", "dim", "uneven"}
_UNOBSERVABLE_FRAMING = {"too_small", "off_center", "cut_off", "no_face"}
_NO_TOUCH_FOR_SCOPE = {"brow": {"no_touch_brow"}, "bangs": {"no_touch_bangs"}}


@dataclass(frozen=True)
class GuardContext:
    scope: str
    restrictions: list[str]
    changes_used: int
    lighting: str
    framing: str


@dataclass(frozen=True)
class GuardResult:
    selected: str
    override: str | None


def apply_guards(choice: Choice, ctx: GuardContext, min_confidence: float = 0.0) -> GuardResult:
    """Only ``grooming_tip`` can do harm, so only it is ever replaced.

    ``min_confidence`` is 0 (off) until it is calibrated on evaluation data (T090): the 0.8
    first proposed would have rejected sensible choices in the spike (0.685, 0.688).
    """
    selected = choice.selected
    if selected != "grooming_tip":
        return GuardResult(selected, None)
    if ctx.changes_used >= MAX_CHANGES:
        return GuardResult("offer_finish", "change_limit")
    no_touch = {r for r in ctx.restrictions if r.startswith("no_touch_")}
    if ctx.scope == "look_first" and no_touch:
        return GuardResult("clarify", "restriction")
    if no_touch & _NO_TOUCH_FOR_SCOPE.get(ctx.scope, set()):
        return GuardResult("clarify", "restriction")
    if ctx.lighting in _UNOBSERVABLE_LIGHTING or ctx.framing in _UNOBSERVABLE_FRAMING:
        return GuardResult("capture_setup_tip", "unobservable")
    if min_confidence > 0 and choice.confidence < min_confidence:
        return GuardResult("clarify", "low_confidence")
    return GuardResult(selected, None)
