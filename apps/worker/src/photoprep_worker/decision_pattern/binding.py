"""The wiring that puts the decision in the agent's path: option -> handler.

Every option of the question must have a handler, and ONLY the selected option's handler
runs. That is what makes the model's choice a real decision rather than a log line.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .decider import Choice, Decider
from .guards import Guard, apply_guards
from .question import TypedQuestion


@dataclass(frozen=True)
class Decision[R]:
    """What was asked, what the model said, what actually ran, and its result."""

    question_version: str
    decider_choice: str
    selected: str
    override_reason: str | None
    probabilities: dict[str, float]
    confidence: float
    result: R


def run_decision[R](
    *,
    decider: Decider,
    question: TypedQuestion,
    state: str,
    guards: Sequence[Guard],
    context: Any,
    handlers: Mapping[str, Callable[[], R]],
) -> Decision[R]:
    if set(handlers) != set(question.options):
        raise ValueError("handlers must cover exactly the question's options")
    choice: Choice = decider.choose(state)  # a failure propagates: no guess, no default
    selected, reason = apply_guards(choice, guards, context)
    if selected not in question.options:
        raise ValueError(f"a guard chose an option outside the question: {selected!r}")
    return Decision(
        question_version=question.version,
        decider_choice=choice.selected,
        selected=selected,
        override_reason=reason,
        probabilities=dict(choice.probabilities),
        confidence=choice.confidence,
        result=handlers[selected](),
    )
