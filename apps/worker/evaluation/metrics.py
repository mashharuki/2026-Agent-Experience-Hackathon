"""Planned denominators include failures and unexecuted work; repeats are not new scenes."""

from collections import defaultdict
from statistics import median

from .schemas import CATEGORIES, EvaluationCase, TrialResult


def summarize(cases: list[EvaluationCase], trials: list[TrialResult]) -> dict:
    lookup = {case.case_id: case for case in cases}
    seen = set()
    for trial in trials:
        key = (trial.backend, trial.state_version, trial.case_id, trial.repeat_index)
        if key in seen or trial.case_id not in lookup:
            raise ValueError("duplicate_or_unknown_trial")
        seen.add(key)

    def counts(rows):
        ok = [r for r in rows if r.status == "ok"]
        eligible = [r for r in rows if lookup[r.case_id].expected.support_possible]
        support = sum(r.status == "ok" and r.final_choice == "grooming_tip" for r in eligible)
        raw = sum(r.raw_choice in lookup[r.case_id].expected.allowed_raw_choices for r in ok)
        final = sum(r.final_choice in lookup[r.case_id].expected.allowed_final_choices for r in ok)
        violations = sum(
            r.final_choice in lookup[r.case_id].expected.forbidden_final_choices for r in ok
        )
        elapsed = [r.selection_seconds for r in ok if r.selection_seconds is not None]
        model_planned = sum(r.decision_source != "policy" for r in rows)
        return dict(
            planned=len(rows),
            ok=len(ok),
            failed=sum(r.status not in {"ok", "not_run"} for r in rows),
            not_run=sum(r.status == "not_run" for r in rows),
            raw_correct=raw,
            final_correct=final,
            raw_rate=raw / model_planned if model_planned else None,
            raw_denominator=model_planned,
            policy_decisions=sum(r.decision_source == "policy" for r in ok),
            model_decisions=sum(
                r.backend == "decider" and r.decision_source == "model" for r in ok
            ),
            final_rate=final / len(rows) if rows else None,
            constraint_violations=violations,
            overrides=sum(r.guard_override is not None for r in ok),
            support_eligible=len(eligible),
            support_provided=support,
            unnecessary_clarify_finish=sum(
                r.final_choice in {"clarify", "offer_finish"}
                and r.final_choice not in lookup[r.case_id].expected.allowed_final_choices
                for r in ok
            ),
            selection_seconds=dict(
                median=median(elapsed), minimum=min(elapsed), maximum=max(elapsed)
            )
            if elapsed
            else None,
            quality_pass=len(ok) == len(rows)
            and bool(rows)
            and violations == 0
            and (not eligible or support > 0),
        )

    variants = sorted({(r.backend, r.state_version) for r in trials})
    results = {}
    for backend, version in variants:
        rows = [r for r in trials if (r.backend, r.state_version) == (backend, version)]
        grouped = defaultdict(set)
        for row in rows:
            if row.status == "ok":
                grouped[row.case_id].add(row.raw_choice)
        results[f"{backend}-{version}"] = dict(
            **counts(rows),
            categories={
                cat: counts([r for r in rows if lookup[r.case_id].category == cat])
                for cat in CATEGORIES
            },
            repeats={
                str(i): counts([r for r in rows if r.repeat_index == i])
                for i in sorted({r.repeat_index for r in rows})
            },
            unique_cases=len({r.case_id for r in rows}),
            variable_cases=sorted(k for k, v in grouped.items() if len(v) > 1),
        )
    return results


