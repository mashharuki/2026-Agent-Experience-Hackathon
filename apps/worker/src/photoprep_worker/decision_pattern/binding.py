"""The wiring that puts the decision in the agent's path: option -> handler.

Every option of the question must have a handler, and ONLY the selected option's handler
runs. That is what makes the model's choice a real decision rather than a log line.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .decider import Choice, Decider, validate_choice
from .eligibility import Eligibility
from .guards import Guard, apply_guards
from .question import TypedQuestion


@dataclass(frozen=True)
class Decision[R]:
    """What was asked, what the model said, what actually ran, and its result."""

    question_version: str
    decider_choice: str | None
    selected: str
    override_reason: str | None
    probabilities: dict[str, float] | None
    confidence: float | None
    result: R
    decision_source: str
    eligible_options: tuple[str, ...]
    policy_reason: str | None


def run_decision[R](
    *,
    decider: Decider,
    question: TypedQuestion,
    state: str,
    guards: Sequence[Guard],
    context: Any,
    handlers: Mapping[str, Callable[[], R]],
    eligibility: Eligibility | None = None,
) -> Decision[R]:
    if set(handlers) != set(question.options):
        raise ValueError("handlers must cover exactly the question's options")
    allowed = eligibility.allowed if eligibility else tuple(question.options)
    if not set(allowed).issubset(question.options):
        raise ValueError("eligibility_outside_question")
    if len(allowed) == 1:
        selected = allowed[0]
        return Decision(
            question_version=question.version,
            decider_choice=None,
            selected=selected,
            override_reason=None,
            probabilities=None,
            confidence=None,
            result=handlers[selected](),
            decision_source="policy",
            eligible_options=allowed,
            policy_reason=eligibility.reason,
        )
    asked = TypedQuestion(
        question.name,
        question.version,
        question.instructions,
        {k: v for k, v in question.options.items() if k in allowed},
    )
    choice: Choice = (
        decider.choose(state, question=asked) if eligibility else decider.choose(state)
    )  # a failure propagates: no guess, no default
    validate_choice(choice, asked)
    selected, reason = apply_guards(choice, guards, context)
    if selected not in allowed:
        raise ValueError(f"a guard chose an option outside the question: {selected!r}")
    return Decision(
        question_version=question.version,
        decider_choice=choice.selected,
        selected=selected,
        override_reason=reason,
        probabilities=dict(choice.probabilities),
        confidence=choice.confidence,
        result=handlers[selected](),
        decision_source="model",
        eligible_options=allowed,
        policy_reason=eligibility.reason if eligibility else None,
    )
