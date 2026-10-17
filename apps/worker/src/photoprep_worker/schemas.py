"""Typed data for the worker. Bedrock cannot guarantee structured output (Nova Lite has no
structured-output mode), so every model answer is validated here and rejected if wrong."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

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

    def to_result(self) -> dict:
        result = {"kind": self.kind, "text": self.text, "basis": self.basis}
        if self.comparable is not None:
            result["comparable"] = self.comparable
        return result


class DecisionRecord(BaseModel):
    """Demo/audit record of one decision. Fields are numbers, enums and ids only: no
    image, no user text, no model text (FR-016, FR-023)."""

    model_config = ConfigDict(extra="forbid")

    job_id: str
    session_id: str
    question_version: str
    probabilities: dict[str, float]
    confidence: float
    decider_choice: AdviceKind
    selected: AdviceKind
    guard_override: str | None
    invoked: list[str]
    created_at: str
