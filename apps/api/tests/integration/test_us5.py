"""US5: the door (is the service accepting work), consent, quotas and ending a session."""

import logging
from datetime import UTC, datetime

import pytest

from photoprep_api.container import Limits
from tests.conftest import CONSENT_VERSION, GOOD_SESSION, OTHER_CLAIMS
from tests.integration.test_api_flow import (
    IDEM_A,
    IDEM_B,
    finish_job,
    fresh_key,
    new_session,
    new_upload,
    session_item,
    start_analysis,
)

PHOTO = {"phase": "before", "contentType": "image/png", "sizeBytes": 10}


def create(api, claims=None, **overrides):
    kwargs = {"claims": claims} if claims else {}
    return api.request(
        "POST", "/sessions", {**GOOD_SESSION, **overrides}, idem=fresh_key(), **kwargs
    )


class TestServiceStatus:
    def test_open(self, api):
        status, body, _ = api.request("GET", "/service-status")
        assert (status, body) == (200, {"accepting": True, "reason": "open"})

    def test_no_record_means_not_accepting(self, api):
        api.store.delete("SERVICE#status", "META")
        assert api.request("GET", "/service-status")[1] == {
            "accepting": False,
            "reason": "worker_stopped",
        }

    def test_warming_up_comes_with_the_expected_reopen_time(self, api):
        api.close_door("warming_up", expected_reopen_at="2026-10-18T09:05:00+00:00")
        status, body, _ = api.request("GET", "/service-status")
        assert status == 200
        assert body == {
            "accepting": False,
            "reason": "warming_up",
            "expectedReopenAt": "2026-10-18T09:05:00+00:00",
        }

    def test_a_drain_in_progress_is_reported_as_maintenance_without_internal_fields(self, api):
        api.close_door("maintenance", draining=True)
        assert api.request("GET", "/service-status")[1] == {
            "accepting": False,
            "reason": "maintenance",
        }

    def test_a_used_up_overall_quota_closes_the_door_even_if_the_worker_is_up(self, api):
        api.container.limits = Limits(user_per_day=5, global_per_day=1)
        assert create(api)[0] == 201
        assert api.request("GET", "/service-status")[1] == {
            "accepting": False,
            "reason": "quota_exhausted",
        }


class TestDoorClosed:
    def test_a_closed_door_stops_new_sessions_uploads_and_analyses(self, api):
        sid = new_session(api)
        upload = new_upload(api, sid)
        api.close_door("worker_stopped")
        for status, body, _ in (
            create(api),
            api.request("POST", f"/sessions/{sid}/uploads", PHOTO),
            start_analysis(api, sid, upload, idem=IDEM_B),
        ):
            assert (status, body["code"]) == (503, "not_accepting")
        assert api.queue.sent == []

    def test_the_user_can_still_finish_check_and_end_while_it_is_closed(self, api):
        sid = new_session(api)
        job_id = start_analysis(api, sid, new_upload(api, sid))[1]["jobId"]
        finish_job(api, job_id)
        api.close_door("maintenance", draining=True)
        assert api.request("GET", f"/jobs/{job_id}")[0] == 200
        assert (
            api.request(
                "POST",
                f"/sessions/{sid}/feedback",
                {"type": "advice_response", "adviceResponse": "finish"},
            )[0]
            == 204
        )
        assert api.request("DELETE", f"/sessions/{sid}")[0] == 202

    def test_a_retry_of_an_accepted_analysis_still_returns_the_same_job(self, api):
        sid = new_session(api)
        upload = new_upload(api, sid)
        first = start_analysis(api, sid, upload)
        api.close_door("maintenance", draining=True)
        again = start_analysis(api, sid, upload)
        assert again[0] == 202 and again[1]["jobId"] == first[1]["jobId"]

    def test_reopening_lets_work_continue(self, api):
        api.close_door("worker_stopped")
        assert create(api)[0] == 503
        api.open_door()
        assert create(api)[0] == 201


