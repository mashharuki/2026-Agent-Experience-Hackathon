"""Loopback-only Decider experiment. Not a production or cloud API."""

import argparse
import json
import math
import secrets
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, ValidationError

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "apps/worker"), str(ROOT / "apps/worker/src")]
from evaluation.model_cache import load_local  # noqa: E402
from evaluation.offline import offline_only  # noqa: E402
from photoprep_worker.decision_pattern.decider import StrandsDecider  # noqa: E402
from photoprep_worker.decision_pattern.question import TypedQuestion  # noqa: E402

IDS = {"aurora", "zephyr", "coral", "jade"}


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Position(Strict):
    x: FiniteFloat = Field(ge=-170, le=170)
    y: FiniteFloat = Field(ge=-100, le=250)


class BoatView(Position):
    id: Literal["aurora", "zephyr", "coral", "jade"]
    headingDeg: FiniteFloat = Field(ge=0, lt=360)
    speedMps: FiniteFloat = Field(ge=0, le=8)
    tackSide: Literal[-1, 1]
    leg: Literal["upwind", "downwind", "finished"]
    markPhase: int = Field(ge=0, le=3)


class Wind(Strict):
    directionDeg: FiniteFloat = Field(ge=0, lt=360)
    speedMps: FiniteFloat = Field(ge=0, le=20)


class Pressure(Position):
    id: str = Field(pattern=r"^(patch_[01]|gust_([0-9]|1[0-2]))$")
    radius: FiniteFloat = Field(gt=0, le=40)
    extraSpeed: FiniteFloat = Field(ge=0, le=3)


class Plan(Strict):
    mode: Literal["angle", "pressure", "mark", "finish"]
    relativeWindDeg: FiniteFloat = Field(ge=-180, le=180)
    target: Position | None


class Observation(Strict):
    version: Literal["fleet-observation-v2"]
    simulationTick: int = Field(ge=0, le=5400)
    boat: BoatView
    others: list[BoatView] = Field(min_length=3, max_length=3)
    wind: Wind
    pressure: list[Pressure] = Field(max_length=3)
    mark: Position
    profile: Literal["balanced", "pressure", "windward", "opportunist"]
    currentPlan: Plan


class Request(Strict):
    raceId: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    epoch: int = Field(ge=0, le=10000)
    seq: int = Field(ge=0, le=1000)
    boatId: Literal["aurora", "zephyr", "coral", "jade"]
    expiresAt: FiniteFloat
    observation: Observation


def options_for(obs: Observation) -> dict[str, str]:
    options = {
        "hold_course": "Continue the current plan toward the next course mark. Prefer this when hold_course_error_deg is small; preserve speed."
    }
    if obs.boat.leg == "finished":
        return options
    if obs.boat.leg == "upwind":
        options["tack_now"] = (
            "Reverse to the opposite upwind tack ONLY when opposite_tack_error_deg is meaningfully smaller than hold_course_error_deg, or to exploit a favorable shift. Every tack loses speed; repeated tacks without progress are harmful."
        )
        if ((obs.boat.x - obs.mark.x) ** 2 + (obs.boat.y - obs.mark.y) ** 2) ** 0.5 < 45:
            options["approach_mark"] = (
                "Round the nearby mark to port (east, north, west), then sail to the finish."
            )
    else:
        options["jibe_now"] = "Jibe to the opposite 150-degree broad reach, with speed loss."
        options["head_to_finish"] = (
            "Steer toward the finish at (0,0), crossing south between x=-30 and 30."
        )
    for patch in obs.pressure:
        options[f"seek_visible_pressure_{patch.id}"] = (
            f"Seek gust {patch.id} only if its extra wind is worth the detour from the course mark."
        )
    return options


