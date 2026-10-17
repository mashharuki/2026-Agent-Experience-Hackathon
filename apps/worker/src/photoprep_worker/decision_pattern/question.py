"""The typed question: one question, a fixed set of named options, each described."""

import re
from collections.abc import Mapping
from dataclasses import dataclass

_OPTION_ID = re.compile(r"^[a-z][a-z0-9_]*$")


@dataclass(frozen=True)
class TypedQuestion:
    """What the Decider is asked.

    ``options`` maps a stable option id (snake_case) to a plain-language description of
    when it is the right choice. The descriptions are sent to the model, so they are part
    of the decision: write them as the criteria you would give a person.
    """

    name: str
    version: str
    instructions: str
    options: Mapping[str, str]

    def __post_init__(self) -> None:
        if not self.name or not self.version or not self.instructions.strip():
            raise ValueError("name, version and instructions are required")
        if len(self.options) < 2:
            raise ValueError("a choice needs at least two options")
        for option_id, description in self.options.items():
            if not _OPTION_ID.match(option_id):
                raise ValueError(f"option id must be snake_case: {option_id!r}")
            if not description.strip():
                raise ValueError(f"option {option_id!r} needs a description")
