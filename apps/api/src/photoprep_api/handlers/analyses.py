from connexion import request as http_request

from ..container import get_container
from ..services import analysis


def request_analysis(sessionId, body, user, **_):
    # The header is required and length-checked by the contract; Connexion does not
    # inject hyphenated header names as arguments, so read it from the request.
    idem_key = http_request.headers["Idempotency-Key"]
    job_id = analysis.request_analysis(get_container(), user, sessionId, body, idem_key)
    return {"jobId": job_id, "status": "QUEUED"}, 202
