"""Uploads, analysis requests and job reads."""

import logging
from datetime import timedelta

from ..container import Container
from ..errors import AppError
from ..logs import log_event
from ..repo import get_owned
from ..states import State, check_can_request_analysis
from ..store import ConditionFailed
from .session import SESSION_TTL, load_session, session_pk, ttl_after

MAX_IMAGE_BYTES = 2 * 1024 * 1024
UPLOAD_URL_SECONDS = 60
UPLOAD_RECORD_TTL = timedelta(hours=1)
PENDING = "PENDING_DISPATCH"

_log = logging.getLogger("photoprep.analysis")


def create_upload(c: Container, sub: str, session_id: str, request: dict) -> dict:
    load_session(c, sub, session_id)
    upload_id = c.new_id()
    # Key, size limit and expiry are decided here, never taken from the client. The
    # client's sizeBytes is only a hint already bounded by the contract.
    key = f"uploads/{session_id}/{upload_id}"
    signed = c.uploads.presign_post(
        key, request["contentType"], MAX_IMAGE_BYTES, UPLOAD_URL_SECONDS
    )
    c.store.create_if_absent(
        f"UPLOAD#{upload_id}",
        "META",
        {
            "ownerSub": sub,
            "sessionId": session_id,
            "phase": request["phase"],
            "key": key,
            "used": False,
            "createdAt": c.now().isoformat(),
            "ttl": ttl_after(c, UPLOAD_RECORD_TTL),
        },
    )
    return {
        "uploadId": upload_id,
        "url": signed["url"],
        "fields": signed["fields"],
        "expiresAt": (c.now() + timedelta(seconds=UPLOAD_URL_SECONDS)).isoformat(),
    }


def request_analysis(c: Container, sub: str, session_id: str, request: dict, idem_key: str) -> str:
    """Accept an analysis and return its job id (a replay returns the same id)."""
    session = load_session(c, sub, session_id)
    phase = request["phase"]
    idem_pk = f"IDEM#{sub}#{session_id}#{idem_key}"

    replay = c.store.get(idem_pk, "META")
    if replay is not None:
        return replay["jobId"]

    upload = get_owned(c.store, f"UPLOAD#{request['uploadId']}", sub)
    if upload["sessionId"] != session_id:
        raise AppError(404, "not_found")
    if upload["phase"] != phase:
        raise AppError(400, "invalid_request")
    if upload["used"]:
        raise AppError(409, "conflict")
    size = c.uploads.object_size(upload["key"])
    if size is None or size > MAX_IMAGE_BYTES:
        # No image (or too large): refuse and spend nothing (FR-011; refined in T085).
        raise AppError(400, "invalid_request")

    state = State(session["state"])
    check_can_request_analysis(state, phase, analyses_used=session["analysesUsed"])

    job_id = c.new_id()
    if not c.store.create_if_absent(
        idem_pk, "META", {"ownerSub": sub, "jobId": job_id, "ttl": ttl_after(c, SESSION_TTL)}
    ):
        return c.store.get(idem_pk, "META")["jobId"]  # lost a race with the same key

    reserved_upload = False
    try:
        c.store.update(
            f"UPLOAD#{request['uploadId']}", "META", expect={"used": False}, set={"used": True}
        )
        reserved_upload = True
        c.store.update(
            session_pk(session_id),
            "META",
            expect={"state": state.value},
            set={"state": State.ANALYZING.value},
            add={"analysesUsed": 1},
            caps={"analysesUsed": 3},
        )
    except ConditionFailed as err:
        if reserved_upload:
            c.store.update(f"UPLOAD#{request['uploadId']}", "META", set={"used": False})
        c.store.delete(idem_pk, "META")
        raise AppError(409, "conflict") from err

    now = c.now().isoformat()
    c.store.create_if_absent(
        f"JOB#{job_id}",
        "META",
        {
            "jobId": job_id,
            "ownerSub": sub,
            "sessionId": session_id,
            "uploadId": request["uploadId"],
            "phase": phase,
            # Where the session returns to if the analysis fails (the worker restores it).
            "prevState": state.value,
            "tools": list(request.get("tools", [])),
            "timeBudget": request.get("timeBudget", "normal"),
            "status": PENDING,
            # Sparse index keys: a job is findable by the re-dispatcher until it is queued.
            "statusKey": PENDING,
            "statusSince": now,
            "createdAt": now,
            "ttl": ttl_after(c, SESSION_TTL),
        },
    )
    dispatch(c, job_id)
    return job_id


def dispatch(c: Container, job_id: str) -> bool:
    """Send the job id to the queue, then mark the job QUEUED. False if the send failed.

    DynamoDB and SQS cannot be written atomically, so a failed send leaves the job
    PENDING_DISPATCH and the 1-minute re-dispatcher (ops/dispatch.py) retries it.
    """
    try:
        c.queue.send(job_id)
    except Exception:  # noqa: BLE001 - any send failure is retried by the re-dispatcher
        log_event("dispatch_failed", job_id=job_id)
        return False
    try:
        c.store.update(
            f"JOB#{job_id}",
            "META",
            expect={"status": PENDING},  # never overwrite a worker that already moved on
            set={"status": "QUEUED"},
            remove=["statusKey", "statusSince"],
        )
    except ConditionFailed:
        pass
    return True


def job_view(item: dict) -> dict:
    status = "QUEUED" if item["status"] == PENDING else item["status"]
    view = {"jobId": item["jobId"], "status": status}
    if status == "SUCCEEDED" and item.get("result"):
        view["advice"] = {
            k: v for k, v in item["result"].items() if k in ("kind", "text", "basis", "comparable")
        }
    if status in ("FAILED", "UNKNOWN") and item.get("errorClass"):
        view["errorClass"] = item["errorClass"]
    return view


def get_job(c: Container, sub: str, job_id: str) -> dict:
    return job_view(get_owned(c.store, f"JOB#{job_id}", sub))
