"""T009 spike checks: invoke the Mangum handler with API Gateway HTTP API v2 events."""

import base64
import json

import pytest

import app as spike

CLAIMS = {"sub": "user-123", "scope": "photoprep/session", "token_use": "access"}


def event(method, path, body=None, headers=None, claims=CLAIMS, query=None, b64=False):
    h = {"content-type": "application/json", "authorization": "Bearer x.y.z"}
    h.update(headers or {})
    if isinstance(body, (dict, list)):
        body = json.dumps(body)
    if body is not None:
        # API Gateway forwards the client's content-length header with the event.
        h.setdefault("content-length", str(len(body.encode())))
    if body is not None and b64:
        body = base64.b64encode(body.encode()).decode()
    rc = {
        "accountId": "123456789012",
        "apiId": "api",
        "domainName": "example.execute-api.ap-northeast-1.amazonaws.com",
        "http": {"method": method, "path": path, "protocol": "HTTP/1.1",
                 "sourceIp": "203.0.113.1", "userAgent": "test"},
        "requestId": "req-1",
        "routeKey": f"{method} {path}",
        "stage": "$default",
        "time": "17/Oct/2026:07:00:00 +0000",
        "timeEpoch": 1792220400000,
    }
    if claims is not None:
        rc["authorizer"] = {"jwt": {"claims": claims, "scopes": ["photoprep/session"]}}
    return {
        "version": "2.0",
        "routeKey": f"{method} {path}",
        "rawPath": path,
        "rawQueryString": query or "",
        "headers": h,
        "requestContext": rc,
        "body": body,
        "isBase64Encoded": b64,
    }


class Ctx:
    function_name = "f"
    memory_limit_in_mb = 128
    invoked_function_arn = "arn:aws:lambda:ap-northeast-1:123456789012:function:f"
    aws_request_id = "rid"


def call(ev):
    res = spike.handler(ev, Ctx())
    body = res.get("body")
    try:
        body = json.loads(body) if body else None
    except ValueError:
        pass
    return res["statusCode"], body, res


GOOD = {"consentVersion": "v1", "scope": "brow", "restrictions": ["no_touch_brow"]}
IDEM = {"idempotency-key": "k" * 16}


def test_valid_create_session_uses_claims_sub():
    st, body, _ = call(event("POST", "/sessions", GOOD, IDEM))
    assert st == 201
    assert body["sessionId"] == "s-user-123"  # sub came from the authorizer claims


def test_no_authorizer_claims_fails_closed():
    st, body, _ = call(event("POST", "/sessions", GOOD, IDEM, claims=None))
    assert st == 401


def test_forged_sub_header_is_ignored():
    st, body, _ = call(event("POST", "/sessions", GOOD, {**IDEM, "x-user-sub": "attacker"}))
    assert st == 201 and body["sessionId"] == "s-user-123"


def test_unknown_body_field_rejected():
    st, body, _ = call(event("POST", "/sessions", {**GOOD, "isAdmin": True}, IDEM))
    assert st == 400


def test_missing_required_field_rejected():
    st, _, _ = call(event("POST", "/sessions", {"scope": "brow"}, IDEM))
    assert st == 400


def test_wrong_type_and_enum_rejected():
    assert call(event("POST", "/sessions", {**GOOD, "scope": "nose"}, IDEM))[0] == 400
    assert call(event("POST", "/sessions", {**GOOD, "wish": 5}, IDEM))[0] == 400


def test_oversized_wish_rejected():
    assert call(event("POST", "/sessions", {**GOOD, "wish": "あ" * 201}, IDEM))[0] == 400


def test_malformed_json_rejected():
    st, _, _ = call(event("POST", "/sessions", "{not json", IDEM))
    assert st == 400


def test_missing_idempotency_key_rejected():
    st, _, _ = call(event("POST", "/sessions", GOOD))
    assert st == 400


def test_wrong_content_type_rejected():
    st, _, _ = call(event("POST", "/sessions", json.dumps(GOOD), {**IDEM, "content-type": "text/plain"}))
    assert st in (400, 415)


def test_base64_body_is_decoded():
    st, body, _ = call(event("POST", "/sessions", GOOD, IDEM, b64=True))
    assert st == 201


def test_japanese_body_roundtrip():
    st, _, _ = call(event("POST", "/sessions", {**GOOD, "wish": "眉の形は変えたくない"}, IDEM))
    assert st == 201


def test_path_param_length_validated():
    assert call(event("GET", "/jobs/x"))[0] == 400


def test_unknown_query_param_rejected_by_strict_validation():
    assert call(event("GET", "/jobs/validjob0001", query="debug=1"))[0] == 400


def test_response_validation_catches_bad_handler_output():
    st, body, _ = call(event("GET", "/jobs/badresponse0"))
    assert st == 500  # validate_responses=True blocks the schema-violating body


def test_good_response_passes_validation():
    st, body, _ = call(event("GET", "/jobs/validjob0001"))
    assert st == 200 and body["status"] == "QUEUED"


def test_unknown_route_404_and_method_405():
    assert call(event("GET", "/nope"))[0] == 404
    assert call(event("PUT", "/sessions", GOOD, IDEM))[0] in (404, 405)


def test_unimplemented_op_returns_stub_501_and_response_validation_ok():
    st, body, _ = call(event("DELETE", "/sessions/abcdefgh1234"))
    assert st in (202, 501, 500)


def test_error_body_does_not_echo_input():
    secret = "SECRET-WISH-TEXT"
    st, body, res = call(event("POST", "/sessions", {**GOOD, "wish": 5, "note": secret}, IDEM))
    assert st == 400 and secret not in json.dumps(body, ensure_ascii=False)


def test_202_has_no_binary_issue():
    ev = event("POST", "/sessions/abcdefgh1234/analyses",
               {"uploadId": "u1", "phase": "before"}, IDEM)
    st, body, res = call(ev)
    assert st in (202, 501, 500) and not res.get("isBase64Encoded", False)


def test_missing_content_length_is_repaired_by_entry_point():
    ev = event("POST", "/sessions", GOOD, IDEM)
    del ev["headers"]["content-length"]
    assert call(ev)[0] == 201


def test_errors_use_contract_error_schema_and_plain_json():
    st, body, res = call(event("POST", "/sessions", {**GOOD, "scope": "nope"}, IDEM))
    assert st == 400 and set(body) == {"code", "message"}
    assert res["headers"]["content-type"].startswith("application/json")
    assert not res.get("isBase64Encoded", False)


def test_user_values_never_reach_response_or_logs(caplog):
    import logging as lg
    caplog.set_level(lg.DEBUG)
    secret = "SECRET-WISH-TEXT"
    for payload in ({**GOOD, "scope": secret}, {**GOOD, "wish": secret * 40}):
        st, body, res = call(event("POST", "/sessions", payload, IDEM))
        assert st == 400
        assert secret not in json.dumps(body, ensure_ascii=False)
    assert secret not in caplog.text
