"""The same pipeline on DynamoDB (moto): catches what the in-memory store cannot, such as
the SDK refusing Python floats."""

import boto3
import pytest
from moto import mock_aws
from photoprep_common.store import DynamoStore

from photoprep_worker.pipeline import Outcome, process_job
from tests.conftest import JOB, SESSION, World


@pytest.fixture
def dynamo_world():
    with mock_aws():
        boto3.client("dynamodb", region_name="ap-northeast-1").create_table(
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
        yield World(DynamoStore("t", region="ap-northeast-1"))


def test_a_full_job_succeeds_and_the_float_fields_survive(dynamo_world):
    world = dynamo_world.seed()
    assert process_job(world.deps, JOB) is Outcome.DONE
    assert world.job()["status"] == "SUCCEEDED"
    record = world.decision()
    assert record["selected"] == "grooming_tip"
    assert 0.0 <= record["confidence"] <= 1.0
    assert abs(sum(record["probabilities"].values()) - 1.0) < 1e-6
    assert world.session()["baseline"] == {"lighting": "good", "framing": "ok"}


def test_failure_and_cancellation_paths_work_on_dynamodb(dynamo_world):
    world = dynamo_world.seed(prev_state="ADVICE_SHOWN")
    world.decider.fail = True
    assert process_job(world.deps, JOB) is Outcome.FAILED
    assert world.session()["state"] == "ADVICE_SHOWN"

    ended = World(world.store)
    ended.store.update(f"SESSION#{SESSION}", "META", set={"state": "DONE"})
    ended.store.update(f"JOB#{JOB}", "META", set={"status": "QUEUED"})
    assert process_job(ended.deps, JOB) is Outcome.CANCELLED
