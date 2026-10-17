"""Ownership-checked repository.

Every read goes through ``get_owned``: a record owned by someone else is reported as
not found, exactly like a missing record, so ids cannot be used to probe other users.
The DynamoDB implementation is added with the services (tasks T031/T032); this module
defines the contract and an in-memory implementation for tests.
"""

from typing import Protocol

from .errors import not_found


class Repository(Protocol):
    def put(self, kind: str, item_id: str, item: dict) -> None: ...

    def get(self, kind: str, item_id: str) -> dict | None: ...


class InMemoryRepository:
    def __init__(self) -> None:
        self._items: dict[tuple[str, str], dict] = {}

    def put(self, kind: str, item_id: str, item: dict) -> None:
        self._items[(kind, item_id)] = dict(item)

    def get(self, kind: str, item_id: str) -> dict | None:
        item = self._items.get((kind, item_id))
        return dict(item) if item is not None else None


def get_owned(repo: Repository, kind: str, item_id: str, owner_sub: str) -> dict:
    """Return the item if it exists and ``ownerSub`` matches; otherwise 404 (no leak)."""
    item = repo.get(kind, item_id)
    if item is None or item.get("ownerSub") != owner_sub:
        raise not_found()
    return item
