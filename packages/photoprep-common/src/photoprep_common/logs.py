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
        "failed_count",
        "attempted_count",
        "deleted_count",
        "retried_count",
        "job_id",
        "session_id",
        "phase",
        "outcome",
        "worker_id",
    }
)

_logger = logging.getLogger("photoprep")

# Libraries whose DEBUG output contains request and response bodies (botocore logs every
# DynamoDB item and S3 call in full, including the user's words). Whatever the root log level
# is set to, these stay quiet.
NOISY_LIBRARIES = ("boto3", "botocore", "s3transfer", "urllib3")


def quiet_libraries() -> None:
    for name in NOISY_LIBRARIES:
        logging.getLogger(name).setLevel(logging.WARNING)


def log_event(event: str, **fields: object) -> None:
    """Log one line. Unknown field names are rejected rather than silently written."""
    unknown = set(fields) - ALLOWED_FIELDS
    if unknown:
        raise ValueError(f"field not allowed in logs: {sorted(unknown)}")
    _logger.info(
        json.dumps({"event": event, **fields}, ensure_ascii=False, default=str)
    )
