from ..container import get_container
from ..services.access import public_status


def get_service_status(user, **_):
    return public_status(get_container()), 200