class TestConsent:
    def test_the_current_wording_is_recorded(self, api):
        create(api)
        assert api.store.get("CONSENT#user-123", "META")["consentVersion"] == CONSENT_VERSION

    @pytest.mark.parametrize("version", ["v1", "2025-01-v0", "x" * 32])
    def test_an_unknown_consent_version_is_refused_and_nothing_is_created(self, api, version):
        status, body, _ = create(api, consentVersion=version)
        assert (status, body["code"]) == (400, "consent_required")
        assert api.store.get("CONSENT#user-123", "META") is None
        assert api.queue.sent == []

    def test_the_session_remembers_which_wording_was_agreed_to(self, api):
        sid = create(api)[1]["sessionId"]
        assert session_item(api, sid)["consentVersion"] == CONSENT_VERSION

    def test_a_session_without_valid_consent_cannot_upload_or_analyse(self, api):
        sid = new_session(api)
        upload = new_upload(api, sid)
        api.store.update(f"SESSION#{sid}", "META", set={"consentVersion": "withdrawn"})
        status, body, _ = api.request("POST", f"/sessions/{sid}/uploads", PHOTO)
        assert (status, body["code"]) == (403, "consent_required")
        status, body, _ = start_analysis(api, sid, upload, idem=IDEM_B)
        assert (status, body["code"]) == (403, "consent_required")
        assert api.queue.sent == []

    def test_a_session_from_before_consent_was_recorded_is_treated_as_unconsented(self, api):
        sid = new_session(api)
        api.store.update(f"SESSION#{sid}", "META", remove=["consentVersion"])
        assert api.request("POST", f"/sessions/{sid}/uploads", PHOTO)[0] == 403


class TestQuota:
    def test_each_person_gets_a_daily_number_of_sessions(self, api):
        api.container.limits = Limits(user_per_day=2, global_per_day=100)
        assert create(api)[0] == 201 and create(api)[0] == 201
        status, body, _ = create(api)
        assert (status, body["code"]) == (429, "quota_exceeded")
        assert create(api, claims=OTHER_CLAIMS)[0] == 201  # someone else is not affected

    def test_the_count_starts_again_the_next_day_in_japan(self, api):
        api.container.limits = Limits(user_per_day=1, global_per_day=100)
        api.clock.current = datetime(2026, 10, 18, 14, 0, tzinfo=UTC)  # 23:00 JST
        assert create(api)[0] == 201
        assert create(api)[0] == 429
        api.clock.advance(hours=2)  # 01:00 JST the next day
        assert create(api)[0] == 201

    def test_the_overall_daily_limit_applies_to_everyone(self, api):
        api.container.limits = Limits(user_per_day=5, global_per_day=2)
        assert create(api)[0] == 201 and create(api, claims=OTHER_CLAIMS)[0] == 201
        third = {**OTHER_CLAIMS, "sub": "user-789"}
        status, body, _ = create(api, claims=third)
        assert (status, body["code"]) == (429, "quota_exceeded")

    def test_a_refused_session_does_not_use_up_the_persons_own_allowance(self, api):
        api.container.limits = Limits(user_per_day=2, global_per_day=1)
        assert create(api)[0] == 201  # uses the single overall slot and one personal slot
        other = {**OTHER_CLAIMS, "sub": "user-789"}
        assert create(api, claims=other)[0] == 429  # blocked by the overall limit ...
        api.container.limits = Limits(user_per_day=2, global_per_day=100)
        assert (
            create(api, claims=other)[0] == 201 and create(api, claims=other)[0] == 201
        )  # ... allowance intact

    def test_the_overall_limit_holds_against_a_stale_door_reading(self, api, monkeypatch):
        """The door check is a first filter; the atomic counter really enforces the limit."""
        from photoprep_api.services import access

        api.container.limits = Limits(user_per_day=5, global_per_day=1)
        assert create(api)[0] == 201
        monkeypatch.setattr(
            access, "public_status", lambda c: {"accepting": True, "reason": "open"}
        )
        other = {**OTHER_CLAIMS, "sub": "user-789"}
        status, body, _ = create(api, claims=other)
        assert (status, body["code"]) == (429, "quota_exceeded")
        # The refused person's own count was given back: the slot used for the attempt is not lost.
        count = api.store.get("QUOTA#USER#user-789#2026-10-18", "META")["count"]
        assert count == 0

    def test_people_already_in_a_session_are_not_cut_off_when_the_overall_quota_runs_out(self, api):
        api.container.limits = Limits(user_per_day=5, global_per_day=1)
        sid = create(api)[1]["sessionId"]  # takes the last overall slot
        assert api.request("GET", "/service-status")[1]["reason"] == "quota_exhausted"
        upload = new_upload(api, sid)  # still allowed: this person's session already exists
        assert start_analysis(api, sid, upload)[0] == 202

    def test_an_invalid_request_does_not_use_a_slot(self, api):
        api.container.limits = Limits(user_per_day=1, global_per_day=100)
        assert create(api, consentVersion="old")[0] == 400
        assert create(api)[0] == 201

    def test_the_quota_is_applied_to_analyses_per_session_as_before(self, api):
        sid = new_session(api)
        for n in range(3):
            body = start_analysis(api, sid, new_upload(api, sid), idem=f"{n}" * 16)[1]
            finish_job(api, body["jobId"], "clarify")
        assert start_analysis(api, sid, new_upload(api, sid), idem="9" * 16)[0] == 429


