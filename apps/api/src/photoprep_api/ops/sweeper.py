"""Remove temporary images that the normal deletion path left behind.

The worker deletes a photo when its job succeeds, fails or is cancelled, and an S3
lifecycle rule expires everything after a day. This runs every 15 minutes in between: any
object under ``uploads/`` older than the one hour an image is usable for (plus a grace
period) is certainly an orphan, because a signed upload expires after 60 seconds and a job
finishes within a minute or two. Younger objects are never touched.
"""

import os
from datetime import UTC, datetime, timedelta

from photoprep_common.logs import log_event

PREFIX = "uploads/"
MAX_AGE = timedelta(minutes=90)  # 60 min usable + 30 min grace


def _client():  # pragma: no cover - wiring
    import boto3

    return boto3.client("s3")


def _now() -> datetime:
    return datetime.now(UTC)


def sweep(s3, bucket: str, now: datetime, max_age: timedelta = MAX_AGE) -> dict:
    cutoff = now - max_age
    old: list[str] = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=PREFIX):
        old += [o["Key"] for o in page.get("Contents", []) if o["LastModified"] < cutoff]
    for start in range(0, len(old), 1000):  # delete_objects takes at most 1000 keys
        batch = old[start : start + 1000]
        s3.delete_objects(
            Bucket=bucket, Delete={"Objects": [{"Key": k} for k in batch], "Quiet": True}
        )
    log_event("sweep", status=200, token_count=len(old))
    return {"deleted": len(old)}


def handler(event, context):  # noqa: ARG001
    return sweep(_client(), os.environ["IMAGE_BUCKET"], _now())
