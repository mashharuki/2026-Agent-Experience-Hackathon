"""Label-blind baselines. The real backend receives only rendered facts and a question."""

from photoprep_worker.decision_inputs import DecisionInputs
from photoprep_worker.decision_pattern import Choice


def rules_choice(inputs: DecisionInputs) -> str:
    if (
        inputs.analyses_used >= 3
        or inputs.changes_used >= 2
        or {"no_touch_brow", "no_touch_bangs"}.issubset(inputs.restrictions)
    ):
        return "offer_finish"
    observation = inputs.observation
    if observation.lighting in {"backlit", "dim", "uneven"} or observation.framing in {
        "too_small",
        "off_center",
        "cut_off",
        "no_face",
    }:
        return "capture_setup_tip"
    restricted = f"no_touch_{inputs.scope}" in inputs.restrictions
    if (
        restricted
        or inputs.scope == "look_first"
        or not observation.visible
        or observation.uncertain
    ):
        return "clarify"
    return "grooming_tip"


class FixedDecider:
    def __init__(self, selected: str):
        self.selected = selected

    def choose(self, state: str, *, question=None) -> Choice:
        options = (
            question.options
            if question
            else ("grooming_tip", "capture_setup_tip", "clarify", "offer_finish")
        )
        return Choice(
            self.selected,
            {k: float(k == self.selected) for k in options},
            1.0,
        )
