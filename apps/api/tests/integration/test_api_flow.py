"""T027/T028: end-to-end behaviour of the HTTP API over in-memory fakes (no AWS)."""

import itertools

import pytest

from photoprep_api.states import state_after_job
from tests.conftest import CONSENT_VERSION, GOOD_SESSION, OTHER_CLAIMS

IDEM_A = "a" * 16
IDEM_B = "b" * 16


_session_counter = itertools.count(1)


def fresh_key() -> str:
    """Each new session needs its own Idempotency-Key; the same key replays the same session."""
    return f"s{next(_session_counter):015d}"


def new_session(api, **overrides):
    status, body, _ = api.request(
        "POST", "/sessions", {**GOOD_SESSION, **overrides}, idem=fresh_key()
    )
    assert status == 201, body
    return body["sessionId"]


def new_upload(api, session_id, phase="before", exists=True, claims=None):
    kwargs = {"claims": claims} if claims else {}
    status, body, _ = api.request(
        "POST",
        f"/sessions/{session_id}/uploads",
        {"phase": phase, "contentType": "image/jpeg", "sizeBytes": 1000},
        **kwargs,
    )
    assert status == 201, body
    if exists:
        api.uploads.put_object(api.uploads.presigned[-1]["key"], 1000)
    return body["uploadId"]


def start_analysis(api, session_id, upload_id, phase="before", idem=IDEM_A):
    return api.request(
        "POST",
        f"/sessions/{session_id}/analyses",
        {"uploadId": upload_id, "phase": phase},
        idem=idem,
    )


def finish_job(api, job_id, kind="grooming_tip", comparable=True):
    """Do what the worker will do: store the result and move the session on (test double)."""
    job = api.store.get(f"JOB#{job_id}", "META")
    new_state = state_after_job(kind, job["phase"], comparable)
    api.store.update(
        f"JOB#{job_id}",
        "META",
        set={
            "status": "SUCCEEDED",
            "result": {
                "kind": kind,
                "text": "眉ブラシで毛流れを整えましょう",
                "basis": "observation",
            },
        },
    )
    api.store.update(
        f"SESSION#{job['sessionId']}",
        "META",
        set={"state": new_state.value, "lastAdviceKind": kind},
    )


def session_item(api, session_id):
    return api.store.get(f"SESSION#{session_id}", "META")


class TestCreateSession:
    def test_creates_a_consulting_session_owned_by_the_caller(self, api):
        status, body, _ = api.request(
            "POST", "/sessions", {**GOOD_SESSION, "wish": "眉の形は変えたくない"}, idem=IDEM_A
        )
        assert status == 201
        assert (
            body["state"] == "CONSULTING" and body["changesUsed"] == 0 and body["analysesUsed"] == 0
        )
        item = session_item(api, body["sessionId"])
        assert item["ownerSub"] == "user-123"
        assert item["restrictions"] == ["no_touch_brow"]
        assert item["wish"] == "眉の形は変えたくない"

    def test_records_the_consent_version(self, api):
        new_session(api)
        consent = api.store.get("CONSENT#user-123", "META")
        assert consent["consentVersion"] == CONSENT_VERSION and consent["grantedAt"]

    def test_session_expires_after_24_hours(self, api):
        sid = new_session(api)
        item = session_item(api, sid)
        assert item["expiresAt"] == "2026-10-19T09:00:00+00:00"
        assert item["ttl"] == int(api.clock().timestamp()) + 24 * 3600


class TestUploads:
    def test_the_server_decides_key_size_and_expiry(self, api):
        sid = new_session(api)
        status, body, _ = api.request(
            "POST",
            f"/sessions/{sid}/uploads",
            {"phase": "before", "contentType": "image/png", "sizeBytes": 10},
        )
        assert status == 201
        presign = api.uploads.presigned[-1]
        assert presign["max_bytes"] == 2 * 1024 * 1024  # not the client-declared 10
        assert presign["expires_s"] == 60
        assert presign["content_type"] == "image/png"
        assert presign["key"].startswith(f"uploads/{sid}/")
        assert "user-123" not in presign["key"]
        assert body["fields"]["key"] == presign["key"]

    def test_unknown_or_foreign_session_is_404(self, api):
        sid = new_session(api)
        body = {"phase": "before", "contentType": "image/png", "sizeBytes": 10}
        assert api.request("POST", "/sessions/doesnotexist1/uploads", body)[0] == 404
        assert api.request("POST", f"/sessions/{sid}/uploads", body, claims=OTHER_CLAIMS)[0] == 404

    def test_ended_session_refuses_uploads(self, api):
        sid = new_session(api)
        api.store.update(f"SESSION#{sid}", "META", set={"state": "DONE"})
        status, body, _ = api.request(
            "POST",
            f"/sessions/{sid}/uploads",
            {"phase": "before", "contentType": "image/png", "sizeBytes": 10},
        )
        assert (status, body["code"]) == (409, "session_ended")

    def test_expired_session_refuses_uploads(self, api):
        sid = new_session(api)
        api.clock.advance(hours=25)
        status, body, _ = api.request(
            "POST",
            f"/sessions/{sid}/uploads",
            {"phase": "before", "contentType": "image/png", "sizeBytes": 10},
        )
        assert (status, body["code"]) == (409, "session_ended")


