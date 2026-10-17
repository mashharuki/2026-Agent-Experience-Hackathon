"""PR review: a failure after the session moved on must not leave state and job disagreeing."""

from photoprep_worker.pipeline import Outcome, process_job
from tests.conftest import JOB, KEY, SESSION


def break_store(world, *, when):
    """Make one kind of write fail once (a throttled or unreachable table)."""
    real_create, real_update = world.store.create_if_absent, world.store.update
    state = {"armed": True}

    def create_if_absent(pk, sk, item):
        if state["armed"] and when("create", pk, sk, item):
            state["armed"] = False
            raise RuntimeError("table unavailable")
        return real_create(pk, sk, item)

    def update(pk, sk, **kw):
        if state["armed"] and when("update", pk, sk, kw):
            state["armed"] = False
            raise RuntimeError("table unavailable")
        return real_update(pk, sk, **kw)

    world.store.create_if_absent, world.store.update = create_if_absent, update


def test_a_failed_decision_record_write_puts_the_session_back_and_fails_the_job(world):
    world.seed()
    break_store(world, when=lambda op, pk, sk, _: op == "create" and sk.startswith("DECISION#"))
    assert process_job(world.deps, JOB) is Outcome.FAILED
    assert world.job()["status"] == "FAILED"
    assert world.job()["errorClass"] == "storage_error"
    assert world.session()["state"] == "CONSULTING"  # not ADVICE_SHOWN with no advice behind it
    assert KEY in world.images.deleted


def test_a_failed_final_job_write_does_the_same(world):
    world.seed()
    break_store(
        world,
        when=lambda op, pk, sk, kw: (
            op == "update"
            and pk.startswith("JOB#")
            and (kw.get("set") or {}).get("status") == "SUCCEEDED"
        ),
    )
    assert process_job(world.deps, JOB) is Outcome.FAILED
    assert world.job()["status"] == "FAILED"
    assert world.session()["state"] == "CONSULTING"


def test_the_session_remembers_which_job_moved_it(world):
    world.seed()
    process_job(world.deps, JOB)
    assert world.session()["lastJobId"] == JOB


def test_an_abandoned_job_whose_session_already_moved_on_is_recovered_when_its_lease_expires(world):
    """The worker died after moving the session but before finishing the job."""
    world.seed(job_status="RUNNING")
    world.store.update(
        f"JOB#{JOB}",
        "META",
        set={"leaseOwner": "dead-worker", "leaseUntil": "2026-01-01T00:00:00+00:00"},
    )
    world.store.update(
        f"SESSION#{SESSION}", "META", set={"state": "ADVICE_SHOWN", "lastJobId": JOB}
    )
    assert process_job(world.deps, JOB) is Outcome.FAILED
    assert world.job()["status"] == "UNKNOWN"
    assert world.session()["state"] == "CONSULTING"


def test_a_session_that_moved_on_for_another_reason_is_left_alone(world):
    world.seed(job_status="RUNNING")
    world.store.update(
        f"JOB#{JOB}",
        "META",
        set={"leaseOwner": "dead-worker", "leaseUntil": "2026-01-01T00:00:00+00:00"},
    )
    world.store.update(
        f"SESSION#{SESSION}", "META", set={"state": "TRYING", "lastJobId": "someone-elses-job"}
    )
    process_job(world.deps, JOB)
    assert world.session()["state"] == "TRYING"
