"""SC-007: unauthenticated callers, other users, oversized input, ended and expired sessions
are refused on every operation."""

import pytest

from tests.conftest import GOOD_SESSION, OTHER_CLAIMS, make_event
from tests.integration.test_api_flow import new_session, new_upload, start_analysis

PHOTO = {"phase": "before", "contentType": "image/png", "sizeBytes": 10}


def operations(sid, job_id, upload_id):
    """Every operation that touches a session or a job, with a valid body."""
    return [
        ("POST", f"/sessions/{sid}/uploads", PHOTO),
        ("POST", f"/sessions/{sid}/analyses", {"uploadId": upload_id, "phase": "before"}),
        (
            "POST",
            f"/sessions/{sid}/feedback",
            {"type": "advice_response", "adviceResponse": "finish"},
        ),
        ("DELETE", f"/sessions/{sid}", None),
        ("GET", f"/jobs/{job_id}", None),
    ]


@pytest.fixture
def world(api):
    sid = new_session(api)
    upload = new_upload(api, sid)
    job_id = start_analysis(api, sid, upload)[1]["jobId"]
    return api, sid, job_id, upload


def test_no_operation_works_without_authentication(world):
    api, sid, job_id, upload = world
    every = operations(sid, job_id, upload) + [
        ("POST", "/sessions", GOOD_SESSION),
        ("GET", "/service-status", None),
    ]
    for method, path, body in every:
        event = make_event(method, path, body, {"idempotency-key": "k" * 16}, claims=None)
        status, _, _ = api.call(event)
        assert status == 401, (method, path)


def test_an_id_token_or_a_token_without_the_scope_is_not_accepted(world):
    api, sid, job_id, upload = world
    bad_claims = [
        {"sub": "user-123", "scope": "photoprep/session", "token_use": "id"},
        {"sub": "user-123", "scope": "openid email", "token_use": "access"},
    ]
    for claims in bad_claims:
        for method, path, body in operations(sid, job_id, upload):
            assert api.request(method, path, body, claims=claims, idem="k" * 16)[0] == 401


def test_another_user_cannot_use_or_even_detect_anyone_elses_session_or_job(world):
    api, sid, job_id, upload = world
    for method, path, body in operations(sid, job_id, upload):
        status, body_out, _ = api.request(method, path, body, claims=OTHER_CLAIMS, idem="o" * 16)
        assert status == 404, (method, path)
        assert body_out["code"] == "not_found"
    assert api.store.get(f"SESSION#{sid}", "META")["state"] == "ANALYZING"  # nothing changed


def test_the_answer_is_identical_for_a_missing_and_a_foreign_resource(world):
    api, sid, job_id, upload = world
    foreign = api.request("GET", f"/jobs/{job_id}", claims=OTHER_CLAIMS)
    missing = api.request("GET", "/jobs/doesnotexist1", claims=OTHER_CLAIMS)
    assert foreign[:2] == missing[:2]


@pytest.mark.parametrize(
    "body",
    [
        {**PHOTO, "sizeBytes": 2 * 1024 * 1024 + 1},
        {**PHOTO, "sizeBytes": 0},
        {**PHOTO, "contentType": "image/gif"},
        {**PHOTO, "contentType": "text/html"},
    ],
)
def test_oversized_or_unexpected_photos_are_refused_before_anything_is_signed(api, body):
    sid = new_session(api)
    status, _, _ = api.request("POST", f"/sessions/{sid}/uploads", body)
    assert status == 400
    assert api.uploads.presigned == []


def test_nothing_works_on_an_ended_session(api):
    sid = new_session(api)
    upload = new_upload(api, sid)
    api.request("DELETE", f"/sessions/{sid}")
    assert api.request("POST", f"/sessions/{sid}/uploads", PHOTO)[0] == 409
    assert start_analysis(api, sid, upload, idem="e" * 16)[0] == 409
    assert (
        api.request(
            "POST",
            f"/sessions/{sid}/feedback",
            {"type": "advice_response", "adviceResponse": "try"},
        )[0]
        == 409
    )


def test_nothing_works_on_an_expired_session(api):
    sid = new_session(api)
    upload = new_upload(api, sid)
    api.clock.advance(hours=25)
    assert api.request("POST", f"/sessions/{sid}/uploads", PHOTO)[0] == 409
    assert start_analysis(api, sid, upload, idem="e" * 16)[0] == 409


def test_a_signed_upload_only_ever_names_the_server_chosen_key(api):
    sid = new_session(api)
    status, body, _ = api.request("POST", f"/sessions/{sid}/uploads", PHOTO)
    assert status == 201
    assert body["fields"]["key"].startswith(f"uploads/{sid}/")
    assert api.uploads.presigned[-1]["max_bytes"] == 2 * 1024 * 1024
    assert api.uploads.presigned[-1]["expires_s"] == 60
