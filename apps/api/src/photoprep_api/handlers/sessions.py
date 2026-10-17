from ..container import get_container
from ..services import session


def create_session(body, user, **_):
    return session.create_session(get_container(), user, body), 201
