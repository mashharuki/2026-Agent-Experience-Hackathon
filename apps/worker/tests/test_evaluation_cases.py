import hashlib
import json
import shutil
from pathlib import Path

import pytest
from evaluation.backends import rules_choice
from evaluation.runner import render_state, trial
from evaluation.schemas import EvaluationCase, load_cases
from pydantic import ValidationError

CASES = Path(__file__).parents[1] / "evaluation/cases"


def test_fixed_synthetic_dataset_has_balanced_disjoint_splits():
    cases, _ = load_cases(CASES)
    assert len(cases) == 40
    assert all(c.provenance == "synthetic" for c in cases)
    assert len({c.group_id for c in cases}) == 40
    for split, count in (("dev", 10), ("holdout", 30)):
        assert sum(c.split == split for c in cases) == count


def test_decision_input_is_deeply_immutable():
    inputs = load_cases(CASES)[0][0].inputs
    with pytest.raises(ValidationError):
        inputs.analyses_used = 0
    with pytest.raises(ValidationError):
        inputs.observation.lighting = "backlit"
    assert isinstance(inputs.observation.visible, tuple)
    assert isinstance(inputs.restrictions, tuple)


@pytest.mark.parametrize(
    "mutation", ["unknown", "empty", "contradiction", "unresolved", "bad_kind", "bad_count"]
)
def test_rejects_invalid_or_unresolved_labels_and_inputs(mutation):
    row = json.loads((CASES / "dev.jsonl").read_text().splitlines()[0])
    if mutation == "unknown":
        row["inputs"]["remaining_analyses"] = 99
    elif mutation == "empty":
        row["expected"]["allowed_raw_choices"] = []
    elif mutation == "contradiction":
        row["expected"]["forbidden_final_choices"] = ["grooming_tip"]
    elif mutation == "unresolved":
        row["label_status"] = "unresolved"
    elif mutation == "bad_kind":
        row["expected"]["allowed_raw_choices"] = ["buy_tools"]
    else:
        row["inputs"]["analyses_used"] = 0
    with pytest.raises(ValueError):
        EvaluationCase.model_validate(row)


@pytest.mark.parametrize(
    "mutation", ["hash", "duplicate_id", "duplicate_inputs", "group_leak", "wrong_split"]
)
def test_refuses_hash_or_split_leakage(tmp_path, mutation):
    target = tmp_path / "cases"
    shutil.copytree(CASES, target)
    dev = [json.loads(line) for line in (target / "dev.jsonl").read_text().splitlines()]
    holdout = [json.loads(line) for line in (target / "holdout.jsonl").read_text().splitlines()]
    if mutation == "duplicate_id":
        holdout[0]["case_id"] = dev[0]["case_id"]
    elif mutation == "duplicate_inputs":
        holdout[0]["inputs"] = dev[0]["inputs"]
    elif mutation == "group_leak":
        holdout[0]["group_id"] = dev[0]["group_id"]
    elif mutation == "wrong_split":
        holdout[0]["split"] = "dev"
    (target / "holdout.jsonl").write_text("\n".join(json.dumps(x) for x in holdout) + "\n")
    if mutation != "hash":
        manifest = json.loads((target / "manifest.json").read_text())
        manifest["sha256"]["holdout"] = hashlib.sha256(
            (target / "holdout.jsonl").read_bytes()
        ).hexdigest()
        (target / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError):
        load_cases(target)


def test_labels_do_not_reach_predictors_or_change_their_predictions():
    case = load_cases(CASES)[0][0]
    original = rules_choice(case.inputs)
    row = case.model_dump(mode="json")
    row["expected"]["rationale"] = "DO_NOT_SEND_THIS_LABEL"
    row["expected"]["allowed_raw_choices"] = ["offer_finish"]
    changed = EvaluationCase.model_validate(row)
    assert rules_choice(changed.inputs) == original
    assert render_state(case.inputs, "v1") == render_state(changed.inputs, "v1")
    result = trial(changed, "rules", "v1", 0)
    assert result.raw_choice == original
    assert result.probabilities is result.confidence is None
    assert "DO_NOT_SEND_THIS_LABEL" not in result.model_dump_json()


def test_v1_renderer_matches_the_pre_experiment_golden_fixture():
    fixture = json.loads((CASES / "v1-golden.json").read_text())
    for case in load_cases(CASES)[0]:
        if case.split == "dev":
            assert render_state(case.inputs, "v1") == fixture["states"][case.case_id]
