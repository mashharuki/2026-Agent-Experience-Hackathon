"""Session state machine (data-model.md, FR-004, FR-007, FR-022).

Pure functions: no I/O. The store applies the same rules atomically with conditional
updates; these checks produce the right error before a write is attempted.
"""

from photoprep_common.states import (  # noqa: F401 - re-exported for the API's callers
    ADVICE_KINDS,
    MAX_ANALYSES,
    MAX_CHANGES,
    State,
    state_after_job,
)

from .errors import AppError

# The photo phase each state can submit for analysis. While TRYING only the "after"
# check is possible, so no new advice is generated while the user is tidying up (FR-004).
_ANALYSIS_PHASE: dict[State, str] = {
    State.CONSULTING: "before",
    State.CAPTURE_ADJUST: "before",
    State.ADVICE_SHOWN: "before",  # "another suggestion"
    State.TRYING: "after",
    State.COMPARING: "before",  # one more try starts from the latest photo
}


def phase_for(state: State) -> str | None:
    return _ANALYSIS_PHASE.get(state)


def check_can_request_analysis(
    state: State, phase: str, *, analyses_used: int, changes_used: int
) -> None:
    if state is State.DONE:
        raise AppError(409, "session_ended")
    expected = _ANALYSIS_PHASE.get(state)
    if expected is None or expected != phase:
        raise AppError(409, "conflict")
    if state is State.COMPARING and changes_used >= MAX_CHANGES:
        raise AppError(409, "change_limit_reached")
    if analyses_used >= MAX_ANALYSES:
        raise AppError(429, "analysis_limit_reached")


def check_can_start_change(state: State, *, changes_used: int) -> None:
    if state is State.DONE:
        raise AppError(409, "session_ended")
    if state is not State.ADVICE_SHOWN:
        raise AppError(409, "conflict")
    if changes_used >= MAX_CHANGES:
        raise AppError(409, "change_limit_reached")
