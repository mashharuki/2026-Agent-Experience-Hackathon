"""Logging that cannot carry user content.

Two layers:
* ``log_event`` (shared, in photoprep_common) accepts only allow-listed field names.
* ``install_log_redaction`` silences library loggers known to echo request values
  (Connexion logs ``Validation error: <offending value>`` at INFO).
"""

import logging

from photoprep_common.logs import ALLOWED_FIELDS, log_event  # noqa: F401 - re-exported


class _RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg, record.args = "request failed (details redacted)", ()
        return True


def install_log_redaction() -> None:
    logging.getLogger("connexion.middleware.exceptions").addFilter(_RedactFilter())
    # Connexion logs offending values at INFO and may log bodies at DEBUG.
    logging.getLogger("connexion").setLevel(logging.WARNING)
