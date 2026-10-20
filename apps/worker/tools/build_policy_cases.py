"""Author a separate, versioned synthetic set; never overwrite previous experiments."""

import hashlib
import json
from pathlib import Path

DESTINATION = Path(__file__).resolve().parents[1] / "evaluation/policy-cases"
TIP = ["grooming_tip"]
ASK = ["clarify", "offer_finish"]
CAPTURE = ["capture_setup_tip", "clarify", "offer_finish"]
FINISH = ["offer_finish"]


def build():
    rows = []

    def add(split, name, category, expected, *, support=False, observation=None, **patch):
        facts = dict(
            scope="bangs",
            wish="写真を撮る前に一つだけ相談したい",
            restrictions=[],
            tools=[],
            changes_used=0,
            analyses_used=1,
            clarified=False,
            phase="before",
            last_advice=None,
            comparable=None,
            observation=dict(
                visible=["前髪の中央の一束が右に寄って見える"],
                uncertain=[],
                lighting="good",
                framing="ok",
                confidence=0.82,
            ),
        )
        facts.update(patch)
        facts["observation"] |= observation or {}
        # This text only differentiates independent synthetic wishes, not the desired answer.
        facts["wish"] = facts["wish"] + (
            "。余計な変更は望まない" if split == "dev" else "。自分で納得して決めたい"
        )
        rows.append(
            dict(
                schema_version=1,
                case_id=f"policy-{split}-{name}",
                group_id=f"policy-scene-{split}-{name}",
                split=split,
                category=category,
                provenance="synthetic",
                label_status="resolved",
                inputs=facts,
                expected=dict(
                    allowed_raw_choices=expected,
                    allowed_final_choices=expected,
                    forbidden_final_choices=[]
                    if expected == TIP
                    else [
                        k
                        for k in ("grooming_tip", "capture_setup_tip", "clarify", "offer_finish")
                        if k not in expected
                    ],
                    support_possible=support,
                    rationale="事前に記述した要件上の許容集合。安全な終了と継続支援を区別する",
                ),
            )
        )

    add("dev", "comb", "normal", TIP, support=True, tools=["くし"])
    add(
        "dev",
        "shape",
        "normal",
        TIP,
        support=True,
        scope="brow",
        restrictions=["keep_brow_shape"],
        wish="眉の形は維持して流れだけそろえたい",
        observation={"visible": ["眉尻の毛先が一か所だけ上を向いている"]},
    )
    add("dev", "blocked-target", "restriction", ASK, restrictions=["no_touch_bangs"])
    add(
        "dev",
        "all-blocked",
        "restriction",
        FINISH,
        restrictions=["no_touch_brow", "no_touch_bangs"],
        observation={"lighting": "dim"},
    )
    add("dev", "unknown-light", "visibility", CAPTURE, observation={"lighting": "unknown"})
    add(
        "dev",
        "no-evidence",
        "visibility",
        ASK,
        observation={"visible": [], "uncertain": ["部位の様子を特定できない"]},
    )
    add(
        "dev",
        "undecided",
        "ambiguity",
        ASK,
        scope="look_first",
        wish="眉と前髪のどちらを相談するか決められていない",
        observation={"visible": []},
    )
    add(
        "dev",
        "answered-no-basis",
        "ambiguity",
        FINISH,
        clarified=True,
        analyses_used=2,
        observation={"visible": [" "]},
    )
    add("dev", "final-dark", "limit", FINISH, analyses_used=3, observation={"lighting": "dim"})
    add(
        "dev",
        "second-change",
        "limit",
        FINISH,
        changes_used=2,
        analyses_used=2,
        phase="after",
        comparable=True,
    )

    add(
        "holdout",
        "fingers",
        "normal",
        TIP,
        support=True,
        wish="前髪を指で軽くそろえたい",
        observation={"visible": ["前髪の左端の束だけ外に向いている"]},
    )
    add(
        "holdout",
        "brush",
        "normal",
        TIP,
        support=True,
        scope="brow",
        tools=["眉ブラシ"],
        observation={"visible": ["右眉の内側だけ毛先が斜め上に向いている"]},
    )
    add(
        "holdout",
        "after-permitted",
        "normal",
        TIP,
        support=True,
        phase="after",
        comparable=True,
        changes_used=1,
        analyses_used=2,
        observation={"visible": ["前髪の毛先に一束だけ重なりが残っている"]},
    )
    add(
        "holdout",
        "answer-supported",
        "normal",
        TIP,
        support=True,
        clarified=True,
        analyses_used=2,
        wish="気になるのは前髪の一束。そこを手でそろえたい",
        observation={"visible": ["前髪の一束が隣より浮いている"]},
    )
    add(
        "holdout",
        "keep-shape",
        "normal",
        TIP,
        support=True,
        scope="brow",
        restrictions=["keep_brow_shape"],
        wish="形はそのまま、眉尻の流れをそろえたい",
        observation={"visible": ["眉尻の一部分の毛先が下がっている"]},
    )
    add(
        "holdout",
        "other-area-blocked",
        "normal",
        TIP,
        support=True,
        restrictions=["no_touch_brow"],
        observation={"visible": ["前髪の中央だけ右向きに流れている"]},
    )

    add(
        "holdout",
        "bangs-blocked",
        "restriction",
        ASK,
        restrictions=["no_touch_bangs"],
        wish="前髪には手を触れたくない",
    )
    add(
        "holdout",
        "brow-blocked",
        "restriction",
        ASK,
        scope="brow",
        restrictions=["no_touch_brow"],
        wish="眉への操作は避けてほしい",
    )
    add(
        "holdout",
        "blocked-after",
        "restriction",
        FINISH,
        scope="brow",
        restrictions=["no_touch_brow"],
        phase="after",
        comparable=True,
        analyses_used=2,
    )
    add(
        "holdout",
        "both-and-offset",
        "restriction",
        FINISH,
        restrictions=["no_touch_bangs", "no_touch_brow"],
        observation={"framing": "off_center"},
    )
    add(
        "holdout",
        "open-one-blocked",
        "restriction",
        ASK,
        scope="look_first",
        restrictions=["no_touch_bangs"],
        wish="触れたくない前髪以外で相談したい",
    )
    add(
        "holdout",
        "answered-blocked",
        "restriction",
        FINISH,
        clarified=True,
        restrictions=["no_touch_bangs"],
        analyses_used=2,
    )

    add("holdout", "unknown-frame", "visibility", CAPTURE, observation={"framing": "unknown"})
    add("holdout", "uneven-light", "visibility", CAPTURE, observation={"lighting": "uneven"})
    add(
        "holdout",
        "no-face",
        "visibility",
        CAPTURE,
        observation={"framing": "no_face", "visible": []},
    )
    add(
        "holdout",
        "after-no-baseline",
        "visibility",
        ["capture_setup_tip", "offer_finish"],
        phase="after",
        comparable=False,
        analyses_used=2,
        changes_used=1,
    )
    add("holdout", "blank-basis", "visibility", ASK, observation={"visible": [" ", "\t"]})
    add(
        "holdout",
        "small-and-backlit",
        "visibility",
        CAPTURE,
        observation={"visible": [], "lighting": "backlit", "framing": "too_small"},
    )

    for i, scope in enumerate(("brow", "bangs", "look_first")):
        add(
            "holdout",
            f"unclear-{scope}",
            "ambiguity",
            ASK,
            scope=scope,
            wish=(
                "今はどこを整えるか自分でも決められない"
                if i == 0
                else "変更するか迷っているので、先に確認してほしい"
            ),
            observation={"visible": [], "uncertain": ["相談したい点の根拠が足りない"]},
        )
        add(
            "holdout",
            f"answered-{scope}",
            "ambiguity",
            FINISH,
            scope=scope,
            clarified=True,
            analyses_used=2,
            observation={"visible": [], "uncertain": ["回答後も観察根拠を特定できない"]},
        )

    for i, (phase, comparable) in enumerate((("before", None), ("after", True), ("after", False))):
        add(
            "holdout",
            f"quota-{i}",
            "limit",
            FINISH,
            phase=phase,
            comparable=comparable,
            analyses_used=3,
            changes_used=i % 2,
            observation={"lighting": "unknown" if i == 2 else "good"},
        )
        add(
            "holdout",
            f"changes-{i}",
            "limit",
            FINISH,
            phase=phase,
            comparable=comparable,
            changes_used=2,
            analyses_used=2,
            clarified=True,
            observation={"visible": [] if i == 1 else ["前髪の左端が一束だけ重なっている"]},
        )
    return rows


def main():
    DESTINATION.mkdir(exist_ok=False)
    hashes = {}
    for split in ("dev", "holdout"):
        path = DESTINATION / f"{split}.jsonl"
        path.write_text(
            "".join(
                json.dumps(r, ensure_ascii=False) + "\n" for r in build() if r["split"] == split
            )
        )
        hashes[split] = hashlib.sha256(path.read_bytes()).hexdigest()
    (DESTINATION / "manifest.json").write_text(
        json.dumps(
            dict(
                schema_version=1,
                dataset_version="eligibility-v1",
                sha256=hashes,
                authors="one AI author; independent human review pending",
                review="authored and frozen before real predictions; not independent expert labels",
                groups=(
                    "new scene IDs and exact inputs; "
                    "semantic overlap with prior policy patterns remains"
                ),
                limitations="synthetic text only; not general model accuracy or product utility",
            ),
            indent=2,
        )
        + "\n"
    )


if __name__ == "__main__":
    main()
