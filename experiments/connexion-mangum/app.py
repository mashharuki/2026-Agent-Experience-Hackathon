"""T009 spike: Connexion 3 (FlaskApp) wrapped by Mangum, spec = contracts draft.

Throwaway experiment, not product code. Handlers are stubs.
Claims come ONLY from the API Gateway v2 event (JWT authorizer result);
no header is trusted as identity.
"""

import base64
import json
import logging
import os
import pathlib
import time

import connexion
from connexion.exceptions import ProblemException
from connexion.lifecycle import ConnexionResponse
from connexion.resolver import Resolver
from starlette.exceptions import HTTPException
from mangum import Mangum

SPEC_DIR = (
    pathlib.Path(__file__).resolve().parents[2]
    / "specs/001-pre-photo-grooming-assist/contracts"
)


def bearer_info(token, request):
    """Connexion security function (bearer). API Gateway already verified the JWT;
    here we only require the authorizer claims in the event (fail closed) and
    return them as token_info. The bearer string itself is never trusted/parsed."""
    event = request.scope.get("aws.event") or {}
    claims = (
        event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims")
    )
    if not claims or not claims.get("sub"):
        return None  # Connexion answers 401
    return {"sub": claims["sub"], "claims": claims}


def create_session(body, user=None, token_info=None, **kwargs):
    # `user` is token_info["sub"], injected by Connexion from the security function.
    return {
        "sessionId": "s-" + user,
        "state": "CONSULTING",
        "changesUsed": 0,
        "analysesUsed": 0,
        "expiresAt": "2026-10-18T00:00:00Z",
    }, 201


def get_job(jobId, **kwargs):
    if jobId == "badresponse0":  # deliberately violates the Job schema
        return {"jobId": jobId, "status": "NOT_A_STATUS", "extra": 1}, 200
    return {"jobId": jobId, "status": "QUEUED"}, 200


HANDLERS = {
    "createSession": create_session,
    "getJob": get_job,
}


def _resolve(operation_id):
    # Operations not stubbed return 501 so that the spec still loads fully.
    return HANDLERS.get(operation_id, lambda **kw: ({"code": "todo", "message": "stub"}, 501))


# Spec stays free of app-specific extensions; the security function is named by env var.
os.environ.setdefault("BEARERINFO_FUNC", "app.bearer_info")


# --- Error format: our contract's Error schema, never echoing request values --------
_CODES = {400: "invalid_request", 401: "unauthenticated", 403: "forbidden",
          404: "not_found", 405: "method_not_allowed", 409: "conflict",
          415: "unsupported_media_type", 429: "too_many_requests",
          503: "service_unavailable"}
_LOG = logging.getLogger("photoprep.errors")


def safe_error(request, exc):
    status = getattr(exc, "status", None) or getattr(exc, "status_code", None) or 500
    status = status if isinstance(status, int) and 400 <= status <= 599 else 500
    # Log only the class and status: exception text can contain user input (wish text).
    _LOG.warning("request failed status=%s exc=%s", status, type(exc).__name__)
    body = {"code": _CODES.get(status, "internal_error"),
            "message": "リクエストを処理できませんでした"}
    return ConnexionResponse(status_code=status, mimetype="application/json",
                             content_type="application/json",
                             body=json.dumps(body, ensure_ascii=False))


class _RedactFilter(logging.Filter):
    """Belt and braces: Connexion's own handlers log repr(exc), which echoes input."""

    def filter(self, record):
        record.msg, record.args = "request failed (details redacted)", ()
        return True


logging.getLogger("connexion.middleware.exceptions").addFilter(_RedactFilter())
# connexion.validators.json logs "Validation error: <offending value>" at INFO and may
# log bodies at DEBUG; keep the whole namespace at WARNING and above.
logging.getLogger("connexion").setLevel(logging.WARNING)


def build():
    t = time.perf_counter()
    app = connexion.FlaskApp(__name__, specification_dir=str(SPEC_DIR))
    app.add_api(
        "openapi.draft.yaml",
        resolver=Resolver(function_resolver=_resolve),
        validate_responses=True,
        strict_validation=True,
    )
    for exc in (ProblemException, HTTPException, Exception):
        app.add_error_handler(exc, safe_error)
    return app, time.perf_counter() - t


app, BUILD_SECONDS = build()
# Mangum receives the whole Connexion app (not the inner Flask app).
_mangum = Mangum(app, lifespan="off")


def handler(event, context):
    """Lambda entry point. Adds content-length when the event lacks it (Connexion
    answers 400 'RequestBody is required' without it) and returns the event unchanged
    otherwise."""
    body = event.get("body")
    headers = event.setdefault("headers", {})
    if body is not None and "content-length" not in {k.lower() for k in headers}:
        raw = base64.b64decode(body) if event.get("isBase64Encoded") else body.encode()
        headers["content-length"] = str(len(raw))
    return _mangum(event, context)
