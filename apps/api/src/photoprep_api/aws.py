"""boto3 adapters for the S3 and SQS ports (tested with moto)."""

import json

import boto3
from botocore.exceptions import ClientError


class S3Uploads:
    def __init__(self, bucket: str, client=None) -> None:
        self._bucket = bucket
        self._s3 = client or boto3.client("s3")

    def presign_post(self, key: str, content_type: str, max_bytes: int, expires_s: int) -> dict:
        """Signed POST with server-decided constraints: key, content type, size range, expiry."""
        post = self._s3.generate_presigned_post(
            Bucket=self._bucket,
            Key=key,
            Fields={"Content-Type": content_type},
            Conditions=[
                {"Content-Type": content_type},
                ["content-length-range", 1, max_bytes],
            ],
            ExpiresIn=expires_s,
        )
        return {"url": post["url"], "fields": post["fields"]}

    def object_size(self, key: str) -> int | None:
        try:
            return int(self._s3.head_object(Bucket=self._bucket, Key=key)["ContentLength"])
        except ClientError as err:
            if err.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
                return None
            raise

    def delete_session_images(self, session_id: str) -> int:
        """Remove every temporary photo of one session (ending it, or withdrawing consent)."""
        prefix = f"uploads/{session_id}/"
        keys: list[str] = []
        for page in self._s3.get_paginator("list_objects_v2").paginate(
            Bucket=self._bucket, Prefix=prefix
        ):
            keys += [o["Key"] for o in page.get("Contents", [])]
        for start in range(0, len(keys), 1000):
            batch = keys[start : start + 1000]
            self._s3.delete_objects(
                Bucket=self._bucket,
                Delete={"Objects": [{"Key": k} for k in batch], "Quiet": True},
            )
        return len(keys)


class SqsQueue:
    def __init__(self, queue_url: str, client=None) -> None:
        self._url = queue_url
        self._sqs = client or boto3.client("sqs")

    def send(self, job_id: str) -> None:
        # Only the job id: no image, text or user data travels through the queue.
        self._sqs.send_message(QueueUrl=self._url, MessageBody=json.dumps({"jobId": job_id}))
