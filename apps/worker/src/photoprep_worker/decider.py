"""Strands Decider 2B as the "next support" decision (the hackathon's meaningful decision).

The Decider takes TEXT only (confirmed in the T008 spike): the photo is observed by
Bedrock and only the resulting facts are passed here. It answers one typed ``choice``
question with a probability per option and a confidence. Call shape verified against
strands-decider 0.1.0: ``engine.ask(state, {name: ChoiceQuestion(...)})``.
"""

from dataclasses import dataclass
from typing import Protocol

from strands_decider.schema import ChoiceQuestion

from .observe import SCOPE_LABEL
from .schemas import Observation

QUESTION_VERSION = "v1"
QUESTION_NAME = "next_support"
INSTRUCTIONS = "本人の依頼と今確認できている状態から、次に使う支援はどれか？"
# Option identifiers are part of the public decision pattern: do not rename them.
CRITERIA = {
    "grooming_tip": "観察に根拠があり、本人の禁止に反しない身支度の一手を示す",
    "capture_setup_tip": "観察が難しい撮影条件（逆光・位置・光の差）を調整するよう案内する",
    "clarify": "根拠が弱い・依頼が曖昧・矛盾しているため、本人に確認する",
    "offer_finish": "試行の上限に達した、または本人が終えたいので終了を提案する",
}
DEFAULT_CHECKPOINT = "StrandsAgents/strands-decider-2B-qwen3.5-v1-2610"

_RESTRICTION_LABEL = {
    "no_touch_brow": "眉には触れない",
    "keep_brow_shape": "眉の形は変えない",
    "no_touch_bangs": "前髪には触れない",
}


@dataclass(frozen=True)
class Choice:
    selected: str
    probabilities: dict[str, float]
    confidence: float


class Decider(Protocol):
    def choose(self, state_text: str) -> Choice: ...


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


class StrandsDecider:
    def __init__(self, engine) -> None:
        self._engine = engine
        self._question = ChoiceQuestion(instructions=INSTRUCTIONS, criteria=CRITERIA)

    def choose(self, state_text: str) -> Choice:
        response = self._engine.ask(state_text, {QUESTION_NAME: self._question})
        answer = response.answers[QUESTION_NAME]
        if answer.choice not in CRITERIA:
            raise ValueError("decider returned an option outside the contract")
        return Choice(
            selected=answer.choice,
            probabilities={k: float(v) for k, v in answer.probabilities.items()},
            confidence=float(answer.confidence),
        )


def load_strands_decider(
    checkpoint: str = DEFAULT_CHECKPOINT, device: str = "cpu"
) -> StrandsDecider:
    """Load the model once at start-up and reuse it (about 5.7 GB resident on CPU)."""
    from strands_decider.infer import load_engine

    return StrandsDecider(load_engine(checkpoint, device=device))
