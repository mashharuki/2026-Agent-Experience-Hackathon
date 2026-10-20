"""One isolated model process, strict call/deadline caps, and crash-safe partial results."""

import contextlib
import json
import multiprocessing
import os
import resource
import sys
import time
import uuid
from pathlib import Path

from photoprep_worker.decider import build_decision_state, question_for
from photoprep_worker.decision_pattern import StrandsDecider, run_decision
from photoprep_worker.guards import guards_for
from photoprep_worker.support_policy import support_eligibility

from .backends import FixedDecider, rules_choice
from .metrics import adoption_gate, summarize
from .model_cache import CacheError, load_local
from .offline import offline_only
from .reporting import new_manifest, write_json, write_results
from .schemas import EvaluationCase, RunManifest, TrialResult, load_cases


def render_state(inputs, version):
    return build_decision_state(inputs, question_for(version))


def trial(case, backend, version, repeat, engine=None, decider=None):
    question = question_for(version)
    if decider is None:
        if backend == "decider":
            decider = StrandsDecider(engine, question)
        else:
            decider = FixedDecider(
                rules_choice(case.inputs) if backend == "rules" else "offer_finish"
            )
    started = time.monotonic()
    base = dict(case_id=case.case_id, backend=backend, state_version=version, repeat_index=repeat)
    try:
        decision = run_decision(
            decider=decider,
            question=question,
            state=render_state(case.inputs, version),
            context=case.inputs.guard_context(),
            guards=guards_for(0),
            handlers={kind: (lambda k=kind: k) for kind in question.options},
            eligibility=support_eligibility(case.inputs) if version in {"v3", "v4"} else None,
        )
        return TrialResult(
            **base,
            status="ok",
            raw_choice=decision.decider_choice,
            final_choice=decision.selected,
            handler_id=decision.result,
            probabilities=decision.probabilities if backend == "decider" else None,
            confidence=decision.confidence if backend == "decider" else None,
            guard_override=decision.override_reason,
            selection_seconds=time.monotonic() - started,
            decision_source=decision.decision_source,
            eligible_options=decision.eligible_options,
            policy_reason=decision.policy_reason,
        )
    except Exception as exc:
        status = "invalid_output" if isinstance(exc, ValueError) else "model_error"
        return TrialResult(
            **base, status=status, error_class=status, selection_seconds=time.monotonic() - started
        )


def schedule(cases, versions, repeats, backend):
    result = []
    for repeat in range(repeats):
        for index, case in enumerate(cases):
            order = versions if (index + repeat) % 2 == 0 else list(reversed(versions))
            result.extend(
                dict(case_id=case.case_id, backend=backend, state_version=v, repeat_index=repeat)
                for v in order
            )
    return result


def _child(cases_json, tasks, out_string, backend, cache, threads, seed, max_calls, delay):
    out = Path(out_string)
    with (
        open(os.devnull, "w") as quiet,
        contextlib.redirect_stdout(quiet),
        contextlib.redirect_stderr(quiet),
    ):
        started = time.monotonic()
        with offline_only():
            try:
                engine, identity = (
                    load_local(Path(cache), threads, seed) if backend == "decider" else (None, None)
                )
                write_json(
                    out / "runtime.json",
                    dict(
                        load_seconds=time.monotonic() - started if engine is not None else 0.0,
                        model_identity=identity,
                    ),
                )
            except Exception as exc:
                write_json(
                    out / "runtime.json",
                    dict(
                        error_class="cache_error" if isinstance(exc, CacheError) else "load_error"
                    ),
                )
                return
            cases = {c.case_id: c for c in map(EvaluationCase.model_validate_json, cases_json)}
            with (out / "completed.jsonl").open("a") as stream:
                for task in tasks[:max_calls]:
                    write_json(out / "active.json", dict(**task, started=time.monotonic()))
                    if delay:
                        time.sleep(delay)
                    result = trial(
                        cases[task["case_id"]],
                        backend,
                        task["state_version"],
                        task["repeat_index"],
                        engine,
                    )
                    stream.write(result.model_dump_json() + "\n")
                    stream.flush()
                    os.fsync(stream.fileno())
            memory = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            write_json(
                out / "runtime.json",
                dict(
                    load_seconds=json.loads((out / "runtime.json").read_text())["load_seconds"],
                    model_identity=identity,
                    peak_memory_bytes=memory * (1 if sys.platform == "darwin" else 1024),
                ),
            )