def validate_request(payload: bytes) -> Request:
    request = Request.model_validate_json(payload)
    obs = request.observation
    if request.boatId != obs.boat.id or {b.id for b in obs.others} != IDS - {obs.boat.id}:
        raise ValueError("boat_identity_mismatch")
    if len({p.id for p in obs.pressure}) != len(obs.pressure):
        raise ValueError("duplicate_pressure")
    if obs.mark.x != 0 or obs.mark.y != 100:
        raise ValueError("wrong_course")
    if not time.time() * 1000 < request.expiresAt <= time.time() * 1000 + 4000:
        raise ValueError("expired")
    return request


def choose(engine, obs: Observation) -> dict:
    options = options_for(obs)
    if len(options) == 1:
        return {
            "selected": "hold_course",
            "source": "policy",
            "confidence": None,
            "probabilities": {},
        }
    question = TypedQuestion(
        name="choose_sailing_tactic",
        version="fleet-v3",
        instructions="Choose a tactic to finish first. Units: meters, m/s, compass degrees (north=0). Wind is FROM the given bearing. Cannot sail within 34 degrees of wind. Tack changes sides upwind; jibe downwind. Profiles: pressure seeks gusts, windward prioritizes upwind progress, balanced limits risk, opportunist exploits shifts. Course-error values compare the current plan and the opposite tack against the NEXT required course waypoint, not a weather forecast. Minimize needless course error, detours and maneuver loss. No future wind is known.",
        options=options,
    )
    rows = [
        [
            b.id,
            round(b.x, 1),
            round(b.y, 1),
            round(b.headingDeg, 1),
            round(b.speedMps, 2),
            b.leg,
            b.markPhase,
        ]
        for b in [obs.boat, *obs.others]
    ]
    boat = obs.boat
    waypoint = (
        (0, -8)
        if boat.leg == "downwind"
        else ((-12, 100) if boat.markPhase == 2 else (0, 112) if boat.markPhase == 1 else (12, 98))
    )
    bearing = math.degrees(math.atan2(waypoint[0] - boat.x, waypoint[1] - boat.y)) % 360

    def error(heading):
        return abs((heading - bearing + 180) % 360 - 180)

    plan = obs.currentPlan
    hold_heading = obs.wind.directionDeg + plan.relativeWindDeg
    if plan.mode in {"mark", "finish"}:
        hold_heading = bearing
    elif plan.mode == "pressure" and plan.target:
        hold_heading = math.degrees(math.atan2(plan.target.x - boat.x, plan.target.y - boat.y))
    if abs((hold_heading - obs.wind.directionDeg + 180) % 360 - 180) < 38:
        hold_heading = obs.wind.directionDeg + boat.tackSide * 46
    opposite_heading = obs.wind.directionDeg - boat.tackSide * (
        150 if boat.leg == "downwind" else 46
    )
    navigation = {
        "waypoint": list(waypoint),
        "distance_m": round(math.hypot(waypoint[0] - boat.x, waypoint[1] - boat.y), 1),
        "bearing_deg": round(bearing, 1),
        "hold_course_error_deg": round(error(hold_heading), 1),
        "opposite_tack_error_deg": round(error(opposite_heading), 1),
    }
    state = json.dumps(
        {
            "self": obs.boat.id,
            "profile": obs.profile,
            "current_plan": obs.currentPlan.model_dump(),
            "navigation": navigation,
            "boat_columns": ["id", "x", "y", "heading", "speed", "leg", "mark_stage"],
            "boats": rows,
            "wind_from": round(obs.wind.directionDeg, 1),
            "wind_speed": round(obs.wind.speedMps, 2),
            "mark": [0, 100],
            "gust_columns": ["id", "x", "y", "radius", "extra_speed"],
            "visible_gusts": [
                [p.id, round(p.x, 1), round(p.y, 1), round(p.radius, 1), round(p.extraSpeed, 2)]
                for p in obs.pressure
            ],
        },
        separators=(",", ":"),
    )
    choice = StrandsDecider(engine, question).choose(state)
    return {
        "selected": choice.selected,
        "source": "decider",
        "confidence": choice.confidence,
        "probabilities": choice.probabilities,
    }


