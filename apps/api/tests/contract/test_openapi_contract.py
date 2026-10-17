"""T028: implemented operations only return documented statuses and valid bodies.

Response bodies are validated by Connexion (validate_responses=True): a body that
does not match the schema turns into a 500, so 'never 500' proves conformance.
"""

import pathlib

import yaml

from photoprep_api.handlers import HANDLERS
from tests.conftest import GOOD_SESSION, OTHER_CLAIMS
from tests.integration.test_api_flow import (
    IDEM_A,
    finish_job,
    new_session,
    new_upload,
    start_analysis,
)

SPEC = yaml.safe_load(
    (pathlib.Path(__file__).resolve().parents[4] / "packages/api-spec/openapi.yaml").read_text(
        encoding="utf-8"
    )
)


def documented(method, path):
    return {int(code) for code in SPEC["paths"][path][method]["responses"]}


def test_every_operation_in_the_contract_has_a_handler_or_is_listed_as_pending():
    pending = {"endSession", "getServiceStatus"}  # US5 (T076, T079)
    ids = {
        op["operationId"]
        for item in SPEC["paths"].values()
        for op in item.values()
        if "operationId" in op
    }
    assert ids - pending <= set(HANDLERS), sorted(ids - pending - set(HANDLERS))


def test_statuses_stay_within_the_contract(api):
    seen = []

    def check(method, path, status):
        seen.append((method, path, status))
        assert status in documented(method, path), (method, path, status)
        assert status != 500

    sid = new_session(api)
    check("post", "/sessions", 201)
    status, body, _ = api.request("POST", "/sessions", {**GOOD_SESSION, "scope": "x"}, idem=IDEM_A)
    check("post", "/sessions", status)
    upload = new_upload(api, sid)
    check("post", "/sessions/{sessionId}/uploads", 201)
    status, body, _ = start_analysis(api, sid, upload)
    check("post", "/sessions/{sessionId}/analyses", status)
    job_id = body["jobId"]
    check("get", "/jobs/{jobId}", api.request("GET", f"/jobs/{job_id}")[0])
    finish_job(api, job_id)
    check("get", "/jobs/{jobId}", api.request("GET", f"/jobs/{job_id}")[0])
    check("get", "/jobs/{jobId}", api.request("GET", "/jobs/doesnotexist1")[0])
    check("get", "/jobs/{jobId}", api.request("GET", f"/jobs/{job_id}", claims=OTHER_CLAIMS)[0])
    check(
        "post",
        "/sessions/{sessionId}/feedback",
        api.request(
            "POST",
            f"/sessions/{sid}/feedback",
            {"type": "advice_response", "adviceResponse": "try"},
        )[0],
    )
    check(
        "post",
        "/sessions/{sessionId}/feedback",
        api.request("POST", f"/sessions/{sid}/feedback", {"type": "comparison"})[0],
    )
    check(
        "post",
        "/sessions/{sessionId}/analyses",
        start_analysis(api, "doesnotexist1", upload, idem="z" * 16)[0],
    )
    assert len(seen) >= 10


def test_errors_use_the_documented_error_shape(api):
    status, body, _ = api.request("GET", "/jobs/doesnotexist1")
    assert status == 404 and set(body) == {"code", "message"} and body["code"] == "not_found"
