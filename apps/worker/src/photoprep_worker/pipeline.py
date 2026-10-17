"""One analysis job: lease -> read image -> observe -> decide -> guard -> explain -> store.

Order of effects matters:
* the image is deleted in every outcome that touched it (success, failure, cancel);
* the session is moved on only if it is still ANALYZING, so a user who ended the session
  meanwhile never gets a late result applied (the job becomes CANCELLED);
* a failed step is recorded as FAILED and the session returns to where it was; nothing is
  ever replaced by invented advice;
* a job whose lease expired mid-run is marked UNKNOWN and never re-run automatically,
  because a model call may already have happened.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum

from photoprep_common.logs import log_event
from photoprep_common.states import State, state_after_job
from photoprep_common.store import ConditionFailed, Store

from .bedrock import Bedrock, BudgetedBedrock
from .decider import NEXT_SUPPORT, Decider, build_state_text
from .decision_pattern import run_decision
from .explain import build_advice
from .guards import GuardContext, guards_for
from .images import ImageError, prepare_image
from .observe import observe
from .schemas import DecisionRecord, Observation

TERMINAL = {"SUCCEEDED", "FAILED", "UNKNOWN", "CANCELLED"}
RECORD_TTL = timedelta(hours=24)


class Outcome(StrEnum):
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"  # already finished, or no such job: acknowledge and move on
    BUSY = "busy"  # another worker holds it: leave the message on the queue
    CANCELLED = "cancelled"


class Images:
    def get(self, key: str) -> bytes | None: ...

    def delete(self, key: str) -> None: ...


@dataclass
class Deps:
    store: Store
    images: Images
    bedrock: Callable[[], Bedrock]
    decider: Decider
    now: Callable[[], datetime]
    worker_id: str
    lease_seconds: int = 120
    min_confidence: float = 0.0


def is_comparable(baseline: dict | None, observation: Observation) -> bool:
    """Both photos well lit and framed; anything else means 'retake', never 'judge'."""
    return bool(
        baseline
        and baseline.get("lighting") == observation.lighting == "good"
        and baseline.get("framing") == observation.framing == "ok"
    )


def heartbeat(deps: Deps, job_id: str) -> bool:
    """Extend the lease while the job is running. False if it is no longer ours."""
    until = (deps.now() + timedelta(seconds=deps.lease_seconds)).isoformat()
    try:
        deps.store.update(
            f"JOB#{job_id}",
            "META",
            expect={"status": "RUNNING", "leaseOwner": deps.worker_id},
            set={"leaseUntil": until},
        )
    except ConditionFailed:
        return False
    return True


def _restore_session(deps: Deps, session_id: str, prev_state: str) -> None:
    try:
        deps.store.update(
            f"SESSION#{session_id}",
            "META",
            expect={"state": State.ANALYZING.value},
            set={"state": prev_state},
        )
    except ConditionFailed:
        pass  # the user moved on (e.g. ended the session): leave it alone


def _finish_job(deps: Deps, job_id: str, **fields: object) -> None:
    deps.store.update(
        f"JOB#{job_id}",
        "META",
        expect={"status": "RUNNING"},
        set=fields,
        remove=["leaseOwner", "leaseUntil"],
    )


def _delete_image(deps: Deps, key: str | None) -> None:
    if key:
        try:
            deps.images.delete(key)
        except Exception:  # noqa: BLE001 - the sweeper removes leftovers (T080)
            log_event("image_delete_failed", error_class="delete_failed")


def process_job(deps: Deps, job_id: str) -> Outcome:
    job = deps.store.get(f"JOB#{job_id}", "META")
    if job is None or job["status"] in TERMINAL:
        return Outcome.SKIPPED

    upload = deps.store.get(f"UPLOAD#{job['uploadId']}", "META")
    key = upload["key"] if upload else None
    session_id, prev_state = job["sessionId"], job["prevState"]
    now = deps.now()

    if job["status"] == "RUNNING":
        if job.get("leaseUntil", "") > now.isoformat():
            return Outcome.BUSY
        # The lease expired: the previous worker died, possibly after a model call.
        # Do not run it again; report it so the user can decide to retry.
        try:
            _finish_job(deps, job_id, status="UNKNOWN", errorClass="worker_unavailable")
        except ConditionFailed:
            return Outcome.SKIPPED
        _restore_session(deps, session_id, prev_state)
        _delete_image(deps, key)
        log_event("job_unknown", job_id=job_id, outcome="unknown")
        return Outcome.FAILED

    try:
        deps.store.update(
            f"JOB#{job_id}",
            "META",
            expect={"status": ["QUEUED", "PENDING_DISPATCH"]},
            set={
                "status": "RUNNING",
                "leaseOwner": deps.worker_id,
                "leaseUntil": (now + timedelta(seconds=deps.lease_seconds)).isoformat(),
            },
            remove=["statusKey", "statusSince"],
        )
    except ConditionFailed:
        return Outcome.BUSY

    session = deps.store.get(f"SESSION#{session_id}", "META")
    if (
        session is None
        or session["state"] == State.DONE.value
        or now.isoformat() >= session["expiresAt"]
    ):
        _finish_job(deps, job_id, status="CANCELLED", errorClass="cancelled")
        _delete_image(deps, key)
        log_event("job_cancelled", job_id=job_id, outcome="cancelled")
        return Outcome.CANCELLED

    def fail(error_class: str) -> Outcome:
        _finish_job(deps, job_id, status="FAILED", errorClass=error_class)
        _restore_session(deps, session_id, prev_state)
        log_event("job_failed", job_id=job_id, error_class=error_class, outcome="failed")
        return Outcome.FAILED

    try:
        raw = deps.images.get(key) if key else None
        if raw is None:
            return fail("no_image")
        try:
            image = prepare_image(raw)
        except ImageError:
            return fail("unreadable_image")

        bedrock = BudgetedBedrock(deps.bedrock())
        phase = job["phase"]
        scope = session["scope"]
        restrictions = list(session.get("restrictions", []))
        wish = session.get("wish")

        try:
            observation = observe(bedrock, image, scope)
            comparable = (
                is_comparable(session.get("baseline"), observation) if phase == "after" else None
            )
            state_text = build_state_text(
                scope=scope,
                wish=wish,
                restrictions=restrictions,
                observation=observation,
                tools=list(job.get("tools", [])),
                changes_used=session["changesUsed"],
                phase=phase,
                last_advice=session.get("lastAdviceKind"),
            )

            def tool(kind: str):
                # One handler per option of the question. Only the selected one runs.
                return lambda: build_advice(
                    kind,
                    observation,
                    bedrock,
                    scope=scope,
                    wish=wish,
                    restrictions=restrictions,
                    phase=phase,
                    comparable=comparable,
                    language=session.get("language"),
                )

            decision = run_decision(
                decider=deps.decider,
                question=NEXT_SUPPORT,
                state=state_text,
                guards=guards_for(deps.min_confidence),
                context=GuardContext(
                    scope=scope,
                    restrictions=restrictions,
                    changes_used=session["changesUsed"],
                    lighting=observation.lighting,
                    framing=observation.framing,
                ),
                handlers={kind: tool(kind) for kind in NEXT_SUPPORT.options},
            )
            advice, advice_invoked = decision.result
        except Exception as err:  # noqa: BLE001 - any model-side failure is a failed job
            log_event("model_step_failed", job_id=job_id, error_class=type(err).__name__)
            return fail("model_error")

        new_state = state_after_job(advice.kind, phase, comparable)
        session_update: dict = {"state": new_state.value, "lastAdviceKind": advice.kind}
        if phase == "before":
            session_update["baseline"] = {
                "lighting": observation.lighting,
                "framing": observation.framing,
            }
        try:
            deps.store.update(
                f"SESSION#{session_id}",
                "META",
                expect={"state": State.ANALYZING.value},
                set=session_update,
            )
        except ConditionFailed:
            # The session ended (or moved on) while the models ran: discard the result.
            _finish_job(deps, job_id, status="CANCELLED", errorClass="cancelled")
            log_event("job_cancelled", job_id=job_id, outcome="cancelled")
            return Outcome.CANCELLED

        record = DecisionRecord(
            job_id=job_id,
            session_id=session_id,
            question_version=decision.question_version,
            probabilities=decision.probabilities,
            confidence=decision.confidence,
            decider_choice=decision.decider_choice,
            selected=decision.selected,
            guard_override=decision.override_reason,
            invoked=["bedrock.observe", *[i for i in advice_invoked if i != "none"]],
            created_at=now.isoformat(),
        )
        deps.store.create_if_absent(
            f"SESSION#{session_id}",
            f"DECISION#{job_id}",
            {
                **record.model_dump(),
                "ownerSub": job["ownerSub"],
                "ttl": int((now + RECORD_TTL).timestamp()),
            },
        )
        _finish_job(deps, job_id, status="SUCCEEDED", result=advice.to_result())
        log_event(
            "job_done",
            job_id=job_id,
            selected=advice.kind,
            confidence=decision.confidence,
            outcome="done",
        )
        return Outcome.DONE
    finally:
        _delete_image(deps, key)
