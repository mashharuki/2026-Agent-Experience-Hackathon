"""Structured logging that cannot carry user content: only allow-listed field names."""

import json
import logging

# Safe fields only: ids we generate, timings, counts, enums. Never wishes, observations,
# model text, claims, tokens or anything derived from a photo.
ALLOWED_FIELDS = frozenset(
    {
        "request_id",
        "route",
        "status",
        "duration_ms",
        "error_class",
        "selected",
        "confidence",
        "token_count",
        "job_id",
        "session_id",
        "phase",
        "outcome",
        "worker_id",
    }
)

_logger = logging.getLogger("photoprep")


def log_event(event: str, **fields: object) -> None:
    """Log one line. Unknown field names are rejected rather than silently written."""
    unknown = set(fields) - ALLOWED_FIELDS
    if unknown:
        raise ValueError(f"field not allowed in logs: {sorted(unknown)}")
    _logger.info(json.dumps({"event": event, **fields}, ensure_ascii=False, default=str))
