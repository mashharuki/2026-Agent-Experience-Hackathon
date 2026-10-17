from ..container import get_container
from ..services import analysis


def get_job(jobId, user, **_):
    return analysis.get_job(get_container(), user, jobId), 200
