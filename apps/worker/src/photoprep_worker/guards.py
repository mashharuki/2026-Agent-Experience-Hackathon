"""This app's guards for the "next support" decision.

The Decider is a model: in the T008 spike it chose ``grooming_tip`` even when the state
said "do not touch the brows". Rules about restrictions, limits and what cannot be seen
are therefore enforced here, in ordinary code, and every override is recorded. The
mechanics (``Override``, ``apply_guards``) come from the reusable ``decision_pattern``.
"""

from dataclasses import dataclass

from photoprep_common.states import MAX_CHANGES

from .decision_pattern import Choice, Guard, Override
from .decision_pattern import apply_guards as run_guards

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


# Only "grooming_tip" can do harm (it tells a person to do something), so only it is guarded.


def change_limit(choice: Choice, ctx: GuardContext) -> Override | None:
    if choice.selected == "grooming_tip" and ctx.changes_used >= MAX_CHANGES:
        return Override("offer_finish", "change_limit")
    return None


def restriction(choice: Choice, ctx: GuardContext) -> Override | None:
    if choice.selected != "grooming_tip":
        return None
    no_touch = {r for r in ctx.restrictions if r.startswith("no_touch_")}
    if (ctx.scope == "look_first" and no_touch) or no_touch & _NO_TOUCH_FOR_SCOPE.get(
        ctx.scope, set()
    ):
        return Override("clarify", "restriction")
    return None


def unobservable(choice: Choice, ctx: GuardContext) -> Override | None:
    if choice.selected == "grooming_tip" and (
        ctx.lighting in _UNOBSERVABLE_LIGHTING or ctx.framing in _UNOBSERVABLE_FRAMING
    ):
        return Override("capture_setup_tip", "unobservable")
    return None


def low_confidence(minimum: float) -> Guard:
    """Off (0) until calibrated on evaluation data (T090): the 0.8 first proposed would have
    rejected sensible choices in the spike (0.685, 0.688)."""

    def guard(choice: Choice, ctx: GuardContext) -> Override | None:  # noqa: ARG001
        if minimum > 0 and choice.selected == "grooming_tip" and choice.confidence < minimum:
            return Override("clarify", "low_confidence")
        return None

    return guard


def guards_for(min_confidence: float = 0.0) -> list[Guard]:
    """In priority order: limit, then restriction, then what cannot be seen, then confidence."""
    return [change_limit, restriction, unobservable, low_confidence(min_confidence)]


def apply_guards(choice: Choice, ctx: GuardContext, min_confidence: float = 0.0) -> GuardResult:
    selected, reason = run_guards(choice, guards_for(min_confidence), ctx)
    return GuardResult(selected, reason)
