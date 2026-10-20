"""Bounded dev-only ablation; diagnostic evidence, never a candidate adoption run."""

import argparse
import contextlib
import hashlib
import json
import multiprocessing
import os
import sys
import time
from pathlib import Path

WORKER = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(WORKER), str(WORKER / "src")]

from evaluation.model_cache import load_local  # noqa: E402
from evaluation.offline import offline_only  # noqa: E402
from evaluation.reporting import conditions, write_json  # noqa: E402
from evaluation.runner import render_state  # noqa: E402
from evaluation.schemas import load_cases, sha256  # noqa: E402

from photoprep_worker.decider import CRITERIA, INSTRUCTIONS  # noqa: E402
from photoprep_worker.decision_pattern import (  # noqa: E402
    StrandsDecider,
    TypedQuestion,
    run_decision,
)
from photoprep_worker.guards import guards_for  # noqa: E402

MAX_CALLS = 30
MAX_SECONDS = 600
POLICY = (
    "本人の希望と観察から次の支援を一つ選ぶ。以下を上から優先する。"
    "眉と前髪の両方が接触禁止なら offer_finish。"
    "解析回数が3/3、または試した回数が2/2なら offer_finish。"
    "根拠が足りず、確認質問への回答が済みなら offer_finish。"
    "相談対象が接触禁止なら、他の対象を確認する clarify。"
    "逆光や顔の位置に問題があれば capture_setup_tip。"
    "根拠が足りない、希望が曖昧なら clarify。"
    "禁止に反せず根拠と残り枠がある場合だけ grooming_tip。"
)
POLICY_CRITERIA = {
    "grooming_tip": (
        "相談対象への接触が許可され、見える根拠があり、"
        "解析回数が3未満かつ試した回数が2未満の場合だけ身支度を案内する"
    ),
    "capture_setup_tip": "逆光・顔の位置など撮影条件で観察が難しいときに調整する",
    "clarify": (
        "未回答で根拠や希望が曖昧な場合、または相談対象が接触禁止で"
        "他の対象を確認する場合。ただし解析回数3/3では選ばない"
    ),
    "offer_finish": (
        "眉と前髪が両方接触禁止、解析回数3/3、試した回数2/2、"
        "または確認質問への回答後も根拠不足なら終了する"
    ),
}


def questions():
    return {
        "baseline_v2": TypedQuestion("next_support", "diagnostic-base", INSTRUCTIONS, CRITERIA),
        "instructions_only": TypedQuestion(
            "next_support", "diagnostic-instructions", POLICY, CRITERIA
        ),
        "criteria_only": TypedQuestion(
            "next_support", "diagnostic-criteria", INSTRUCTIONS, POLICY_CRITERIA
        ),
    }


def schedule(cases):
    names = list(questions())
    return [
        {"case_id": case.case_id, "variant": name}
        for i, case in enumerate(cases)
        for name in names[i % len(names) :] + names[: i % len(names)]
    ]


def child(cache, out_string):
    out = Path(out_string)
    with (
        open(os.devnull, "w") as quiet,
        contextlib.redirect_stdout(quiet),
        contextlib.redirect_stderr(quiet),
        offline_only(),
    ):
        try:
            engine, identity = load_local(Path(cache), 4, 0)
            write_json(out / "model.json", identity)
            cases, _ = load_cases(WORKER / "evaluation/cases")
            dev = {c.case_id: c for c in cases if c.split == "dev"}
            plan = json.loads((out / "manifest.json").read_text())["schedule"]
            with (out / "trials.jsonl").open("a") as stream:
                for task in plan[:MAX_CALLS]:
                    case = dev[task["case_id"]]
                    question = questions()[task["variant"]]
                    row = dict(task)
                    try:
                        decision = run_decision(
                            decider=StrandsDecider(engine, question),
                            question=question,
                            state=render_state(case.inputs, "v2"),
                            context=case.inputs.guard_context(),
                            guards=guards_for(0),
                            handlers={kind: (lambda k=kind: k) for kind in CRITERIA},
                        )
                        row.update(
                            status="ok",
                            raw_choice=decision.decider_choice,
                            final_choice=decision.selected,
                            probabilities=decision.probabilities,
                            guard_override=decision.override_reason,
                            raw_fit=decision.decider_choice in case.expected.allowed_raw_choices,
                            final_fit=decision.selected in case.expected.allowed_final_choices,
                        )
                    except Exception:
                        row.update(status="model_error")
                    stream.write(json.dumps(row) + "\n")
                    stream.flush()
                    os.fsync(stream.fileno())
        except Exception:
            write_json(out / "error.json", {"status": "load_or_runner_error"})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-cache", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    cases, data = load_cases(WORKER / "evaluation/cases")
    dev = [c for c in cases if c.split == "dev"]
    args.out.mkdir(parents=True, exist_ok=False)
    rendered_questions = {
        name: {"instructions": q.instructions, "criteria": dict(q.options)}
        for name, q in questions().items()
    }
    write_json(
        args.out / "manifest.json",
        dict(
            purpose="development_diagnostic_not_adoption",
            dataset_sha256=data["sha256"],
            script_sha256=sha256(Path(__file__)),
            state_version="v2",
            conditions=conditions(data, threads=4, seed=0),
            max_calls=MAX_CALLS,
            max_seconds=MAX_SECONDS,
            repeats=1,
            schedule=schedule(dev),
            questions=rendered_questions,
            question_sha256=hashlib.sha256(
                json.dumps(rendered_questions, ensure_ascii=False).encode()
            ).hexdigest(),
        ),
    )
    started = time.monotonic()
    process = multiprocessing.get_context("spawn").Process(
        target=child, args=(str(args.model_cache), str(args.out))
    )
    process.start()
    try:
        process.join(MAX_SECONDS)
    finally:
        if process.is_alive():
            process.terminate()
            process.join(5)
            if process.is_alive():
                process.kill()
                process.join()
    path = args.out / "trials.jsonl"
    rows = [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
    complete = len(rows) == MAX_CALLS and all(r["status"] == "ok" for r in rows)
    summary = {
        "status": "complete" if complete else "partial",
        "elapsed_seconds": time.monotonic() - started,
        "completed_records": len(rows),
        "variants": {
            name: {
                "planned": len(dev),
                "ok": sum(r["status"] == "ok" for r in rows if r["variant"] == name),
                "raw_fit": sum(r.get("raw_fit", False) for r in rows if r["variant"] == name),
                "final_fit": sum(r.get("final_fit", False) for r in rows if r["variant"] == name),
            }
            for name in questions()
        },
    }
    write_json(args.out / "summary.json", summary)
    print(json.dumps(summary, indent=2))
    return 0 if complete else 1


if __name__ == "__main__":
    raise SystemExit(main())
