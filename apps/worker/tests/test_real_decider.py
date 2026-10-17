"""Smoke test with the REAL Strands Decider 2B weights (slow: ~80 s to load on CPU).

Skipped unless RUN_REAL_DECIDER=1. It checks the adapter against the real engine, not
decision quality: five synthetic states give a feel for the behaviour, nothing more.
"""

import json
import os

import pytest

from photoprep_worker.decider import CRITERIA, build_state_text, load_strands_decider
from photoprep_worker.guards import GuardContext, apply_guards
from photoprep_worker.schemas import Observation
from tests.fakes import observation_text

pytestmark = [
    pytest.mark.real_model,
    pytest.mark.skipif(os.environ.get("RUN_REAL_DECIDER") != "1", reason="set RUN_REAL_DECIDER=1"),
]


@pytest.fixture(scope="module")
def decider():
    return load_strands_decider(device="cpu")


def observation(**kw) -> Observation:
    return Observation.model_validate(json.loads(observation_text(**kw)))


def state(**kw) -> str:
    base = dict(
        scope="brow",
        wish=None,
        restrictions=[],
        observation=observation(),
        tools=[],
        changes_used=0,
        phase="before",
        last_advice=None,
    )
    return build_state_text(**{**base, **kw})


def test_the_adapter_works_with_the_real_engine(decider):
    choice = decider.choose(
        state(wish="眉の形は変えたくないが毛流れは整えたい", tools=["眉ブラシ"])
    )
    assert choice.selected in CRITERIA
    assert set(choice.probabilities) == set(CRITERIA)
    assert abs(sum(choice.probabilities.values()) - 1.0) < 0.01
    assert 0.0 <= choice.confidence <= 1.0


def test_guards_hold_even_if_the_real_model_ignores_a_restriction(decider):
    text = state(restrictions=["no_touch_brow"], wish="眉には触れたくない")
    choice = decider.choose(text)
    result = apply_guards(
        choice,
        GuardContext(
            scope="brow",
            restrictions=["no_touch_brow"],
            changes_used=0,
            lighting="good",
            framing="ok",
        ),
    )
    assert result.selected != "grooming_tip"
    print(
        f"decider chose {choice.selected} ({choice.confidence:.2f}); after guards: {result.selected}"
    )
