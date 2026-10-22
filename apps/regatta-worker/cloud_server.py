"""Decider service for ECS on Fargate, reached only through API Gateway.

API Gateway validates the Cognito access token and forwards the token's `sub` as the
`x-regatta-user` header; the task's security group accepts traffic only from the VPC
link. Observation validation and the typed question are shared with local_server.
"""

import argparse
import json
import os
import re
import threading
import time
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from pydantic import ValidationError

from local_server import Service, choose, offline_only, validate_request

USER = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
QUESTION_VERSION = "fleet-v4"
REVISION = "216d1ccb46a9e9b036eb9187b248db98480f77d4"


class Limits:
    """Per-user daily and per-process caps. One task runs at a time (desired count 0/1)."""

    def __init__(self, per_user_daily: int, process_total: int):
        self.per_user_daily = per_user_daily
        self.process_total = process_total
        self.lock = threading.Lock()
        self.day = None
        self.used: dict[str, int] = {}
        self.total = 0

    def reserve(self, user: str, today: str) -> str | None:
        with self.lock:
            if self.day != today:
                self.day, self.used = today, {}
            if self.total >= self.process_total:
                return "process_limit"
            if self.used.get(user, 0) >= self.per_user_daily:
                return "user_daily_limit"
            self.used[user] = self.used.get(user, 0) + 1
            self.total += 1
            return None


class CloudService:
    def __init__(self, service: Service, limits: Limits, max_lead_ms: float, device: str):
        self.service = service
        self.limits = limits
        self.max_lead_ms = max_lead_ms
        self.device = device

    def health(self) -> tuple[int, dict]:
        return 200, {
            "ready": self.service.engine is not None,
            "busy": self.service.lock.locked(),
            "error": self.service.error,
            "device": self.device,
            "questionVersion": QUESTION_VERSION,
            "model": "Strands Decider 2B",
            "revision": REVISION,
            "maxLeadMs": self.max_lead_ms,
        }

    def decide(self, user: str, body: bytes, now: float | None = None) -> tuple[int, dict]:
        if not USER.match(user):
            return 403, {"error": "forbidden"}
        if not 0 < len(body) <= 16384:
            return 413, {"error": "body_size"}
        try:
            request = validate_request(body, self.max_lead_ms)
        except (ValueError, ValidationError):
            return 400, {"error": "invalid_request"}
        if self.service.engine is None:
            return 503, {"error": "not_ready"}
        # Busy is checked before the quota so a rejected request costs the user nothing.
        if not self.service.lock.acquire(blocking=False):
            return 429, {"error": "busy"}
        try:
            today = datetime.fromtimestamp(now or time.time(), UTC).strftime("%Y-%m-%d")
            refused = self.limits.reserve(user, today)
            if refused:
                return 429, {"error": refused}
            if time.time() * 1000 >= request.expiresAt:
                return 410, {"error": "expired"}
            self.service.calls += 1
            start = time.perf_counter()
            with offline_only():
                result = choose(self.service.engine, request.observation)
            elapsed = (time.perf_counter() - start) * 1000
            # Never return a decision the client would have to apply late.
            if time.time() * 1000 >= request.expiresAt:
                return 410, {"error": "expired", "latencyMs": elapsed}
            return 200, {
                **result,
                "raceId": request.raceId,
                "epoch": request.epoch,
                "seq": request.seq,
                "boatId": request.boatId,
                "latencyMs": elapsed,
                "questionVersion": QUESTION_VERSION,
            }
        except Exception:
            return 500, {"error": "inference_failed"}
        finally:
            self.service.lock.release()


def make_handler(cloud: CloudService):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Never log observations, tokens or user ids.

        def reply(self, status, value):
            data = json.dumps(value, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            if self.path == "/ping":  # Container health check: no user, no model call.
                return self.reply(200, {"ok": True})
            if not USER.match(self.headers.get("x-regatta-user", "")):
                return self.reply(403, {"error": "forbidden"})
            if self.path != "/health":
                return self.reply(404, {"error": "not_found"})
            return self.reply(*cloud.health())

        def do_POST(self):
            if self.path != "/decide":
                return self.reply(404, {"error": "not_found"})
            if (self.headers.get("Content-Type") or "").split(";")[0] != "application/json":
                return self.reply(415, {"error": "content_type"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return self.reply(400, {"error": "invalid_request"})
            if not 0 < length <= 16384:
                return self.reply(413, {"error": "body_size"})
            self.connection.settimeout(4)
            try:
                body = self.rfile.read(length)
            except TimeoutError:
                return self.reply(400, {"error": "invalid_request"})
            return self.reply(*cloud.decide(self.headers.get("x-regatta-user", ""), body))

    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--threads", type=int, default=int(os.environ.get("REGATTA_THREADS", "4")))
    args = parser.parse_args()
    max_lead_ms = float(os.environ.get("REGATTA_MAX_LEAD_MS", "15000"))
    limits = Limits(
        int(os.environ.get("REGATTA_USER_DAILY_LIMIT", "300")),
        int(os.environ.get("REGATTA_PROCESS_LIMIT", "1500")),
    )
    if not 1000 <= max_lead_ms <= 30000:
        raise ValueError("REGATTA_MAX_LEAD_MS must be 1000-30000")
    service = Service()
    cloud = CloudService(service, limits, max_lead_ms, "cpu")
    server = ThreadingHTTPServer(("0.0.0.0", args.port), make_handler(cloud))  # noqa: S104
    server.daemon_threads = True
    threading.Thread(
        target=service.load, args=(args.threads, "cpu", Path("/models/hub")), daemon=True
    ).start()
    print(f"Decider service listening on {args.port}; API Gateway only.", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
