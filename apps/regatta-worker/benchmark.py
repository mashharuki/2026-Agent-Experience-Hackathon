"""Bounded synthetic HTTP latency experiment; no model download or AWS calls."""

import argparse
import json
import statistics
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IDS = ["aurora", "zephyr", "coral", "jade"]
PROFILES = ["balanced", "pressure", "windward", "opportunist"]


def observation(case):
    index = case % 4
    near = case % 3 == 0
    downwind = case % 5 == 0
    boat = {
        "id": IDS[index],
        "x": -30.0 + (case % 7) * 10,
        "y": 85.0 if near else 20.0,
        "headingDeg": 150.0 if downwind else 46.0,
        "speedMps": 2.5,
        "tackSide": 1,
        "leg": "downwind" if downwind else "upwind",
        "markPhase": 3 if downwind else 0,
    }
    return {
        "version": "fleet-observation-v2",
        "simulationTick": 300 + case * 30,
        "boat": boat,
        "others": [
            {**boat, "id": name, "x": float(i * 10 - 15)}
            for i, name in enumerate(IDS)
            if name != boat["id"]
        ],
        "wind": {"directionDeg": [0.0, 12.0, 348.0, 5.0][index], "speedMps": 4.5 + index * 0.5},
        "pressure": [
            {
                "id": f"gust_{i}",
                "x": float(i * 45 - 50),
                "y": 70.0,
                "radius": 30.0,
                "extraSpeed": 1.5 + i * 0.2,
            }
            for i in range(case % 4)
        ],
        "mark": {"x": 0.0, "y": 100.0},
        "profile": PROFILES[index],
        "currentPlan": {
            "mode": "angle",
            "relativeWindDeg": 150.0 if downwind else 46.0,
            "target": None,
        },
    }


def request(case, token):
    obs = observation(case)
    payload = {
        "raceId": "latency-benchmark",
        "epoch": 0,
        "seq": case,
        "boatId": obs["boat"]["id"],
        "expiresAt": time.time() * 1000 + 3000,
        "observation": obs,
    }
    req = urllib.request.Request(
        "http://127.0.0.1:8766/decide",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "X-Regatta-Local-Token": token},
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=20) as response:  # noqa: S310 - fixed loopback URL
            body = json.load(response)
            status = response.status
    except urllib.error.HTTPError as exc:
        body = json.loads(exc.read())
        status = exc.code
    return {
        "case": case,
        "httpStatus": status,
        "latencyMs": (time.perf_counter() - started) * 1000,
        "inferenceMs": body.get("latencyMs"),
        "selected": body.get("selected"),
        "source": body.get("source"),
        "error": body.get("error"),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=100)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not 1 <= args.count <= 100:
        raise ValueError("count must be between 1 and 100")
    token = (ROOT / ".local/regatta/token").read_text().strip()
    warmup = [request(i, token) for i in range(12)]
    results = []
    for case in range(args.count):
        results.append(request(case, token))
        if (case + 1) % 10 == 0:
            print(f"{case + 1}/{args.count}", flush=True)
    latencies = sorted(r["latencyMs"] for r in results)
    report = {
        "scope": "Local Mac MPS, synthetic fleet observations; not AWS latency or sailing quality",
        "observationVersion": "fleet-observation-v2",
        "modelRevision": "216d1ccb46a9e9b036eb9187b248db98480f77d4",
        "warmup": warmup,
        "count": args.count,
        "p50Ms": statistics.median(latencies),
        "p95Ms": latencies[max(0, int(len(latencies) * 0.95 + 0.9999) - 1)],
        "expired": sum(r["httpStatus"] == 410 for r in results),
        "failed": sum(r["httpStatus"] != 200 for r in results),
        "results": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps({k: v for k, v in report.items() if k not in {"warmup", "results"}}, indent=2),
        flush=True,
    )


if __name__ == "__main__":
    main()
