"""Bounded CPU latency gate on ECS. No API, AWS SDK calls, or runtime downloads."""

import argparse
import json
import resource
import signal
import statistics
import time
from pathlib import Path

from benchmark import observation
from local_server import Observation, choose, load_local, offline_only


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--count", type=int, default=100)
    args = parser.parse_args()
    if not 1 <= args.count <= 100 or not 1 <= args.threads <= 16:
        raise ValueError("bounded probe required")
    # Standalone task, never a service: even model startup cannot run indefinitely.
    signal.alarm(900)
    started = time.perf_counter()
    with offline_only():
        engine, identity = load_local(Path("/models/hub"), args.threads, 42)
        startup = time.perf_counter() - started
        for case in range(12):
            choose(engine, Observation.model_validate(observation(case)))
        results = []
        for case in range(args.count):
            before = time.perf_counter()
            result = choose(engine, Observation.model_validate(observation(case)))
            results.append(
                {
                    "case": case,
                    "latencyMs": (time.perf_counter() - before) * 1000,
                    "selected": result["selected"],
                    "source": result["source"],
                }
            )
            if (case + 1) % 10 == 0:
                print(json.dumps({"progress": case + 1, "total": args.count}), flush=True)
    durations = sorted(item["latencyMs"] for item in results)
    report = {
        "scope": "Linux x86_64 CPU inference only; API and queue overhead excluded",
        "questionVersion": "fleet-v4",
        "observationVersion": "fleet-observation-v2",
        "modelRevisions": identity["revisions"],
        "threads": args.threads,
        "count": args.count,
        "startupSeconds": startup,
        "p50Ms": statistics.median(durations),
        "p95Ms": durations[max(0, int(len(durations) * 0.95 + 0.9999) - 1)],
        "overThreeSeconds": sum(value >= 3000 for value in durations),
        "peakRssMiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
        "results": results,
    }
    print(json.dumps({"report": report}), flush=True)


if __name__ == "__main__":
    main()
