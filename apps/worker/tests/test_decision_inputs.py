import pytest

from photoprep_worker.decider import CRITERIA, INSTRUCTIONS, build_decision_state
from photoprep_worker.decision_inputs import DecisionInputs
from photoprep_worker.decision_pattern import TypedQuestion


def inputs(**kw):
    return DecisionInputs.model_validate(
        dict(
            scope="brow",
            restrictions=["no_touch_brow"],
            observation=dict(
                visible=["毛の方向が一部異なる"],
                uncertain=[],
                lighting="good",
                framing="ok",
                confidence=0.8,
            ),
            changes_used=1,
            analyses_used=2,
            phase="before",
            clarified=True,
        )
        | kw
    )


def test_v2_rendering_and_guard_context_share_authoritative_counts_and_restrictions():
    facts = inputs()
    question = TypedQuestion("next_support", "v2", INSTRUCTIONS, CRITERIA)
    text = build_decision_state(facts, question)
    guard = facts.guard_context()
    assert guard.analyses_used == 2 and guard.clarified is True
    assert guard.restrictions == ["no_touch_brow"]
    assert "残り解析枠: 1" in text
    assert "確認質問への回答: 済み" in text
    assert "前後比較: 未実施" in text
    assert "接触可能な相談範囲: なし" in text


def test_final_accepted_analysis_can_return_comparison_with_no_new_analysis_slot():
    facts = inputs(analyses_used=3, phase="after", comparable=True)
    text = build_decision_state(facts, TypedQuestion("next_support", "v2", INSTRUCTIONS, CRITERIA))
    assert "残り解析枠: 0" in text and "前後比較: 可能" in text
    assert facts.guard_context().analyses_used == 3


def test_question_renderer_mismatch_is_rejected():
    with pytest.raises(ValueError):
        build_decision_state(inputs(), TypedQuestion("next_support", "v3", INSTRUCTIONS, CRITERIA))
    with pytest.raises(ValueError):
        build_decision_state(inputs(), TypedQuestion("other", "v2", INSTRUCTIONS, CRITERIA))


def test_pipeline_counts_current_job_identically_for_v2_and_guard(world, monkeypatch):
    from photoprep_worker import pipeline
    from tests.conftest import SESSION

    world.seed(changes_used=1)
    world.store.update(f"SESSION#{SESSION}", "META", set={"analysesUsed": 3})
    monkeypatch.setattr(
        pipeline, "NEXT_SUPPORT", TypedQuestion("next_support", "v2", INSTRUCTIONS, CRITERIA)
    )
    assert pipeline.process_job(world.deps, "job00001") == pipeline.Outcome.DONE
    assert "残り解析枠: 0" in world.decider.states[0]
    assert world.decision()["guard_override"] == "analysis_limit"
    assert world.decision()["selected"] == "offer_finish"
    assert world.decision()["question_version"] == "v2"
    assert len(world.bedrock.calls) == 1  # observe only; no explanation for finishing
