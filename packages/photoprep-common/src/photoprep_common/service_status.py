"""Whether the service is accepting analysis work (FR-027), shared by the API (reads it),
the operations Lambda (starts and stops the worker) and the worker (says when it is ready).

Fails closed: with no record the service counts as stopped.
"""

from .store import Store

PK = "SERVICE#status"
SK = "META"

# The reasons that are part of the public API contract (ServiceStatus.reason).
REASONS = frozenset({"open", "worker_stopped", "warming_up", "quota_exhausted", "maintenance"})


def get_status(store: Store) -> dict:
    """The public view: ``accepting``, ``reason`` and, if known, ``expectedReopenAt``."""
    item = store.get(PK, SK)
    if item is None:
        return {"accepting": False, "reason": "worker_stopped"}
    status = {"accepting": bool(item["accepting"]), "reason": item["reason"]}
    if item.get("expectedReopenAt"):
        status["expectedReopenAt"] = item["expectedReopenAt"]
    return status


def set_status(
    store: Store,
    *,
    accepting: bool,
    reason: str,
    expected_reopen_at: str | None = None,
    draining: bool = False,
) -> None:
    """Record the status. ``draining`` is internal (a stop waiting for jobs to finish) and is
    reported to users as ``maintenance``."""
    if reason not in REASONS:
        raise ValueError(f"reason is not part of the contract: {reason}")
    store.create_if_absent(PK, SK, {"accepting": accepting, "reason": reason, "draining": draining})
    fields: dict = {"accepting": accepting, "reason": reason, "draining": draining}
    remove = []
    if expected_reopen_at:
        fields["expectedReopenAt"] = expected_reopen_at
    else:
        remove.append("expectedReopenAt")
    store.update(PK, SK, set=fields, remove=remove)
