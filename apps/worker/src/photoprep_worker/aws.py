"""boto3 adapter for the temporary image bucket (tested with moto)."""

import boto3
from botocore.exceptions import ClientError


class S3Images:
    def __init__(self, bucket: str, client=None) -> None:
        self._bucket = bucket
        self._s3 = client or boto3.client("s3")

    def get(self, key: str) -> bytes | None:
        try:
            return self._s3.get_object(Bucket=self._bucket, Key=key)["Body"].read()
        except ClientError as err:
            if err.response["Error"]["Code"] in ("NoSuchKey", "404"):
                return None
            raise

    def delete(self, key: str) -> None:
        self._s3.delete_object(Bucket=self._bucket, Key=key)  # idempotent in S3
