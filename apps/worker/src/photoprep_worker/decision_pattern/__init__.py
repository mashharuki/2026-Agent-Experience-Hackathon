"""Reusable Strands Decider 2B decision pattern (tag: #tool-selection).

    typed question  ->  Decider  ->  guards  ->  the ONE selected tool runs  ->  trace

* ``TypedQuestion``: the question and its described options (``question.py``).
* ``StrandsDecider``: asks the model, returns the option probabilities and a confidence
  (``decider.py``).
* ``Override`` / ``apply_guards``: ordinary code that can overrule the choice with a recorded
  reason (``guards.py``).
* ``run_decision``: wires every option to a handler and runs only the selected one
  (``binding.py``).

This package imports nothing from the rest of the app (a test enforces it): copy the
directory into another agent. See ``docs/decision-pattern.md`` and ``example.py``.
"""

from .binding import Decision, run_decision
from .decider import DEFAULT_CHECKPOINT, Choice, Decider, StrandsDecider, load_engine
from .eligibility import Eligibility
from .guards import Guard, Override, apply_guards
from .question import TypedQuestion

__all__ = [
    "DEFAULT_CHECKPOINT",
    "Choice",
    "Decider",
    "Decision",
    "Eligibility",
    "Guard",
    "Override",
    "StrandsDecider",
    "TypedQuestion",
    "apply_guards",
    "load_engine",
    "run_decision",
]
