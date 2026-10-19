"""Persistence port with an in-memory and a DynamoDB implementation.

The domain needs only a few atomic operations, so the port exposes exactly those:
create-if-absent, get, a conditional update (equality / one-of checks, counters with
caps, set/remove) and a query on the sparse status index. Items are plain dicts with
``pk`` and ``sk``. Both implementations are tested against the same contract.
"""

import copy
from collections.abc import Mapping, Sequence
from decimal import Decimal
from functools import wraps
from threading import RLock
from typing import Any, Protocol

STATUS_INDEX = "status-index"
# Module-level because ``update`` has a parameter named ``set`` that shadows the builtin.
_ONE_OF = (list, tuple, set, frozenset)


class ConditionFailed(Exception):
    """The item is missing or a stated condition did not hold; nothing was changed."""


class Store(Protocol):
    def transact(self, operations: Sequence[Mapping[str, Any]]) -> None: ...

    def create_if_absent(self, pk: str, sk: str, item: Mapping[str, Any]) -> bool: ...

    def get(self, pk: str, sk: str) -> dict | None: ...

    def delete(self, pk: str, sk: str) -> None: ...

    def update(
        self,
        pk: str,
        sk: str,
        *,
        expect: Mapping[str, Any] | None = None,
        set: Mapping[str, Any] | None = None,
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


def _locked(method):
    @wraps(method)
    def call(self, *args, **kwargs):
        with self._lock:
            return method(self, *args, **kwargs)

    return call


class InMemoryStore:
    def __init__(self) -> None:
        self._lock = RLock()
        self._items: dict[tuple[str, str], dict] = {}

    @_locked
    def create_if_absent(self, pk, sk, item) -> bool:
        if (pk, sk) in self._items:
            return False
        self._items[(pk, sk)] = {**copy.deepcopy(dict(item)), "pk": pk, "sk": sk}
        return True

    @_locked
    def get(self, pk, sk) -> dict | None:
        item = self._items.get((pk, sk))
        return copy.deepcopy(item) if item is not None else None

    @_locked
    def delete(self, pk, sk) -> None:
        self._items.pop((pk, sk), None)

    @_locked
    def update(self, pk, sk, *, expect=None, set=None, add=None, caps=None, remove=()):
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

    @_locked
    def query_by_status(self, status_key, *, older_than=None, limit=50):
        found = [
            copy.deepcopy(i)
            for i in self._items.values()
            if i.get("statusKey") == status_key
            and (older_than is None or i.get("statusSince", "") <= older_than)
        ]
        found.sort(key=lambda i: i.get("statusSince", ""))
        return found[:limit]

    @_locked
    def transact(self, operations):
        _validate_transaction(operations)
        staged = InMemoryStore()
        staged._items = copy.deepcopy(self._items)
        for operation in operations:
            op = dict(operation)
            kind, pk, sk = op.pop("op"), op.pop("pk"), op.pop("sk")
            if kind == "put":
                existing = staged.get(pk, sk)
                if not op.get("overwrite", False) and existing is not None:
                    raise ConditionFailed("exists")
                if op.get("expect") and (
                    existing is None
                    or any(
                        not _matches(existing.get(k), v)
                        for k, v in op["expect"].items()
                    )
                ):
                    raise ConditionFailed("put condition")
                staged._items[(pk, sk)] = {
                    **copy.deepcopy(op["item"]),
                    "pk": pk,
                    "sk": sk,
                }
            elif kind == "update":
                staged.update(pk, sk, **op)
            elif kind == "check":
                existing = staged.get(pk, sk)
                if existing is None or any(
                    not _matches(existing.get(k), v) for k, v in op["expect"].items()
                ):
                    raise ConditionFailed("check")
            else:
                staged.delete(pk, sk)
        self._items = staged._items


def _validate_transaction(operations):
    keys = [(op["pk"], op["sk"]) for op in operations]
    if not keys or len(keys) != len(set(keys)):
        raise ValueError("transaction must contain unique items")
    if any(op["op"] not in {"put", "update", "check", "delete"} for op in operations):
        raise ValueError("unknown transaction operation")


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


def _update_request(pk, sk, *, expect=None, set=None, add=None, caps=None, remove=()):
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
    }
    if clauses:
        kwargs["UpdateExpression"] = " ".join(clauses)
    if names:
        kwargs["ExpressionAttributeNames"] = names
    if values:
        kwargs["ExpressionAttributeValues"] = values
    return kwargs


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

    def update(self, pk, sk, *, expect=None, set=None, add=None, caps=None, remove=()):
        from botocore.exceptions import ClientError

        kwargs = _update_request(
            pk, sk, expect=expect, set=set, add=add, caps=caps, remove=remove
        )
        kwargs["ReturnValues"] = "ALL_NEW"
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

    def transact(self, operations):
        from boto3.dynamodb.conditions import Attr, ConditionExpressionBuilder

        _validate_transaction(operations)
        writes = []
        for operation in operations:
            op = dict(operation)
            kind, pk, sk = op.pop("op"), op.pop("pk"), op.pop("sk")
            if kind == "update":
                request = _update_request(pk, sk, **op)
                request["TableName"] = self._table.name
                writes.append({"Update": request})
                continue
            request = {"TableName": self._table.name}
            if kind == "put":
                request["Item"] = {**_to_dynamo(op["item"]), "pk": pk, "sk": sk}
            else:
                request["Key"] = {"pk": pk, "sk": sk}
            condition = None
            if kind == "put" and not op.get("overwrite", False):
                condition = Attr("pk").not_exists()
            if kind == "check" or op.get("expect"):
                condition = Attr("pk").exists() if condition is None else condition
                for key, wanted in op.get("expect", {}).items():
                    part = (
                        Attr(key).is_in(list(wanted))
                        if isinstance(wanted, _ONE_OF)
                        else Attr(key).eq(wanted)
                    )
                    condition = condition & part
            if condition is not None:
                expression = ConditionExpressionBuilder().build_expression(condition)
                request["ConditionExpression"] = expression.condition_expression
                if expression.attribute_name_placeholders:
                    request["ExpressionAttributeNames"] = (
                        expression.attribute_name_placeholders
                    )
                if expression.attribute_value_placeholders:
                    request["ExpressionAttributeValues"] = _to_dynamo(
                        expression.attribute_value_placeholders
                    )
            writes.append(
                {
                    {"put": "Put", "check": "ConditionCheck", "delete": "Delete"}[
                        kind
                    ]: request
                }
            )
        client = self._table.meta.client
        try:
            client.transact_write_items(TransactItems=writes)
        except client.exceptions.TransactionCanceledException as err:
            reasons = err.response.get("CancellationReasons", [])
            if any(
                reason.get("Code") == "ConditionalCheckFailed" for reason in reasons
            ):
                raise ConditionFailed("transaction condition") from err
            raise
