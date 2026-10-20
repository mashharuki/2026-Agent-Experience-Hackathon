import json
from pathlib import Path

import pytest
from evaluation.metrics import adoption_gate, summarize
from evaluation.runner import compare, evaluate, trial
from evaluation.schemas import TrialResult, load_cases

CASES = Path(__file__).parents[1] / "evaluation/cases"


def test_finish_only_fake_cannot_pass_by_having_no_violations():
    cases = [c for c in load_cases(CASES)[0] if c.split == "dev"]
    rows = [trial(c, "fake", "v1", 0) for c in cases]
    summary = summarize(cases, rows)["fake-v1"]
    assert summary["constraint_violations"] == 0
    assert summary["support_eligible"] == 2
    assert summary["support_provided"] == 0
    assert summary["quality_pass"] is False
    assert adoption_gate(cases, rows, {"fake-v1": summary})["adopt_v2"] is False


def test_failures_and_not_run_remain_in_denominator_and_duplicates_are_errors():
    cases = load_cases(CASES)[0][:2]
    rows = [
        trial(cases[0], "rules", "v1", 0),
        TrialResult(
            case_id=cases[1].case_id,
            backend="rules",
            state_version="v1",
            repeat_index=0,
            status="not_run",
        ),
    ]
    summary = summarize(cases, rows)["rules-v1"]
    assert (summary["planned"], summary["ok"], summary["not_run"], summary["raw_rate"]) == (
        2,
        1,
        1,
        0.5,
    )
    with pytest.raises(ValueError):
        summarize(cases, [*rows, rows[0]])


def test_call_limit_persists_partial_run_and_does_not_overwrite(tmp_path):
    out = tmp_path / "run"
    assert evaluate(CASES, out, max_calls=3) == 4
    manifest = json.loads((out / "manifest.json").read_text())
    summary = json.loads((out / "summary.json").read_text())["variants"]["fake-v1"]
    assert manifest["status"] == "partial"
    assert manifest["stop_reason"] == "call_limit"
    assert summary["planned"] == 10 and summary["ok"] == 3 and summary["not_run"] == 7
    with pytest.raises(FileExistsError):
        evaluate(CASES, out)
    text = "".join(p.read_text() for p in out.glob("*.json*"))
    assert "本人の希望" not in text and "毛流れ" not in text


def test_compare_refuses_incompatible_conditions(tmp_path):
    out = tmp_path / "first"
    assert evaluate(CASES, out, backend="rules") == 0
    manifest = json.loads((out / "manifest.json").read_text())
    manifest["conditions"]["min_confidence"] = 0.8
    other = tmp_path / "other"
    other.mkdir()
    (other / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="incompatible"):
        compare([out, other], CASES, tmp_path / "compare")


def test_model_exception_is_sanitized_without_inventing_a_handler():
    class Broken:
        def choose(self, state):
            raise RuntimeError("private-text-must-not-leak")

    row = trial(load_cases(CASES)[0][0], "decider", "v1", 0, decider=Broken())
    assert row.status == "model_error" and row.handler_id is None
    assert "private-text" not in row.model_dump_json()


def paired_holdout():
    cases = [c for c in load_cases(CASES)[0] if c.split == "holdout"]
    rows = []
    for case in cases:
        for repeat in range(3):
            for version in ("v1", "v2"):
                selected = sorted(case.expected.allowed_final_choices)[0]
                rows.append(
                    TrialResult(
                        case_id=case.case_id,
                        backend="decider",
                        state_version=version,
                        repeat_index=repeat,
                        status="ok",
                        raw_choice=selected,
                        final_choice=selected,
                        handler_id=selected,
                        probabilities={
                            k: float(k == selected)
                            for k in (
                                "grooming_tip",
                                "capture_setup_tip",
                                "clarify",
                                "offer_finish",
                            )
                        },
                        confidence=1.0,
                    )
                )
    return cases, rows


def test_adoption_requires_observed_improvement_and_no_category_regression():
    cases, rows = paired_holdout()
    assert adoption_gate(cases, rows, summarize(cases, rows))["adopt_v2"] is False
    rows[0] = rows[0].model_copy(
        update=dict(
            raw_choice="offer_finish", final_choice="offer_finish", handler_id="offer_finish"
        )
    )
    assert adoption_gate(cases, rows, summarize(cases, rows))["adopt_v2"] is True
    target = next(
        i for i, r in enumerate(rows) if r.state_version == "v2" and r.case_id.endswith("dim-room")
    )
    rows[target] = rows[target].model_copy(
        update=dict(
            raw_choice="offer_finish", final_choice="offer_finish", handler_id="offer_finish"
        )
    )
    assert adoption_gate(cases, rows, summarize(cases, rows))["adopt_v2"] is False


def test_failed_trial_or_missing_pairs_prevents_adoption():
    cases, rows = paired_holdout()
    rows[0] = rows[0].model_copy(
        update=dict(
            raw_choice="offer_finish", final_choice="offer_finish", handler_id="offer_finish"
        )
    )
    rows[1] = TrialResult(
        case_id=rows[1].case_id,
        backend="decider",
        state_version="v2",
        repeat_index=rows[1].repeat_index,
        status="model_error",
    )
    assert adoption_gate(cases, rows, summarize(cases, rows))["adopt_v2"] is False
    assert adoption_gate(cases, rows[:-1], summarize(cases, rows[:-1]))["adopt_v2"] is False


def test_compare_refuses_missing_planned_records(tmp_path):
    out = tmp_path / "first"
    assert evaluate(CASES, out, backend="rules") == 0
    path = out / "trials.jsonl"
    path.write_text("\n".join(path.read_text().splitlines()[:-1]) + "\n")
    with pytest.raises(ValueError, match="missing_planned"):
        compare([out], CASES, tmp_path / "compare")


def test_result_contract_does_not_invent_model_scores_or_success_after_failure():
    with pytest.raises(ValueError):
        TrialResult(
            case_id="synthetic",
            backend="fake",
            state_version="v1",
            repeat_index=0,
            status="ok",
            raw_choice="offer_finish",
            final_choice="offer_finish",
            handler_id="offer_finish",
            probabilities={"offer_finish": 1},
            confidence=1,
        )
    with pytest.raises(ValueError):
        TrialResult(
            case_id="synthetic",
            backend="decider",
            state_version="v1",
            repeat_index=0,
            status="model_error",
            final_choice="offer_finish",
        )
