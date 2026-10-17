"""Turn the chosen support into the text the user sees.

Only ``grooming_tip`` calls the model. The other kinds use fixed, neutral wording chosen
from the observation, so they cost nothing and cannot invent anything. A failed or
unusable explanation is an error: it is never replaced by canned advice presented as if
the model had written it.
"""

import re

from .bedrock import Bedrock
from .observe import SCOPE_LABEL
from .schemas import Advice, Observation

DEFAULT_LANGUAGE = "ja"

_RESTRICTION_RULE = {
    "ja": {
        "no_touch_brow": "眉には触れない",
        "keep_brow_shape": "眉の形は変えない",
        "no_touch_bangs": "前髪には触れない",
    },
    "en": {
        "no_touch_brow": "do not touch the brows",
        "keep_brow_shape": "do not change the brow shape",
        "no_touch_bangs": "do not touch the bangs",
    },
}

_SCOPE_LABEL = {
    "ja": SCOPE_LABEL,
    "en": {"brow": "brows", "bangs": "bangs", "look_first": "brows and bangs"},
}

EXPLAIN_SYSTEM = {
    "ja": """あなたは撮影前の身支度を手伝うアシスタントの「説明」担当です。
観察結果にもとづき、今すぐ自分でできて元に戻せる身支度の一手を、日本語で1つだけ、200文字以内で説明してください。
守ること:
- 眉のカット・抜く・剃る、メイク、商品の購入は勧めない。
- 見えていないことは断定しない。
- 外見の評価や点数付けをしない。
- 本人の禁止事項に反することは言わない。
- 箇条書きや見出しを使わず、やさしい口調の文章だけを出力する。""",
    "en": """You are the "explanation" part of an assistant that helps people get ready before a photo.
Based on the observation, explain exactly one grooming step the person can do right now and undo, in English, in at most 300 characters.
Rules:
- Do not recommend cutting, plucking or shaving the brows, makeup, or buying products.
- Do not state anything that is not visible.
- Do not rate or score the person's appearance.
- Never say anything that goes against the person's restrictions.
- Output only gentle, plain sentences: no bullet points and no headings.""",
}

_CAPTURE_TEXT = {
    "ja": {
        "backlit": "光源（窓や照明）が後ろにあるようです。窓や照明が顔の正面に来る向きにして、もう一度撮ってみましょう。",
        "dim": "少し暗いようです。明るい場所か窓の近くで、撮り直してみましょう。",
        "uneven": "顔に影が出ているようです。正面から均一に光が当たる場所で、撮り直してみましょう。",
        "too_small": "顔が小さく写っています。もう少しカメラに近づいて、顔が枠いっぱいになるようにしましょう。",
        "off_center": "顔が中心からずれています。顔が画面の真ん中に来るように合わせましょう。",
        "cut_off": "顔が見切れています。顔全体が入るように、カメラの位置を調整しましょう。",
        "no_face": "顔が見つかりませんでした。顔が画面に入るようにして撮り直しましょう。",
    },
    "en": {
        "backlit": "The light seems to be behind you. Turn so a window or lamp is in front of your face, then take the photo again.",
        "dim": "It looks a little dark. Try again in a brighter place or near a window.",
        "uneven": "There seem to be shadows on your face. Try again where the light falls evenly from the front.",
        "too_small": "Your face looks small in the frame. Move a little closer so it fills the frame.",
        "off_center": "Your face is off center. Line it up with the middle of the screen.",
        "cut_off": "Part of your face is cut off. Adjust the camera so your whole face is in view.",
        "no_face": "No face was found. Make sure your face is in the frame and try again.",
    },
}
_CAPTURE_DEFAULT = {
    "ja": "撮影の条件を少し整えて、もう一度撮ってみましょう。",
    "en": "Adjust the shooting conditions a little and take the photo again.",
}
_NOT_COMPARABLE = {
    "ja": "前の写真と光や位置が違うため、比べられません。",
    "en": "The light or position differs from the earlier photo, so they cannot be compared. ",
}

_CLARIFY_TEXT = {
    "ja": {
        "brow": "眉のどの部分が気になりますか？気になる箇所を教えてください。",
        "bangs": "前髪のどの部分が気になりますか？気になる箇所を教えてください。",
        "look_first": "眉と前髪のどちらを見てほしいですか？",
    },
    "en": {
        "brow": "Which part of your brows bothers you? Please tell me which spot.",
        "bangs": "Which part of your bangs bothers you? Please tell me which spot.",
        "look_first": "Would you like me to look at your brows or your bangs?",
    },
}
_CLARIFY_RESTRICTED = {
    "ja": "触れたくない範囲があるため、別の範囲（たとえば前髪）を見ましょうか。それとも、このまま終えますか？",
    "en": "Since there is an area you do not want to touch, shall I look at another area (for example, the bangs)? Or would you rather finish here?",
}
_FINISH_TEXT = {
    "ja": "ここまでにしましょう。比べた中から気に入った方を選んで、撮影に進めます。",
    "en": "Let's stop here. Choose the one you like best from the comparison and go on to your photo.",
}
_NONE = {"ja": "なし", "en": "none"}
_SEPARATOR = {"ja": "、", "en": ", "}


