from ..container import get_container
from ..services import session


def record_feedback(sessionId, body, user, **_):
    session.record_feedback(get_container(), user, sessionId, body)
    return None, 204
