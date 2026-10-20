from types import SimpleNamespace

import pytest

from photoprep_worker.decider import NEXT_SUPPORT
from photoprep_worker.decision_pattern import StrandsDecider, run_decision


class Engine:
    def __init__(self, answer):
        self.answer = answer

    def ask(self, state, questions):
        return SimpleNamespace(answers={"next_support": self.answer})


def answer(**changes):
    return SimpleNamespace(
        **(
            dict(
                choice="grooming_tip",
                confidence=0.7,
                probabilities=dict(
                    grooming_tip=0.7, capture_setup_tip=0.1, clarify=0.1, offer_finish=0.1
                ),
            )
            | changes
        )
    )


@pytest.mark.parametrize(
    "change",
    [
        dict(choice="unknown"),
        dict(confidence=None),
        dict(probabilities=None),
        dict(confidence=float("nan")),
        dict(confidence=float("inf")),
        dict(confidence=-0.1),
        dict(confidence=1.1),
        dict(probabilities=dict(grooming_tip=1.0)),
        dict(
            probabilities=dict(
                grooming_tip=0.7, capture_setup_tip=0.1, clarify=0.1, offer_finish=0.1, extra=0.0
            )
        ),
        dict(
            probabilities=dict(
                grooming_tip=float("nan"), capture_setup_tip=0.1, clarify=0.1, offer_finish=0.1
            )
        ),
        dict(
            probabilities=dict(
                grooming_tip=-0.1, capture_setup_tip=0.9, clarify=0.1, offer_finish=0.1
            )
        ),
        dict(
            probabilities=dict(
                grooming_tip=0.4, capture_setup_tip=0.1, clarify=0.1, offer_finish=0.1
            )
        ),
        dict(
            probabilities=dict(
                grooming_tip=0.1, capture_setup_tip=0.7, clarify=0.1, offer_finish=0.1
            )
        ),
    ],
)
def test_invalid_model_output_executes_zero_handlers(change):
    called = []
    with pytest.raises(ValueError):
        run_decision(
            decider=StrandsDecider(Engine(answer(**change)), NEXT_SUPPORT),
            question=NEXT_SUPPORT,
            state="synthetic",
            context=None,
            guards=[],
            handlers={kind: (lambda k=kind: called.append(k)) for kind in NEXT_SUPPORT.options},
        )
    assert called == []


def test_tied_maximum_is_valid_without_renormalizing_probabilities():
    probabilities = dict(grooming_tip=0.4, capture_setup_tip=0.4, clarify=0.1, offer_finish=0.1)
    result = StrandsDecider(Engine(answer(probabilities=probabilities)), NEXT_SUPPORT).choose(
        "synthetic"
    )
    assert result.probabilities == probabilities
