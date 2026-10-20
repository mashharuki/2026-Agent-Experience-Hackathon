"""Reproducible manifests and bounded, content-free result files."""

import hashlib
import importlib.metadata
import inspect
import json
import platform
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from photoprep_worker.decider import (
    CRITERIA,
    INSTRUCTIONS,
    build_state_text,
    build_state_text_v2,
    build_state_text_v3,
    question_for,
)

from .schemas import TrialResult, sha256


def write_json(path: Path, value):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n")
    temp.replace(path)


def code_identity() -> dict:
    root = Path(__file__).resolve().parents[1]
    digest = hashlib.sha256()
    for directory in (root / "evaluation", root / "src/photoprep_worker", root / "tools"):
        for path in sorted(directory.rglob("*.py")):
            digest.update(str(path.relative_to(root)).encode())
            digest.update(path.read_bytes())
    git = shutil.which("git")
    if git is None:
        raise ValueError("git_required_for_provenance")
    head = subprocess.run(  # noqa: S603 - fixed git subcommand, resolved executable
        [git, "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    dirty = subprocess.run(  # noqa: S603 - fixed git subcommand, resolved executable
        [git, "status", "--porcelain"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return dict(git_head=head, dirty=bool(dirty), code_sha256=digest.hexdigest())


def conditions(dataset, threads: int, seed: int) -> dict:
    root = Path(__file__).resolve().parents[1] / "src/photoprep_worker"
    return dict(
        dataset_sha256=dataset["sha256"],
        question_sha256=hashlib.sha256(
            json.dumps(
                dict(instructions=INSTRUCTIONS, options=CRITERIA), ensure_ascii=False
            ).encode()
        ).hexdigest(),
        guard_sha256=sha256(root / "guards.py"),
        binding_sha256=sha256(root / "decision_pattern/binding.py"),
        adapter_sha256=sha256(root / "decision_pattern/decider.py"),
        min_confidence=0,
        v4_question_sha256=hashlib.sha256(repr(question_for("v4")).encode()).hexdigest(),
        v3_question_sha256=hashlib.sha256(repr(question_for("v3")).encode()).hexdigest(),
        policy_sha256=sha256(root / "support_policy.py"),
        eligibility_sha256=sha256(root / "decision_pattern/eligibility.py"),
        v3_renderer_sha256=hashlib.sha256(
            inspect.getsource(build_state_text_v3).encode()
        ).hexdigest(),
        v1_renderer_sha256=hashlib.sha256(inspect.getsource(build_state_text).encode()).hexdigest(),
        v2_renderer_sha256=hashlib.sha256(
            inspect.getsource(build_state_text_v2).encode()
        ).hexdigest(),
        threads=threads,
        seed=seed,
        device="cpu",
        prefix_cache=False,
        warmups=0,
        libraries={
            k: importlib.metadata.version(k)
            for k in ("strands-decider", "torch", "transformers", "pydantic")
        },
        python=platform.python_version(),
        os=platform.system(),
    )


def new_manifest(dataset, threads, seed, split, backend, versions, repeats, max_calls, max_seconds):
    return dict(
        schema_version=1,
        created_at=datetime.now(UTC).isoformat(),
        **code_identity(),
        conditions=conditions(dataset, threads, seed),
        split=split,
        backend=backend,
        versions=versions,
        repeats=repeats,
        max_calls=max_calls,
        max_seconds=max_seconds,
        concurrency=1,
        status="running",
        load_seconds=None,
        peak_memory_bytes=None,
        planned=0,
        model_identity=None,
    )


def write_results(out: Path, trials: list[TrialResult], summary: dict):
    (out / "trials.jsonl").write_text("".join(r.model_dump_json() + "\n" for r in trials))
    write_json(out / "summary.json", summary)
    # Only enums and synthetic IDs: never serialize exception messages or input text.
    failures = ["# Evaluation mismatches / failures", ""]
    for row in summary.get("mismatches", []):
        failures.append(
            f"- {row['backend']} {row['state_version']} {row['case_id']} "
            f"repeat={row['repeat_index']}: {row['status']} "
            f"raw={row['raw_choice']} final={row['final_choice']}"
        )
    (out / "failures.md").write_text("\n".join(failures) + "\n")
