"""S3 and SQS adapters against moto (no real AWS)."""

import json

import boto3
import pytest
from moto import mock_aws

from photoprep_api.aws import S3Uploads, SqsQueue


@pytest.fixture
def s3():
    with mock_aws():
        client = boto3.client("s3", region_name="ap-northeast-1")
        client.create_bucket(
            Bucket="images",
            CreateBucketConfiguration={"LocationConstraint": "ap-northeast-1"},
        )
        yield client


def test_presigned_post_carries_server_side_constraints(s3):
    uploads = S3Uploads("images", client=s3)
    signed = uploads.presign_post("uploads/s1/u1", "image/jpeg", 2 * 1024 * 1024, 60)
    assert signed["fields"]["key"] == "uploads/s1/u1"
    assert signed["fields"]["Content-Type"] == "image/jpeg"
    import base64

    policy = json.loads(base64.b64decode(signed["fields"]["policy"]))
    assert ["content-length-range", 1, 2 * 1024 * 1024] in policy["conditions"]
    assert {"Content-Type": "image/jpeg"} in policy["conditions"]
    assert {"key": "uploads/s1/u1"} in policy["conditions"]


def test_object_size_for_present_and_missing_objects(s3):
    uploads = S3Uploads("images", client=s3)
    s3.put_object(Bucket="images", Key="uploads/s1/u1", Body=b"x" * 123)
    assert uploads.object_size("uploads/s1/u1") == 123
    assert uploads.object_size("uploads/s1/missing") is None


def test_queue_message_contains_only_the_job_id():
    with mock_aws():
        sqs = boto3.client("sqs", region_name="ap-northeast-1")
        url = sqs.create_queue(QueueName="jobs")["QueueUrl"]
        SqsQueue(url, client=sqs).send("job-123")
        message = sqs.receive_message(QueueUrl=url)["Messages"][0]
        assert json.loads(message["Body"]) == {"jobId": "job-123"}


class _PartialFailureS3:
    """delete_objects answers 200 but lists keys it could not delete (that is how S3 reports it)."""

    def __init__(self, keys, failing):
        self.keys, self.failing, self.calls = keys, failing, 0

    def get_paginator(self, name):
        keys = self.keys

        class Pages:
            def paginate(self, **_):
                return [{"Contents": [{"Key": k} for k in keys]}]

        return Pages()

    def delete_objects(self, Bucket, Delete):  # noqa: N803 - boto3 names
        self.calls += 1
        asked = [o["Key"] for o in Delete["Objects"]]
        errors = [{"Key": k, "Code": "AccessDenied"} for k in asked if k in self.failing]
        return {"Errors": errors} if errors else {}


def test_deleting_session_images_reports_keys_s3_could_not_delete():
    from photoprep_api.aws import PartialDeleteError

    keys = [f"uploads/s1/u{i}" for i in range(1500)]  # two batches
    s3 = _PartialFailureS3(keys, failing={"uploads/s1/u3", "uploads/s1/u1400"})
    with pytest.raises(PartialDeleteError) as caught:
        S3Uploads("images", client=s3).delete_session_images("s1")
    assert caught.value.failed == 2
    assert s3.calls == 2  # the second batch was still attempted


def test_deleting_session_images_returns_the_count_when_everything_went():
    s3 = _PartialFailureS3(["uploads/s1/a", "uploads/s1/b"], failing=set())
    assert S3Uploads("images", client=s3).delete_session_images("s1") == 2
