"""Fixed question metadata, shared by the worker and API (no user text parsing)."""

from datetime import timedelta

CONTEXT_LIFETIME = timedelta(minutes=10)
CONTEXT_INDEX = "CLARIFICATION_CONTEXT"


def context_key(clarification_id: str) -> str:
    return f"CLARIFICATION#{clarification_id}"


def question(clarification_id: str, scope: str, restrictions: list[str]) -> dict:
    allowed = [
        target
        for target in ("brow", "bangs")
        if f"no_touch_{target}" not in restrictions
    ]
    restricted = scope not in allowed and scope != "look_first"
    return {
        "clarificationId": clarification_id,
        "reason": "restricted_scope"
        if restricted
        else "choose_scope"
        if scope == "look_first"
        else "specify_detail",
        "allowedScopes": allowed,
        "requiresDetail": scope in allowed,
    }
