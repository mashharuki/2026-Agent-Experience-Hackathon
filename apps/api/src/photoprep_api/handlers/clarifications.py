from connexion import request as http_request

from ..container import get_container
from ..services.clarification import answer


def answer_clarification(sessionId, body, user, **_):
    return answer(get_container(), user, sessionId, body, http_request.headers["Idempotency-Key"])
