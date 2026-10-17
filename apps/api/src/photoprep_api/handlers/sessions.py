from connexion import request as http_request

from ..container import get_container
from ..services import session


def create_session(body, user, **_):
    # Required and length-checked by the contract; Connexion does not inject hyphenated
    # header names as arguments, so read it from the request.
    idem_key = http_request.headers["Idempotency-Key"]
    return session.create_session(get_container(), user, body, idem_key), 201


def end_session(sessionId, user, **_):
    session.end_session(get_container(), user, sessionId)
    return None, 202
