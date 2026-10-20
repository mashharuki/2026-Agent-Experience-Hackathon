"""Execution constraints hold independently of a model's preferred action."""

from types import SimpleNamespace

import pytest

from photoprep_worker.decider import NEXT_SUPPORT
from photoprep_worker.decision_inputs import DecisionInputs
from photoprep_worker.decision_pattern import Eligibility, StrandsDecider, run_decision
from photoprep_worker.support_policy import support_eligibility
from tests.fakes import GOOD_OBSERVATION


def inputs(**patch):
    return DecisionInputs.model_validate(
        dict(
            scope="brow",
            observation=GOOD_OBSERVATION,
            changes_used=0,
            analyses_used=1,
            phase="before",
        )
        | patch
    )


@pytest.mark.parametrize(
    "patch",
    [
        {"analyses_used": 3},
        {"changes_used": 2},
        {"restrictions": ["no_touch_brow", "no_touch_bangs"]},
    ],
)
def test_hard_limits_leave_only_finish(patch):
    assert support_eligibility(inputs(**patch)).allowed == ("offer_finish",)


@pytest.mark.parametrize(
    "patch",
    [
        {"observation": GOOD_OBSERVATION | {"visible": []}},
        {"observation": GOOD_OBSERVATION | {"visible": ["  "]}},
        {"observation": GOOD_OBSERVATION | {"lighting": "unknown"}},
        {"restrictions": ["no_touch_brow"]},
        {"scope": "look_first", "restrictions": ["no_touch_bangs"]},
        {"phase": "after", "comparable": False},
    ],
)
def test_no_grooming_without_evidence_permission_or_comparable_conditions(patch):
    assert "grooming_tip" not in support_eligibility(inputs(**patch)).allowed


def test_answered_question_cannot_repeat_but_a_supported_tip_is_still_possible():
    policy = support_eligibility(inputs(clarified=True))
    assert "clarify" not in policy.allowed and "grooming_tip" in policy.allowed
    empty = GOOD_OBSERVATION | {"visible": [], "uncertain": ["insufficient"]}
    assert support_eligibility(inputs(clarified=True, observation=empty)).allowed == (
        "offer_finish",
    )


class Engine:
    def __init__(self, selected="clarify", corrupt=False):
        self.selected, self.corrupt, self.calls = selected, corrupt, []

    def ask(self, state, questions):
        criteria = questions["next_support"].criteria
        self.calls.append(tuple(criteria))
        probabilities = dict.fromkeys(criteria, 0.0)
        probabilities[self.selected] = 1.0
        if self.corrupt:
            probabilities["grooming_tip"] = 0.0
        answer = SimpleNamespace(choice=self.selected, probabilities=probabilities, confidence=1)
        return SimpleNamespace(answers={"next_support": answer})


def decide(engine, policy, ran):
    return run_decision(
        decider=StrandsDecider(engine, NEXT_SUPPORT),
        question=NEXT_SUPPORT,
        state="synthetic",
        eligibility=policy,
        context=None,
        guards=[],
        handlers={k: (lambda kind=k: ran.append(kind)) for k in NEXT_SUPPORT.options},
    )


def test_only_permitted_options_reach_model_and_one_real_choice_runs():
    engine, ran = Engine(), []
    decision = decide(engine, Eligibility(("clarify", "offer_finish"), "restriction"), ran)
    assert engine.calls == [("clarify", "offer_finish")]
    assert ran == ["clarify"] and decision.decider_choice == "clarify"
    assert decision.decision_source == "model"
    assert set(decision.probabilities) == {"clarify", "offer_finish"}


def test_forced_finish_has_no_model_call_or_invented_scores():
    engine, ran = Engine(), []
    decision = decide(engine, Eligibility(("offer_finish",), "analysis_limit"), ran)
    assert engine.calls == [] and ran == ["offer_finish"]
    assert decision.decision_source == "policy" and decision.policy_reason == "analysis_limit"
    assert decision.probabilities is decision.confidence is decision.decider_choice is None


def test_corrupt_response_cannot_execute_even_a_safe_handler():
    engine, ran = Engine(corrupt=True), []
    with pytest.raises(ValueError):
        decide(engine, Eligibility(("clarify", "offer_finish"), "restriction"), ran)
    assert ran == []


@pytest.mark.parametrize("allowed", [(), ("unknown",), ("clarify", "clarify")])
def test_invalid_candidate_configuration_fails_before_inference(allowed):
    engine, ran = Engine(), []
    with pytest.raises(ValueError):
        decide(engine, Eligibility(allowed, "invalid"), ran)
    assert engine.calls == [] and ran == []


@pytest.mark.parametrize(
    "phase,comparable,expected_state",
    [
        ("before", None, "DONE"),
        ("after", True, "COMPARING"),
        ("after", False, "DONE"),
    ],
)
def test_final_analysis_skips_decider_and_never_leaves_an_impossible_retake(
    world, phase, comparable, expected_state
):
    from photoprep_worker.pipeline import Outcome, process_job
    from tests.conftest import JOB, SESSION
    from tests.fakes import observation_text

    world.seed(phase=phase, baseline={"lighting": "good", "framing": "ok"})
    world.store.update(f"SESSION#{SESSION}", "META", set={"analysesUsed": 3})
    if comparable is False:
        world.bedrock.texts[0] = observation_text(lighting="dim")
    world.decider.fail = True
    assert process_job(world.deps, JOB) == Outcome.DONE
    assert world.session()["state"] == expected_state
    assert world.decider.states == [] and len(world.bedrock.calls) == 1
    record = world.decision()
    assert record["decision_source"] == "policy" and record["policy_reason"] == "analysis_limit"
    assert record["probabilities"] is record["confidence"] is record["decider_choice"] is None


