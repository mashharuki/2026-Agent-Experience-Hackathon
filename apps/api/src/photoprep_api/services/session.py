"""Session lifecycle: create, load (owned and active), advice responses, comparison."""

from datetime import timedelta

from photoprep_common.clarification import context_key

from ..aws import PartialDeleteError
from ..container import Container
from ..errors import AppError
from ..logs import log_event
from ..repo import get_owned
from ..states import State, check_can_start_change
from ..store import ConditionFailed
from .access import check_consent_version, ensure_accepting, session_reservation_operations
from .idempotency import check_replay, fingerprint

SESSION_TTL = timedelta(hours=24)
MAX_COMPARISONS = 10  # more than the two changes a session allows; a runaway guard


def session_pk(session_id: str) -> str:
    return f"SESSION#{session_id}"


def ttl_after(c: Container, lifetime: timedelta) -> int:
    return int((c.now() + lifetime).timestamp())


def create_session(c: Container, sub: str, request: dict, idem_key: str) -> dict:
    """Create a session. A retry with the same key returns that session and uses no new quota."""
    idem_pk = f"IDEM#{sub}#SESSION#{idem_key}"
    replay = c.store.get(idem_pk, "META")
    if replay is not None:
        check_replay(replay, request)
        return _replay(c, sub, replay)  # accepted work stays valid even if the door closed since
    ensure_accepting(c, new_session=True)
    check_consent_version(request["consentVersion"])  # an invalid request must not use a quota slot
    now = c.now()
    session_id = c.new_id()
    item = {
        "ownerSub": sub,
        "scope": request["scope"],
        "language": request.get("language", "ja"),
        "restrictions": sorted(set(request.get("restrictions", []))),
        "consentVersion": request["consentVersion"],
        "state": State.CONSULTING.value,
        "changesUsed": 0,
        "analysesUsed": 0,
        "createdAt": now.isoformat(),
        "expiresAt": (now + SESSION_TTL).isoformat(),
        "ttl": ttl_after(c, SESSION_TTL),
    }
    if request.get("wish"):
        item["wish"] = request["wish"]  # never logged; kept only for the 24 h session life
    for attempt in range(3):
        operations = session_reservation_operations(c, sub) + [
            {
                "op": "put",
                "pk": idem_pk,
                "sk": "META",
                "item": {
                    "ownerSub": sub,
                    "sessionId": session_id,
                    "fingerprint": fingerprint(request),
                    "ttl": ttl_after(c, SESSION_TTL),
                },
            },
            {"op": "put", "pk": session_pk(session_id), "sk": "META", "item": item},
            {
                "op": "put",
                "pk": f"CONSENT#{sub}",
                "sk": "META",
                "overwrite": True,
                "item": {
                    "ownerSub": sub,
                    "consentVersion": request["consentVersion"],
                    "grantedAt": now.isoformat(),
                },
            },
            {"op": "check", "pk": "SERVICE#status", "sk": "META", "expect": {"accepting": True}},
        ]
        try:
            c.store.transact(operations)
            break
        except ConditionFailed as err:
            replay = c.store.get(idem_pk, "META")
            if replay:
                check_replay(replay, request)
                return _replay(c, sub, replay)
            ensure_accepting(c, new_session=True)
            if attempt == 2:
                raise AppError(409, "conflict") from err
    return session_view(session_id, item)


def _replay(c: Container, sub: str, record: dict) -> dict:
    session_id = record.get("sessionId")
    item = c.store.get(session_pk(session_id), "META") if session_id else None
    if item is None or item["ownerSub"] != sub:
        # The first request is still being processed (or failed half-way): not ours to guess.
        raise AppError(409, "conflict")
    return session_view(session_id, item)


def session_view(session_id: str, item: dict) -> dict:
    return {
        "sessionId": session_id,
        "state": item["state"],
        "changesUsed": item["changesUsed"],
        "analysesUsed": item["analysesUsed"],
        "expiresAt": item["expiresAt"],
    }


def load_session(c: Container, sub: str, session_id: str, *, allow_ended: bool = False) -> dict:
    """The caller's session, or 404. Ended or expired sessions are 409 unless allowed."""
    item = get_owned(c.store, session_pk(session_id), sub)
    if not allow_ended and (
        item["state"] == State.DONE.value or c.now().isoformat() >= item["expiresAt"]
    ):
        raise AppError(409, "session_ended")
    return item


def record_feedback(c: Container, sub: str, session_id: str, request: dict) -> None:
    kind = request["type"]
    response = request.get("adviceResponse")
    choice = request.get("comparisonChoice")
    if kind == "advice_response" and response is None:
        raise AppError(400, "invalid_request")
    if kind == "comparison" and choice is None:
        raise AppError(400, "invalid_request")

    # "finish" is allowed (and harmless) even when the session has already ended.
    session = load_session(c, sub, session_id, allow_ended=response == "finish")
    state = State(session["state"])
    pk = session_pk(session_id)

    if kind == "advice_response" and response == "finish":
        if state is not State.DONE:
            c.store.update(pk, "META", set={"state": State.DONE.value})
    elif kind == "advice_response" and response == "try":
        check_can_start_change(
            state,
            changes_used=session["changesUsed"],
            last_advice_kind=session.get("lastAdviceKind"),
        )
        try:
            c.store.update(
                pk,
                "META",
                expect={"state": [State.ADVICE_SHOWN.value, State.COMPARING.value]},
                set={"state": State.TRYING.value},
                add={"changesUsed": 1},
                caps={"changesUsed": 2},
            )
        except ConditionFailed as err:
            raise AppError(409, "conflict") from err
    elif kind == "advice_response":  # "another": a new analysis request follows
        if state is not State.ADVICE_SHOWN:
            raise AppError(409, "conflict")
    else:  # comparison
        if state is not State.COMPARING:
            raise AppError(409, "conflict")
        try:
            updated = c.store.update(
                pk,
                "META",
                expect={"state": State.COMPARING.value},
                add={"comparisons": 1},
                caps={"comparisons": MAX_COMPARISONS},
            )
        except ConditionFailed as err:
            raise AppError(409, "conflict") from err
        c.store.create_if_absent(
            pk,
            f"COMPARISON#{updated['comparisons']:03d}",
            {
                "ownerSub": sub,
                "choice": choice,
                "createdAt": c.now().isoformat(),
                "ttl": ttl_after(c, SESSION_TTL),
            },
        )


def end_session(c: Container, sub: str, session_id: str) -> None:
    """End a session: nothing new is accepted and its photos are deleted.

    A job already running cannot be stopped and we do not claim otherwise; the worker checks the
    session before and after its model calls and discards the result of an ended session.
    Safe to repeat. Also the way to withdraw: ending the session removes the photos at once.
    """
    session = load_session(c, sub, session_id, allow_ended=True)
    if session["state"] != State.DONE.value:
        session = c.store.update(session_pk(session_id), "META", set={"state": State.DONE.value})
    pending = session.get("pendingClarificationId")
    active_id = session.get("activeJobId")
    active_job = c.store.get(f"JOB#{active_id}", "META") if active_id else None
    context_id = pending or (active_job or {}).get("clarificationId")
    if context_id:
        c.store.delete(session_pk(session_id), context_key(context_id))
    try:
        c.uploads.delete_session_images(session_id)
    except PartialDeleteError as err:
        # The session is over either way. The sweeper (every 15 min) and the bucket's lifecycle
        # rule remove what is left; say so in the logs instead of pretending it all went.
        log_event("images_delete_failed", failed_count=err.failed)
