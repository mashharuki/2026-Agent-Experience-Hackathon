"""T008 spike: ask Strands Decider 2B our 4-way typed `choice` question.

Throwaway experiment (not product code). Run from this directory:
    .venv/bin/python spike.py
States are synthetic text only; no photos are used.
"""

import json
import resource
import sys
import time

from strands_decider.infer import load_engine
from strands_decider.schema import ChoiceQuestion

CHECKPOINT = "StrandsAgents/strands-decider-2B-qwen3.5-v1-2610"

QUESTION = ChoiceQuestion(
    instructions=(
        "本人の依頼と今確認できている状態から、次に使う支援はどれか？"
    ),
    criteria={
        "grooming_tip": "観察に根拠があり、本人の禁止に反しない身支度の一手を示す",
        "capture_setup_tip": "観察が難しい撮影条件（逆光・位置・光の差）を調整するよう案内する",
        "clarify": "根拠が弱い・依頼が曖昧・矛盾しているため、本人に確認する",
        "offer_finish": "試行の上限に達した、または本人が終えたいので終了を提案する",
    },
)

CASES = {
    "A_flow_only": (
        "相談範囲: 眉。希望: 眉の形は変えたくないが毛流れは整えたい。"
        "道具: 眉ブラシあり。観察: 眉の毛流れが一部乱れて見える。照明: 十分。"
        "試した回数: 0/2。"
    ),
    "B_backlight": (
        "相談範囲: 眉。希望: 毛流れを整えたい。"
        "観察: 逆光で眉がほとんど見えない。照明: 逆光。試した回数: 0/2。"
    ),
    "C_vague": (
        "相談範囲: まず見てほしい。希望: なし。"
        "観察: 目立つ乱れは確認できない。不確かな点: 前髪の分け目。試した回数: 0/2。"
    ),
    "D_limit_reached": (
        "相談範囲: 眉。観察: 毛流れは概ね整っている。試した回数: 2/2。"
        "本人の反応: もう十分。"
    ),
    "E_forbidden": (
        "相談範囲: 眉。希望: 眉には触れたくない。禁止: 眉の操作。"
        "観察: 眉の毛流れが乱れて見える。照明: 十分。試した回数: 0/2。"
    ),
}


def rss_mib() -> float:
    # ru_maxrss is bytes on macOS
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024)


def main() -> None:
    device = sys.argv[1] if len(sys.argv) > 1 else "cpu"
    t0 = time.perf_counter()
    engine = load_engine(CHECKPOINT, device=device)
    load_s = time.perf_counter() - t0
    print(json.dumps({"event": "loaded", "device": device, "load_s": round(load_s, 1),
                      "peak_rss_mib": round(rss_mib())}), flush=True)

    for name, state in CASES.items():
        runs = []
        for _ in range(3):
            t = time.perf_counter()
            res = engine.ask(state, {"next_support": QUESTION})
            runs.append(time.perf_counter() - t)
        ans = res.answers["next_support"]
        print(json.dumps({
            "case": name,
            "choice": ans.choice,
            "confidence": round(ans.confidence, 3),
            "probabilities": {k: round(v, 3) for k, v in ans.probabilities.items()},
            "latency_s": [round(x, 2) for x in runs],
            "usage": res.usage.model_dump(),
            "peak_rss_mib": round(rss_mib()),
        }, ensure_ascii=False), flush=True)
    print("RAW_RESPONSE_SAMPLE:", res.model_dump_json(), flush=True)


if __name__ == "__main__":
    main()
