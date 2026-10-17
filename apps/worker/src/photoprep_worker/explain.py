"""Turn the chosen support into the text the user sees.

Only ``grooming_tip`` calls the model. The other kinds use fixed, neutral wording chosen
from the observation, so they cost nothing and cannot invent anything. A failed or
unusable explanation is an error: it is never replaced by canned advice presented as if
the model had written it.
"""

from .bedrock import Bedrock
from .observe import SCOPE_LABEL
from .schemas import Advice, Observation

_RESTRICTION_RULE = {
    "no_touch_brow": "眉には触れない",
    "keep_brow_shape": "眉の形は変えない",
    "no_touch_bangs": "前髪には触れない",
}

EXPLAIN_SYSTEM = """あなたは撮影前の身支度を手伝うアシスタントの「説明」担当です。
観察結果にもとづき、今すぐ自分でできて元に戻せる身支度の一手を、日本語で1つだけ、200文字以内で説明してください。
守ること:
- 眉のカット・抜く・剃る、メイク、商品の購入は勧めない。
- 見えていないことは断定しない。
- 外見の評価や点数付けをしない。
- 本人の禁止事項に反することは言わない。
- 箇条書きや見出しを使わず、やさしい口調の文章だけを出力する。"""

_CAPTURE_TEXT = {
    "backlit": "光源（窓や照明）が後ろにあるようです。窓や照明が顔の正面に来る向きにして、もう一度撮ってみましょう。",
    "dim": "少し暗いようです。明るい場所か窓の近くで、撮り直してみましょう。",
    "uneven": "顔に影が出ているようです。正面から均一に光が当たる場所で、撮り直してみましょう。",
    "too_small": "顔が小さく写っています。もう少しカメラに近づいて、顔が枠いっぱいになるようにしましょう。",
    "off_center": "顔が中心からずれています。顔が画面の真ん中に来るように合わせましょう。",
    "cut_off": "顔が見切れています。顔全体が入るように、カメラの位置を調整しましょう。",
    "no_face": "顔が見つかりませんでした。顔が画面に入るようにして撮り直しましょう。",
}
_CAPTURE_DEFAULT = "撮影の条件を少し整えて、もう一度撮ってみましょう。"
_NOT_COMPARABLE = "前の写真と光や位置が違うため、比べられません。"

_CLARIFY_TEXT = {
    "brow": "眉のどの部分が気になりますか？気になる箇所を教えてください。",
    "bangs": "前髪のどの部分が気になりますか？気になる箇所を教えてください。",
    "look_first": "眉と前髪のどちらを見てほしいですか？",
}
_CLARIFY_RESTRICTED = "触れたくない範囲があるため、別の範囲（たとえば前髪）を見ましょうか。それとも、このまま終えますか？"
_FINISH_TEXT = "ここまでにしましょう。比べた中から気に入った方を選んで、撮影に進めます。"


class ExplainError(Exception):
    """The explanation could not be produced or was unusable."""


def _capture_text(observation: Observation, comparable: bool | None) -> str:
    reason = None
    if observation.framing in _CAPTURE_TEXT:
        reason = observation.framing
    elif observation.lighting in _CAPTURE_TEXT:
        reason = observation.lighting
    text = _CAPTURE_TEXT.get(reason, _CAPTURE_DEFAULT)
    return f"{_NOT_COMPARABLE}{text}" if comparable is False else text


def _grooming_text(observation, bedrock, scope, wish, restrictions) -> str:
    rules = [_RESTRICTION_RULE[r] for r in restrictions if r in _RESTRICTION_RULE]
    content = [
        {
            "text": "\n".join(
                [
                    f"相談範囲: {SCOPE_LABEL.get(scope, scope)}",
                    f"本人の希望: {wish or 'なし'}",
                    "本人の禁止事項: " + ("、".join(rules) or "なし"),
                    "観察できたこと: " + ("; ".join(observation.visible) or "なし"),
                    "不確かな点: " + ("; ".join(observation.uncertain) or "なし"),
                ]
            )
        }
    ]
    prompt = EXPLAIN_SYSTEM + ("\n本人の禁止事項: " + "、".join(rules) if rules else "")
    text = bedrock.converse(prompt, content).strip()
    if not text or len(text) > 400:
        raise ExplainError("unusable explanation")
    return text


def build_advice(
    kind: str,
    observation: Observation,
    bedrock: Bedrock,
    *,
    scope: str,
    wish: str | None,
    restrictions: list[str],
    phase: str,
    comparable: bool | None = None,
) -> tuple[Advice, list[str]]:
    """Return the advice and which models were invoked to produce it."""
    invoked = ["none"]
    basis = "observation"
    if kind == "grooming_tip":
        text = _grooming_text(observation, bedrock, scope, wish, restrictions)
        invoked = ["bedrock.explain"]
    elif kind == "capture_setup_tip":
        text = _capture_text(observation, comparable)
    elif kind == "clarify":
        no_touch = {r for r in restrictions if r.startswith("no_touch_")}
        restricted = bool(no_touch) and (
            scope == "look_first"
            or ("no_touch_brow" in no_touch and scope == "brow")
            or ("no_touch_bangs" in no_touch and scope == "bangs")
        )
        text = (
            _CLARIFY_RESTRICTED
            if restricted
            else _CLARIFY_TEXT.get(scope, _CLARIFY_TEXT["look_first"])
        )
        basis = "user_request" if (wish or restrictions) else "observation"
    elif kind == "offer_finish":
        text = _FINISH_TEXT
        basis = "user_request"
    else:
        raise ValueError(f"unknown advice kind: {kind}")
    comparable_value = comparable if phase == "after" else None
    return Advice(kind=kind, text=text, basis=basis, comparable=comparable_value), invoked
