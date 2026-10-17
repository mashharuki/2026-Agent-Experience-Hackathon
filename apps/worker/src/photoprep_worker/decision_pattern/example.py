"""A runnable, self-contained example of the pattern (also executed by the tests).

Scenario: a support agent must pick ONE tool for each request: look in the docs, ask the
user a question, or hand over to a person. The "decider" here is a scripted stand-in so
the example runs anywhere; swap in ``StrandsDecider(load_engine(), QUESTION)`` for the real
model.
"""

from dataclasses import dataclass

from .binding import run_decision
from .decider import Choice
from .guards import Override
from .question import TypedQuestion

QUESTION = TypedQuestion(
    name="route_request",
    version="v1",
    instructions="Which tool should handle this support request?",
    options={
        "search_docs": "the answer is probably in the documentation",
        "ask_user": "the request is unclear or missing details; ask the user",
        "escalate": "the user is upset, or the request involves money or account access",
    },
)


@dataclass
class Request:
    text: str
    contains_payment_data: bool = False


def payment_data_always_escalates(choice: Choice, request: Request) -> Override | None:
    """A rule that must hold whatever the model says."""
    if request.contains_payment_data and choice.selected != "escalate":
        return Override("escalate", "payment_data")
    return None


class ScriptedDecider:
    """Stands in for the model; maps a request to a choice."""

    def __init__(self, request: Request) -> None:
        self._request = request

    def choose(self, state: str) -> Choice:
        text = self._request.text
        picked = "ask_user" if "?" not in text else "search_docs"
        if "refund" in text:
            picked = "escalate"
        probabilities = {option: 0.1 for option in QUESTION.options}
        probabilities[picked] = 0.8
        return Choice(selected=picked, probabilities=probabilities, confidence=0.8)


def demo() -> list[dict]:
    requests = [
        Request("How do I reset my password?"),
        Request("it does not work"),
        Request("I want a refund"),
        Request("How do I change my card number?", contains_payment_data=True),
    ]
    outcomes = []
    for request in requests:
        ran: list[str] = []

        def tool(name: str, ran: list[str] = ran, text: str = request.text) -> str:
            ran.append(name)
            return f"{name} handled: {text}"

        decision = run_decision(
            decider=ScriptedDecider(request),
            question=QUESTION,
            state=f"request: {request.text}",
            guards=[payment_data_always_escalates],
            context=request,
            handlers={option: (lambda n=option: tool(n)) for option in QUESTION.options},
        )
        outcomes.append(
            {
                "request": request.text,
                "decider_choice": decision.decider_choice,
                "selected": decision.selected,
                "override_reason": decision.override_reason,
                "ran": ran,
            }
        )
    return outcomes


if __name__ == "__main__":
    for outcome in demo():
        print(outcome)