class TestRequestAnalysis:
    def test_accepts_enqueues_only_the_job_id_and_marks_it_queued(self, api):
        sid = new_session(api)
        status, body, _ = start_analysis(api, sid, new_upload(api, sid))
        assert status == 202 and body["status"] == "QUEUED"
        job_id = body["jobId"]
        assert api.queue.sent == [job_id]  # nothing but the job id leaves the API
        job = api.store.get(f"JOB#{job_id}", "META")
        assert job["status"] == "QUEUED" and "statusKey" not in job  # out of the sparse index
        assert job["ownerSub"] == "user-123" and job["sessionId"] == sid
        assert job["prevState"] == "CONSULTING"  # restored by the worker if the job fails
        item = session_item(api, sid)
        assert item["state"] == "ANALYZING" and item["analysesUsed"] == 1

    def test_same_idempotency_key_returns_the_same_job_without_new_cost(self, api):
        sid = new_session(api)
        upload = new_upload(api, sid)
        first = start_analysis(api, sid, upload)
        second = start_analysis(api, sid, upload)
        assert first[0] == second[0] == 202 and first[1]["jobId"] == second[1]["jobId"]
        assert api.queue.sent == [first[1]["jobId"]]
        assert session_item(api, sid)["analysesUsed"] == 1

    def test_an_upload_can_be_used_once(self, api):
        sid = new_session(api)
        upload = new_upload(api, sid)
        assert start_analysis(api, sid, upload, idem=IDEM_A)[0] == 202
        finish_job(api, api.queue.sent[0], "clarify")
        status, body, _ = start_analysis(api, sid, upload, idem=IDEM_B)
        assert (status, body["code"]) == (409, "conflict")

    def test_missing_image_is_refused_and_costs_nothing(self, api):
        sid = new_session(api)
        status, body, _ = start_analysis(api, sid, new_upload(api, sid, exists=False))
        assert (status, body["code"]) == (400, "invalid_request")
        assert api.queue.sent == [] and session_item(api, sid)["analysesUsed"] == 0

    def test_oversized_object_is_refused(self, api):
        sid = new_session(api)
        upload = new_upload(api, sid)
        api.uploads.put_object(api.uploads.presigned[-1]["key"], 3 * 1024 * 1024)
        assert start_analysis(api, sid, upload)[0] == 400

    def test_phase_must_match_the_upload_and_the_state(self, api):
        sid = new_session(api)
        assert (
            start_analysis(api, sid, new_upload(api, sid, phase="after"), phase="after")[0] == 409
        )  # not TRYING
        assert (
            start_analysis(api, sid, new_upload(api, sid, phase="before"), phase="after")[0] == 400
        )  # mismatch

    def test_an_upload_from_another_session_or_user_is_not_found(self, api):
        sid = new_session(api)
        other_session = new_session(api)
        foreign_upload = new_upload(api, other_session)
        assert start_analysis(api, sid, foreign_upload)[0] == 404
        assert start_analysis(api, "doesnotexist1", new_upload(api, sid))[0] == 404
        status, _, _ = api.request(
            "POST",
            f"/sessions/{sid}/analyses",
            {"uploadId": new_upload(api, sid), "phase": "before"},
            claims=OTHER_CLAIMS,
            idem=IDEM_B,
        )
        assert status == 404

    def test_fourth_analysis_is_refused(self, api):
        sid = new_session(api)
        for n in range(3):
            upload = new_upload(api, sid)
            status, body, _ = start_analysis(api, sid, upload, idem=f"{n}" * 16)
            assert status == 202, body
            finish_job(api, body["jobId"], "capture_setup_tip")
        status, body, _ = start_analysis(api, sid, new_upload(api, sid), idem="9" * 16)
        assert (status, body["code"]) == (429, "analysis_limit_reached")
        assert len(api.queue.sent) == 3

    def test_a_second_analysis_while_one_is_running_is_a_conflict(self, api):
        sid = new_session(api)
        assert start_analysis(api, sid, new_upload(api, sid), idem=IDEM_A)[0] == 202
        status, body, _ = start_analysis(api, sid, new_upload(api, sid), idem=IDEM_B)
        assert (status, body["code"]) == (409, "conflict")

    def test_queue_failure_leaves_the_job_pending_dispatch_but_accepted(self, api):
        sid = new_session(api)
        api.queue.fail = True
        status, body, _ = start_analysis(api, sid, new_upload(api, sid))
        assert status == 202 and body["status"] == "QUEUED"
        job = api.store.get(f"JOB#{body['jobId']}", "META")
        assert job["status"] == "PENDING_DISPATCH" and job["statusKey"] == "PENDING_DISPATCH"


