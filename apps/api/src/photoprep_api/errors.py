"""Error responses that follow the contract's ``Error`` schema.

Connexion's default error handling echoes offending request values in ``detail``
and in its own logs. These handlers never read the exception text: they return a
fixed message and log only the status and exception class (FR-023).
"""

import json
import logging

from connexion.exceptions import ProblemException
from connexion.lifecycle import ConnexionResponse
from starlette.exceptions import HTTPException

log = logging.getLogger("photoprep.errors")

ERROR_CODES = frozenset(
    {
        "invalid_request",
        "unauthenticated",
        "forbidden",
        "not_found",
        "method_not_allowed",
        "conflict",
        "unsupported_media_type",
        "too_many_requests",
        "service_unavailable",
        "internal_error",
        "consent_required",
        "session_ended",
        "change_limit_reached",
        "analysis_limit_reached",
        "quota_exceeded",
        "not_accepting",
    }
)

_DEFAULT_CODE_BY_STATUS = {
    400: "invalid_request",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    415: "unsupported_media_type",
    429: "too_many_requests",
    503: "service_unavailable",
}

MESSAGE = "リクエストを処理できませんでした"


class AppError(Exception):
    """A deliberate application error. ``code`` must be in ``ERROR_CODES``."""

    def __init__(self, status: int, code: str) -> None:
        if code not in ERROR_CODES:
            raise ValueError(f"unknown error code: {code}")
        super().__init__(code)
        self.status = status
        self.code = code


def not_found() -> AppError:
    """Used for both missing and not-owned resources so existence is not revealed."""
    return AppError(404, "not_found")


def error_body(status: int, code: str | None = None, request_id: str | None = None) -> dict:
    body = {
        "code": code or _DEFAULT_CODE_BY_STATUS.get(status, "internal_error"),
        "message": MESSAGE,
    }
    if request_id:
        body["requestId"] = request_id
    return body


def _status_of(exc: Exception) -> int:
    status = getattr(exc, "status", None) or getattr(exc, "status_code", None)
    if isinstance(status, int) and 400 <= status <= 599:
        return status
    return 500


def safe_error(request, exc: Exception) -> ConnexionResponse:  # noqa: ARG001
    """Connexion error handler. Never includes exception text in the body or the log."""
    status = _status_of(exc)
    code = exc.code if isinstance(exc, AppError) else None
    log.warning("request failed status=%s exc=%s", status, type(exc).__name__)
    return ConnexionResponse(
        status_code=status,
        mimetype="application/json",
        content_type="application/json",
        body=json.dumps(error_body(status, code), ensure_ascii=False),
    )


def register_error_handlers(app) -> None:
    for exc_type in (AppError, ProblemException, HTTPException, Exception):
        app.add_error_handler(exc_type, safe_error)
