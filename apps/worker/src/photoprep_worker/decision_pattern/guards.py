"""Guards: ordinary code that can overrule the model's choice, with a recorded reason.

A model's choice is advice, not authority. Rules that must always hold (limits, user
restrictions, what can and cannot be known) belong here, not in a prompt.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from .decider import Choice


@dataclass(frozen=True)
class Override:
    option: str  # the option to run instead
    reason: str  # a short stable code, recorded with the decision


Guard = Callable[[Choice, Any], Override | None]


def apply_guards(choice: Choice, guards: Sequence[Guard], context: Any) -> tuple[str, str | None]:
    """Return ``(option to run, override reason or None)``. The first override wins."""
    for guard in guards:
        override = guard(choice, context)
        if override is not None:
            return override.option, override.reason
    return choice.selected, None
