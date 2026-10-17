from ..container import get_container
from ..services import analysis


def create_upload(sessionId, body, user, **_):
    return analysis.create_upload(get_container(), user, sessionId, body), 201
