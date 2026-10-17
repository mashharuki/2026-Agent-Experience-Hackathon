"""T026: identity comes only from authorizer claims; other users' records look absent."""

import pytest

from photoprep_api.auth import identity_from_claims
from photoprep_api.errors import AppError
from photoprep_api.repo import get_owned
from photoprep_api.store import InMemoryStore
from tests.conftest import ACCESS_CLAIMS, GOOD_SESSION, IDEMPOTENCY, make_event


def test_access_token_claims_accepted():
    identity = identity_from_claims(ACCESS_CLAIMS)
    assert identity is not None and identity.sub == "user-123"


@pytest.mark.parametrize(
    "claims",
    [
        None,
        {},
        {"scope": "photoprep/session", "token_use": "access"},  # no sub
        {"sub": "", "scope": "photoprep/session", "token_use": "access"},
        {"sub": "u", "scope": "photoprep/session", "token_use": "id"},  # ID token
        {"sub": "u", "scope": "openid email", "token_use": "access"},  # wrong scope
        {"sub": "u", "token_use": "access"},  # no scope
        {"sub": "u", "scope": ["photoprep/session"], "token_use": "access"},  # wrong type
    ],
)
def test_unacceptable_claims_rejected(claims):
    assert identity_from_claims(claims) is None


def test_sub_comes_from_claims_not_headers(invoke):
    event = make_event("POST", "/sessions", GOOD_SESSION, {**IDEMPOTENCY, "x-user-sub": "attacker"})
    status, body, _ = invoke(event)
    assert status == 201 and body["sessionId"] == "s-user-123"


@pytest.mark.parametrize(
    "claims", [None, {"sub": "u", "scope": "photoprep/session", "token_use": "id"}]
)
def test_missing_or_id_token_claims_give_401(invoke, claims):
    status, body, _ = invoke(
        make_event("POST", "/sessions", GOOD_SESSION, IDEMPOTENCY, claims=claims)
    )
    assert status == 401 and body["code"] == "unauthenticated"


def test_every_operation_requires_authentication(invoke):
    probes = [
        ("GET", "/service-status", None),
        ("POST", "/sessions", GOOD_SESSION),
        ("DELETE", "/sessions/abcdefgh1234", None),
        (
            "POST",
            "/sessions/abcdefgh1234/uploads",
            {"phase": "before", "contentType": "image/png", "sizeBytes": 10},
        ),
        ("POST", "/sessions/abcdefgh1234/analyses", {"uploadId": "u", "phase": "before"}),
        ("POST", "/sessions/abcdefgh1234/feedback", {"type": "comparison"}),
        ("GET", "/jobs/abcdefgh1234", None),
    ]
    for method, path, body in probes:
        status, _, _ = invoke(make_event(method, path, body, IDEMPOTENCY, claims=None))
        assert status == 401, f"{method} {path} must fail closed without claims"


def test_owner_can_read_own_record():
    store = InMemoryStore()
    store.create_if_absent("SESSION#s1", "META", {"ownerSub": "alice", "state": "CONSULTING"})
    assert get_owned(store, "SESSION#s1", "alice")["state"] == "CONSULTING"


def test_other_users_record_is_indistinguishable_from_missing():
    store = InMemoryStore()
    store.create_if_absent("SESSION#s1", "META", {"ownerSub": "alice"})
    with pytest.raises(AppError) as other:
        get_owned(store, "SESSION#s1", "mallory")
    with pytest.raises(AppError) as missing:
        get_owned(store, "SESSION#nope", "mallory")
    assert (
        (other.value.status, other.value.code)
        == (missing.value.status, missing.value.code)
        == (404, "not_found")
    )


def test_record_without_owner_is_never_returned():
    store = InMemoryStore()
    store.create_if_absent("SESSION#s1", "META", {"state": "CONSULTING"})
    with pytest.raises(AppError):
        get_owned(store, "SESSION#s1", "alice")
