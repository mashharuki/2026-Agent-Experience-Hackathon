"""T026: errors use the contract's Error schema and never echo or log user values."""

import json
import logging

import pytest

from photoprep_api.errors import ERROR_CODES, AppError, error_body
from photoprep_api.logs import log_event
from tests.conftest import GOOD_SESSION, IDEMPOTENCY, make_event

SECRET = "SECRET-WISH-TEXT"


def test_validation_error_uses_contract_schema(invoke):
    status, body, res = invoke(
        make_event("POST", "/sessions", {**GOOD_SESSION, "scope": "nope"}, IDEMPOTENCY)
    )
    assert status == 400
    assert set(body) == {"code", "message"} and body["code"] in ERROR_CODES
    assert res["headers"]["content-type"].startswith("application/json")
    assert not res.get("isBase64Encoded", False)


@pytest.mark.parametrize(
    "payload",
    [
        {**GOOD_SESSION, "scope": SECRET},  # enum violation
        {**GOOD_SESSION, "wish": SECRET * 40},  # too long
        {**GOOD_SESSION, SECRET: 1},  # unknown property name
    ],
)
def test_user_values_never_reach_response_or_logs(invoke, caplog, payload):
    caplog.set_level(logging.DEBUG)
    status, body, _ = invoke(make_event("POST", "/sessions", payload, IDEMPOTENCY))
    assert status == 400
    assert SECRET not in json.dumps(body, ensure_ascii=False)
    assert SECRET not in caplog.text


def test_malformed_json_does_not_echo_body(invoke, caplog):
    caplog.set_level(logging.DEBUG)
    status, body, _ = invoke(make_event("POST", "/sessions", "{" + SECRET, IDEMPOTENCY))
    assert status == 400 and SECRET not in json.dumps(body) and SECRET not in caplog.text


def test_unimplemented_operation_still_returns_contract_error(invoke):
    status, body, _ = invoke(make_event("GET", "/jobs/abcdefgh1234"))
    assert status == 501 and set(body) == {"code", "message"}


def test_service_status_response_validates(invoke):
    status, body, _ = invoke(make_event("GET", "/service-status"))
    assert status == 200 and body == {"accepting": False, "reason": "worker_stopped"}


def test_app_error_requires_known_code_and_hides_detail(invoke):
    with pytest.raises(ValueError):
        AppError(400, "made_up_code")
    assert error_body(404) == {"code": "not_found", "message": "リクエストを処理できませんでした"}
    assert error_body(500, request_id="r1")["requestId"] == "r1"


def test_log_event_rejects_fields_that_could_carry_user_content():
    log_event("analysis_done", job_id="j1", status=200, duration_ms=12)  # allowed
    for field in ("wish", "image", "token", "claims", "body", "sub"):
        with pytest.raises(ValueError):
            log_event("x", **{field: "value"})
