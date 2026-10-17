"""T051: starting and stopping the worker without losing jobs or accepting work it cannot do."""

import pytest
from photoprep_common.service_status import get_status
from photoprep_common.store import InMemoryStore

from photoprep_api.ops.worker_control import WorkerControl
from tests.fakes import FixedClock


class FakeEcs:
    def __init__(self, desired=0):
        self.desired = desired
        self.updates = []

    def update_service(self, cluster, service, desiredCount):  # noqa: N803 - boto3 names
        self.updates.append((cluster, service, desiredCount))
        self.desired = desiredCount
        return {}

    def describe_services(self, cluster, services):
        return {"services": [{"desiredCount": self.desired, "runningCount": self.desired}]}


class FakeSqs:
    def __init__(self, waiting=0, in_flight=0):
        self.waiting, self.in_flight = waiting, in_flight

    def get_queue_attributes(self, QueueUrl, AttributeNames):  # noqa: N803
        return {
            "Attributes": {
                "ApproximateNumberOfMessages": str(self.waiting),
                "ApproximateNumberOfMessagesNotVisible": str(self.in_flight),
            }
        }


def control(desired=0, waiting=0, in_flight=0):
    ecs, sqs, store, clock = (
        FakeEcs(desired),
        FakeSqs(waiting, in_flight),
        InMemoryStore(),
        FixedClock(),
    )
    wc = WorkerControl(
        ecs=ecs, sqs=sqs, store=store, cluster="c", service="s", queue_url="q", now=clock
    )
    return wc, ecs, sqs, store


def test_start_runs_one_task_and_keeps_closed_until_the_model_is_loaded():
    wc, ecs, _, store = control()
    result = wc.handle({"action": "start"})
    assert ecs.updates == [("c", "s", 1)]
    status = get_status(store)
    assert status["accepting"] is False and status["reason"] == "warming_up"
    assert "expectedReopenAt" in status  # the app can show a restart estimate
    assert result["action"] == "start"


def test_start_is_safe_to_repeat():
    wc, ecs, _, _ = control(desired=1)
    wc.handle({"action": "start"})
    assert ecs.desired == 1


def test_stop_when_idle_closes_the_door_and_scales_to_zero():
    wc, ecs, _, store = control(desired=1)
    result = wc.handle({"action": "stop"})
    assert ecs.desired == 0
    assert get_status(store) == {"accepting": False, "reason": "worker_stopped"}
    assert result["stopped"] is True


@pytest.mark.parametrize(("waiting", "in_flight"), [(1, 0), (0, 1), (2, 1)])
def test_stop_with_work_in_progress_closes_the_door_but_lets_it_finish(waiting, in_flight):
    wc, ecs, _, store = control(desired=1, waiting=waiting, in_flight=in_flight)
    result = wc.handle({"action": "stop"})
    assert ecs.desired == 1  # not killed mid-job
    status = get_status(store)
    assert status["accepting"] is False and status["reason"] == "maintenance"
    assert store.get("SERVICE#status", "META")["draining"] is True
    assert result["stopped"] is False and result["draining"] is True


def test_reconcile_finishes_a_drain_once_the_queue_is_empty():
    wc, ecs, sqs, store = control(desired=1, in_flight=1)
    wc.handle({"action": "stop"})
    assert wc.handle({"action": "reconcile"})["stopped"] is False  # still busy
    sqs.in_flight = 0
    result = wc.handle({"action": "reconcile"})
    assert ecs.desired == 0 and result["stopped"] is True
    assert get_status(store) == {"accepting": False, "reason": "worker_stopped"}
    assert store.get("SERVICE#status", "META")["draining"] is False


def test_reconcile_does_nothing_while_the_service_is_running_normally():
    wc, ecs, _, store = control(desired=1)
    from photoprep_common.service_status import set_status

    set_status(store, accepting=True, reason="open")
    wc.handle({"action": "reconcile"})
    assert ecs.updates == [] and get_status(store)["accepting"] is True


def test_reconcile_closes_the_door_if_no_worker_is_supposed_to_be_running():
    """The flag says open but the service is scaled to zero (e.g. changed by hand): fail closed."""
    wc, _, _, store = control(desired=0)
    from photoprep_common.service_status import set_status

    set_status(store, accepting=True, reason="open")
    wc.handle({"action": "reconcile"})
    assert get_status(store) == {"accepting": False, "reason": "worker_stopped"}


def test_start_during_a_drain_cancels_it():
    wc, ecs, _, store = control(desired=1, in_flight=1)
    wc.handle({"action": "stop"})
    wc.handle({"action": "start"})
    assert store.get("SERVICE#status", "META")["draining"] is False
    assert ecs.desired == 1


def test_unknown_actions_are_rejected():
    wc, _, _, _ = control()
    with pytest.raises(ValueError):
        wc.handle({"action": "delete_everything"})
    with pytest.raises(ValueError):
        wc.handle({})


class TestStartOnARunningWorker:
    """The worker opens the door once, at boot. `start` must not close a door it cannot reopen."""

    def test_an_open_door_stays_open(self):
        from photoprep_common.service_status import set_status

        wc, ecs, _, store = control(desired=1)
        set_status(store, accepting=True, reason="open")
        wc.handle({"action": "start"})
        assert get_status(store) == {"accepting": True, "reason": "open"}
        assert ecs.updates == []  # nothing to scale

    def test_a_drain_is_cancelled_and_the_door_reopens_because_the_worker_never_left(self):
        wc, ecs, _, store = control(desired=1, in_flight=1)
        from photoprep_common.service_status import set_status

        set_status(store, accepting=True, reason="open")
        wc.handle({"action": "stop"})  # draining, door closed (maintenance)
        wc.handle({"action": "start"})
        assert store.get("SERVICE#status", "META")["draining"] is False
        assert get_status(store) == {"accepting": True, "reason": "open"}

    def test_a_worker_that_is_still_booting_keeps_its_warming_up_door(self):
        from photoprep_common.service_status import set_status

        wc, ecs, _, store = control(desired=1)
        set_status(
            store,
            accepting=False,
            reason="warming_up",
            expected_reopen_at="2026-10-17T10:00:00+00:00",
        )
        wc.handle({"action": "start"})
        status = get_status(store)
        assert status["accepting"] is False and status["reason"] == "warming_up"
        assert status["expectedReopenAt"] == "2026-10-17T10:00:00+00:00"  # the estimate is kept

    def test_starting_a_stopped_worker_still_closes_the_door_and_scales_up(self):
        wc, ecs, _, store = control(desired=0)
        wc.handle({"action": "start"})
        assert ecs.desired == 1 and get_status(store)["reason"] == "warming_up"
