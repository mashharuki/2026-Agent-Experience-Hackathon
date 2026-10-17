"""T038/T039: the Lambda entry point and the re-dispatcher."""

import base64
import json

from photoprep_api import lambda_handler
from photoprep_api.ops import dispatch
from tests.conftest import GOOD_SESSION, IDEMPOTENCY, LambdaContext, make_event
from tests.integration.test_api_flow import new_session, new_upload, start_analysis


def test_entry_point_serves_requests_and_repairs_a_missing_content_length(api):
    event = make_event("POST", "/sessions", GOOD_SESSION, IDEMPOTENCY)
    del event["headers"]["content-length"]
    response = lambda_handler.handler(event, LambdaContext())
    assert response["statusCode"] == 201
    assert json.loads(response["body"])["state"] == "CONSULTING"


def test_entry_point_repairs_base64_bodies_too(api):
    event = make_event("POST", "/sessions", GOOD_SESSION, IDEMPOTENCY)
    del event["headers"]["content-length"]
    event["body"] = base64.b64encode(event["body"].encode()).decode()
    event["isBase64Encoded"] = True
    assert lambda_handler.handler(event, LambdaContext())["statusCode"] == 201


def test_entry_point_without_claims_fails_closed(api):
    event = make_event("POST", "/sessions", GOOD_SESSION, IDEMPOTENCY, claims=None)
    assert lambda_handler.handler(event, LambdaContext())["statusCode"] == 401


def test_redispatcher_resends_jobs_that_never_reached_the_queue(api):
    sid = new_session(api)
    api.queue.fail = True
    job_id = start_analysis(api, sid, new_upload(api, sid))[1]["jobId"]
    api.queue.fail = False
    assert api.queue.sent == []

    api.clock.advance(seconds=30)  # inside the grace period: the request may still be sending
    assert dispatch.handler() == {"dispatched": 0, "failed": 0}

    api.clock.advance(seconds=60)
    assert dispatch.handler() == {"dispatched": 1, "failed": 0}
    assert api.queue.sent == [job_id]
    job = api.store.get(f"JOB#{job_id}", "META")
    assert job["status"] == "QUEUED" and "statusKey" not in job
    assert dispatch.handler() == {"dispatched": 0, "failed": 0}  # nothing left to resend


def test_redispatcher_keeps_the_job_pending_while_the_queue_is_down(api):
    sid = new_session(api)
    api.queue.fail = True
    job_id = start_analysis(api, sid, new_upload(api, sid))[1]["jobId"]
    api.clock.advance(minutes=5)
    assert dispatch.handler() == {"dispatched": 0, "failed": 1}
    assert api.store.get(f"JOB#{job_id}", "META")["status"] == "PENDING_DISPATCH"


def test_redispatcher_does_not_overwrite_a_job_a_worker_already_took(api):
    sid = new_session(api)
    api.queue.fail = True
    job_id = start_analysis(api, sid, new_upload(api, sid))[1]["jobId"]
    api.queue.fail = False
    api.store.update(
        f"JOB#{job_id}", "META", set={"status": "RUNNING"}, remove=["statusKey", "statusSince"]
    )
    api.clock.advance(minutes=5)
    assert dispatch.handler() == {"dispatched": 0, "failed": 0}  # no longer in the sparse index
    assert api.store.get(f"JOB#{job_id}", "META")["status"] == "RUNNING"
