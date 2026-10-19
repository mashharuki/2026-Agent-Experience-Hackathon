"""Recover old uploads and expired clarification text; inspect every S3 batch result."""

import os
import time
from datetime import UTC, datetime, timedelta

from photoprep_common.clarification import CONTEXT_INDEX
from photoprep_common.logs import log_event

PREFIX = "uploads/"
MAX_AGE = timedelta(minutes=90)
RETRYABLE = {"InternalError", "ServiceUnavailable", "SlowDown", "RequestTimeout"}


def _client():  # pragma: no cover - wiring
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        config=Config(
            connect_timeout=2,
            read_timeout=3,
            retries={"total_max_attempts": 2, "mode": "standard"},
        ),
    )


def _now() -> datetime:
    return datetime.now(UTC)


def sweep(
    s3,
    bucket: str,
    now: datetime,
    max_age: timedelta = MAX_AGE,
    *,
    sleep=time.sleep,
    remaining_ms=lambda: 60_000,
) -> dict:
    cutoff = now - max_age
    old = [
        obj["Key"]
        for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=PREFIX)
        for obj in page.get("Contents", [])
        if obj["LastModified"] < cutoff
    ]
    deleted = failed = retried = 0
    for start in range(0, len(old), 1000):
        pending = old[start : start + 1000]
        for attempt in range(3):
            response = s3.delete_objects(
                Bucket=bucket, Delete={"Objects": [{"Key": key} for key in pending], "Quiet": True}
            )
            errors = {item["Key"]: item.get("Code") for item in response.get("Errors", [])}
            deleted += sum(key not in errors for key in pending)
            retry = [key for key in pending if errors.get(key) in RETRYABLE]
            failed += sum(key in errors and key not in retry for key in pending)
            if not retry:
                break
            if attempt == 2 or remaining_ms() < 15_000:
                failed += len(retry)
                break
            sleep(0.2 * (2**attempt))
            retried += len(retry)
            pending = retry
    result = {"attempted": len(old), "deleted": deleted, "failed": failed, "retried": retried}
    log_event(
        "sweep",
        status=200 if not failed else 207,
        attempted_count=len(old),
        deleted_count=deleted,
        failed_count=failed,
        retried_count=retried,
    )
    return result


def sweep_contexts(store, now: datetime) -> int:
    expired = store.query_by_status(CONTEXT_INDEX, older_than=now.isoformat(), limit=1000)
    for record in expired:
        store.delete(record["pk"], record["sk"])
    log_event("sweep_contexts", deleted_count=len(expired))
    return len(expired)


def handler(event, context):  # noqa: ARG001
    now = _now()
    remaining = context.get_remaining_time_in_millis if context else lambda: 60_000
    result = sweep(_client(), os.environ["IMAGE_BUCKET"], now, remaining_ms=remaining)
    if os.environ.get("TABLE_NAME"):
        from photoprep_common.store import DynamoStore

        result["contextsDeleted"] = sweep_contexts(DynamoStore(os.environ["TABLE_NAME"]), now)
    return result
