"""The Store contract, run against the in-memory store and DynamoDB (moto)."""

import boto3
import pytest
from moto import mock_aws

from photoprep_api.store import ConditionFailed, DynamoStore, InMemoryStore


@pytest.fixture(params=["memory", "dynamodb"])
def store(request):
    if request.param == "memory":
        yield InMemoryStore()
        return
    with mock_aws():
        client = boto3.client("dynamodb", region_name="ap-northeast-1")
        client.create_table(
            TableName="t",
            BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[
                {"AttributeName": "pk", "AttributeType": "S"},
                {"AttributeName": "sk", "AttributeType": "S"},
                {"AttributeName": "statusKey", "AttributeType": "S"},
                {"AttributeName": "statusSince", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "pk", "KeyType": "HASH"},
                {"AttributeName": "sk", "KeyType": "RANGE"},
            ],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": "status-index",
                    "KeySchema": [
                        {"AttributeName": "statusKey", "KeyType": "HASH"},
                        {"AttributeName": "statusSince", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                }
            ],
        )
        yield DynamoStore("t", region="ap-northeast-1")


def test_create_if_absent_is_exclusive(store):
    assert store.create_if_absent("A", "META", {"x": 1}) is True
    assert store.create_if_absent("A", "META", {"x": 2}) is False
    assert store.get("A", "META")["x"] == 1


def test_get_missing_returns_none(store):
    assert store.get("nope", "META") is None


def test_stored_items_come_back_with_plain_python_numbers(store):
    store.create_if_absent("A", "META", {"count": 3, "name": "n", "flag": True})
    item = store.get("A", "META")
    assert item["count"] == 3 and isinstance(item["count"], int)
    assert item["flag"] is True


def test_update_sets_values_and_returns_the_new_item(store):
    store.create_if_absent("A", "META", {"state": "CONSULTING", "n": 0})
    new = store.update("A", "META", set={"state": "ANALYZING"}, add={"n": 1})
    assert new["state"] == "ANALYZING" and new["n"] == 1


def test_update_on_missing_item_fails(store):
    with pytest.raises(ConditionFailed):
        store.update("nope", "META", set={"a": 1})


def test_expect_accepts_a_value_or_any_of_several(store):
    store.create_if_absent("A", "META", {"state": "TRYING"})
    store.update("A", "META", expect={"state": "TRYING"}, set={"a": 1})
    store.update("A", "META", expect={"state": ["CONSULTING", "TRYING"]}, set={"a": 2})
    with pytest.raises(ConditionFailed):
        store.update("A", "META", expect={"state": "DONE"}, set={"a": 3})
    with pytest.raises(ConditionFailed):
        store.update("A", "META", expect={"state": ["DONE", "CONSULTING"]}, set={"a": 3})
    assert store.get("A", "META")["a"] == 2


def test_counter_cap_is_atomic_and_inclusive(store):
    store.create_if_absent("A", "META", {"used": 0})
    for expected in (1, 2, 3):
        assert store.update("A", "META", add={"used": 1}, caps={"used": 3})["used"] == expected
    with pytest.raises(ConditionFailed):
        store.update("A", "META", add={"used": 1}, caps={"used": 3})
    assert store.get("A", "META")["used"] == 3


def test_counter_cap_applies_to_a_missing_counter(store):
    store.create_if_absent("A", "META", {"x": 1})
    assert store.update("A", "META", add={"used": 1}, caps={"used": 2})["used"] == 1


def test_failed_condition_changes_nothing(store):
    store.create_if_absent("A", "META", {"state": "DONE", "used": 0})
    with pytest.raises(ConditionFailed):
        store.update("A", "META", expect={"state": "TRYING"}, set={"state": "X"}, add={"used": 1})
    item = store.get("A", "META")
    assert item["state"] == "DONE" and item["used"] == 0


def test_remove_deletes_attributes(store):
    store.create_if_absent(
        "J", "META", {"statusKey": "PENDING_DISPATCH", "statusSince": "2026-10-18T09:00:00+00:00"}
    )
    new = store.update("J", "META", remove=["statusKey", "statusSince"])
    assert "statusKey" not in new and "statusSince" not in new


def test_query_by_status_returns_only_old_enough_items_oldest_first(store):
    for job_id, since in (
        ("J1", "2026-10-18T09:00:00+00:00"),
        ("J2", "2026-10-18T09:05:00+00:00"),
        ("J3", "2026-10-18T09:20:00+00:00"),
    ):
        store.create_if_absent(
            f"JOB#{job_id}",
            "META",
            {"jobId": job_id, "statusKey": "PENDING_DISPATCH", "statusSince": since},
        )
    store.create_if_absent(
        "JOB#J4", "META", {"jobId": "J4"}
    )  # no statusKey: not in the sparse index
    found = store.query_by_status("PENDING_DISPATCH", older_than="2026-10-18T09:10:00+00:00")
    assert [i["jobId"] for i in found] == ["J1", "J2"]
