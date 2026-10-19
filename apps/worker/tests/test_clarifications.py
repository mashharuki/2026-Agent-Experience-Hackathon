"""Answers reuse a synthetic observation, not a retained photograph."""

from photoprep_common.clarification import context_key

from photoprep_worker.pipeline import Outcome, process_job
from tests.conftest import JOB, KEY, SESSION
from tests.fakes import FakeBedrock


def test_clarify_saves_a_short_lived_context_and_deletes_photo(world):
    world.seed(scope="look_first")
    world.decider.selected = "clarify"
    assert process_job(world.deps, JOB) == Outcome.DONE
    assert world.session()["state"] == "CLARIFYING"
    metadata = world.job()["result"]["clarification"]
    assert metadata["allowedScopes"] == ["brow", "bangs"]
    assert KEY not in world.images.objects
    assert world.store.get(f"SESSION#{SESSION}", context_key(JOB))["observation"]


def test_answer_calls_decider_with_answer_but_does_not_observe_again(world):
    world.seed(scope="look_first")
    world.decider.selected = "clarify"
    process_job(world.deps, JOB)
    answer_job = "answer001"
    world.store.update(
        f"SESSION#{SESSION}",
        "META",
        set={
            "state": "ANALYZING",
            "scope": "brow",
            "wish": "flow only",
            "analysesUsed": 2,
            "activeJobId": answer_job,
        },
    )
    world.store.update(f"SESSION#{SESSION}", context_key(JOB), set={"answerJobId": answer_job})
    world.store.create_if_absent(
        f"JOB#{answer_job}",
        "META",
        {
            "jobId": answer_job,
            "ownerSub": "user-123",
            "sessionId": SESSION,
            "inputKind": "clarification",
            "clarificationId": JOB,
            "phase": "before",
            "prevState": "CONSULTING",
            "status": "QUEUED",
        },
    )
    world.bedrock = FakeBedrock("眉ブラシで毛流れを整えてみましょう。")
    world.decider.selected = "grooming_tip"
    assert process_job(world.deps, answer_job) == Outcome.DONE
    assert len(world.bedrock.calls) == 1
    assert "flow only" in world.decider.states[-1]
    assert world.store.get(f"SESSION#{SESSION}", context_key(JOB)) is None
    record = world.store.get(f"SESSION#{SESSION}", f"DECISION#{answer_job}")
    assert "bedrock.observe" not in record["invoked"]


def test_both_prohibited_areas_end_without_grooming_or_question(world):
    world.seed(restrictions=["no_touch_brow", "no_touch_bangs"])
    assert process_job(world.deps, JOB) == Outcome.DONE
    assert world.job()["result"]["kind"] == "offer_finish"
    assert len(world.bedrock.calls) == 1
