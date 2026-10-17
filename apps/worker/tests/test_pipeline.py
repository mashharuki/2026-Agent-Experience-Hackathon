"""T029/T041/T047: lease, pipeline order, failure handling and image deletion (all mocked)."""

import logging

import pytest

from photoprep_worker.pipeline import Outcome, process_job
from tests.conftest import JOB, KEY, SESSION
from tests.fakes import observation_text


class TestHappyPath:
    def test_observe_decide_explain_then_store_the_result(self, world):
        world.seed()
        assert process_job(world.deps, JOB) is Outcome.DONE
        job = world.job()
        assert job["status"] == "SUCCEEDED"
        assert job["result"] == {
            "kind": "grooming_tip",
            "text": "眉ブラシで毛流れを整えてみましょう。",
            "basis": "observation",
        }
        assert world.session()["state"] == "ADVICE_SHOWN"
        assert len(world.bedrock.calls) == 2  # one observation + one explanation: the budget

    def test_the_image_is_deleted_and_never_reaches_the_decider_or_the_record(self, world):
        world.seed()
        process_job(world.deps, JOB)
        assert KEY in world.images.deleted and KEY not in world.images.objects
        assert all("\\xff" not in s and "base64" not in s.lower() for s in world.decider.states)
        assert "bytes" not in repr(world.decision()).lower()

    def test_the_decision_record_shows_what_was_chosen_and_what_ran(self, world):
        world.seed()
        process_job(world.deps, JOB)
        record = world.decision()
        assert record["selected"] == record["decider_choice"] == "grooming_tip"
        assert record["guard_override"] is None
        assert record["invoked"] == ["bedrock.observe", "bedrock.explain"]
        assert set(record["probabilities"]) == {
            "grooming_tip",
            "capture_setup_tip",
            "clarify",
            "offer_finish",
        }
        assert "text" not in record and "wish" not in record

    def test_the_decider_never_sees_the_image_only_text_facts(self, world):
        world.seed(wish="眉の形は変えたくない")
        process_job(world.deps, JOB)
        state = world.decider.states[0]
        assert "眉の形は変えたくない" in state and "眉の毛流れが一部乱れて見える" in state

    def test_the_before_baseline_is_kept_for_the_later_comparison(self, world):
        world.seed()
        process_job(world.deps, JOB)
        assert world.session()["baseline"] == {"lighting": "good", "framing": "ok"}


class TestGuardsAreApplied:
    def test_a_decider_choice_that_breaks_a_restriction_is_replaced_and_recorded(self, world):
        world.seed(restrictions=["no_touch_brow"])
        world.decider.selected, world.decider.confidence = "grooming_tip", 0.419
        process_job(world.deps, JOB)
        assert world.job()["result"]["kind"] == "clarify"
        record = world.decision()
        assert (record["decider_choice"], record["selected"], record["guard_override"]) == (
            "grooming_tip",
            "clarify",
            "restriction",
        )
        assert len(world.bedrock.calls) == 1  # no explanation was generated for a blocked tip
        assert world.session()["state"] == "CONSULTING"

    def test_an_unobservable_photo_gets_a_capture_tip_not_a_judgement(self, world):
        world.seed()
        world.bedrock.texts[0] = observation_text(lighting="backlit")
        process_job(world.deps, JOB)
        assert world.job()["result"]["kind"] == "capture_setup_tip"
        assert world.decision()["guard_override"] == "unobservable"
        assert world.session()["state"] == "CAPTURE_ADJUST"

    def test_after_two_changes_no_new_tip(self, world):
        world.seed(changes_used=2, prev_state="COMPARING")
        process_job(world.deps, JOB)
        assert world.job()["result"]["kind"] == "offer_finish"
        assert world.session()["state"] == "DONE"


class TestComparison:
    def test_similar_conditions_are_comparable(self, world):
        world.seed(
            phase="after", prev_state="TRYING", baseline={"lighting": "good", "framing": "ok"}
        )
        world.decider.selected = "clarify"
        process_job(world.deps, JOB)
        assert world.job()["result"]["comparable"] is True
        assert world.session()["state"] == "COMPARING"

    def test_a_big_lighting_change_means_retake_not_a_verdict(self, world):
        world.seed(
            phase="after", prev_state="TRYING", baseline={"lighting": "good", "framing": "ok"}
        )
        world.bedrock.texts[0] = observation_text(lighting="dim")
        world.decider.selected = "clarify"
        process_job(world.deps, JOB)
        assert world.job()["result"]["comparable"] is False
        assert world.session()["state"] == "CAPTURE_ADJUST"


class TestFailures:
    @pytest.mark.parametrize(
        ("break_it", "error_class"),
        [
            (lambda w: w.bedrock.texts.__setitem__(0, "not json"), "model_error"),
            (lambda w: setattr(w.bedrock, "fail_on", 1), "model_error"),
            (lambda w: setattr(w.decider, "fail", True), "model_error"),
            (lambda w: setattr(w.bedrock, "fail_on", 2), "model_error"),
            (lambda w: w.images.objects.__setitem__(KEY, b"not an image"), "unreadable_image"),
            (lambda w: w.images.objects.pop(KEY), "no_image"),
        ],
    )
    def test_failure_is_recorded_the_session_is_restored_and_the_image_is_deleted(
        self, world, break_it, error_class
    ):
        world.seed(prev_state="ADVICE_SHOWN")
        break_it(world)
        assert process_job(world.deps, JOB) is Outcome.FAILED
        job = world.job()
        assert (job["status"], job["errorClass"]) == ("FAILED", error_class)
        assert "result" not in job  # a failed decision is never recorded as a success
        assert world.session()["state"] == "ADVICE_SHOWN"  # back to where the user was
        assert KEY in world.images.deleted or KEY not in world.images.objects

    def test_a_failed_decider_is_not_replaced_by_a_made_up_choice(self, world):
        world.seed()
        world.decider.fail = True
        process_job(world.deps, JOB)
        assert world.decision() is None and "result" not in world.job()


