"""Fixes from the PR review: partial photo deletion and the per-session upload cap."""

import logging

from photoprep_api.aws import PartialDeleteError
from tests.integration.test_api_flow import new_session, new_upload


def test_ending_a_session_still_ends_it_when_some_photos_could_not_be_deleted(api, caplog):
    sid = new_session(api)

    def fail(session_id):
        raise PartialDeleteError(2)

    api.uploads.delete_session_images = fail
    with caplog.at_level(logging.INFO, logger="photoprep"):
        status, _, _ = api.request("DELETE", f"/sessions/{sid}")
    assert status == 202
    assert api.store.get(f"SESSION#{sid}", "META")["state"] == "DONE"
    logged = " ".join(r.getMessage() for r in caplog.records)
    assert "images_delete_failed" in logged and '"failed_count": 2' in logged
    assert sid not in logged  # ids of sessions are not needed to see that it happened


def test_one_session_cannot_mint_unlimited_upload_forms(api):
    sid = new_session(api)
    statuses = []
    for _ in range(8):
        status, _, _ = api.request(
            "POST",
            f"/sessions/{sid}/uploads",
            {"phase": "before", "contentType": "image/jpeg", "sizeBytes": 1000},
        )
        statuses.append(status)
    assert statuses[:6] == [201] * 6
    assert statuses[6:] == [429, 429]
    assert len(api.uploads.presigned) == 6  # nothing was signed beyond the cap


def test_the_cap_is_per_session(api):
    first, second = new_session(api), new_session(api)
    for _ in range(6):
        new_upload(api, first, exists=False)
    assert new_upload(api, second, exists=False)
