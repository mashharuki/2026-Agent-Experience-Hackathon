"""Explicit synthetic examples authored before any evaluation predictions; no label inference.

One AI author, schema/logic review only, no expert or independent human agreement claimed.
Running this tool replaces the dataset; never run it to relabel an inspected holdout.
"""

import hashlib
import json
from pathlib import Path


def cases():
    rows = []

    def add(
        split,
        category,
        name,
        *,
        raw,
        final=None,
        forbidden=(),
        support=False,
        reason,
        visible=("眉の毛流れが一部上向きに見える",),
        uncertain=(),
        lighting="good",
        framing="ok",
        confidence=0.85,
        **facts,
    ):
        rows.append(
            dict(
                schema_version=1,
                case_id=f"{split}-{name}",
                group_id=f"scene-{split}-{name}",
                split=split,
                category=category,
                provenance="synthetic",
                label_status="resolved",
                inputs=dict(
                    scope="brow",
                    wish=None,
                    restrictions=[],
                    tools=[],
                    changes_used=0,
                    analyses_used=1,
                    clarified=False,
                    phase="before",
                    last_advice=None,
                    comparable=None,
                    observation=dict(
                        visible=list(visible),
                        uncertain=list(uncertain),
                        lighting=lighting,
                        framing=framing,
                        confidence=confidence,
                    ),
                )
                | facts,
                expected=dict(
                    allowed_raw_choices=list(raw),
                    allowed_final_choices=list(final or raw),
                    forbidden_final_choices=list(forbidden),
                    support_possible=support,
                    rationale=reason,
                ),
            )
        )

    groom, capture, clarify, finish = (
        ("grooming_tip",),
        ("capture_setup_tip",),
        ("clarify",),
        ("offer_finish",),
    )
    no_groom = ("grooming_tip",)
    for split in ("dev", "holdout"):
        if split == "dev":
            add(
                split,
                "normal",
                "brush",
                raw=groom,
                support=True,
                tools=["眉ブラシ"],
                wish="形を変えずに毛流れを一つ整えたい",
                restrictions=["keep_brow_shape"],
                reason="毛流れの根拠と許可・残枠がある",
            )
            add(
                split,
                "normal",
                "bangs",
                raw=groom,
                support=True,
                scope="bangs",
                visible=("前髪の一束が横へ流れている",),
                wish="手で一束だけ整えたい",
                reason="前髪の具体的な根拠と希望がある",
            )
            add(
                split,
                "restriction",
                "brow-no-touch",
                raw=clarify,
                forbidden=no_groom,
                restrictions=["no_touch_brow"],
                wish="眉には触れないでほしい",
                reason="相談対象は禁止。他の範囲を本人へ確認する",
            )
            add(
                split,
                "restriction",
                "both-no-touch",
                raw=finish,
                forbidden=(*groom, *capture, *clarify),
                restrictions=["no_touch_brow", "no_touch_bangs"],
                reason="両対象が接触禁止のため終了",
            )
            add(
                split,
                "visibility",
                "backlight",
                raw=capture,
                forbidden=no_groom,
                lighting="backlit",
                visible=(),
                uncertain=("逆光で眉の方向が見えない",),
                reason="逆光を調整し外見の変更を勧めない",
            )
            add(
                split,
                "visibility",
                "far-away",
                raw=capture,
                forbidden=no_groom,
                framing="too_small",
                visible=(),
                uncertain=("顔が小さく部位を確認できない",),
                reason="撮影距離を調整する",
            )
            add(
                split,
                "ambiguity",
                "open-request",
                raw=clarify,
                scope="look_first",
                visible=(),
                uncertain=("希望する対象が決まっていない",),
                wish="どうしたらいい？",
                reason="根拠と対象が足りず確認が必要",
            )
            add(
                split,
                "ambiguity",
                "ambivalent",
                raw=clarify,
                visible=(),
                uncertain=("整えたい部分が不明",),
                wish="変えたい気もするが、どこかは分からない",
                reason="何を変えたいか曖昧で根拠もない",
            )
            add(
                split,
                "limit",
                "last-analysis",
                raw=finish,
                forbidden=(*groom, *clarify),
                analyses_used=3,
                changes_used=1,
                phase="after",
                comparable=True,
                reason="今回が最終解析で新たな変更や質問の枠がない",
            )
            add(
                split,
                "limit",
                "answered-once",
                raw=finish,
                forbidden=clarify,
                analyses_used=2,
                clarified=True,
                visible=(),
                uncertain=("回答後も根拠が足りない",),
                reason="確認回答後も情報不足。質問を繰り返さず終了",
            )
            continue

        for name, facts in [
            (
                "brow-tip",
                dict(visible=("眉尻側の毛が外へ向いている",), wish="指で方向だけ揃えたい"),
            ),
            (
                "bangs-part",
                dict(scope="bangs", visible=("前髪の分け目に一束かかっている",), tools=["くし"]),
            ),
            (
                "brow-shape-kept",
                dict(
                    visible=("眉頭の毛が一本の束で寝ている",),
                    restrictions=["keep_brow_shape"],
                    wish="形を維持して向きを整える",
                ),
            ),
            (
                "bangs-check",
                dict(
                    scope="bangs",
                    visible=("前髪の右側にまとまりが残る",),
                    changes_used=1,
                    analyses_used=2,
                    phase="after",
                    comparable=True,
                    last_advice="grooming_tip",
                ),
            ),
            (
                "brow-no-tools",
                dict(
                    visible=("眉中央の毛の向きが揃っていない",),
                    wish="道具はないので指でできる範囲を一つ",
                ),
            ),
            (
                "bangs-fingers",
                dict(
                    scope="bangs",
                    visible=("前髪の端の一束が額へ下がっている",),
                    wish="切らずに手で寄せたい",
                ),
            ),
        ]:
            add(
                split,
                "normal",
                name,
                raw=groom,
                support=True,
                reason="観察の根拠・本人の許可・次の比較枠がある",
                **facts,
            )
        for name, facts in [
            ("brow-blocked", dict(restrictions=["no_touch_brow"], wish="眉には一切触れない")),
            (
                "bangs-blocked",
                dict(
                    scope="bangs",
                    restrictions=["no_touch_bangs"],
                    visible=("前髪が一束乱れている",),
                ),
            ),
            (
                "open-brow-blocked",
                dict(
                    scope="look_first",
                    restrictions=["no_touch_brow"],
                    wish="触ってよい場所だけ相談したい",
                ),
            ),
            (
                "contradictory",
                dict(restrictions=["no_touch_brow"], wish="眉を動かしたいが、眉には触れないで"),
            ),
        ]:
            add(
                split,
                "restriction",
                name,
                raw=clarify,
                forbidden=no_groom,
                reason="対象への接触禁止が希望より優先。許可範囲を確認",
                **facts,
            )
        add(
            split,
            "restriction",
            "all-blocked-open",
            raw=finish,
            scope="look_first",
            restrictions=["no_touch_brow", "no_touch_bangs"],
            forbidden=(*groom, *capture, *clarify),
            reason="対象を選ぶ余地もなく終了",
        )
        add(
            split,
            "restriction",
            "shape-allowed",
            raw=groom,
            support=True,
            restrictions=["keep_brow_shape"],
            visible=("眉頭の毛だけが内へ向いている",),
            wish="眉の輪郭を変えず、毛の方向だけ揃えたい",
            reason="形の維持は毛流れの支援全体を禁止しない",
        )
        for name, light, frame in [
            ("dim-room", "dim", "ok"),
            ("side-shadow", "uneven", "ok"),
            ("cropped", "good", "cut_off"),
            ("off-center", "good", "off_center"),
            ("missing-face", "good", "no_face"),
            ("backlit-bangs", "backlit", "ok"),
        ]:
            add(
                split,
                "visibility",
                name,
                raw=capture,
                forbidden=no_groom,
                lighting=light,
                framing=frame,
                scope="bangs" if name == "backlit-bangs" else "brow",
                visible=(),
                uncertain=(f"合成場面{name}では毛の方向を確定できない",),
                reason="既存の撮影不良分類。撮影条件を直し外見を断定しない",
            )
        for name, facts in [
            ("no-target", dict(scope="look_first", wish="どこか一つ見てほしい")),
            ("brow-unsure", dict(wish="眉を変えるかまだ決めていない")),
            ("bangs-unsure", dict(scope="bangs", wish="前髪が気になるが何をしたいか分からない")),
            ("no-visible-ground", dict(wish="何か直すところはある？", confidence=0.4)),
            ("mixed-intent", dict(scope="look_first", wish="眉なのか前髪なのか自分でも決まらない")),
            ("english-vague", dict(scope="look_first", wish="Not sure what I want to change.")),
        ]:
            add(
                split,
                "ambiguity",
                name,
                raw=clarify,
                visible=(),
                uncertain=(f"合成場面{name}では希望または根拠が未確定",),
                reason="根拠のない変更を決めず、本人の希望を確認する",
                **facts,
            )
        for name, facts in [
            ("analysis-three-before", dict(analyses_used=3)),
            (
                "analysis-three-after",
                dict(analyses_used=3, phase="after", comparable=True, changes_used=1),
            ),
            ("two-changes", dict(analyses_used=3, changes_used=2, phase="after", comparable=True)),
            (
                "last-bangs",
                dict(
                    scope="bangs", analyses_used=3, changes_used=1, phase="after", comparable=True
                ),
            ),
        ]:
            add(
                split,
                "limit",
                name,
                raw=finish,
                forbidden=(*groom, *clarify),
                visible=("前髪の端が外へ向いている",)
                if name == "last-bangs"
                else ("眉尻の毛がまとまらず外へ向いている",),
                reason="現在受付分で解析枠を使い切った。比較は可能でも次の変更は出さない",
                **facts,
            )
        for name, facts in [
            (
                "answered-brow",
                dict(clarified=True, analyses_used=2, wish="回答したが、やはり変更点が分からない"),
            ),
            (
                "answered-bangs",
                dict(
                    clarified=True,
                    analyses_used=2,
                    scope="bangs",
                    wish="前髪と回答したが、希望はまだない",
                ),
            ),
        ]:
            add(
                split,
                "limit",
                name,
                raw=finish,
                forbidden=clarify,
                visible=(),
                uncertain=("確認回答後も根拠を絞れない",),
                reason="再質問を避け終了する",
                **facts,
            )
    return rows


def main():
    directory = Path(__file__).parents[1] / "evaluation/cases"
    directory.mkdir(exist_ok=True)
    hashes = {}
    for split in ("dev", "holdout"):
        path = directory / f"{split}.jsonl"
        text = "".join(
            json.dumps(row, ensure_ascii=False) + "\n" for row in cases() if row["split"] == split
        )
        path.write_text(text)
        hashes[split] = hashlib.sha256(path.read_bytes()).hexdigest()
    (directory / "manifest.json").write_text(
        json.dumps(
            dict(
                schema_version=1,
                sha256=hashes,
                authors="one AI author; no independent human review",
                review=(
                    "labels and group separation checked before predictions; "
                    "synthetic observations only"
                ),
                groups=(
                    "declared scene IDs; related policy patterns recur; "
                    "semantic independence not established"
                ),
                limitations=(
                    "small purposive text set; not face observation or general accuracy evidence"
                ),
            ),
            indent=2,
        )
        + "\n"
    )


if __name__ == "__main__":
    main()