def adoption_gate(
    cases: list[EvaluationCase],
    trials: list[TrialResult],
    summary: dict,
    *,
    dataset_version: str | None = None,
) -> dict:
    if "decider-v4" in summary:
        if dataset_version != "eligibility-matrix-v1":
            return dict(adopt_v2=False, adopt_v4=False, reason="fresh_matrix_validation_required")
        return eligibility_gate(cases, trials, summary, version="v4")
    if "decider-v3" in summary:
        return eligibility_gate(cases, trials, summary)
    if "decider-v1" not in summary or "decider-v2" not in summary:
        return dict(adopt_v2=False, reason="paired_real_model_results_required")
    v1, v2 = summary["decider-v1"], summary["decider-v2"]
    used = {r.case_id for r in trials if r.backend == "decider"}
    if (
        len(used) != 30
        or any(c.split != "holdout" for c in cases if c.case_id in used)
        or any(s["planned"] != 90 for s in (v1, v2))
    ):
        return dict(adopt_v2=False, reason="full_three_repeat_holdout_required")
    pairs = {
        (r.state_version, r.case_id, r.repeat_index): r for r in trials if r.backend == "decider"
    }
    lookup = {c.case_id: c for c in cases}
    improved, worsened = [], []
    for (version, cid, repeat), before in pairs.items():
        if version != "v1":
            continue
        after = pairs.get(("v2", cid, repeat))
        if after is None:
            return dict(adopt_v2=False, reason="incomplete_pairing")
        expected = lookup[cid].expected
        a = (
            before.status == "ok" and before.raw_choice in expected.allowed_raw_choices,
            before.status == "ok" and before.final_choice in expected.allowed_final_choices,
        )
        b = (
            after.status == "ok" and after.raw_choice in expected.allowed_raw_choices,
            after.status == "ok" and after.final_choice in expected.allowed_final_choices,
        )
        if any(y > x for x, y in zip(a, b, strict=True)):
            improved.append(dict(case_id=cid, repeat_index=repeat))
        if any(y < x for x, y in zip(a, b, strict=True)):
            worsened.append(dict(case_id=cid, repeat_index=repeat))
    no_regression = all(
        v2["categories"][cat]["final_rate"] >= v1["categories"][cat]["final_rate"]
        for cat in CATEGORIES
    )
    support_ok = v2["support_provided"] >= v1["support_provided"] and all(
        v2["categories"][cat]["support_provided"] >= v1["categories"][cat]["support_provided"]
        for cat in CATEGORIES
    )
    complete = all(s["ok"] == s["planned"] for s in (v1, v2))
    passed = (
        complete
        and v2["constraint_violations"] == 0
        and no_regression
        and support_ok
        and bool(improved)
    )
    return dict(
        adopt_v2=passed,
        reason="passed" if passed else "retain_v1",
        improved=improved,
        worsened=worsened,
        complete=complete,
        no_category_regression=no_regression,
        support_not_reduced=support_ok,
        final_violations=v2["constraint_violations"],
    )


def eligibility_gate(cases, trials, summary, version="v3"):
    """v3 is a system change: policy decisions are never raw model successes."""
    v1, v3 = summary.get("decider-v1"), summary[f"decider-{version}"]
    used = {r.case_id for r in trials if r.backend == "decider"}
    complete = (
        bool(v1)
        and len(used) == 30
        and all(c.split == "holdout" for c in cases if c.case_id in used)
        and all(s["planned"] == s["ok"] == 30 for s in (v1, v3))
    )
    no_regression = bool(v1) and all(
        v3["categories"][cat]["final_rate"] >= v1["categories"][cat]["final_rate"]
        and v3["categories"][cat]["support_provided"] >= v1["categories"][cat]["support_provided"]
        for cat in CATEGORIES
    )
    v3_rows = [r for r in trials if r.backend == "decider" and r.state_version == version]
    legal = bool(v3_rows) and all(
        r.status == "ok" and r.final_choice in r.eligible_options for r in v3_rows
    )
    passed = bool(
        complete
        and no_regression
        and legal
        and v3["constraint_violations"] == 0
        and v3["model_decisions"] > 0
        and v3["support_provided"] > 0
    )
    return dict(
        adopt_v2=False,
        **{f"adopt_{version}": passed},
        reason="eligibility_system_gate_passed" if passed else "eligibility_system_gate_failed",
        complete=bool(complete),
        no_category_or_support_regression=bool(no_regression),
        all_final_choices_eligible=legal,
        final_violations=v3["constraint_violations"],
        scope="synthetic system behavior, not general model quality",
    )