# What the explanation must never contain, checked after the model has written it. The prompt asks
# for the same things; this makes it a rule of the code (FR-008) instead of a request to a model.
_FORBIDDEN_ACTIONS = {
    "ja": re.compile(
        r"カット|切(?:る|って|り|ら)|抜(?:く|いて|き)|剃|脱毛|毛抜き|メイク|化粧|購入|買(?:う|って|い)"
    ),
    "en": re.compile(
        r"\b(?:cut(?:ting)?|trim(?:ming)?|pluck(?:ing)?|tweez\w*|shav(?:e|ing)|wax(?:ing)?|"
        r"dye|bleach|make-?up|buy(?:ing)?|purchase)\b",
        re.IGNORECASE,
    ),
}
_BROWS = {"ja": re.compile(r"眉"), "en": re.compile(r"\bbrows?\b|\beyebrows?\b", re.IGNORECASE)}
_BANGS = {"ja": re.compile(r"前髪"), "en": re.compile(r"\bbangs?\b|\bfringe\b", re.IGNORECASE)}
_RESHAPING = {
    "ja": re.compile(r"形を(?:変|整|作)|整形|アーチ|細く|太く|ラインを(?:変|整|引)"),
    "en": re.compile(
        r"\breshap\w*|\b(?:change|alter|redefine|adjust)\s+(?:the\s+|your\s+)?(?:brow\s+)?shape\b|"
        r"\barch\b|\bthinn?(?:er|ing)?\b|\bthicken\w*",
        re.IGNORECASE,
    ),
}


class ExplainError(Exception):
    """The explanation could not be produced or was unusable."""


def _violates(text: str, restrictions: list[str], lang: str) -> bool:
    """True if the generated text goes against a restriction or recommends a forbidden action."""
    if _FORBIDDEN_ACTIONS[lang].search(text):
        return True
    mentions_brows = bool(_BROWS[lang].search(text))
    if "no_touch_brow" in restrictions and mentions_brows:
        return True
    if "no_touch_bangs" in restrictions and _BANGS[lang].search(text):
        return True
    return (
        "keep_brow_shape" in restrictions and mentions_brows and bool(_RESHAPING[lang].search(text))
    )


def _lang(language: str | None) -> str:
    return language if language in EXPLAIN_SYSTEM else DEFAULT_LANGUAGE


def _capture_text(observation: Observation, comparable: bool | None, lang: str) -> str:
    reason = None
    if observation.framing in _CAPTURE_TEXT[lang]:
        reason = observation.framing
    elif observation.lighting in _CAPTURE_TEXT[lang]:
        reason = observation.lighting
    text = _CAPTURE_TEXT[lang].get(reason, _CAPTURE_DEFAULT[lang])
    return f"{_NOT_COMPARABLE[lang]}{text}" if comparable is False else text


def _grooming_text(observation, bedrock, scope, wish, restrictions, lang) -> str:
    rules = [_RESTRICTION_RULE[lang][r] for r in restrictions if r in _RESTRICTION_RULE[lang]]
    none, sep = _NONE[lang], _SEPARATOR[lang]
    labels = (
        ("相談範囲", "本人の希望", "本人の禁止事項", "観察できたこと", "不確かな点")
        if lang == "ja"
        else (
            "Scope",
            "The person's wish",
            "The person's restrictions",
            "What was observed",
            "Uncertain points",
        )
    )
    content = [
        {
            "text": "\n".join(
                [
                    f"{labels[0]}: {_SCOPE_LABEL[lang].get(scope, scope)}",
                    f"{labels[1]}: {wish or none}",
                    f"{labels[2]}: " + (sep.join(rules) or none),
                    f"{labels[3]}: " + ("; ".join(observation.visible) or none),
                    f"{labels[4]}: " + ("; ".join(observation.uncertain) or none),
                ]
            )
        }
    ]
    prompt = EXPLAIN_SYSTEM[lang] + (f"\n{labels[2]}: " + sep.join(rules) if rules else "")
    text = bedrock.converse(prompt, content).strip()
    if not text or len(text) > 400 or _violates(text, restrictions, lang):
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
    language: str | None = None,
) -> tuple[Advice, list[str]]:
    """Return the advice and which models were invoked to produce it."""
    lang = _lang(language)
    invoked = ["none"]
    basis = "observation"
    if kind == "grooming_tip":
        text = _grooming_text(observation, bedrock, scope, wish, restrictions, lang)
        invoked = ["bedrock.explain"]
    elif kind == "capture_setup_tip":
        text = _capture_text(observation, comparable, lang)
    elif kind == "clarify":
        no_touch = {r for r in restrictions if r.startswith("no_touch_")}
        restricted = bool(no_touch) and (
            scope == "look_first"
            or ("no_touch_brow" in no_touch and scope == "brow")
            or ("no_touch_bangs" in no_touch and scope == "bangs")
        )
        text = (
            _CLARIFY_RESTRICTED[lang]
            if restricted
            else _CLARIFY_TEXT[lang].get(scope, _CLARIFY_TEXT[lang]["look_first"])
        )
        basis = "user_request" if (wish or restrictions) else "observation"
    elif kind == "offer_finish":
        text = _FINISH_TEXT[lang]
        basis = "user_request"
    else:
        raise ValueError(f"unknown advice kind: {kind}")
    comparable_value = comparable if phase == "after" else None
    return Advice(kind=kind, text=text, basis=basis, comparable=comparable_value), invoked
