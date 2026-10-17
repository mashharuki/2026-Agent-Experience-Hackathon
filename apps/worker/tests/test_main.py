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