class TestLeaseAndRedelivery:
    def test_a_second_delivery_of_a_finished_job_does_nothing(self, world):
        world.seed()
        process_job(world.deps, JOB)
        calls = len(world.bedrock.calls)
        assert process_job(world.deps, JOB) is Outcome.SKIPPED
        assert len(world.bedrock.calls) == calls

    def test_a_job_another_worker_is_running_is_left_alone(self, world):
        world.seed(job_status="RUNNING")
        world.store.update(
            f"JOB#{JOB}",
            "META",
            set={"leaseOwner": "worker-2", "leaseUntil": "2026-10-18T09:01:00+00:00"},
        )
        assert process_job(world.deps, JOB) is Outcome.BUSY
        assert world.bedrock.calls == [] and world.job()["status"] == "RUNNING"

    def test_an_expired_lease_means_unknown_and_is_never_rerun(self, world):
        world.seed(job_status="RUNNING", prev_state="CONSULTING")
        world.store.update(
            f"JOB#{JOB}",
            "META",
            set={"leaseOwner": "dead", "leaseUntil": "2026-10-18T08:59:00+00:00"},
        )
        assert process_job(world.deps, JOB) is Outcome.FAILED
        assert world.bedrock.calls == []
        job = world.job()
        assert (job["status"], job["errorClass"]) == ("UNKNOWN", "worker_unavailable")
        assert world.session()["state"] == "CONSULTING"

    def test_an_unknown_job_id_is_skipped(self, world):
        assert process_job(world.deps, "nope0001") is Outcome.SKIPPED

    def test_two_workers_cannot_both_take_the_same_job(self, world):
        world.seed()
        first = world.deps
        second = type(first)(**{**first.__dict__, "worker_id": "worker-2"})
        world.store.update(
            f"JOB#{JOB}",
            "META",
            expect={"status": "QUEUED"},
            set={
                "status": "RUNNING",
                "leaseOwner": "worker-1",
                "leaseUntil": "2026-10-18T09:02:00+00:00",
            },
        )
        assert process_job(second, JOB) is Outcome.BUSY


class TestEndedSessions:
    def test_a_session_that_ended_before_the_job_started_is_cancelled_without_calling_models(
        self, world
    ):
        world.seed(state="DONE")
        assert process_job(world.deps, JOB) is Outcome.CANCELLED
        assert world.bedrock.calls == [] and world.decider.states == []
        assert world.job()["status"] == "CANCELLED" and KEY in world.images.deleted

    def test_a_session_ended_during_processing_discards_the_result(self, world):
        world.seed()
        original = world.bedrock.converse

        def end_session_then_answer(system, content):
            world.store.update(f"SESSION#{SESSION}", "META", set={"state": "DONE"})
            return original(system, content)

        world.bedrock.converse = end_session_then_answer
        assert process_job(world.deps, JOB) is Outcome.CANCELLED
        assert world.session()["state"] == "DONE"  # never moved on by a late result
        assert world.job()["status"] == "CANCELLED" and "result" not in world.job()
        assert KEY in world.images.deleted

    def test_an_expired_session_is_cancelled(self, world):
        world.seed()
        world.clock.advance(hours=30)
        assert process_job(world.deps, JOB) is Outcome.CANCELLED


def test_logs_never_contain_the_wish_or_the_model_text(world, caplog):
    caplog.set_level(logging.DEBUG)
    world.seed(wish="秘密の希望文SECRET")
    process_job(world.deps, JOB)
    assert "秘密の希望文SECRET" not in caplog.text
    assert "眉ブラシ" not in caplog.text and "毛流れ" not in caplog.text


class TestRacesBetweenWorkers:
    """Conditional writes are the second line of defence: a stale read stands in for a race."""

    def test_the_job_is_taken_atomically(self, world, monkeypatch):
        world.seed()
        real_get = world.store.get
        stale = real_get(f"JOB#{JOB}", "META")  # the loser read it while still QUEUED
        # The winner takes it first ...
        world.store.update(
            f"JOB#{JOB}",
            "META",
            set={
                "status": "RUNNING",
                "leaseOwner": "worker-2",
                "leaseUntil": "2026-10-18T09:02:00+00:00",
            },
        )
        # ... and the loser, acting on its stale read, must not also start processing.
        monkeypatch.setattr(
            world.store,
            "get",
            lambda pk, sk: dict(stale) if pk == f"JOB#{JOB}" else real_get(pk, sk),
        )
        assert process_job(world.deps, JOB) is Outcome.BUSY
        assert world.bedrock.calls == []
        monkeypatch.undo()  # read the real state again, not the stale snapshot
        assert world.job()["leaseOwner"] == "worker-2"

    def test_a_finished_job_is_not_overwritten_by_a_straggler(self, world):
        from photoprep_common.store import ConditionFailed

        from photoprep_worker.pipeline import _finish_job

        world.seed(job_status="CANCELLED")
        with pytest.raises(ConditionFailed):
            _finish_job(world.deps, JOB, status="SUCCEEDED", result={"kind": "clarify"})
        assert world.job()["status"] == "CANCELLED" and "result" not in world.job()
