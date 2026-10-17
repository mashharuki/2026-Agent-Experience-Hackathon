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
    assert result == {"deleted": 2}
    assert "uploads/s2/fresh" in s3.objects and "other/not-ours" in s3.objects


def test_an_image_still_inside_its_usable_hour_is_never_touched():
    s3 = FakeS3({"uploads/s/u": NOW - timedelta(minutes=59)})
    assert sweep(s3, "bucket", NOW) == {"deleted": 0}
    assert s3.deleted == []


def test_nothing_to_do_is_fine():
    assert sweep(FakeS3({}), "bucket", NOW) == {"deleted": 0}


def test_works_with_the_real_client_against_moto():
    with mock_aws():
        s3 = boto3.client("s3", region_name="ap-northeast-1")
        location = {"LocationConstraint": "ap-northeast-1"}
        s3.create_bucket(Bucket="sweep-bucket", CreateBucketConfiguration=location)
        s3.put_object(Bucket="sweep-bucket", Key="uploads/s/u1", Body=b"x")
        s3.put_object(Bucket="sweep-bucket", Key="keep/me", Body=b"x")
        assert sweep(s3, "sweep-bucket", datetime.now(UTC) + timedelta(hours=5)) == {"deleted": 1}
        keys = [o["Key"] for o in s3.list_objects_v2(Bucket="sweep-bucket").get("Contents", [])]
        assert keys == ["keep/me"]


def test_the_handler_reads_its_bucket_from_the_environment(monkeypatch):
    from photoprep_api.ops import sweeper

    monkeypatch.setenv("IMAGE_BUCKET", "bucket")
    monkeypatch.setattr(
        sweeper, "_client", lambda: FakeS3({"uploads/a/b": NOW - timedelta(days=1)})
    )
    monkeypatch.setattr(sweeper, "_now", lambda: NOW)
    assert json.loads(json.dumps(sweeper.handler({}, None))) == {"deleted": 1}