class Service:
    def __init__(self):
        self.engine = None
        self.identity = None
        self.lock = threading.Lock()
        self.calls = 0
        self.error = None

    def load(self, threads, device):
        try:
            with offline_only():
                engine, self.identity = load_local(
                    Path.home() / ".cache/huggingface/hub", threads, 42, device=device
                )
                from benchmark import observation

                for case in range(12):
                    choose(engine, Observation.model_validate(observation(case)))
                    self.calls += 1
                self.engine = engine
            print(f"Decider ready (verified local cache; {device}).", flush=True)
        except Exception as exc:
            self.error = type(exc).__name__
            print(f"Decider load failed: {self.error}", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--device", choices=["cpu", "mps"], default="cpu")
    args = parser.parse_args()
    private = ROOT / ".local/regatta"
    private.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    token_file = private / "token"
    token_file.write_text(token)
    token_file.chmod(0o600)
    service = Service()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Never log observation payloads or the token.

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

        def authorized(self):
            return secrets.compare_digest(
                self.headers.get("X-Regatta-Local-Token", ""), token
            ) and self.headers.get("Origin", "http://127.0.0.1:5174") in {
                "http://127.0.0.1:5174",
                "http://localhost:5174",
            }

        def do_GET(self):
            if not self.authorized():
                return self.reply(403, {"error": "forbidden"})
            if self.path != "/health":
                return self.reply(404, {"error": "not_found"})
            return self.reply(
                200,
                {
                    "ready": service.engine is not None,
                    "busy": service.lock.locked(),
                    "calls": service.calls,
                    "error": service.error,
                    "device": args.device,
                    "questionVersion": "fleet-v3",
                    "model": "Strands Decider 2B",
                    "revision": "216d1ccb46a9e9b036eb9187b248db98480f77d4",
                },
            )

        def do_POST(self):
            if not self.authorized():
                return self.reply(403, {"error": "forbidden"})
            if self.path != "/decide":
                return self.reply(404, {"error": "not_found"})
            if self.headers.get("Content-Type") != "application/json":
                return self.reply(415, {"error": "content_type"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 16384:
                    return self.reply(413, {"error": "body_size"})
                self.connection.settimeout(4)
                request = validate_request(self.rfile.read(length))
            except (ValueError, ValidationError, TimeoutError):
                return self.reply(400, {"error": "invalid_request"})
            if service.engine is None:
                return self.reply(503, {"error": "not_ready"})
            if service.calls >= 512:
                return self.reply(429, {"error": "process_limit"})
            if not service.lock.acquire(blocking=False):
                return self.reply(429, {"error": "busy"})
            try:
                if service.calls >= 512:
                    return self.reply(429, {"error": "process_limit"})
                if time.time() * 1000 >= request.expiresAt:
                    return self.reply(410, {"error": "expired"})
                service.calls += 1
                start = time.perf_counter()
                with offline_only():
                    result = choose(service.engine, request.observation)
                elapsed = (time.perf_counter() - start) * 1000
                if time.time() * 1000 >= request.expiresAt:
                    return self.reply(410, {"error": "expired", "latencyMs": elapsed})
                return self.reply(
                    200,
                    {
                        **result,
                        "raceId": request.raceId,
                        "epoch": request.epoch,
                        "seq": request.seq,
                        "boatId": request.boatId,
                        "latencyMs": elapsed,
                        "questionVersion": "fleet-v3",
                    },
                )
            except Exception:
                return self.reply(500, {"error": "inference_failed"})
            finally:
                service.lock.release()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    threading.Thread(target=service.load, args=(args.threads, args.device), daemon=True).start()
    print(
        f"Local experiment listening on 127.0.0.1:{args.port}; authentication required.", flush=True
    )
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