class TestGetJob:
    def test_pending_dispatch_is_reported_as_queued(self, api):
        sid = new_session(api)
        api.queue.fail = True
        job_id = start_analysis(api, sid, new_upload(api, sid))[1]["jobId"]
        status, body, _ = api.request("GET", f"/jobs/{job_id}")
        assert (status, body) == (200, {"jobId": job_id, "status": "QUEUED"})

    def test_succeeded_job_returns_the_advice(self, api):
        sid = new_session(api)
        job_id = start_analysis(api, sid, new_upload(api, sid))[1]["jobId"]
        finish_job(api, job_id)
        status, body, _ = api.request("GET", f"/jobs/{job_id}")
        assert status == 200 and body["status"] == "SUCCEEDED"
        assert body["advice"]["kind"] == "grooming_tip" and body["advice"]["basis"] == "observation"

    def test_failed_job_reports_the_error_class_only(self, api):
        sid = new_session(api)
        job_id = start_analysis(api, sid, new_upload(api, sid))[1]["jobId"]
        api.store.update(
            f"JOB#{job_id}", "META", set={"status": "FAILED", "errorClass": "model_error"}
        )
        status, body, _ = api.request("GET", f"/jobs/{job_id}")
        assert (status, body) == (
            200,
            {"jobId": job_id, "status": "FAILED", "errorClass": "model_error"},
        )

    def test_another_users_job_looks_missing(self, api):
        sid = new_session(api)
        job_id = start_analysis(api, sid, new_upload(api, sid))[1]["jobId"]
        assert api.request("GET", f"/jobs/{job_id}", claims=OTHER_CLAIMS)[0] == 404
        assert api.request("GET", "/jobs/doesnotexist1")[0] == 404


