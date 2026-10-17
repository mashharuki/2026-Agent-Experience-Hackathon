"""Logging that cannot carry user content.

Two layers:
* ``log_event`` accepts only allow-listed, non-sensitive field names.
* ``install_log_redaction`` silences library loggers known to echo request values
  (Connexion logs ``Validation error: <offending value>`` at INFO).
"""

import json
import logging

# Fields that are safe to log: identifiers we generate, timings, counts, enums.
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
    }
)

_logger = logging.getLogger("photoprep")


class _RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg, record.args = "request failed (details redacted)", ()
        return True


def install_log_redaction() -> None:
    logging.getLogger("connexion.middleware.exceptions").addFilter(_RedactFilter())
    # Connexion logs offending values at INFO and may log bodies at DEBUG.
    logging.getLogger("connexion").setLevel(logging.WARNING)


def log_event(event: str, **fields: object) -> None:
    """Structured log line. Unknown field names are rejected, never silently logged."""
    unknown = set(fields) - ALLOWED_FIELDS
    if unknown:
        raise ValueError(f"field not allowed in logs: {sorted(unknown)}")
    _logger.info(json.dumps({"event": event, **fields}, ensure_ascii=False, default=str))
