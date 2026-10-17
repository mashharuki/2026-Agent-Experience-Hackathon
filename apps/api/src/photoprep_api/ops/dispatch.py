"""Re-dispatcher (runs every minute): resend jobs that were saved but never queued.

DynamoDB and SQS cannot be written atomically, so a job can be left PENDING_DISPATCH
after a failed send (or a crash between the two writes). Re-sending is safe: the worker
takes a conditional lease per job and ignores duplicates.
"""

from datetime import timedelta

from ..container import get_container
from ..logs import log_event
from ..services.analysis import PENDING, dispatch

GRACE = timedelta(seconds=60)  # let the original request finish its own send first


def handler(event=None, context=None) -> dict:  # noqa: ARG001
    c = get_container()
    cutoff = (c.now() - GRACE).isoformat()
    sent = failed = 0
    for job in c.store.query_by_status(PENDING, older_than=cutoff):
        if dispatch(c, job["jobId"]):
            sent += 1
        else:
            failed += 1
    log_event("redispatch", status=200 if not failed else 207, token_count=sent)
    return {"dispatched": sent, "failed": failed}
