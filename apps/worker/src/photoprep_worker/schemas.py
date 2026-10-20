"""Typed data for the worker. Bedrock cannot guarantee structured output (Nova Lite has no
structured-output mode), so every model answer is validated here and rejected if wrong."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Lighting = Literal["good", "backlit", "dim", "uneven", "unknown"]
Framing = Literal["ok", "too_small", "off_center", "cut_off", "no_face", "unknown"]
AdviceKind = Literal["grooming_tip", "capture_setup_tip", "clarify", "offer_finish"]
Short = Annotated[str, StringConstraints(max_length=120)]


class Observation(BaseModel):
    """What the photo shows. Contains no pixels and no identifying data."""

    model_config = ConfigDict(extra="forbid")

    visible: list[Short] = Field(max_length=6)
    uncertain: list[Short] = Field(max_length=6)
    lighting: Lighting
    framing: Framing
    confidence: float = Field(ge=0.0, le=1.0)


class Advice(BaseModel):
    """The advice shown to the user. ``text`` is limited like the API contract."""

    model_config = ConfigDict(extra="forbid")

    kind: AdviceKind
    text: str = Field(min_length=1, max_length=400)
    basis: Literal["observation", "user_request"]
    comparable: bool | None = None
    clarification: dict | None = None

    def to_result(self) -> dict:
        result = {"kind": self.kind, "text": self.text, "basis": self.basis}
        if self.comparable is not None:
            result["comparable"] = self.comparable
        if self.clarification is not None:
            result["clarification"] = self.clarification
        return result


class DecisionRecord(BaseModel):
    """Demo/audit record of one decision. Fields are numbers, enums and ids only: no
    image, no user text, no model text (FR-016, FR-023)."""

    model_config = ConfigDict(extra="forbid")

    job_id: str
    session_id: str
    question_version: str
    probabilities: dict[str, float] | None
    confidence: float | None
    decider_choice: AdviceKind | None
    selected: AdviceKind
    guard_override: str | None
    invoked: list[str]
    created_at: str
    decision_source: Literal["model", "policy"] = "model"
    eligible_options: tuple[AdviceKind, ...] = ()
    policy_reason: (
        Literal[
            "analysis_limit",
            "change_limit",
            "restriction",
            "unobservable",
            "insufficient_evidence",
            "clarification_limit",
            "available_support",
        ]
        | None
    ) = None

    @model_validator(mode="after")
    def truthful_provenance(self):
        scores = (self.probabilities, self.confidence, self.decider_choice)
        if self.decision_source == "policy":
            if any(value is not None for value in scores) or (
                self.eligible_options != (self.selected,) or self.policy_reason is None
            ):
                raise ValueError("invented_policy_inference")
        elif any(value is None for value in scores):
            raise ValueError("missing_model_inference")
        elif self.eligible_options and len(self.eligible_options) < 2:
            raise ValueError("singleton_is_not_model_inference")
        if self.eligible_options and self.selected not in self.eligible_options:
            raise ValueError("ineligible_selection")
        if (
            self.decision_source == "model"
            and self.eligible_options
            and (set(self.probabilities) != set(self.eligible_options))
        ):
            raise ValueError("ineligible_model_scores")
        return self