def test_empty_observation_never_generates_a_grooming_explanation(world):
    from photoprep_worker.pipeline import Outcome, process_job
    from tests.conftest import JOB
    from tests.fakes import observation_text

    world.seed()
    world.bedrock.texts[0] = observation_text(visible=[" "], uncertain=["insufficient"])
    assert process_job(world.deps, JOB) == Outcome.DONE
    assert world.job()["result"]["kind"] == "clarify"
    assert len(world.bedrock.calls) == 1


def test_worker_rejects_a_model_returning_an_excluded_action(world):
    from photoprep_worker.decision_pattern import Choice
    from photoprep_worker.pipeline import Outcome, process_job
    from tests.conftest import JOB, KEY

    class Invalid:
        def choose(self, state, *, question):
            assert "grooming_tip" not in question.options
            return Choice("grooming_tip", {"grooming_tip": 1.0}, 1.0)

    world.seed(restrictions=["no_touch_brow"])
    world.deps.decider = Invalid()
    assert process_job(world.deps, JOB) == Outcome.FAILED
    assert len(world.bedrock.calls) == 1 and KEY not in world.images.objects
    assert world.decision() is None


@pytest.mark.parametrize("version", ["v3", "v4"])
def test_code_decision_is_not_counted_as_model_accuracy_or_inference(version):
    from pathlib import Path

    from evaluation.metrics import summarize
    from evaluation.runner import trial
    from evaluation.schemas import load_cases

    cases = load_cases(Path(__file__).parents[1] / "evaluation/policy-cases")[0]
    case = next(c for c in cases if c.case_id == "policy-dev-final-dark")
    row = trial(case, "decider", version, 0, engine=None)
    assert row.status == "ok" and row.decision_source == "policy"
    assert row.raw_choice is row.probabilities is row.confidence is None
    summary = summarize([case], [row])[f"decider-{version}"]
    assert summary["policy_decisions"] == 1 and summary["model_decisions"] == 0
    assert summary["raw_denominator"] == 0 and summary["raw_rate"] is None
    assert summary["final_rate"] == 1


def test_current_state_distinguishes_blocked_target_and_available_other_target():
    from photoprep_worker.decider import build_decision_state, question_for

    text = build_decision_state(inputs(restrictions=["no_touch_brow"]), question_for("v4"))
    assert "現在の相談対象で接触可能: なし" in text
    assert "本人に確認後に選べる他の対象: 前髪 (bangs)" in text


def test_a_guard_cannot_reintroduce_an_ineligible_action():
    from photoprep_worker.decision_pattern import Override

    engine, ran = Engine(), []
    with pytest.raises(ValueError):
        run_decision(
            decider=StrandsDecider(engine, NEXT_SUPPORT),
            question=NEXT_SUPPORT,
            state="synthetic",
            eligibility=Eligibility(("clarify", "offer_finish"), "restriction"),
            context=None,
            guards=[lambda c, ctx: Override("grooming_tip", "invalid")],
            handlers={k: (lambda kind=k: ran.append(kind)) for k in NEXT_SUPPORT.options},
        )
    assert ran == []


def test_record_rejects_invented_confidence_for_a_policy_decision(world):
    from pydantic import ValidationError

    from photoprep_worker.pipeline import process_job
    from photoprep_worker.schemas import DecisionRecord
    from tests.conftest import JOB

    world.seed(changes_used=2)
    process_job(world.deps, JOB)
    record = {k: v for k, v in world.decision().items() if k in DecisionRecord.model_fields}
    with pytest.raises(ValidationError):
        DecisionRecord.model_validate(record | {"confidence": 1.0})


def test_v4_gate_requires_new_dataset_and_rejects_lost_supported_actions():
    from pathlib import Path

    from evaluation.metrics import adoption_gate, summarize
    from evaluation.schemas import TrialResult, load_cases

    cases = [
        c
        for c in load_cases(Path(__file__).parents[1] / "evaluation/eligibility-matrix")[0]
        if c.split == "holdout"
    ]
    # Synthetic perfect records test the gate; they are not model-quality evidence.
    rows = []
    for version in ("v1", "v4"):
        for case in cases:
            selected = sorted(case.expected.allowed_final_choices)[0]
            rows.append(
                TrialResult(
                    case_id=case.case_id,
                    backend="decider",
                    state_version=version,
                    repeat_index=0,
                    status="ok",
                    raw_choice=selected,
                    final_choice=selected,
                    handler_id=selected,
                    probabilities=dict.fromkeys(NEXT_SUPPORT.options, 0.0) | {selected: 1.0},
                    confidence=1.0,
                    eligible_options=tuple(NEXT_SUPPORT.options),
                )
            )
    summary = summarize(cases, rows)
    assert adoption_gate(cases, rows, summary)["adopt_v4"] is False
    assert (
        adoption_gate(cases, rows, summary, dataset_version="eligibility-matrix-v1")["adopt_v4"]
        is True
    )
    index = next(
        i for i, r in enumerate(rows) if r.state_version == "v4" and r.raw_choice == "grooming_tip"
    )
    rows[index] = rows[index].model_copy(
        update=dict(
            raw_choice="offer_finish",
            final_choice="offer_finish",
            handler_id="offer_finish",
            eligible_options=tuple(NEXT_SUPPORT.options),
            probabilities=dict.fromkeys(NEXT_SUPPORT.options, 0.0) | {"offer_finish": 1.0},
        )
    )
    assert (
        adoption_gate(cases, rows, summarize(cases, rows), dataset_version="eligibility-matrix-v1")[
            "adopt_v4"
        ]
        is False
    )
