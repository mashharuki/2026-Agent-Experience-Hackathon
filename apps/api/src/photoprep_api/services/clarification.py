"""Answer a fixed question once; reuse only a current observation covering the chosen scope."""

from photoprep_common.clarification import context_key

from ..container import Container
from ..errors import AppError
from ..states import MAX_ANALYSES, State
from ..store import ConditionFailed
from .access import ensure_accepting, ensure_consent
from .analysis import PENDING, dispatch
from .idempotency import check_replay, fingerprint
from .session import SESSION_TTL, load_session, session_pk, session_view, ttl_after


def answer(c: Container, sub: str, session_id: str, request: dict, key: str) -> tuple[dict, int]:
    session = load_session(c, sub, session_id)
    idem_pk = f"IDEM#{sub}#{session_id}#CLARIFY#{key}"
    replay = c.store.get(idem_pk, "META")
    if replay:
        check_replay(replay, request)
        return replay["response"], replay["responseStatus"]
    ensure_consent(session)
    ensure_accepting(c)
    clarification_id = request["clarificationId"]
    if (
        session["state"] != State.CLARIFYING
        or session.get("pendingClarificationId") != clarification_id
    ):
        raise AppError(409, "conflict")
    source = c.store.get(f"JOB#{clarification_id}", "META")
    if not source or source["ownerSub"] != sub or source["status"] != "SUCCEEDED":
        raise AppError(409, "conflict")
    question = source.get("result", {}).get("clarification")
    scope = request["scope"]
    if (
        not question
        or scope not in question["allowedScopes"]
        or f"no_touch_{scope}" in session.get("restrictions", [])
    ):
        raise AppError(400, "invalid_request")
    detail = request.get("detail", "").strip()
    if question["requiresDetail"] and not detail:
        raise AppError(400, "invalid_request")
    context = c.store.get(session_pk(session_id), context_key(clarification_id))
    reusable = (
        context is not None
        and context["expiresAt"] > c.now().isoformat()
        and context["scope"] in ("look_first", scope)
        and not context.get("answerJobId")
    )
    if session["analysesUsed"] >= MAX_ANALYSES:
        raise AppError(429, "analysis_limit_reached")
    changed = {"scope": scope}
    if detail:
        changed["wish"] = detail
    expected = {
        "state": State.CLARIFYING.value,
        "pendingClarificationId": clarification_id,
        "analysesUsed": session["analysesUsed"],
        "ownerSub": sub,
    }
    writes = [{"op": "check", "pk": "SERVICE#status", "sk": "META", "expect": {"accepting": True}}]
    now = c.now().isoformat()
    if reusable:
        job_id = c.new_id()
        changed.update(state=State.ANALYZING.value, activeJobId=job_id)
        response, status = {"jobId": job_id, "status": "QUEUED"}, 202
        writes += [
            {
                "op": "put",
                "pk": f"JOB#{job_id}",
                "sk": "META",
                "item": {
                    "jobId": job_id,
                    "ownerSub": sub,
                    "sessionId": session_id,
                    "phase": "before",
                    "inputKind": "clarification",
                    "clarificationId": clarification_id,
                    "prevState": State.CONSULTING.value,
                    "status": PENDING,
                    "statusKey": PENDING,
                    "statusSince": now,
                    "createdAt": now,
                    "ttl": ttl_after(c, SESSION_TTL),
                },
            },
            {
                "op": "update",
                "pk": session_pk(session_id),
                "sk": context_key(clarification_id),
                "expect": {"expiresAt": context["expiresAt"], "sourceJobId": clarification_id},
                "set": {"answerJobId": job_id},
            },
        ]
    else:
        changed["state"] = State.CONSULTING.value
        response, status = (
            {
                "status": "capture_required",
                "session": session_view(session_id, {**session, **changed}),
            },
            200,
        )
        writes.append(
            {"op": "delete", "pk": session_pk(session_id), "sk": context_key(clarification_id)}
        )
    writes += [
        {
            "op": "update",
            "pk": session_pk(session_id),
            "sk": "META",
            "expect": expected,
            "set": changed,
            "remove": ["pendingClarificationId"],
            **(
                {"add": {"analysesUsed": 1}, "caps": {"analysesUsed": MAX_ANALYSES}}
                if reusable
                else {}
            ),
        },
        {
            "op": "put",
            "pk": idem_pk,
            "sk": "META",
            "item": {
                "ownerSub": sub,
                "fingerprint": fingerprint(request),
                "response": response,
                "responseStatus": status,
                "ttl": ttl_after(c, SESSION_TTL),
            },
        },
    ]
    try:
        c.store.transact(writes)
    except ConditionFailed as err:
        replay = c.store.get(idem_pk, "META")
        if replay:
            check_replay(replay, request)
            return replay["response"], replay["responseStatus"]
        raise AppError(409, "conflict") from err
    if reusable:
        dispatch(c, response["jobId"])
    return response, status
