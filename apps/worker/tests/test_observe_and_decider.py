"""T043/T044/T046: Bedrock observation, the Decider adapter and explanations (mocked)."""

import json

import pytest

from photoprep_worker.bedrock import BudgetedBedrock, CallBudgetExceeded
from photoprep_worker.decider import (
    CRITERIA,
    INSTRUCTIONS,
    QUESTION_NAME,
    StrandsDecider,
    build_state_text,
)
from photoprep_worker.explain import ExplainError, build_advice
from photoprep_worker.images import PreparedImage
from photoprep_worker.observe import ObservationError, observe
from photoprep_worker.schemas import Observation
from tests.fakes import FakeBedrock, observation_text

IMAGE = PreparedImage(data=b"\xff\xd8\xff-jpeg-bytes", width=800, height=600)
OBS = Observation.model_validate(json.loads(observation_text()))


class TestObserve:
    def test_valid_json_is_validated_and_returned(self):
        bedrock = FakeBedrock(observation_text())
        assert observe(bedrock, IMAGE, scope="brow") == OBS
        assert len(bedrock.calls) == 1

    def test_json_inside_code_fences_is_accepted(self):
        bedrock = FakeBedrock("```json\n" + observation_text() + "\n```")
        assert observe(bedrock, IMAGE, scope="brow").lighting == "good"

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "I cannot help",
            "{not json",
            "[]",
            observation_text(lighting="sunny"),
            '{"visible": []}',
        ],
    )
    def test_bad_model_output_is_an_error_not_a_guess(self, text):
        with pytest.raises(ObservationError):
            observe(FakeBedrock(text), IMAGE, scope="brow")

    def test_image_is_sent_as_a_jpeg_block_and_the_prompt_demands_json_only(self):
        bedrock = FakeBedrock(observation_text())
        observe(bedrock, IMAGE, scope="bangs")
        call = bedrock.calls[0]
        blocks = call["content"]
        assert any(b.get("image", {}).get("format") == "jpeg" for b in blocks)
        assert "JSON" in call["system"]
        texts = " ".join(b["text"] for b in blocks if "text" in b)
        assert "前髪" in texts


class TestCallBudget:
    def test_third_call_is_refused(self):
        inner = FakeBedrock("a", "b", "c")
        budget = BudgetedBedrock(inner, max_calls=2)
        budget.converse("s", [])
        budget.converse("s", [])
        with pytest.raises(CallBudgetExceeded):
            budget.converse("s", [])
        assert len(inner.calls) == 2
        assert budget.calls == 2


class FakeEngine:
    """Same shape as strands_decider's SystemOneEngine.ask (confirmed in the T008 spike)."""

    def __init__(self, choice="clarify"):
        self.choice = choice
        self.asked = []

    def ask(self, state, questions):
        self.asked.append((state, questions))
        probs = dict.fromkeys(questions[QUESTION_NAME].criteria, 0.1)
        probs[self.choice] = 0.7
        answer = type("A", (), {"choice": self.choice, "probabilities": probs, "confidence": 0.6})()
        return type("R", (), {"answers": {QUESTION_NAME: answer}})()


class TestDecider:
    def test_the_typed_question_has_the_four_documented_options(self):
        assert list(CRITERIA) == ["grooming_tip", "capture_setup_tip", "clarify", "offer_finish"]
        assert "次に使う支援" in INSTRUCTIONS

    def test_adapter_asks_one_choice_question_and_maps_the_answer(self):
        engine = FakeEngine("capture_setup_tip")
        choice = StrandsDecider(engine).choose("state text")
        state, questions = engine.asked[0]
        assert state == "state text" and list(questions) == [QUESTION_NAME]
        assert questions[QUESTION_NAME].type == "choice"
        assert (choice.selected, choice.confidence) == ("capture_setup_tip", 0.6)
        assert set(choice.probabilities) == set(CRITERIA)

    def test_an_option_outside_the_contract_is_an_error(self):
        with pytest.raises(ValueError):
            StrandsDecider(FakeEngine("buy_cream")).choose("x")

    def test_state_text_carries_the_facts_the_decision_needs_but_no_image(self):
        text = build_state_text(
            scope="brow",
            wish="眉の形は変えたくないが毛流れは整えたい",
            restrictions=["keep_brow_shape"],
            observation=OBS,
            tools=["眉ブラシ"],
            changes_used=1,
            phase="before",
            last_advice="grooming_tip",
        )
        for needle in (
            "brow",
            "眉の形は変えたくない",
            "keep_brow_shape",
            "眉の毛流れが一部乱れて見える",
            "眉ブラシ",
            "1/2",
        ):
            assert needle in text
        assert "base64" not in text.lower() and "\\x" not in text


class TestAdvice:
    def ctx(self, **kw):
        base = {"scope": "brow", "wish": None, "restrictions": [], "phase": "before"}
        return {**base, **kw}

    def test_grooming_tip_asks_bedrock_once_and_reports_it(self):
        bedrock = FakeBedrock("眉ブラシで毛流れを整えてみましょう。")
        advice, invoked = build_advice("grooming_tip", OBS, bedrock, **self.ctx())
        assert advice.kind == "grooming_tip" and advice.basis == "observation"
        assert advice.text == "眉ブラシで毛流れを整えてみましょう。"
        assert invoked == ["bedrock.explain"] and len(bedrock.calls) == 1

    def test_the_explanation_prompt_carries_the_users_restrictions(self):
        bedrock = FakeBedrock("ok")
        build_advice("grooming_tip", OBS, bedrock, **self.ctx(restrictions=["keep_brow_shape"]))
        prompt = bedrock.calls[0]["system"] + json.dumps(
            bedrock.calls[0]["content"], ensure_ascii=False
        )
        assert "形は変えない" in prompt

    @pytest.mark.parametrize("kind", ["capture_setup_tip", "clarify", "offer_finish"])
    def test_other_kinds_use_no_model_call(self, kind):
        bedrock = FakeBedrock()
        advice, invoked = build_advice(kind, OBS, bedrock, **self.ctx())
        assert advice.kind == kind and advice.text and invoked == ["none"] and bedrock.calls == []

    def test_capture_tip_depends_on_what_is_wrong(self):
        backlit = Observation.model_validate(json.loads(observation_text(lighting="backlit")))
        far = Observation.model_validate(json.loads(observation_text(framing="too_small")))
        text_a, _ = build_advice("capture_setup_tip", backlit, FakeBedrock(), **self.ctx())
        text_b, _ = build_advice("capture_setup_tip", far, FakeBedrock(), **self.ctx())
        assert text_a.text != text_b.text

    def test_overlong_or_empty_explanations_are_errors_not_fallbacks(self):
        for bad in ("", "   ", "あ" * 401):
            with pytest.raises(ExplainError):
                build_advice("grooming_tip", OBS, FakeBedrock(bad), **self.ctx())

    def test_after_phase_carries_the_comparability(self):
        advice, _ = build_advice(
            "clarify", OBS, FakeBedrock(), **self.ctx(phase="after"), comparable=True
        )
        assert advice.comparable is True
