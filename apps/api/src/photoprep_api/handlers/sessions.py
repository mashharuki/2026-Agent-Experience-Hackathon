from ..container import get_container
from ..services import session


def create_session(body, user, **_):
    return session.create_session(get_container(), user, body), 201


def end_session(sessionId, user, **_):
    session.end_session(get_container(), user, sessionId)
    return None, 202
