"""SQS loop. Concurrency is 1 (one job at a time, sized for a 4 vCPU task)."""

import json
import os
import signal
import socket
import threading
from datetime import UTC, datetime

from photoprep_common.logs import log_event
from photoprep_common.service_status import PK, SK, set_status

from .pipeline import Deps, Outcome, heartbeat, process_job

VISIBILITY_SECONDS = 120
HEARTBEAT_SECONDS = 30
WAIT_SECONDS = 20


def announce_ready(store) -> None:
    """Open the door once the model is loaded, unless a stop is already being carried out."""
    item = store.get(PK, SK)
    if item and item.get("draining"):
        return
    set_status(store, accepting=True, reason="open")


def announce_stopping(store) -> None:
    set_status(store, accepting=False, reason="worker_stopped")


def _job_id(body: str) -> str | None:
    try:
        parsed = json.loads(body)
    except ValueError:
        return None
    job_id = parsed.get("jobId") if isinstance(parsed, dict) else None
    return job_id if isinstance(job_id, str) and job_id else None


def handle_message(deps: Deps, sqs, queue_url: str, message: dict) -> Outcome | None:
    """Process one message. Delete it unless another worker still holds the job."""
    receipt = message["ReceiptHandle"]
    job_id = _job_id(message["Body"])
    if job_id is None:
        sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=receipt)  # can never succeed
        log_event("poison_message_dropped", error_class="bad_message")
        return None

    stop = threading.Event()

    def keep_alive() -> None:
        while not stop.wait(HEARTBEAT_SECONDS):
            heartbeat(deps, job_id)
            sqs.change_message_visibility(
                QueueUrl=queue_url, ReceiptHandle=receipt, VisibilityTimeout=VISIBILITY_SECONDS
            )

    beat = threading.Thread(target=keep_alive, daemon=True)
    beat.start()
    try:
        outcome = process_job(deps, job_id)
    finally:
        stop.set()
        beat.join(timeout=1)
    if outcome is not Outcome.BUSY:
        sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=receipt)
    return outcome


def run_forever(deps: Deps, sqs, queue_url: str, should_stop) -> None:
    while not should_stop():
        response = sqs.receive_message(
            QueueUrl=queue_url,
            MaxNumberOfMessages=1,
            WaitTimeSeconds=WAIT_SECONDS,
            VisibilityTimeout=VISIBILITY_SECONDS,
        )
        for message in response.get("Messages", []):
            handle_message(deps, sqs, queue_url, message)


def main() -> None:  # pragma: no cover - wiring only, exercised on AWS
    import boto3
    from photoprep_common.store import DynamoStore

    from .aws import S3Images
    from .bedrock import DEFAULT_MODEL_ID, BedrockConverse
    from .decider import DEFAULT_CHECKPOINT, load_strands_decider

    region = os.environ.get("AWS_REGION", "ap-northeast-1")
    decider = load_strands_decider(os.environ.get("DECIDER_CHECKPOINT", DEFAULT_CHECKPOINT))
    deps = Deps(
        store=DynamoStore(os.environ["TABLE_NAME"], region=region),
        images=S3Images(os.environ["IMAGE_BUCKET"]),
        bedrock=lambda: BedrockConverse(
            os.environ.get("BEDROCK_MODEL_ID", DEFAULT_MODEL_ID), region=region
        ),
        decider=decider,
        now=lambda: datetime.now(UTC),
        worker_id=socket.gethostname(),
    )
    stopping = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopping.set())
    run_forever(
        deps, boto3.client("sqs", region_name=region), os.environ["QUEUE_URL"], stopping.is_set
    )


if __name__ == "__main__":
    main()
