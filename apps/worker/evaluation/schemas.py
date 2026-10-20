"""Strict synthetic data contracts and split/hash validation."""

import hashlib
import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from photoprep_worker.decision_inputs import DecisionInputs
from photoprep_worker.schemas import AdviceKind

CATEGORIES = ("normal", "restriction", "visibility", "ambiguity", "limit")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


class Expected(StrictModel):
    allowed_raw_choices: frozenset[AdviceKind] = Field(min_length=1)
    allowed_final_choices: frozenset[AdviceKind] = Field(min_length=1)
    forbidden_final_choices: frozenset[AdviceKind]
    support_possible: bool
    rationale: str = Field(min_length=1)

    @model_validator(mode="after")
    def consistent(self):
        if self.allowed_final_choices & self.forbidden_final_choices:
            raise ValueError("contradictory_labels")
        if self.support_possible and "grooming_tip" not in self.allowed_final_choices:
            raise ValueError("support_label_contradiction")
        return self


class EvaluationCase(StrictModel):
    schema_version: Literal[1]
    case_id: str = Field(pattern=r"^[a-z0-9_-]{1,60}$")
    group_id: str = Field(pattern=r"^[a-z0-9_-]{1,60}$")
    split: Literal["dev", "holdout"]
    category: Literal["normal", "restriction", "visibility", "ambiguity", "limit"]
    provenance: Literal["synthetic"]
    inputs: DecisionInputs
    expected: Expected
    label_status: Literal["resolved"]


class TrialResult(StrictModel):
    case_id: str
    backend: Literal["rules", "fake", "decider"]
    state_version: Literal["v1", "v2", "v3", "v4"]
    repeat_index: int = Field(ge=0)
    status: Literal["ok", "invalid_output", "model_error", "timeout", "not_run"]
    raw_choice: AdviceKind | None = None
    final_choice: AdviceKind | None = None
    probabilities: dict[str, float] | None = None
    confidence: float | None = None
    guard_override: str | None = None
    handler_id: AdviceKind | None = None
    selection_seconds: float | None = Field(default=None, ge=0)
    error_class: Literal["invalid_output", "model_error", "timeout"] | None = None
    decision_source: Literal["model", "policy"] = "model"
    eligible_options: tuple[AdviceKind, ...] = ()
    policy_reason: str | None = None

    @model_validator(mode="after")
    def execution_evidence(self):
        if self.status == "ok":
            if (
                (self.raw_choice is None and self.decision_source != "policy")
                or self.final_choice is None
                or self.handler_id != self.final_choice
            ):
                raise ValueError("missing_handler_evidence")
            if (
                self.backend == "decider"
                and self.decision_source == "model"
                and (self.probabilities is None or self.confidence is None)
            ):
                raise ValueError("missing_model_scores")
            if self.decision_source == "policy" and (
                any(v is not None for v in (self.raw_choice, self.probabilities, self.confidence))
                or self.eligible_options != (self.final_choice,)
                or not self.policy_reason
            ):
                raise ValueError("invented_policy_scores")
            if self.eligible_options and self.final_choice not in self.eligible_options:
                raise ValueError("ineligible_final_choice")
            if (
                self.decision_source == "model"
                and self.eligible_options
                and (len(self.eligible_options) < 2)
            ):
                raise ValueError("singleton_is_not_model_inference")
            if self.backend != "decider" and (
                self.probabilities is not None or self.confidence is not None
            ):
                raise ValueError("invented_model_scores")
        elif any(
            v is not None
            for v in (
                self.raw_choice,
                self.final_choice,
                self.handler_id,
                self.probabilities,
                self.confidence,
                self.guard_override,
            )
        ):
            raise ValueError("invented_failure_result")
        return self


class RunManifest(StrictModel):
    schema_version: Literal[1]
    run_id: str
    created_at: str
    git_head: str
    dirty: bool
    code_sha256: str
    conditions: dict
    split: Literal["dev", "holdout"]
    backend: Literal["rules", "fake", "decider"]
    versions: tuple[Literal["v1", "v2", "v3", "v4"], ...]
    repeats: int = Field(ge=1, le=3)
    max_calls: int = Field(ge=1, le=180)
    max_seconds: float = Field(gt=0, le=1800)
    concurrency: Literal[1]
    status: Literal["running", "complete", "partial"]
    planned: int = Field(ge=1)
    case_ids: tuple[str, ...]
    order: tuple[dict, ...]
    load_seconds: float | None = Field(default=None, ge=0)
    peak_memory_bytes: int | None = Field(default=None, ge=0)
    model_identity: dict | None = None
    elapsed_seconds: float | None = Field(default=None, ge=0)
    error_class: Literal["cache_error", "load_error"] | None = None
    stop_reason: (
        Literal["cache_error", "load_error", "timeout", "interrupted", "call_limit"] | None
    ) = None


def load_cases(directory: Path) -> tuple[list[EvaluationCase], dict]:
    manifest = json.loads((directory / "manifest.json").read_text())
    cases = []
    for split, count in (("dev", 10), ("holdout", 30)):
        path = directory / f"{split}.jsonl"
        if sha256(path) != manifest["sha256"][split]:
            raise ValueError("dataset_hash_mismatch")
        rows = [EvaluationCase.model_validate_json(line) for line in path.read_text().splitlines()]
        if len(rows) != count or any(c.split != split for c in rows):
            raise ValueError("split_count_mismatch")
        if any(sum(c.category == cat for c in rows) != count // 5 for cat in CATEGORIES):
            raise ValueError("category_count_mismatch")
        cases.extend(rows)
    if len({c.case_id for c in cases}) != len(cases):
        raise ValueError("duplicate_case_id")
    fingerprints, groups = set(), {}
    for case in cases:
        fingerprint = case.inputs.model_dump_json()
        if fingerprint in fingerprints:
            raise ValueError("duplicate_inputs")
        fingerprints.add(fingerprint)
        if case.group_id in groups and groups[case.group_id] != case.split:
            raise ValueError("group_leakage")
        groups[case.group_id] = case.split
        if case.inputs.phase == "before" and case.inputs.comparable is not None:
            raise ValueError("comparison_before_capture")
    return cases, manifest
