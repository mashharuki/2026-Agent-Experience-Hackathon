"""Ownership checks on top of the Store.

A record owned by someone else is reported as not found, exactly like a missing record,
so ids cannot be used to probe other users' data.
"""

from .errors import not_found
from .store import Store


def get_owned(store: Store, pk: str, owner_sub: str, sk: str = "META") -> dict:
    item = store.get(pk, sk)
    if item is None or item.get("ownerSub") != owner_sub:
        raise not_found()
    return item
