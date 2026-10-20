"""Export decision records for the demo and the article (operator tool, no images).

    uv run python -m tools.export_decisions --table <TABLE_NAME> [--session <id>] > decisions.jsonl

Reads the DECISION# items the worker wrote. They hold ids, option names, probabilities,
confidence, the guard override reason and which models ran: never an image, the user's
words or the model's text. Even so, the user and session identifiers are replaced by a
short one-way hash, so the output can be shown publicly.
"""

import argparse
import hashlib
import json
import sys
from collections.abc import Iterable

FIELDS = (
    "job_id",
    "question_version",
    "decider_choice",
    "selected",
    "guard_override",
    "confidence",
    "probabilities",
    "invoked",
    "created_at",
    "decision_source",
    "eligible_options",
    "policy_reason",
)


def _pseudonym(value: str) -> str:
    return "s-" + hashlib.sha256(value.encode()).hexdigest()[:8]


def _scan(table_name: str, region: str | None) -> Iterable[dict]:
    import boto3
    from boto3.dynamodb.conditions import Attr

    table = boto3.resource("dynamodb", region_name=region).Table(table_name)
    kwargs = {"FilterExpression": Attr("sk").begins_with("DECISION#")}
    while True:
        page = table.scan(**kwargs)
        yield from page["Items"]
        if "LastEvaluatedKey" not in page:
            return
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def export_decisions(store, session_id: str | None = None) -> list[dict]:
    """``store`` is anything with ``items()`` (tests) or a DynamoDB table name wrapper."""
    items = store.scan_decisions() if hasattr(store, "scan_decisions") else _from_store(store)
    rows = []
    for item in items:
        if session_id and item["session_id"] != session_id:
            continue
        row = {key: item[key] for key in FIELDS if key in item}
        row["session"] = _pseudonym(item["session_id"])
        rows.append(row)
    rows.sort(key=lambda r: (r["created_at"], r["job_id"]))
    return rows


def _from_store(store) -> list[dict]:
    # The in-memory store used in tests exposes its items; DynamoDB uses _scan.
    return [i for (pk, sk), i in store._items.items() if sk.startswith("DECISION#")]  # noqa: SLF001


class _DynamoDecisions:
    def __init__(self, table_name: str, region: str | None) -> None:
        self._table, self._region = table_name, region

    def scan_decisions(self) -> list[dict]:
        return [dict(i) for i in _scan(self._table, self._region)]


def main() -> None:  # pragma: no cover - operator entry point
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--table", required=True)
    parser.add_argument("--session")
    parser.add_argument("--region", default="ap-northeast-1")
    args = parser.parse_args()
    for row in export_decisions(_DynamoDecisions(args.table, args.region), args.session):
        sys.stdout.write(json.dumps(row, ensure_ascii=False, default=float) + "\n")


if __name__ == "__main__":
    main()
