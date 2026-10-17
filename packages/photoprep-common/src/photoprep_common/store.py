"""Persistence port with an in-memory and a DynamoDB implementation.

The domain needs only a few atomic operations, so the port exposes exactly those:
create-if-absent, get, a conditional update (equality / one-of checks, counters with
caps, set/remove) and a query on the sparse status index. Items are plain dicts with
``pk`` and ``sk``. Both implementations are tested against the same contract.
"""

import copy
from collections.abc import Mapping, Sequence
from decimal import Decimal
from typing import Any, Protocol

STATUS_INDEX = "status-index"
# Module-level because ``update`` has a parameter named ``set`` that shadows the builtin.
_ONE_OF = (list, tuple, set, frozenset)


class ConditionFailed(Exception):
    """The item is missing or a stated condition did not hold; nothing was changed."""


class Store(Protocol):
    def create_if_absent(self, pk: str, sk: str, item: Mapping[str, Any]) -> bool: ...

    def get(self, pk: str, sk: str) -> dict | None: ...

    def delete(self, pk: str, sk: str) -> None: ...

    def update(
        self,
        pk: str,
        sk: str,
        *,
        expect: Mapping[str, Any] | None = None,
        set: Mapping[str, Any] | None = None,  # noqa: A002
        add: Mapping[str, int] | None = None,
        caps: Mapping[str, int] | None = None,
        remove: Sequence[str] = (),
    ) -> dict: ...

    def query_by_status(
        self, status_key: str, *, older_than: str | None = None, limit: int = 50
    ) -> list[dict]: ...


def _matches(actual: Any, wanted: Any) -> bool:
    if isinstance(wanted, _ONE_OF):
        return actual in wanted
    return actual == wanted


class InMemoryStore:
    def __init__(self) -> None:
        self._items: dict[tuple[str, str], dict] = {}

    def create_if_absent(self, pk, sk, item) -> bool:
        if (pk, sk) in self._items:
            return False
        self._items[(pk, sk)] = {**copy.deepcopy(dict(item)), "pk": pk, "sk": sk}
        return True

    def get(self, pk, sk) -> dict | None:
        item = self._items.get((pk, sk))
        return copy.deepcopy(item) if item is not None else None

    def delete(self, pk, sk) -> None:
        self._items.pop((pk, sk), None)

    def update(self, pk, sk, *, expect=None, set=None, add=None, caps=None, remove=()):  # noqa: A002
        item = self._items.get((pk, sk))
        if item is None:
            raise ConditionFailed("missing item")
        for attr, wanted in (expect or {}).items():
            if not _matches(item.get(attr), wanted):
                raise ConditionFailed(attr)
        for attr, limit in (caps or {}).items():
            increment = (add or {}).get(attr, 1)
            if item.get(attr, 0) + increment > limit:
                raise ConditionFailed(attr)
        # All conditions hold: apply on a copy, then swap in (atomic like DynamoDB).
        updated = copy.deepcopy(item)
        for attr, value in (set or {}).items():
            updated[attr] = copy.deepcopy(value)
        for attr, increment in (add or {}).items():
            updated[attr] = updated.get(attr, 0) + increment
        for attr in remove:
            updated.pop(attr, None)
        self._items[(pk, sk)] = updated
        return copy.deepcopy(updated)

    def query_by_status(self, status_key, *, older_than=None, limit=50):
        found = [
            copy.deepcopy(i)
            for i in self._items.values()
            if i.get("statusKey") == status_key
            and (older_than is None or i.get("statusSince", "") <= older_than)
        ]
        found.sort(key=lambda i: i.get("statusSince", ""))
        return found[:limit]


def _to_dynamo(value: Any) -> Any:
    """DynamoDB's SDK rejects Python floats; store them as Decimal (via str, so 0.1 stays 0.1)."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: _to_dynamo(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_to_dynamo(v) for v in value]
    return value


def _from_dynamo(value: Any) -> Any:
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {k: _from_dynamo(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_from_dynamo(v) for v in value]
    return value


class DynamoStore:
    def __init__(self, table_name: str, *, region: str | None = None) -> None:
        import boto3

        self._table = boto3.resource("dynamodb", region_name=region).Table(table_name)

    def create_if_absent(self, pk, sk, item) -> bool:
        from botocore.exceptions import ClientError

        try:
            self._table.put_item(
                Item={**_to_dynamo(dict(item)), "pk": pk, "sk": sk},
                ConditionExpression="attribute_not_exists(pk)",
            )
        except ClientError as err:
            if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
                return False
            raise
        return True

    def get(self, pk, sk) -> dict | None:
        response = self._table.get_item(Key={"pk": pk, "sk": sk}, ConsistentRead=True)
        item = response.get("Item")
        return _from_dynamo(item) if item is not None else None

    def delete(self, pk, sk) -> None:
        self._table.delete_item(Key={"pk": pk, "sk": sk})

    def update(self, pk, sk, *, expect=None, set=None, add=None, caps=None, remove=()):  # noqa: A002
        from botocore.exceptions import ClientError

        names: dict[str, str] = {}
        values: dict[str, Any] = {}

        def name(attr: str) -> str:
            ref = f"#n{len(names)}"
            names[ref] = attr
            return ref

        def value(v: Any) -> str:
            ref = f":v{len(values)}"
            values[ref] = _to_dynamo(v)
            return ref

        conditions = ["attribute_exists(pk)"]
        for attr, wanted in (expect or {}).items():
            if isinstance(wanted, _ONE_OF):
                refs = ", ".join(value(w) for w in wanted)
                conditions.append(f"{name(attr)} IN ({refs})")
            else:
                conditions.append(f"{name(attr)} = {value(wanted)}")
        for attr, limit in (caps or {}).items():
            increment = (add or {}).get(attr, 1)
            ref = name(attr)
            conditions.append(
                f"(attribute_not_exists({ref}) OR {ref} <= {value(limit - increment)})"
            )

        set_parts = [f"{name(a)} = {value(v)}" for a, v in (set or {}).items()]
        add_parts = [f"{name(a)} {value(v)}" for a, v in (add or {}).items()]
        remove_parts = [name(a) for a in remove]
        clauses = []
        if set_parts:
            clauses.append("SET " + ", ".join(set_parts))
        if add_parts:
            clauses.append("ADD " + ", ".join(add_parts))
        if remove_parts:
            clauses.append("REMOVE " + ", ".join(remove_parts))

        kwargs: dict[str, Any] = {
            "Key": {"pk": pk, "sk": sk},
            "ConditionExpression": " AND ".join(conditions),
            "ReturnValues": "ALL_NEW",
        }
        if clauses:
            kwargs["UpdateExpression"] = " ".join(clauses)
        if names:
            kwargs["ExpressionAttributeNames"] = names
        if values:
            kwargs["ExpressionAttributeValues"] = values
        try:
            response = self._table.update_item(**kwargs)
        except ClientError as err:
            if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise ConditionFailed from err
            raise
        return _from_dynamo(response["Attributes"])

    def query_by_status(self, status_key, *, older_than=None, limit=50):
        from boto3.dynamodb.conditions import Key

        condition = Key("statusKey").eq(status_key)
        if older_than is not None:
            condition = condition & Key("statusSince").lte(older_than)
        response = self._table.query(
            IndexName=STATUS_INDEX, KeyConditionExpression=condition, Limit=limit
        )
        return [_from_dynamo(i) for i in response.get("Items", [])]
