"""POST /sessions honours its Idempotency-Key (the contract requires the header)."""

from tests.conftest import GOOD_SESSION

KEY = "k" * 16


def create(api, key=KEY, **overrides):
    return api.request("POST", "/sessions", {**GOOD_SESSION, **overrides}, idem=key)


def test_a_retry_with_the_same_key_returns_the_same_session(api):
    first_status, first, _ = create(api)
    second_status, second, _ = create(api)
    assert first_status == 201 and second_status == 201
    assert second["sessionId"] == first["sessionId"]


def test_a_retry_does_not_use_a_second_daily_slot(api):
    create(api)
    create(api)
    user_keys = [pk for pk in _quota_partition_keys(api) if pk.startswith("QUOTA#USER#")]
    assert len(user_keys) == 1
    assert api.store.get(user_keys[0], "META")["count"] == 1


def _quota_partition_keys(api):
    store = api.store
    if hasattr(store, "_items"):
        return [pk for (pk, _sk) in store._items if pk.startswith("QUOTA#")]
    return [i["pk"] for i in store._table.scan()["Items"] if i["pk"].startswith("QUOTA#")]


def test_a_different_key_makes_a_new_session(api):
    _, first, _ = create(api, key="a" * 16)
    _, second, _ = create(api, key="b" * 16)
    assert second["sessionId"] != first["sessionId"]


def test_a_replay_still_works_when_the_door_has_closed_since(api):
    from photoprep_common.service_status import set_status

    _, first, _ = create(api)
    set_status(api.store, accepting=False, reason="worker_stopped")
    status, again, _ = create(api)
    assert status == 201 and again["sessionId"] == first["sessionId"]


def test_another_person_cannot_replay_a_key_into_someones_session(api):
    from tests.conftest import OTHER_CLAIMS

    _, first, _ = create(api)
    status, body, _ = api.request("POST", "/sessions", GOOD_SESSION, idem=KEY, claims=OTHER_CLAIMS)
    assert status == 201 and body["sessionId"] != first["sessionId"]


def test_a_refused_request_does_not_leave_a_key_behind_to_replay(api):
    status, _, _ = create(api, key="c" * 16, consentVersion="old-version")
    assert status == 400
    status, body, _ = create(api, key="c" * 16)
    assert status == 201 and body["sessionId"]
