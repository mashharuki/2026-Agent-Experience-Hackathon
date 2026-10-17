"""Who may do what right now: the door, consent and daily quotas (FR-018, FR-022, FR-027)."""

from datetime import timedelta

from photoprep_common.service_status import get_status
from photoprep_common.store import ConditionFailed

from ..container import Container
from ..errors import AppError

# The wording the app currently shows before the first photo. A request that agrees to any
# other version (a stale page, a made-up value) is refused.
CONSENT_VERSION = "2026-10-v1"
ACCEPTED_CONSENT_VERSIONS = frozenset({CONSENT_VERSION})

_JST = timedelta(hours=9)  # the daily quota resets at midnight in Japan
_QUOTA_TTL = timedelta(days=2)


def ensure_accepting(c: Container, *, new_session: bool = False) -> None:
    """New work is refused unless the door is open.

    Starting a session is also refused when the overall daily quota is used up (429, a clear
    reason). People already in a session are only held back by the worker being closed: the
    quota counts sessions started, so it must not cut off someone half-way through.
    """
    status = public_status(c) if new_session else get_status(c.store)
    if status["accepting"]:
        return
    if status["reason"] == "quota_exhausted":
        raise AppError(429, "quota_exceeded")
    raise AppError(503, "not_accepting")


def ensure_consent(session: dict) -> None:
    """Defence in depth: the session itself must carry an accepted consent version."""
    if session.get("consentVersion") not in ACCEPTED_CONSENT_VERSIONS:
        raise AppError(403, "consent_required")


def check_consent_version(version: str) -> None:
    if version not in ACCEPTED_CONSENT_VERSIONS:
        raise AppError(400, "consent_required")


def _day(c: Container) -> str:
    return (c.now() + _JST).date().isoformat()


def _global_key(c: Container) -> tuple[str, str]:
    return f"QUOTA#GLOBAL#{_day(c)}", "META"


def _bump(c: Container, key: tuple[str, str], by: int, cap: int | None = None) -> None:
    c.store.create_if_absent(*key, {"count": 0, "ttl": int((c.now() + _QUOTA_TTL).timestamp())})
    c.store.update(*key, add={"count": by}, caps={"count": cap} if cap is not None else None)


def reserve_session(c: Container, sub: str) -> None:
    """Take one session from the person's daily allowance and from the overall one.

    Both are atomic conditional increments. If the overall limit refuses, the person's slot is
    given back, so a refusal never costs the person anything.
    """
    user_key = (f"QUOTA#USER#{sub}#{_day(c)}", "META")
    try:
        _bump(c, user_key, 1, c.limits.user_per_day)
    except ConditionFailed as err:
        raise AppError(429, "quota_exceeded") from err
    try:
        _bump(c, _global_key(c), 1, c.limits.global_per_day)
    except ConditionFailed as err:
        _bump(c, user_key, -1)
        raise AppError(429, "quota_exceeded") from err


def global_quota_used_up(c: Container) -> bool:
    item = c.store.get(*_global_key(c))
    return bool(item and item["count"] >= c.limits.global_per_day)


def public_status(c: Container) -> dict:
    """What GET /service-status reports: the stored door state, closed early when the overall
    daily quota is used up (derived, never stored)."""
    status = get_status(c.store)
    if status["accepting"] and global_quota_used_up(c):
        return {"accepting": False, "reason": "quota_exhausted"}
    return status
