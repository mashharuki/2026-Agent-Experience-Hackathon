"""Ask Strands Decider 2B a typed ``choice`` question.

The Decider takes TEXT and answers with a probability per option plus a confidence. Call
shape verified against strands-decider 0.1.0: ``engine.ask(state, {name: ChoiceQuestion})``.
"""

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


class Decider(Protocol):
    def choose(self, state: str) -> Choice: ...


class StrandsDecider:
    def __init__(self, engine, question: TypedQuestion) -> None:
        self._engine = engine
        self._question = question
        self._asked = ChoiceQuestion(
            instructions=question.instructions, criteria=dict(question.options)
        )

    def choose(self, state: str) -> Choice:
        response = self._engine.ask(state, {self._question.name: self._asked})
        answer = response.answers[self._question.name]
        if answer.choice not in self._question.options:
            raise ValueError("the decider answered with an option outside the question")
        return Choice(
            selected=answer.choice,
            probabilities={k: float(v) for k, v in answer.probabilities.items()},
            confidence=float(answer.confidence),
        )


def load_engine(checkpoint: str = DEFAULT_CHECKPOINT, device: str = "cpu"):
    """Load the model once at start-up and reuse it (about 5.7 GB resident on CPU)."""
    from strands_decider.infer import load_engine as _load

    return _load(checkpoint, device=device)
