"""Contract and state-boundary tests; observations are synthetic, models are not called."""

from photoprep_common.clarification import CONTEXT_LIFETIME, context_key, question

from tests.conftest import OTHER_CLAIMS
from tests.integration.test_api_flow import finish_job, new_session, new_upload, start_analysis


def seed_question(api, scope="look_first"):
    sid = new_session(api, scope=scope, restrictions=["keep_brow_shape"])
    jid = start_analysis(api, sid, new_upload(api, sid))[1]["jobId"]
    finish_job(api, jid, kind="clarify")
    metadata = question(jid, scope, ["keep_brow_shape"])
    api.store.update(
        f"JOB#{jid}",
        "META",
        set={
            "result": {
                "kind": "clarify",
                "text": "Which?",
                "basis": "user_request",
                "clarification": metadata,
            }
        },
    )
    api.store.update(f"SESSION#{sid}", "META", set={"pendingClarificationId": jid})
    until = api.clock() + CONTEXT_LIFETIME
    api.store.create_if_absent(
        f"SESSION#{sid}",
        context_key(jid),
        {
            "ownerSub": "user-123",
            "sourceJobId": jid,
            "scope": scope,
            "observation": {
                "visible": ["synthetic"],
                "uncertain": [],
                "lighting": "good",
                "framing": "ok",
                "confidence": 0.8,
            },
            "question": metadata,
            "expiresAt": until.isoformat(),
            "ttl": int(until.timestamp()),
        },
    )
    return sid, jid


def answer(api, sid, jid, **kwargs):
    return api.request(
        "POST",
        f"/sessions/{sid}/clarifications",
        {
            "clarificationId": jid,
            "scope": "brow",
            **kwargs,
        },
        idem="clarification-key",
    )


def test_answer_is_atomic_and_idempotent(api):
    sid, jid = seed_question(api)
    first = answer(api, sid, jid)
    assert first[0] == 202, first[1]
    assert answer(api, sid, jid)[1] == first[1]
    session = api.store.get(f"SESSION#{sid}", "META")
    assert session["scope"] == "brow" and session["restrictions"] == ["keep_brow_shape"]
    assert session["analysesUsed"] == 2
    job = api.store.get(f"JOB#{first[1]['jobId']}", "META")
    assert job["inputKind"] == "clarification" and "uploadId" not in job
    assert answer(api, sid, jid, scope="bangs")[0] == 409


def test_completed_answer_replays_without_another_job_or_charge(api):
    sid, jid = seed_question(api)
    first = answer(api, sid, jid)
    finish_job(api, first[1]["jobId"], kind="offer_finish")
    before = api.store.get(f"SESSION#{sid}", "META")
    sent = list(api.queue.sent)
    assert answer(api, sid, jid)[:2] == first[:2]
    assert api.store.get(f"SESSION#{sid}", "META") == before
    assert api.queue.sent == sent
    assert answer(api, sid, jid, scope="bangs")[0] == 409
    body = {"clarificationId": jid, "scope": "brow"}
    assert (
        api.request("POST", f"/sessions/{sid}/clarifications", body, idem="new-answer-key-123")[0]
        == 409
    )
    assert (
        api.request(
            "POST",
            f"/sessions/{sid}/clarifications",
            body,
            idem="clarification-key",
            claims=OTHER_CLAIMS,
        )[0]
        == 404
    )


def test_expired_or_out_of_scope_observation_requires_capture_without_spending(api):
    sid, jid = seed_question(api, scope="bangs")
    # A bangs-only observation must not be used to invent a brow observation.
    result = answer(api, sid, jid, detail="flow")
    assert result[0] == 200 and result[1]["status"] == "capture_required"
    assert api.store.get(f"SESSION#{sid}", "META")["analysesUsed"] == 1
    assert api.store.get(f"SESSION#{sid}", context_key(jid)) is None


def test_expired_observation_requires_new_photo(api):
    sid, jid = seed_question(api)
    api.clock.advance(minutes=11)
    assert answer(api, sid, jid)[0] == 200


def test_answer_requires_owner_valid_question_and_detail(api):
    sid, jid = seed_question(api, scope="brow")
    assert answer(api, sid, jid)[0] == 400
    assert answer(api, sid, jid, detail="hair direction")[0] == 202
    assert (
        api.request(
            "POST",
            f"/sessions/{sid}/clarifications",
            {"clarificationId": jid, "scope": "brow", "detail": "x"},
            idem="other-answer-key",
            claims=OTHER_CLAIMS,
        )[0]
        == 404
    )


def test_end_discards_pending_context_and_rejects_answer(api):
    sid, jid = seed_question(api)
    api.request("DELETE", f"/sessions/{sid}")
    assert api.store.get(f"SESSION#{sid}", context_key(jid)) is None
    assert answer(api, sid, jid)[0] == 409


def test_cannot_remove_restrictions_through_the_answer_contract(api):
    sid, jid = seed_question(api)
    assert answer(api, sid, jid, restrictions=[])[0] == 400


def test_end_removes_context_created_after_its_initial_session_read(api, monkeypatch):
    from photoprep_api.services import session as service

    sid, jid = seed_question(api)
    stale = api.store.get(f"SESSION#{sid}", "META")
    stale.pop("pendingClarificationId")
    stale["state"] = "ANALYZING"
    monkeypatch.setattr(service, "load_session", lambda *args, **kwargs: stale)
    service.end_session(api.container, "user-123", sid)
    assert api.store.get(f"SESSION#{sid}", context_key(jid)) is None