class TestFeedback:
    def to_advice(self, api):
        sid = new_session(api)
        job_id = start_analysis(api, sid, new_upload(api, sid))[1]["jobId"]
        finish_job(api, job_id)
        assert session_item(api, sid)["state"] == "ADVICE_SHOWN"
        return sid

    def feedback(self, api, sid, body, claims=None):
        kwargs = {"claims": claims} if claims else {}
        return api.request("POST", f"/sessions/{sid}/feedback", body, **kwargs)

    def test_trying_a_suggestion_starts_a_change(self, api):
        sid = self.to_advice(api)
        status, _, _ = self.feedback(api, sid, {"type": "advice_response", "adviceResponse": "try"})
        assert status == 204
        item = session_item(api, sid)
        assert item["state"] == "TRYING" and item["changesUsed"] == 1

    def test_asking_for_another_suggestion_keeps_the_state(self, api):
        sid = self.to_advice(api)
        assert (
            self.feedback(api, sid, {"type": "advice_response", "adviceResponse": "another"})[0]
            == 204
        )
        item = session_item(api, sid)
        assert item["state"] == "ADVICE_SHOWN" and item["changesUsed"] == 0

    def test_finishing_ends_the_session_from_any_state(self, api):
        sid = new_session(api)
        assert (
            self.feedback(api, sid, {"type": "advice_response", "adviceResponse": "finish"})[0]
            == 204
        )
        assert session_item(api, sid)["state"] == "DONE"

    def to_comparison(self, api, next_kind="grooming_tip", changes_used=1):
        sid = new_session(api)
        job_id = start_analysis(api, sid, new_upload(api, sid))[1]["jobId"]
        finish_job(api, job_id)
        assert (
            self.feedback(api, sid, {"type": "advice_response", "adviceResponse": "try"})[0] == 204
        )
        after = start_analysis(
            api, sid, new_upload(api, sid, phase="after"), phase="after", idem="c" * 16
        )
        assert after[0] == 202, after
        finish_job(api, after[1]["jobId"], next_kind)
        assert session_item(api, sid)["state"] == "COMPARING"
        return sid

    def test_one_more_change_starts_from_the_comparison_without_a_new_analysis(self, api):
        sid = self.to_comparison(api)
        sent_before = len(api.queue.sent)
        status, _, _ = self.feedback(api, sid, {"type": "advice_response", "adviceResponse": "try"})
        assert status == 204
        item = session_item(api, sid)
        assert item["state"] == "TRYING" and item["changesUsed"] == 2
        assert item["analysesUsed"] == 2  # two changes fit in three analyses
        assert len(api.queue.sent) == sent_before

    def test_the_second_change_check_is_the_third_and_last_analysis(self, api):
        sid = self.to_comparison(api)
        self.feedback(api, sid, {"type": "advice_response", "adviceResponse": "try"})
        status, body, _ = start_analysis(
            api, sid, new_upload(api, sid, phase="after"), phase="after", idem="d" * 16
        )
        assert status == 202, body
        assert session_item(api, sid)["analysesUsed"] == 3

    def test_no_second_change_when_the_check_offered_no_next_suggestion(self, api):
        sid = self.to_comparison(api, next_kind="offer_finish")
        status, body, _ = self.feedback(
            api, sid, {"type": "advice_response", "adviceResponse": "try"}
        )
        assert (status, body["code"]) == (409, "conflict")

    def test_a_comparison_with_changes_used_up_cannot_start_another(self, api):
        sid = self.to_comparison(api)
        api.store.update(f"SESSION#{sid}", "META", set={"changesUsed": 2})
        status, body, _ = self.feedback(
            api, sid, {"type": "advice_response", "adviceResponse": "try"}
        )
        assert (status, body["code"]) == (409, "change_limit_reached")

    def test_cannot_start_a_change_without_advice(self, api):
        sid = new_session(api)
        status, body, _ = self.feedback(
            api, sid, {"type": "advice_response", "adviceResponse": "try"}
        )
        assert (status, body["code"]) == (409, "conflict")

    def test_the_third_change_is_refused(self, api):
        sid = self.to_advice(api)
        api.store.update(f"SESSION#{sid}", "META", set={"changesUsed": 2})
        status, body, _ = self.feedback(
            api, sid, {"type": "advice_response", "adviceResponse": "try"}
        )
        assert (status, body["code"]) == (409, "change_limit_reached")
        assert session_item(api, sid)["changesUsed"] == 2

    def test_comparison_choice_is_recorded_and_respected(self, api):
        sid = self.to_advice(api)
        api.store.update(f"SESSION#{sid}", "META", set={"state": "COMPARING"})
        assert (
            self.feedback(api, sid, {"type": "comparison", "comparisonChoice": "prefer_before"})[0]
            == 204
        )
        recorded = api.store.get(f"SESSION#{sid}", "COMPARISON#001")
        assert recorded["choice"] == "prefer_before"
        assert session_item(api, sid)["state"] == "COMPARING"  # nothing is forced next

    def test_comparison_only_while_comparing(self, api):
        sid = self.to_advice(api)
        status, body, _ = self.feedback(
            api, sid, {"type": "comparison", "comparisonChoice": "unclear"}
        )
        assert (status, body["code"]) == (409, "conflict")

    @pytest.mark.parametrize(
        "payload",
        [
            {"type": "advice_response"},
            {"type": "comparison"},
            {"type": "advice_response", "comparisonChoice": "unclear"},
        ],
    )
    def test_the_type_decides_which_field_is_required(self, api, payload):
        sid = self.to_advice(api)
        assert self.feedback(api, sid, payload)[0] == 400

    def test_another_users_session_is_not_found(self, api):
        sid = self.to_advice(api)
        assert (
            self.feedback(
                api, sid, {"type": "advice_response", "adviceResponse": "try"}, claims=OTHER_CLAIMS
            )[0]
            == 404
        )
