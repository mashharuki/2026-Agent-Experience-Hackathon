"""Content fingerprints are never logged; replay is checked against durable records."""

import hashlib
import json

from ..errors import AppError


def fingerprint(request: dict) -> str:
    return hashlib.sha256(
        json.dumps(request, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def check_replay(record: dict, request: dict) -> None:
    if record.get("fingerprint") not in (None, fingerprint(request)):
        raise AppError(409, "conflict")
