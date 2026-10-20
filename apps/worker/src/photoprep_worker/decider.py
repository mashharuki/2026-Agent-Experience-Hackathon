"""Strands Decider 2B as the "next support" decision (the hackathon's meaningful decision).

The Decider takes TEXT only (confirmed in the T008 spike): the photo is observed by
Bedrock and only the resulting facts are passed here. It answers one typed ``choice``
question with a probability per option and a confidence. Call shape verified against
strands-decider 0.1.0: ``engine.ask(state, {name: ChoiceQuestion(...)})``.
"""

from .decision_inputs import DecisionInputs
from .decision_pattern import (
    DEFAULT_CHECKPOINT,
    Choice,
    Decider,
    TypedQuestion,
    load_engine,
)
from .decision_pattern import StrandsDecider as PatternDecider
from .observe import SCOPE_LABEL
from .schemas import Observation

__all__ = [
    "CRITERIA",
    "DEFAULT_CHECKPOINT",
    "INSTRUCTIONS",
    "NEXT_SUPPORT",
    "QUESTION_NAME",
    "QUESTION_VERSION",
    "Choice",
    "Decider",
    "StrandsDecider",
    "build_state_text",
    "build_state_text_v2",
    "build_decision_state",
    "load_strands_decider",
]

QUESTION_VERSION = "v4"
QUESTION_NAME = "next_support"
INSTRUCTIONS = "本人の依頼と今確認できている状態から、次に使う支援はどれか？"
# Option identifiers are part of the public decision pattern: do not rename them.
CRITERIA = {
    "grooming_tip": "観察に根拠があり、本人の禁止に反しない身支度の一手を示す",
    "capture_setup_tip": "観察が難しい撮影条件（逆光・位置・光の差）を調整するよう案内する",
    "clarify": "根拠が弱い・依頼が曖昧・矛盾しているため、本人に確認する",
    "offer_finish": "試行の上限に達した、または本人が終えたいので終了を提案する",
}
V3_INSTRUCTIONS = "提示された実行可能な候補から、本人の希望と観察に最も合う次の支援を一つ選ぶ。"
V3_CRITERIA = {
    "grooming_tip": "観察に根拠があり、本人の希望に合う身支度の一手を示す",
    "capture_setup_tip": "身支度より先に、写真の光・位置・比較条件を整えることが役立つ",
    "clarify": "本人の希望や相談範囲が曖昧で、確認してから支援を決めることが役立つ",
    "offer_finish": "変更を望まない、または支援を続ける利益が乏しく、そのまま終了を提案する",
}


def question_for(version: str) -> TypedQuestion:
    if version not in {"v1", "v2", "v3", "v4"}:
        raise ValueError("unsupported_question_version")
    return TypedQuestion(
        QUESTION_NAME,
        version,
        V3_INSTRUCTIONS if version == "v3" else INSTRUCTIONS,
        V3_CRITERIA if version == "v3" else CRITERIA,
    )


NEXT_SUPPORT = question_for(QUESTION_VERSION)

_RESTRICTION_LABEL = {
    "no_touch_brow": "眉には触れない",
    "keep_brow_shape": "眉の形は変えない",
    "no_touch_bangs": "前髪には触れない",
}


def build_state_text(
    *,
    scope: str,
    wish: str | None,
    restrictions: list[str],
    observation: Observation,
    tools: list[str],
    changes_used: int,
    phase: str,
    last_advice: str | None,
) -> str:
    """The facts the decision needs, as text. Never contains pixels or image data."""
    lines = [
        f"相談範囲: {SCOPE_LABEL.get(scope, scope)} ({scope})",
        f"本人の希望: {wish or 'なし'}",
        "本人の禁止: "
        + (", ".join(f"{_RESTRICTION_LABEL.get(r, r)} ({r})" for r in restrictions) or "なし"),
        f"撮影の段階: {'整えた後の確認' if phase == 'after' else '整える前'}",
        "観察できたこと: " + ("; ".join(observation.visible) or "なし"),
        "不確かな点: " + ("; ".join(observation.uncertain) or "なし"),
        f"光: {observation.lighting} / 顔の位置: {observation.framing}",
        f"観察の確かさ: {observation.confidence:.2f}",
        "手元の道具: " + (", ".join(tools) or "未確認"),
        f"試した回数: {changes_used}/2",
        f"直前の助言: {last_advice or 'なし'}",
    ]
    return "\n".join(lines)


def build_state_text_v2(inputs: DecisionInputs) -> str:
    """Same question/criteria, plus facts previously visible only to guards."""
    labels = {"brow": "眉 (brow)", "bangs": "前髪 (bangs)"}
    scopes = ("brow", "bangs") if inputs.scope == "look_first" else (inputs.scope,)
    allowed = [labels[s] for s in scopes if f"no_touch_{s}" not in inputs.restrictions]
    comparison = "未実施" if inputs.comparable is None else "可能" if inputs.comparable else "不可"
    return (
        build_state_text(**inputs.v1_arguments())
        + "\n"
        + "\n".join(
            [
                f"解析回数（現在の受付分を含む）: {inputs.analyses_used}/3",
                f"残り解析枠: {max(0, 3 - inputs.analyses_used)}",
                f"残り変更枠: {max(0, 2 - inputs.changes_used)}",
                f"確認質問への回答: {'済み' if inputs.clarified else '未回答'}",
                f"前後比較: {comparison}",
                "接触可能な相談範囲: " + (", ".join(allowed) or "なし"),
            ]
        )
    )


def build_state_text_v3(inputs: DecisionInputs) -> str:
    from .support_policy import support_eligibility

    labels = {"brow": "眉 (brow)", "bangs": "前髪 (bangs)"}
    global_scopes = [s for s in labels if f"no_touch_{s}" not in inputs.restrictions]
    current = (
        global_scopes
        if inputs.scope == "look_first"
        else [s for s in global_scopes if s == inputs.scope]
    )
    other = [s for s in global_scopes if s not in current]
    text = build_state_text_v2(inputs).rsplit("\n接触可能な相談範囲:", 1)[0]
    return (
        text
        + "\n"
        + "\n".join(
            [
                "現在の相談対象で接触可能: " + (", ".join(labels[s] for s in current) or "なし"),
                "本人に確認後に選べる他の対象: " + (", ".join(labels[s] for s in other) or "なし"),
                "実行可能な候補: " + ", ".join(support_eligibility(inputs).allowed),
            ]
        )
    )


def build_decision_state(inputs: DecisionInputs, question: TypedQuestion = NEXT_SUPPORT) -> str:
    if question != question_for(question.version):
        raise ValueError("question_renderer_mismatch")
    if question.version in {"v3", "v4"}:
        return build_state_text_v3(inputs)
    return (
        build_state_text(**inputs.v1_arguments())
        if question.version == "v1"
        else build_state_text_v2(inputs)
    )


def StrandsDecider(engine) -> PatternDecider:  # noqa: N802 - keeps the original constructor name
    """The pattern's decider bound to this app's question."""
    return PatternDecider(engine, NEXT_SUPPORT)


def load_strands_decider(
    checkpoint: str = DEFAULT_CHECKPOINT, device: str = "cpu"
) -> PatternDecider:
    """Load the model once at start-up and reuse it (about 5.7 GB resident on CPU)."""
    return StrandsDecider(load_engine(checkpoint, device=device))
