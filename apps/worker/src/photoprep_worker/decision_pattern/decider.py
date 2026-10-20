"""Ask Strands Decider 2B a typed ``choice`` question.

The Decider takes TEXT and answers with a probability per option plus a confidence. Call
shape verified against strands-decider 0.1.0: ``engine.ask(state, {name: ChoiceQuestion})``.
"""

import math
from dataclasses import dataclass
from typing import Protocol

from strands_decider.schema import ChoiceQuestion

from .question import TypedQuestion

DEFAULT_CHECKPOINT = "StrandsAgents/strands-decider-2B-qwen3.5-v1-2610"


@dataclass(frozen=True)
class Choice:
    selected: str
    probabilities: dict[str, float]
    confidence: float


def validate_choice(choice: Choice, question: TypedQuestion) -> None:
    """Reject corrupt scores, without filling missing keys or renormalizing."""
    if choice.selected not in question.options or set(choice.probabilities) != set(
        question.options
    ):
        raise ValueError("invalid_model_output")
    values = [*choice.probabilities.values(), choice.confidence]
    if any(not math.isfinite(v) or not 0 <= v <= 1 for v in values):
        raise ValueError("invalid_model_output")
    if abs(sum(choice.probabilities.values()) - 1) > 0.01:
        raise ValueError("invalid_model_output")
    if choice.probabilities[choice.selected] + 1e-9 < max(choice.probabilities.values()):
        raise ValueError("invalid_model_output")


class Decider(Protocol):
    def choose(self, state: str, *, question: TypedQuestion | None = None) -> Choice: ...


class StrandsDecider:
    def __init__(self, engine, question: TypedQuestion) -> None:
        self._engine = engine
        self._question = question
        self._asked = ChoiceQuestion(
            instructions=question.instructions, criteria=dict(question.options)
        )

    def choose(self, state: str, *, question: TypedQuestion | None = None) -> Choice:
        asked = question or self._question
        if question is not None and (
            (asked.name, asked.version, asked.instructions)
            != (self._question.name, self._question.version, self._question.instructions)
            or any(self._question.options.get(k) != v for k, v in asked.options.items())
        ):
            raise ValueError("question_mismatch")
        payload = (
            ChoiceQuestion(instructions=asked.instructions, criteria=dict(asked.options))
            if question is not None
            else self._asked
        )
        response = self._engine.ask(state, {asked.name: payload})
        try:
            answer = response.answers[asked.name]
            choice = Choice(
                selected=answer.choice,
                probabilities={k: float(v) for k, v in answer.probabilities.items()},
                confidence=float(answer.confidence),
            )
            validate_choice(choice, asked)
            return choice
        except (AttributeError, KeyError, TypeError, ValueError, OverflowError):
            raise ValueError("invalid_model_output") from None


def load_engine(checkpoint: str = DEFAULT_CHECKPOINT, device: str = "cpu"):
    """Load the model once at start-up and reuse it (about 5.7 GB resident on CPU)."""
    from strands_decider.infer import load_engine as _load

    return _load(checkpoint, device=device)
