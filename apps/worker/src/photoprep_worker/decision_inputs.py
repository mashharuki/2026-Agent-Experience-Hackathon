"""Immutable facts shared by state rendering and code guards, never scoring labels."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .guards import GuardContext
from .schemas import AdviceKind, Framing, Lighting, Short


class ObservationSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)
    visible: tuple[Short, ...] = Field(max_length=6)
    uncertain: tuple[Short, ...] = Field(max_length=6)
    lighting: Lighting
    framing: Framing
    confidence: float = Field(ge=0, le=1)


class DecisionInputs(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    scope: Literal["brow", "bangs", "look_first"]
    wish: str | None = Field(default=None, max_length=200)
    restrictions: tuple[Literal["no_touch_brow", "no_touch_bangs", "keep_brow_shape"], ...] = ()
    observation: ObservationSnapshot
    tools: tuple[str, ...] = Field(default=(), max_length=10)
    changes_used: int = Field(ge=0, le=2)
    analyses_used: int = Field(ge=1, le=3)
    clarified: bool = False
    phase: Literal["before", "after"]
    last_advice: AdviceKind | None = None
    comparable: bool | None = None

    def guard_context(self) -> GuardContext:
        return GuardContext(
            scope=self.scope,
            restrictions=list(self.restrictions),
            changes_used=self.changes_used,
            lighting=self.observation.lighting,
            framing=self.observation.framing,
            analyses_used=self.analyses_used,
            clarified=self.clarified,
        )

    def v1_arguments(self) -> dict:
        from .schemas import Observation

        return dict(
            scope=self.scope,
            wish=self.wish,
            restrictions=list(self.restrictions),
            observation=Observation.model_validate(self.observation.model_dump()),
            tools=list(self.tools),
            changes_used=self.changes_used,
            phase=self.phase,
            last_advice=self.last_advice,
        )
