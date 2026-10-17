"""T041: the SQS loop acknowledges messages correctly."""

import json

from photoprep_worker.main import handle_message
from tests.conftest import JOB


class FakeSqs:
    def __init__(self):
        self.deleted, self.visibility = [], []

    def delete_message(self, QueueUrl, ReceiptHandle):  # noqa: N803 - boto3 names
        self.deleted.append(ReceiptHandle)

    def change_message_visibility(self, QueueUrl, ReceiptHandle, VisibilityTimeout):  # noqa: N803
        self.visibility.append((ReceiptHandle, VisibilityTimeout))


def message(body, handle="h1"):
    return {"Body": body if isinstance(body, str) else json.dumps(body), "ReceiptHandle": handle}


def test_a_finished_job_is_acknowledged(world):
    world.seed()
    sqs = FakeSqs()
    handle_message(world.deps, sqs, "q", message({"jobId": JOB}))
    assert sqs.deleted == ["h1"] and world.job()["status"] == "SUCCEEDED"


def test_a_failed_job_is_still_acknowledged_so_it_is_not_retried_forever(world):
    world.seed()
    world.decider.fail = True
    sqs = FakeSqs()
    handle_message(world.deps, sqs, "q", message({"jobId": JOB}))
    assert sqs.deleted == ["h1"]


def test_a_job_another_worker_holds_stays_on_the_queue(world):
    world.seed(job_status="RUNNING")
    world.store.update(
        f"JOB#{JOB}", "META", set={"leaseOwner": "w2", "leaseUntil": "2026-10-18T09:05:00+00:00"}
    )
    sqs = FakeSqs()
    handle_message(world.deps, sqs, "q", message({"jobId": JOB}))
    assert sqs.deleted == []


def test_duplicates_and_unknown_jobs_are_acknowledged(world):
    sqs = FakeSqs()
    handle_message(world.deps, sqs, "q", message({"jobId": "nope0001"}))
    assert sqs.deleted == ["h1"]


def test_poison_messages_are_dropped_not_retried(world):
    sqs = FakeSqs()
    for i, body in enumerate(["not json", {"other": 1}, {"jobId": 5}, "[]"]):
        handle_message(world.deps, sqs, "q", message(body, handle=f"p{i}"))
    assert sqs.deleted == ["p0", "p1", "p2", "p3"]


class TestReadiness:
    """The door opens only when the worker itself says the model is loaded."""

    def test_the_worker_opens_the_door_when_it_is_ready(self, world):
        from photoprep_common.service_status import get_status, set_status

        from photoprep_worker.main import announce_ready

        set_status(world.store, accepting=False, reason="warming_up")
        announce_ready(world.store)
        assert get_status(world.store) == {"accepting": True, "reason": "open"}

    def test_it_never_reopens_a_door_that_is_being_closed_for_a_stop(self, world):
        from photoprep_common.service_status import get_status, set_status

        from photoprep_worker.main import announce_ready

        set_status(world.store, accepting=False, reason="maintenance", draining=True)
        announce_ready(world.store)
        assert get_status(world.store)["accepting"] is False

    def test_it_closes_the_door_when_it_shuts_down(self, world):
        from photoprep_common.service_status import get_status, set_status

        from photoprep_worker.main import announce_stopping

        set_status(world.store, accepting=True, reason="open")
        announce_stopping(world.store)
        assert get_status(world.store) == {"accepting": False, "reason": "worker_stopped"}


def test_chatty_libraries_are_silenced_even_if_the_root_level_is_debug(world, caplog):
    import logging

    from photoprep_common.logs import quiet_libraries

    quiet_libraries()
    caplog.set_level(logging.DEBUG)
    logging.getLogger("botocore.hooks").debug("item: 秘密の希望文SECRET")
    logging.getLogger("boto3.resources.action").debug("Response: 秘密の希望文SECRET")
    assert "秘密の希望文SECRET" not in caplog.text


class TestServe:
    """The wiring: open the door once ready, close it when the loop ends (even by an error)."""

    def test_the_door_opens_before_the_first_message_and_closes_at_the_end(self, world):
        from photoprep_common.service_status import get_status, set_status

        from photoprep_worker.main import serve

        set_status(world.store, accepting=False, reason="warming_up")
        seen = []

        class OneRound:
            def receive_message(self, **_):
                seen.append(get_status(world.store))
                return {}

        rounds = iter([False, True])
        serve(world.deps, OneRound(), "q", lambda: next(rounds))
        assert seen == [{"accepting": True, "reason": "open"}]
        assert get_status(world.store) == {"accepting": False, "reason": "worker_stopped"}

    def test_the_door_closes_even_when_the_loop_fails(self, world):
        from photoprep_common.service_status import get_status

        from photoprep_worker.main import serve

        class Broken:
            def receive_message(self, **_):
                raise RuntimeError("queue gone")

        try:
            serve(world.deps, Broken(), "q", lambda: False)
        except RuntimeError:
            pass
        assert get_status(world.store)["accepting"] is False
