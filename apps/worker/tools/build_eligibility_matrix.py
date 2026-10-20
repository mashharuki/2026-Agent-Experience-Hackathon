"""Freeze a new synthetic state matrix before v4 validation, without model/policy labels."""

import hashlib
import json
from pathlib import Path


def main():
    out = Path(__file__).resolve().parents[1] / "evaluation/eligibility-matrix"
    out.mkdir(exist_ok=False)
    rows = []
    kinds = ["grooming_tip", "capture_setup_tip", "clarify", "offer_finish"]
    for scope, noun in (("brow", "眉"), ("bangs", "前髪")):
        for category in ("normal", "restriction", "visibility", "ambiguity", "limit"):
            for variant in range(4):
                split = "dev" if variant == 0 else "holdout"
                locations = ("中央", "右端", "左端", "先端")
                facts = dict(
                    scope=scope,
                    wish=f"{noun}の流れだけ手元の道具でそろえたい",
                    restrictions=[],
                    tools=["ブラシ"],
                    changes_used=0,
                    analyses_used=1,
                    clarified=False,
                    phase="before",
                    last_advice=None,
                    comparable=None,
                    observation=dict(
                        visible=[f"{noun}の{locations[variant]}に一束だけ外向きの毛先が見える"],
                        uncertain=[],
                        lighting="good",
                        framing="ok",
                        confidence=0.78,
                    ),
                )
                obs = facts["observation"]
                allowed, forbidden, support = ["grooming_tip"], [], category == "normal"
                if category == "normal":
                    if variant == 1:
                        facts.update(clarified=True, analyses_used=2)
                    elif variant == 2:
                        facts.update(
                            phase="after", comparable=True, changes_used=1, analyses_used=2
                        )
                    elif variant == 3:
                        obs["confidence"] = 0.35
                elif category == "restriction":
                    facts.update(
                        restrictions=[f"no_touch_{scope}"],
                        wish=f"{noun}に触れることは避けて相談したい",
                    )
                    allowed, forbidden = ["clarify", "offer_finish"], ["grooming_tip"]
                    if variant == 2:
                        facts["restrictions"] = ["no_touch_brow", "no_touch_bangs"]
                        obs["framing"] = "cut_off"
                    elif variant == 3:
                        facts.update(clarified=True, analyses_used=2)
                    if variant in (2, 3):
                        allowed, forbidden = ["offer_finish"], kinds[:-1]
                elif category == "visibility":
                    allowed, forbidden = kinds[1:], ["grooming_tip"]
                    if variant == 1:
                        facts.update(phase="after", comparable=False, analyses_used=2)
                        obs["framing"] = "unknown"
                        allowed, forbidden = (
                            ["capture_setup_tip", "offer_finish"],
                            ["grooming_tip", "clarify"],
                        )
                    elif variant == 3:
                        obs["visible"] = []
                        allowed = ["clarify", "offer_finish"]
                    else:
                        obs["lighting"] = "dim" if variant == 0 else "uneven"
                elif category == "ambiguity":
                    facts["wish"] = f"{noun}を変えたいか迷うので、先に意向を確認してほしい"
                    if variant == 0:
                        facts["wish"] = f"{noun}について何を相談したいか自分でもまだ分からない"
                    obs.update(visible=[], uncertain=["相談したい点と観察根拠がまだ合わない"])
                    allowed, forbidden = ["clarify", "offer_finish"], ["grooming_tip"]
                    if variant == 2:
                        facts.update(clarified=True, analyses_used=2)
                        obs["lighting"] = "unknown"
                        allowed, forbidden = (
                            ["capture_setup_tip", "offer_finish"],
                            ["grooming_tip", "clarify"],
                        )
                    elif variant == 3:
                        facts.update(phase="after", comparable=True, analyses_used=2)
                        allowed, forbidden = ["offer_finish"], kinds[:-1]
                else:
                    allowed, forbidden = ["offer_finish"], kinds[:-1]
                    facts["analyses_used"] = 3
                    if variant == 2:
                        facts.update(
                            changes_used=2, analyses_used=2, phase="after", comparable=False
                        )
                    elif variant == 3:
                        facts.update(changes_used=1, phase="after", comparable=True)
                name = f"matrix-{scope}-{category}-{variant}"
                rows.append(
                    dict(
                        schema_version=1,
                        case_id=name,
                        group_id=f"scene-{name}",
                        split=split,
                        category=category,
                        provenance="synthetic",
                        label_status="resolved",
                        inputs=facts,
                        expected=dict(
                            allowed_raw_choices=allowed,
                            allowed_final_choices=allowed,
                            forbidden_final_choices=forbidden,
                            support_possible=support,
                            rationale="事前に固定した状態組合せの要件上の許容集合",
                        ),
                    )
                )
    hashes = {}
    for split in ("dev", "holdout"):
        path = out / f"{split}.jsonl"
        path.write_text(
            "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows if r["split"] == split)
        )
        hashes[split] = hashlib.sha256(path.read_bytes()).hexdigest()
    (out / "manifest.json").write_text(
        json.dumps(
            dict(
                schema_version=1,
                dataset_version="eligibility-matrix-v1",
                sha256=hashes,
                authors="one AI author; independent human review pending",
                review=(
                    "frozen before v4 predictions; "
                    "authored factor combinations, not model labels"
                ),
                groups="new exact inputs; related policy patterns recur; not semantic independence",
                limitations=(
                    "synthetic state matrix; "
                    "not representative users or general model accuracy"
                ),
            ),
            indent=2,
        )
        + "\n"
    )


if __name__ == "__main__":
    main()
