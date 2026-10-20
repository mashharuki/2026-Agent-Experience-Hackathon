"""Offline evaluation CLI. No command defaults to loading a model."""

import argparse
import sys
from pathlib import Path


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Bounded offline selection evaluation")
    sub = parser.add_subparsers(dest="command", required=True)
    validation = sub.add_parser("validate")
    validation.add_argument("--cases-dir", required=True, type=Path)
    run = sub.add_parser("run")
    run.add_argument("--cases-dir", required=True, type=Path)
    run.add_argument("--out", required=True, type=Path)
    run.add_argument("--backend", required=True, choices=["rules", "fake", "decider"])
    run.add_argument("--split", required=True, choices=["dev", "holdout"])
    version = run.add_mutually_exclusive_group()
    version.add_argument("--state-version", choices=["v1", "v2", "v3", "v4"])
    version.add_argument("--paired-versions", choices=["v1,v2", "v1,v3", "v1,v4"])
    run.add_argument("--model-cache", type=Path)
    run.add_argument("--repeats", type=int, default=1)
    run.add_argument("--max-calls", type=int, default=180)
    run.add_argument("--max-seconds", type=float, default=1800)
    run.add_argument("--threads", type=int, default=4)
    run.add_argument("--seed", type=int, default=0)
    run.add_argument("--limit", type=int)
    comparison = sub.add_parser("compare")
    comparison.add_argument("--runs", type=Path, nargs="+", required=True)
    comparison.add_argument("--cases-dir", type=Path, required=True)
    comparison.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    # This workspace intentionally is not an installed Python distribution (uv package=false).
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
    from evaluation.runner import compare, evaluate
    from evaluation.schemas import load_cases

    try:
        if args.command == "validate":
            cases, _ = load_cases(args.cases_dir)
            print(f"validated {len(cases)} synthetic cases")
            return 0
        if args.command == "compare":
            return compare(args.runs, args.cases_dir, args.out)
        if args.backend == "decider" and args.model_cache is None:
            parser.error("--model-cache is required for the real backend")
        versions = (
            args.paired_versions.split(",")
            if args.paired_versions
            else [args.state_version or "v1"]
        )
        code = evaluate(
            args.cases_dir,
            args.out,
            backend=args.backend,
            split=args.split,
            versions=versions,
            repeats=args.repeats,
            max_calls=args.max_calls,
            max_seconds=args.max_seconds,
            cache=args.model_cache,
            threads=args.threads,
            seed=args.seed,
            limit=args.limit,
        )
        print("run complete" if code == 0 else "partial run; inspect sanitized manifest")
        return code
    except (ValueError, OSError, KeyError):
        print("invalid arguments, dataset, output directory or run compatibility", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