def evaluate(
    directory: Path,
    out: Path,
    *,
    backend="fake",
    split="dev",
    versions=None,
    repeats=1,
    max_calls=180,
    max_seconds=1800,
    cache=None,
    threads=4,
    seed=0,
    limit=None,
    test_delay=0,
) -> int:
    if (
        backend not in {"fake", "rules", "decider"}
        or not 1 <= max_calls <= 180
        or not 0 < max_seconds <= 1800
        or not 1 <= repeats <= 3
        or not 1 <= threads <= 8
    ):
        raise ValueError("invalid_run_limits")
    versions = versions or ["v1"]
    if versions not in (["v1"], ["v2"], ["v3"], ["v4"], ["v1", "v2"], ["v1", "v3"], ["v1", "v4"]):
        raise ValueError("invalid_versions")
    all_cases, dataset = load_cases(directory)
    cases = [c for c in all_cases if c.split == split]
    if not cases or (limit is not None and (split != "dev" or not 1 <= limit <= 10)):
        raise ValueError("invalid_split_or_limit")
    if limit is not None:
        # The five-case smoke covers one example from each category.
        cases = sorted(
            cases,
            key=lambda c: (
                sum(x.category == c.category for x in cases[: cases.index(c)]),
                c.category,
            ),
        )[:limit]
    tasks = schedule(cases, versions, repeats, backend)
    out.mkdir(parents=True, exist_ok=False)
    manifest = new_manifest(
        dataset, threads, seed, split, backend, versions, repeats, max_calls, max_seconds
    )
    manifest.update(
        run_id=uuid.uuid4().hex,
        planned=len(tasks),
        case_ids=[c.case_id for c in cases],
        order=tasks,
    )
    write_json(out / "manifest.json", RunManifest.model_validate(manifest).model_dump(mode="json"))
    process = multiprocessing.get_context("spawn").Process(
        target=_child,
        args=(
            [c.model_dump_json() for c in cases],
            tasks,
            str(out),
            backend,
            str(cache) if cache else "",
            threads,
            seed,
            max_calls,
            test_delay,
        ),
    )
    started = time.monotonic()
    process.start()
    timed_out, interrupted = False, False
    try:
        while process.is_alive():
            process.join(timeout=min(0.1, max(0, max_seconds - (time.monotonic() - started))))
            if process.is_alive() and time.monotonic() - started >= max_seconds:
                timed_out = True
                break
    except KeyboardInterrupt:
        interrupted = True
    finally:
        if process.is_alive():
            process.terminate()
            process.join(timeout=2)
            if process.is_alive():
                process.kill()
                process.join(timeout=2)
    manifest["elapsed_seconds"] = time.monotonic() - started
    runtime = (
        json.loads((out / "runtime.json").read_text()) if (out / "runtime.json").exists() else {}
    )
    manifest.update(runtime)
    completed = []
    if (out / "completed.jsonl").exists():
        for line in (out / "completed.jsonl").read_text().splitlines():
            try:
                completed.append(TrialResult.model_validate_json(line))
            except ValueError:
                break  # a killed writer can leave one incomplete trailing record

    def key(row):
        return (row.case_id, row.state_version, row.repeat_index)

    found = {key(row): row for row in completed}
    active = json.loads((out / "active.json").read_text()) if (out / "active.json").exists() else {}
    results = []
    for task in tasks:
        identity = (task["case_id"], task["state_version"], task["repeat_index"])
        row = found.get(identity)
        if row is None:
            timeout = timed_out and all(active.get(k) == v for k, v in task.items())
            row = TrialResult(
                **task,
                status="timeout" if timeout else "not_run",
                error_class="timeout" if timeout else None,
            )
        results.append(row)
    complete = all(row.status == "ok" for row in results)
    manifest["status"] = "complete" if complete else "partial"
    manifest["stop_reason"] = runtime.get("error_class")
    if timed_out or interrupted or len(tasks) > max_calls:
        manifest["stop_reason"] = (
            "timeout" if timed_out else "interrupted" if interrupted else "call_limit"
        )
    metrics = summarize(cases, results)
    mismatch = [
        row.model_dump(mode="json")
        for row in results
        if row.status != "ok"
        or (
            row.decision_source == "model"
            and row.raw_choice
            not in next(c for c in cases if c.case_id == row.case_id).expected.allowed_raw_choices
        )
        or row.final_choice
        not in next(c for c in cases if c.case_id == row.case_id).expected.allowed_final_choices
    ]
    write_results(out, results, dict(variants=metrics, mismatches=mismatch))
    write_json(out / "manifest.json", RunManifest.model_validate(manifest).model_dump(mode="json"))
    if runtime.get("error_class") in {"cache_error", "load_error"}:
        return 3
    return 0 if complete else 4


def compare(directories: list[Path], directory: Path, out: Path) -> int:
    cases, dataset = load_cases(directory)
    manifests = [
        RunManifest.model_validate_json((path / "manifest.json").read_text()).model_dump(
            mode="json"
        )
        for path in directories
    ]
    if any(
        m["conditions"] != manifests[0]["conditions"] or m["split"] != manifests[0]["split"]
        for m in manifests
    ):
        raise ValueError("incompatible_runs")
    if any(m["conditions"]["dataset_sha256"] != dataset["sha256"] for m in manifests):
        raise ValueError("dataset_changed_since_run")
    real = [m for m in manifests if m["backend"] == "decider"]
    if real and any(m["backend"] == "fake" for m in manifests):
        raise ValueError("fake_is_not_model_evidence")
    if real and any(m.get("model_identity") != real[0].get("model_identity") for m in real):
        raise ValueError("model_identity_mismatch")
    trials = []
    for path, manifest in zip(directories, manifests, strict=True):
        rows = [
            TrialResult.model_validate_json(line)
            for line in (path / "trials.jsonl").read_text().splitlines()
        ]
        actual = {(r.case_id, r.state_version, r.repeat_index, r.backend) for r in rows}
        planned = {
            (r["case_id"], r["state_version"], r["repeat_index"], r["backend"])
            for r in manifest["order"]
        }
        if len(rows) != manifest["planned"] or actual != planned:
            raise ValueError("missing_planned_trials")
        if any(c.split != manifest["split"] for c in cases if c.case_id in manifest["case_ids"]):
            raise ValueError("run_split_mismatch")
        trials.extend(rows)
    summary = summarize(cases, trials)
    gate = adoption_gate(cases, trials, summary, dataset_version=dataset.get("dataset_version"))
    out.mkdir(parents=True, exist_ok=False)
    write_json(
        out / "summary.json",
        dict(
            variants=summary,
            adoption=gate,
            run_ids=[m["run_id"] for m in manifests],
            permitted_differences=["backend", "state_version"],
        ),
    )
    return 0 if any(gate.get(f"adopt_v{v}") for v in (2, 3, 4)) else 5
