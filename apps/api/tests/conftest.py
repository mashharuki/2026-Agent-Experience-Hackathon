"""Shared helpers: synthetic API Gateway HTTP API v2 events (not captured from AWS)."""

import json

import pytest
from mangum import Mangum

from photoprep_api.app import create_app

ACCESS_CLAIMS = {"sub": "user-123", "scope": "photoprep/session", "token_use": "access"}
GOOD_SESSION = {"consentVersion": "v1", "scope": "brow", "restrictions": ["no_touch_brow"]}
IDEMPOTENCY = {"idempotency-key": "k" * 16}


class LambdaContext:
    function_name = "f"
    memory_limit_in_mb = 128
    invoked_function_arn = "arn:aws:lambda:ap-northeast-1:123456789012:function:f"
    aws_request_id = "rid"


def make_event(method, path, body=None, headers=None, claims=ACCESS_CLAIMS, query=""):
    h = {"content-type": "application/json", "authorization": "Bearer x.y.z"}
    h.update(headers or {})
    if isinstance(body, dict | list):
        body = json.dumps(body)
    if body is not None:
        h.setdefault("content-length", str(len(body.encode())))
    context = {
        "http": {
            "method": method,
            "path": path,
            "protocol": "HTTP/1.1",
            "sourceIp": "203.0.113.1",
            "userAgent": "test",
        },
        "requestId": "req-1",
        "routeKey": f"{method} {path}",
        "stage": "$default",
    }
    if claims is not None:
        context["authorizer"] = {"jwt": {"claims": claims, "scopes": ["photoprep/session"]}}
    return {
        "version": "2.0",
        "routeKey": f"{method} {path}",
        "rawPath": path,
        "rawQueryString": query,
        "headers": h,
        "requestContext": context,
        "body": body,
        "isBase64Encoded": False,
    }


def _create_session(body, user=None, **_):
    return {
        "sessionId": f"s-{user}",
        "state": "CONSULTING",
        "changesUsed": 0,
        "analysesUsed": 0,
        "expiresAt": "2026-10-18T00:00:00Z",
    }, 201


def _service_status(user=None, **_):
    return {"accepting": False, "reason": "worker_stopped"}, 200


@pytest.fixture(scope="session")
def invoke():
    app = create_app({"createSession": _create_session, "getServiceStatus": _service_status})
    mangum = Mangum(app, lifespan="off")

    def call(event):
        res = mangum(event, LambdaContext())
        body = res.get("body")
        try:
            body = json.loads(body) if body else None
        except ValueError:
            pass
        return res["statusCode"], body, res

    return call
