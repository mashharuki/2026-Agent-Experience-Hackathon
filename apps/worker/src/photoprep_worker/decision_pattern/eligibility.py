"""Code-owned execution candidates, computed before asking a model."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Eligibility:
    allowed: tuple[str, ...]
    reason: str

    def __post_init__(self):
        if not self.allowed or len(set(self.allowed)) != len(self.allowed) or not self.reason:
            raise ValueError("invalid_eligibility")
