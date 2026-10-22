import json
import threading
import time
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer

import pytest

import cloud_server
from benchmark import observation
from cloud_server import CloudService, Limits, make_handler
from local_server import Service

USER = "0f8fad5b-d9cb-469f-a165-70867728950e"
OTHER = "7c9e6679-7425-40de-944b-e07fc1f90ae7"


def body(case=1, lead_ms=10000):
    obs = observation(case)
    return json.dumps(
        {
            "raceId": "race-1",
            "epoch": 2,
            "seq": case,
            "boatId": obs["boat"]["id"],
            "expiresAt": time.time() * 1000 + lead_ms,
            "observation": obs,
        }
    ).encode()


@pytest.fixture
def cloud(monkeypatch):
    calls = []

    def fake_choose(engine, obs):
        calls.append(obs.boat.id)
        return {
            "selected": "hold_course",
            "source": "decider",
            "confidence": 0.7,
            "probabilities": {"hold_course": 0.7, "tack_now": 0.3},
        }

    monkeypatch.setattr(cloud_server, "choose", fake_choose)
    service = Service()
    service.engine = object()
    instance = CloudService(service, Limits(2, 3), max_lead_ms=15000, device="cpu")
    instance.calls = calls
    return instance


def test_returns_a_decision_bound_to_the_request(cloud):
    status, reply = cloud.decide(USER, body(5))
    assert status == 200
    assert (reply["raceId"], reply["epoch"], reply["seq"]) == ("race-1", 2, 5)
    assert reply["source"] == "decider" and reply["questionVersion"] == "fleet-v4"


def test_accepts_the_configured_cloud_deadline_but_not_beyond(cloud):
    assert cloud.decide(USER, body(lead_ms=14000))[0] == 200
    assert cloud.decide(USER, body(lead_ms=16000)) == (400, {"error": "invalid_request"})


@pytest.mark.parametrize("user", ["", "anonymous", "0F8FAD5B-D9CB-469F-A165-70867728950E"])
def test_requires_the_user_forwarded_by_api_gateway(cloud, user):
    assert cloud.decide(user, body()) == (403, {"error": "forbidden"})
    assert cloud.calls == []


def test_rejects_invalid_and_oversized_bodies_without_inference(cloud):
    assert cloud.decide(USER, b"{}")[0] == 400
    assert cloud.decide(USER, b"x" * 16385)[0] == 413
    assert cloud.decide(USER, body(lead_ms=-1))[0] == 400
    assert cloud.calls == []


def test_per_user_and_process_limits_are_enforced(cloud):
    assert cloud.decide(USER, body())[0] == 200
    assert cloud.decide(USER, body())[0] == 200
    assert cloud.decide(USER, body()) == (429, {"error": "user_daily_limit"})
    assert cloud.decide(OTHER, body())[0] == 200
    assert cloud.decide(OTHER, body()) == (429, {"error": "process_limit"})
    assert len(cloud.calls) == 3


def test_daily_limit_resets_on_a_new_utc_day():
    limits = Limits(1, 10)
    assert limits.reserve(USER, "2026-10-22") is None
    assert limits.reserve(USER, "2026-10-22") == "user_daily_limit"
    assert limits.reserve(USER, "2026-10-23") is None


def test_busy_service_rejects_without_using_quota(cloud):
    cloud.service.lock.acquire()
    try:
        assert cloud.decide(USER, body()) == (429, {"error": "busy"})
    finally:
        cloud.service.lock.release()
    assert cloud.limits.used == {}


def test_not_ready_before_the_model_loads(cloud):
    cloud.service.engine = None
    assert cloud.decide(USER, body()) == (503, {"error": "not_ready"})


def test_late_inference_is_reported_expired_not_returned(cloud, monkeypatch):
    def slow(engine, obs):
        time.sleep(0.05)
        return {"selected": "tack_now", "source": "decider", "confidence": 1, "probabilities": {}}

    monkeypatch.setattr(cloud_server, "choose", slow)
    status, reply = cloud.decide(USER, body(lead_ms=20))
    assert status == 410 and "selected" not in reply


def test_model_errors_are_not_leaked(cloud, monkeypatch):
    def broken(engine, obs):
        raise RuntimeError("weights at /models/hub")

    monkeypatch.setattr(cloud_server, "choose", broken)
    assert cloud.decide(USER, body()) == (500, {"error": "inference_failed"})


def test_http_layer_requires_user_header_and_json(cloud):
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(cloud))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]

        def call(method, path, payload=None, headers=None):
            connection = HTTPConnection("127.0.0.1", port, timeout=5)
            connection.request(method, path, body=payload, headers=headers or {})
            response = connection.getresponse()
            return response.status, json.loads(response.read())

        assert call("GET", "/ping") == (200, {"ok": True})
        assert call("GET", "/health")[0] == 403
        status, health = call("GET", "/health", headers={"x-regatta-user": USER})
        assert status == 200 and health["ready"] and health["maxLeadMs"] == 15000
        assert call("POST", "/decide", body(), {"Content-Type": "text/plain"})[0] == 415
        assert call("POST", "/decide", body(), {"Content-Type": "application/json"})[0] == 403
        status, reply = call(
            "POST",
            "/decide",
            body(),
            {"Content-Type": "application/json", "x-regatta-user": USER},
        )
        assert status == 200 and reply["selected"] == "hold_course"
    finally:
        server.shutdown()
        server.server_close()
