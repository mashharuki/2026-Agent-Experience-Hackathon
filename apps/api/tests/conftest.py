"""Shared helpers: synthetic API Gateway HTTP API v2 events (not captured from AWS)."""

import json
from types import SimpleNamespace

import pytest
from mangum import Mangum

from photoprep_api.app import create_app
from photoprep_api.container import Container, configure
from photoprep_api.handlers import HANDLERS
from photoprep_api.store import InMemoryStore
from tests.fakes import FakeQueue, FakeUploads, FixedClock, sequential_ids

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


OTHER_CLAIMS = {"sub": "user-456", "scope": "photoprep/session", "token_use": "access"}


def _dynamo_store():
    import boto3
    from moto import mock_aws

    from photoprep_api.store import DynamoStore

    mock = mock_aws()
    mock.start()
    boto3.client("dynamodb", region_name="ap-northeast-1").create_table(
        TableName="t",
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[
            {"AttributeName": "pk", "AttributeType": "S"},
            {"AttributeName": "sk", "AttributeType": "S"},
            {"AttributeName": "statusKey", "AttributeType": "S"},
            {"AttributeName": "statusSince", "AttributeType": "S"},
        ],
        KeySchema=[
            {"AttributeName": "pk", "KeyType": "HASH"},
            {"AttributeName": "sk", "KeyType": "RANGE"},
        ],
        GlobalSecondaryIndexes=[
            {
                "IndexName": "status-index",
                "KeySchema": [
                    {"AttributeName": "statusKey", "KeyType": "HASH"},
                    {"AttributeName": "statusSince", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            }
        ],
    )
    return DynamoStore("t", region="ap-northeast-1"), mock


@pytest.fixture(params=["memory", "dynamodb"])
def api(request):
    """The real handlers over fakes, run on the in-memory store and on DynamoDB (moto).

    ``api.call(event)`` -> (status, body, raw).
    """
    mock = None
    if request.param == "dynamodb":
        store, mock = _dynamo_store()
    else:
        store = InMemoryStore()
    container = Container(
        store=store,
        uploads=FakeUploads(),
        queue=FakeQueue(),
        now=FixedClock(),
        new_id=sequential_ids("id"),
    )
    configure(container)
    mangum = Mangum(create_app(HANDLERS), lifespan="off")

    def call(event):
        res = mangum(event, LambdaContext())
        body = res.get("body")
        try:
            body = json.loads(body) if body else None
        except ValueError:
            pass
        return res["statusCode"], body, res

    def send(method, path, body=None, *, claims=ACCESS_CLAIMS, idem=None, headers=None):
        extra = {"idempotency-key": idem} if idem else {}
        extra.update(headers or {})
        return call(make_event(method, path, body, extra, claims=claims))

    request.addfinalizer(lambda: mock.stop() if mock else None)
    return SimpleNamespace(
        call=call,
        request=send,
        container=container,
        store=container.store,
        uploads=container.uploads,
        queue=container.queue,
        clock=container.now,
    )
