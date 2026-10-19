"""No orphaned acceptance records, even if the storage response is lost."""

import pytest

from photoprep_api.services.analysis import request_analysis
from tests.integration.test_api_flow import IDEM_A, new_session, new_upload, start_analysis


def test_failed_transaction_does_not_consume_upload_or_analysis(api, monkeypatch):
    sid = new_session(api, restrictions=[])
    upload = new_upload(api, sid)
    before = api.store.get(f"SESSION#{sid}", "META")

    def fail(_operations):
        raise RuntimeError("simulated storage failure")

    monkeypatch.setattr(api.store, "transact", fail)
    with pytest.raises(RuntimeError):
        request_analysis(
            api.container, "user-123", sid, {"uploadId": upload, "phase": "before"}, IDEM_A
        )
    assert api.store.get(f"SESSION#{sid}", "META") == before
    assert api.store.get(f"UPLOAD#{upload}", "META")["used"] is False
    assert api.store.get(f"IDEM#user-123#{sid}#{IDEM_A}", "META") is None


def test_lost_transaction_response_replays_an_existing_pending_job(api, monkeypatch):
    sid = new_session(api, restrictions=[])
    upload = new_upload(api, sid)
    transact = api.store.transact

    def commit_then_lose_response(operations):
        transact(operations)
        raise RuntimeError("simulated lost acknowledgement")

    monkeypatch.setattr(api.store, "transact", commit_then_lose_response)
    with pytest.raises(RuntimeError):
        request_analysis(
            api.container, "user-123", sid, {"uploadId": upload, "phase": "before"}, IDEM_A
        )
    monkeypatch.setattr(api.store, "transact", transact)
    status, body, _ = start_analysis(api, sid, upload)
    assert status == 202
    assert api.store.get(f"JOB#{body['jobId']}", "META")["status"] == "PENDING_DISPATCH"
    assert api.store.get(f"SESSION#{sid}", "META")["analysesUsed"] == 1
    assert api.queue.sent == []  # the scheduled outbox dispatcher owns recovery


def test_changed_request_cannot_reuse_an_analysis_key(api):
    sid = new_session(api, restrictions=[])
    upload = new_upload(api, sid)
    assert start_analysis(api, sid, upload)[0] == 202
    assert api.request(
        "POST",
        f"/sessions/{sid}/analyses",
        {"uploadId": upload, "phase": "before", "tools": ["comb"]},
        idem=IDEM_A,
    )[0] in (400, 409)


def test_legacy_orphan_is_not_reported_as_accepted(api):
    sid = new_session(api, restrictions=[])
    upload = new_upload(api, sid)
    api.store.create_if_absent(
        f"IDEM#user-123#{sid}#{IDEM_A}", "META", {"ownerSub": "user-123", "jobId": "missing-job"}
    )
    assert start_analysis(api, sid, upload)[0] == 409
