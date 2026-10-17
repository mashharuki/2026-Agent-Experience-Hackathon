"""Start and stop the Fargate worker, and open or close the door accordingly.

Invoked by EventBridge Scheduler (nightly ``stop``, a ``reconcile`` every few minutes) and by
hand before a demo (``{"action": "start"}``). The worker is not an always-on service: while
it is stopped the API refuses new work with a clear reason instead of queueing it.

* start: run one task, keep the door CLOSED (``warming_up``); the worker itself opens it once
  the model is loaded and it can reach its dependencies.
* stop: close the door first, then scale to zero only when no job is waiting or running;
  otherwise keep the task until the queue is empty (``reconcile`` finishes the job).
* reconcile: finish a pending stop, and close the door if it says "open" while no worker is
  meant to be running.
"""

import os
from datetime import timedelta

from photoprep_common.logs import log_event
from photoprep_common.service_status import PK, SK, get_status, set_status

WARMUP_ESTIMATE = timedelta(minutes=5)  # roughly the 80 s model load plus task start; unmeasured


class WorkerControl:
    def __init__(self, *, ecs, sqs, store, cluster, service, queue_url, now) -> None:
        self._ecs, self._sqs, self._store = ecs, sqs, store
        self._cluster, self._service, self._queue_url, self._now = cluster, service, queue_url, now

    def handle(self, event: dict) -> dict:
        action = (event or {}).get("action")
        if action == "start":
            return self._start()
        if action == "stop":
            return self._stop()
        if action == "reconcile":
            return self._reconcile()
        raise ValueError("unknown action")

    # -- helpers -------------------------------------------------------------------------
    def _desired(self) -> int:
        services = self._ecs.describe_services(cluster=self._cluster, services=[self._service])
        return int(services["services"][0]["desiredCount"])

    def _scale(self, count: int) -> None:
        self._ecs.update_service(cluster=self._cluster, service=self._service, desiredCount=count)

    def _idle(self) -> bool:
        attrs = self._sqs.get_queue_attributes(
            QueueUrl=self._queue_url,
            AttributeNames=["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
        )["Attributes"]
        return (
            int(attrs["ApproximateNumberOfMessages"])
            + int(attrs["ApproximateNumberOfMessagesNotVisible"])
            == 0
        )

    def _draining(self) -> bool:
        item = self._store.get(PK, SK)
        return bool(item and item.get("draining"))

    # -- actions -------------------------------------------------------------------------
    def _start(self) -> dict:
        if self._desired() >= 1:
            return self._start_running()
        reopen = (self._now() + WARMUP_ESTIMATE).isoformat()
        set_status(self._store, accepting=False, reason="warming_up", expected_reopen_at=reopen)
        self._scale(1)  # also cancels a drain: draining was reset by set_status
        log_event("worker_start", status=200)
        return {"action": "start"}

    def _start_running(self) -> dict:
        """A worker is already up. It opens the door once, at boot, so closing the door here
        would leave it closed for good. Keep the door as it is; only a pending drain is
        cancelled, and then the worker, which never left, is serving again."""
        if self._draining():
            set_status(self._store, accepting=True, reason="open")  # also resets draining
        log_event("worker_start_noop", status=200)
        return {"action": "start", "alreadyRunning": True}

    def _stop(self) -> dict:
        if self._idle():
            set_status(self._store, accepting=False, reason="worker_stopped")
            self._scale(0)
            log_event("worker_stop", status=200)
            return {"action": "stop", "stopped": True, "draining": False}
        set_status(self._store, accepting=False, reason="maintenance", draining=True)
        log_event("worker_draining", status=202)
        return {"action": "stop", "stopped": False, "draining": True}

    def _reconcile(self) -> dict:
        if self._draining():
            if not self._idle():
                return {"action": "reconcile", "stopped": False}
            set_status(self._store, accepting=False, reason="worker_stopped")
            self._scale(0)
            log_event("worker_stop", status=200)
            return {"action": "reconcile", "stopped": True}
        if get_status(self._store)["accepting"] and self._desired() == 0:
            set_status(self._store, accepting=False, reason="worker_stopped")
            log_event("door_closed", status=200)
        return {"action": "reconcile", "stopped": False}


def handler(event, context):  # pragma: no cover - wiring only, exercised on AWS
    from datetime import UTC, datetime

    import boto3
    from photoprep_common.store import DynamoStore

    region = os.environ.get("AWS_REGION")
    control = WorkerControl(
        ecs=boto3.client("ecs", region_name=region),
        sqs=boto3.client("sqs", region_name=region),
        store=DynamoStore(os.environ["TABLE_NAME"], region=region),
        cluster=os.environ["CLUSTER_NAME"],
        service=os.environ["SERVICE_NAME"],
        queue_url=os.environ["QUEUE_URL"],
        now=lambda: datetime.now(UTC),
    )
    return control.handle(event)
