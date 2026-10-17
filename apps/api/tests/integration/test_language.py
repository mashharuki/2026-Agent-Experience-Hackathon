"""T110: the session remembers the language the user chose (FR-028)."""

from tests.conftest import GOOD_SESSION

IDEM = "l" * 16


def create(api, **overrides):
    return api.request("POST", "/sessions", {**GOOD_SESSION, **overrides}, idem=IDEM)


def test_the_language_defaults_to_japanese(api):
    status, body, _ = create(api)
    assert status == 201, body
    assert api.store.get(f"SESSION#{body['sessionId']}", "META")["language"] == "ja"


def test_english_is_stored_with_the_session(api):
    status, body, _ = create(api, language="en")
    assert status == 201, body
    assert api.store.get(f"SESSION#{body['sessionId']}", "META")["language"] == "en"


def test_other_languages_are_refused_without_using_a_quota_slot(api):
    status, body, _ = create(api, language="fr")
    assert status == 400, body
