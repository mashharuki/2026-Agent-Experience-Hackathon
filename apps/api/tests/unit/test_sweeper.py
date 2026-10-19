"""Leftover temporary images are removed even when the normal deletion path failed."""

import json
from datetime import UTC, datetime, timedelta

import boto3
from moto import mock_aws

from photoprep_api.ops.sweeper import sweep

NOW = datetime(2026, 10, 18, 12, 0, 0, tzinfo=UTC)


class FakeS3:
    def __init__(self, objects):
        self.objects = dict(objects)  # key -> LastModified
        self.deleted = []

    def get_paginator(self, name):
        assert name == "list_objects_v2"
        outer = self

        class Paginator:
            def paginate(self, Bucket, Prefix):  # noqa: N803
                keys = [k for k in outer.objects if k.startswith(Prefix)]
                # two pages to prove pagination is handled
                half = max(1, len(keys) // 2)
                yield {
                    "Contents": [{"Key": k, "LastModified": outer.objects[k]} for k in keys[:half]]
                }
                yield {
                    "Contents": [{"Key": k, "LastModified": outer.objects[k]} for k in keys[half:]]
                }

        return Paginator()

    def delete_objects(self, Bucket, Delete):  # noqa: N803
        keys = [o["Key"] for o in Delete["Objects"]]
        self.deleted += keys
        for key in keys:
            self.objects.pop(key, None)
        return {"Deleted": [{"Key": k} for k in keys]}


def test_deletes_only_old_uploads():
    s3 = FakeS3(
        {
            "uploads/s1/old1": NOW - timedelta(hours=3),
            "uploads/s1/old2": NOW - timedelta(minutes=95),
            "uploads/s2/fresh": NOW - timedelta(minutes=5),
            "other/not-ours": NOW - timedelta(days=9),
        }
    )
    result = sweep(s3, "bucket", NOW)
    assert sorted(s3.deleted) == ["uploads/s1/old1", "uploads/s1/old2"]
    assert result == {"attempted": 2, "deleted": 2, "failed": 0, "retried": 0}
    assert "uploads/s2/fresh" in s3.objects and "other/not-ours" in s3.objects


def test_an_image_still_inside_its_usable_hour_is_never_touched():
    s3 = FakeS3({"uploads/s/u": NOW - timedelta(minutes=59)})
    assert sweep(s3, "bucket", NOW) == {"attempted": 0, "deleted": 0, "failed": 0, "retried": 0}
    assert s3.deleted == []


def test_nothing_to_do_is_fine():
    assert sweep(FakeS3({}), "bucket", NOW) == {
        "attempted": 0,
        "deleted": 0,
        "failed": 0,
        "retried": 0,
    }


def test_works_with_the_real_client_against_moto():
    with mock_aws():
        s3 = boto3.client("s3", region_name="ap-northeast-1")
        location = {"LocationConstraint": "ap-northeast-1"}
        s3.create_bucket(Bucket="sweep-bucket", CreateBucketConfiguration=location)
        s3.put_object(Bucket="sweep-bucket", Key="uploads/s/u1", Body=b"x")
        s3.put_object(Bucket="sweep-bucket", Key="keep/me", Body=b"x")
        assert sweep(s3, "sweep-bucket", datetime.now(UTC) + timedelta(hours=5)) == {
            "attempted": 1,
            "deleted": 1,
            "failed": 0,
            "retried": 0,
        }
        keys = [o["Key"] for o in s3.list_objects_v2(Bucket="sweep-bucket").get("Contents", [])]
        assert keys == ["keep/me"]


def test_the_handler_reads_its_bucket_from_the_environment(monkeypatch):
    from photoprep_api.ops import sweeper

    monkeypatch.setenv("IMAGE_BUCKET", "bucket")
    monkeypatch.setattr(
        sweeper, "_client", lambda: FakeS3({"uploads/a/b": NOW - timedelta(days=1)})
    )
    monkeypatch.setattr(sweeper, "_now", lambda: NOW)
    assert json.loads(json.dumps(sweeper.handler({}, None))) == {
        "attempted": 1,
        "deleted": 1,
        "failed": 0,
        "retried": 0,
    }


def test_partial_failure_is_reported_and_only_transient_keys_are_retried():
    class PartialS3(FakeS3):
        def __init__(self):
            super().__init__(
                {
                    f"uploads/s/{name}": NOW - timedelta(hours=3)
                    for name in ("ok", "retry", "denied")
                }
            )
            self.batches = []

        def delete_objects(self, Bucket, Delete):  # noqa: N803
            keys = [item["Key"] for item in Delete["Objects"]]
            self.batches.append(keys)
            if len(self.batches) == 1:
                return {
                    "Errors": [
                        {"Key": "uploads/s/retry", "Code": "InternalError"},
                        {"Key": "uploads/s/denied", "Code": "AccessDenied"},
                    ]
                }
            return {}

    s3 = PartialS3()
    result = sweep(s3, "bucket", NOW, sleep=lambda _: None)
    assert result == {"attempted": 3, "deleted": 2, "failed": 1, "retried": 1}
    assert s3.batches[1] == ["uploads/s/retry"]


def test_transient_failures_have_a_retry_limit():
    class BrokenS3(FakeS3):
        def delete_objects(self, Bucket, Delete):  # noqa: N803
            return {
                "Errors": [{"Key": item["Key"], "Code": "SlowDown"} for item in Delete["Objects"]]
            }

    result = sweep(
        BrokenS3({"uploads/s/one": NOW - timedelta(hours=3)}), "bucket", NOW, sleep=lambda _: None
    )
    assert result == {"attempted": 1, "deleted": 0, "failed": 1, "retried": 2}


def test_does_not_retry_when_lambda_is_near_its_deadline():
    class BrokenS3(FakeS3):
        def delete_objects(self, Bucket, Delete):  # noqa: N803
            return {
                "Errors": [
                    {"Key": item["Key"], "Code": "InternalError"} for item in Delete["Objects"]
                ]
            }

    result = sweep(
        BrokenS3({"uploads/s/one": NOW - timedelta(hours=3)}),
        "bucket",
        NOW,
        remaining_ms=lambda: 1000,
    )
    assert result["failed"] == 1 and result["retried"] == 0


def test_expired_observation_notes_are_removed_without_touching_live_notes():
    from photoprep_common.clarification import CONTEXT_INDEX
    from photoprep_common.store import InMemoryStore

    from photoprep_api.ops.sweeper import sweep_contexts

    store = InMemoryStore()
    for name, expires in (
        ("old", NOW - timedelta(minutes=1)),
        ("live", NOW + timedelta(minutes=1)),
    ):
        store.create_if_absent(
            "SESSION#one",
            f"CLARIFICATION#{name}",
            {
                "statusKey": CONTEXT_INDEX,
                "statusSince": expires.isoformat(),
                "observation": {"visible": ["private"]},
            },
        )
    assert sweep_contexts(store, NOW) == 1
    assert store.get("SESSION#one", "CLARIFICATION#old") is None
    assert store.get("SESSION#one", "CLARIFICATION#live") is not None