class TestEndSession:
    def test_ending_a_session_closes_it_and_removes_its_photos(self, api):
        sid = new_session(api)
        new_upload(api, sid)
        new_upload(api, sid, phase="after")
        assert len(api.uploads.objects) == 2
        status, _, _ = api.request("DELETE", f"/sessions/{sid}")
        assert status == 202
        assert session_item(api, sid)["state"] == "DONE"
        assert api.uploads.objects == {}
        assert api.uploads.deleted_sessions == [sid]

    def test_nothing_new_is_accepted_afterwards(self, api):
        sid = new_session(api)
        upload = new_upload(api, sid)
        api.request("DELETE", f"/sessions/{sid}")
        for status, body, _ in (
            api.request("POST", f"/sessions/{sid}/uploads", PHOTO),
            start_analysis(api, sid, upload, idem=IDEM_B),
        ):
            assert (status, body["code"]) == (409, "session_ended")

    def test_ending_twice_is_fine(self, api):
        sid = new_session(api)
        assert api.request("DELETE", f"/sessions/{sid}")[0] == 202
        assert api.request("DELETE", f"/sessions/{sid}")[0] == 202

    def test_a_job_that_was_running_is_left_for_the_worker_to_cancel(self, api):
        """The API cannot stop a model call already in flight and does not claim to."""
        sid = new_session(api)
        job_id = start_analysis(api, sid, new_upload(api, sid))[1]["jobId"]
        api.request("DELETE", f"/sessions/{sid}")
        assert api.store.get(f"JOB#{job_id}", "META")["status"] == "QUEUED"
        assert session_item(api, sid)["state"] == "DONE"  # the worker checks this before and after

    def test_another_persons_session_cannot_be_ended(self, api):
        sid = new_session(api)
        assert api.request("DELETE", f"/sessions/{sid}", claims=OTHER_CLAIMS)[0] == 404
        assert session_item(api, sid)["state"] == "CONSULTING"
        assert api.request("DELETE", "/sessions/doesnotexist1")[0] == 404


def test_the_users_words_and_photos_never_reach_the_logs(api, caplog):
    caplog.set_level(logging.DEBUG)
    secret = "秘密の希望文SECRET"
    sid = api.request("POST", "/sessions", {**GOOD_SESSION, "wish": secret}, idem=IDEM_A)[1][
        "sessionId"
    ]
    upload = new_upload(api, sid)
    start_analysis(api, sid, upload)
    api.request("DELETE", f"/sessions/{sid}")
    api.request("POST", "/sessions", {**GOOD_SESSION, "wish": secret, "scope": "bad"}, idem=IDEM_B)
    assert secret not in caplog.text
    assert "uploads/" not in caplog.text or sid not in caplog.text.split("uploads/")[0]
