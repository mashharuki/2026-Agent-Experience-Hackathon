"""S3 adapter against moto (no real AWS)."""

import boto3
from moto import mock_aws

from photoprep_worker.aws import S3Images


def test_get_returns_bytes_or_none_and_delete_is_idempotent():
    with mock_aws():
        s3 = boto3.client("s3", region_name="ap-northeast-1")
        s3.create_bucket(
            Bucket="images", CreateBucketConfiguration={"LocationConstraint": "ap-northeast-1"}
        )
        s3.put_object(Bucket="images", Key="uploads/s/u", Body=b"abc")
        images = S3Images("images", client=s3)
        assert images.get("uploads/s/u") == b"abc"
        assert images.get("uploads/s/missing") is None
        images.delete("uploads/s/u")
        images.delete("uploads/s/u")  # deleting twice is fine
        assert images.get("uploads/s/u") is None
