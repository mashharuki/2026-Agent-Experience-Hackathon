"""Lambda entry point: the whole Connexion app wrapped in Mangum (HTTP API v2 events).

The Connexion app, not its inner Flask app, is what Mangum receives, so request and
response validation can never be bypassed. Identity comes only from the JWT authorizer
claims in the event (see auth.bearer_info).
"""

import base64

from mangum import Mangum

from .app import create_app
from .handlers import HANDLERS

_mangum = Mangum(create_app(HANDLERS), lifespan="off")


def handler(event, context):
    """Add ``content-length`` when the event lacks it.

    Connexion rejects a request body with 400 "RequestBody is required" when the header is
    missing (found in the T009 spike); API Gateway normally forwards it.
    """
    body = event.get("body")
    headers = event.setdefault("headers", {})
    if body is not None and "content-length" not in {k.lower() for k in headers}:
        raw = base64.b64decode(body) if event.get("isBase64Encoded") else body.encode()
        headers["content-length"] = str(len(raw))
    return _mangum(event, context)
