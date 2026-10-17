"""The conditional writes are a second line of defence behind the precondition checks.

A stale read stands in for a concurrent request: the precheck sees old data, so only the
atomic condition in the store can stop the write.
"""

import pytest

from photoprep_api.services import analysis, session
from tests.integration.test_api_flow import (
    IDEM_A,
    IDEM_B,
    finish_job,
    new_session,
    new_upload,
    start_analysis,
)


def stale_session(monkeypatch, snapshot):
    monkeypatch.setattr(analysis, "load_session", lambda *a, **k: dict(snapshot))
    monkeypatch.setattr(session, "load_session", lambda *a, **k: dict(snapshot))


def test_analysis_counter_cap_holds_against_a_stale_read(api, monkeypatch):
    sid = new_session(api)
    upload = new_upload(api, sid)
    snapshot = api.store.get(f"SESSION#{sid}", "META")  # analysesUsed == 0 ...
    api.store.update(f"SESSION#{sid}", "META", set={"analysesUsed": 3})  # ... but really 3
    stale_session(monkeypatch, snapshot)
    status, body, _ = start_analysis(api, sid, upload)
    assert status == 409
    assert api.queue.sent == []
    assert api.store.get(f"SESSION#{sid}", "META")["analysesUsed"] == 3
    # The reservation is rolled back: the upload is usable again and no idempotency record is left.
    assert api.store.get(f"UPLOAD#{upload}", "META")["used"] is False
    assert api.store.get(f"IDEM#user-123#{sid}#{IDEM_A}", "META") is None


def test_state_change_between_check_and_write_is_a_conflict(api, monkeypatch):
    sid = new_session(api)
    upload = new_upload(api, sid)
    snapshot = api.store.get(f"SESSION#{sid}", "META")  # CONSULTING
    api.store.update(f"SESSION#{sid}", "META", set={"state": "ANALYZING"})  # another request won
    stale_session(monkeypatch, snapshot)
    assert start_analysis(api, sid, upload)[0] == 409
    assert api.queue.sent == []


def test_change_counter_cap_holds_against_a_stale_read(api, monkeypatch):
    sid = new_session(api)
    job_id = start_analysis(api, sid, new_upload(api, sid))[1]["jobId"]
    finish_job(api, job_id)  # ADVICE_SHOWN, changesUsed 0
    snapshot = api.store.get(f"SESSION#{sid}", "META")
    api.store.update(f"SESSION#{sid}", "META", set={"changesUsed": 2})
    stale_session(monkeypatch, snapshot)
    status, body, _ = api.request(
        "POST", f"/sessions/{sid}/feedback", {"type": "advice_response", "adviceResponse": "try"}
    )
    assert (status, body["code"]) == (409, "conflict")
    item = api.store.get(f"SESSION#{sid}", "META")
    assert item["changesUsed"] == 2 and item["state"] == "ADVICE_SHOWN"


def test_an_upload_used_by_a_concurrent_request_cannot_be_reused(api, monkeypatch):
    sid = new_session(api)
    upload = new_upload(api, sid)
    real_get_owned = analysis.get_owned

    def stale_upload(store, pk, sub, sk="META"):
        item = real_get_owned(store, pk, sub, sk)
        if pk.startswith("UPLOAD#"):
            item["used"] = False  # the precheck saw it as free
        return item

    api.store.update(f"UPLOAD#{upload}", "META", set={"used": True})  # someone just took it
    monkeypatch.setattr(analysis, "get_owned", stale_upload)
    status, body, _ = start_analysis(api, sid, upload, idem=IDEM_B)
    assert (status, body["code"]) == (409, "conflict")
    assert api.queue.sent == []
    assert api.store.get(f"SESSION#{sid}", "META")["analysesUsed"] == 0


@pytest.mark.parametrize("status", ["RUNNING", "SUCCEEDED", "CANCELLED"])
def test_dispatch_never_overwrites_a_job_that_moved_on(api, status):
    sid = new_session(api)
    api.queue.fail = True
    job_id = start_analysis(api, sid, new_upload(api, sid))[1]["jobId"]
    api.queue.fail = False
    api.store.update(f"JOB#{job_id}", "META", set={"status": status})
    analysis.dispatch(api.container, job_id)
    assert api.store.get(f"JOB#{job_id}", "META")["status"] == status
