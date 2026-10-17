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
