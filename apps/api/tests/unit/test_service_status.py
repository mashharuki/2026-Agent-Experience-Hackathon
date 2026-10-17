"""The shared 'is the service accepting work' flag (FR-027): API, worker control and the
worker all read and write it through one module."""

from photoprep_common.service_status import get_status, set_status
from photoprep_common.store import InMemoryStore


def test_unknown_status_means_not_accepting():
    """Fail closed: with no record the service is treated as stopped."""
    assert get_status(InMemoryStore()) == {"accepting": False, "reason": "worker_stopped"}


def test_open_and_closed_round_trip():
    store = InMemoryStore()
    set_status(store, accepting=True, reason="open")
    assert get_status(store) == {"accepting": True, "reason": "open"}
    set_status(
        store, accepting=False, reason="warming_up", expected_reopen_at="2026-10-18T09:05:00+00:00"
    )
    assert get_status(store) == {
        "accepting": False,
        "reason": "warming_up",
        "expectedReopenAt": "2026-10-18T09:05:00+00:00",
    }


def test_reopening_clears_a_stale_reopen_time():
    store = InMemoryStore()
    set_status(
        store, accepting=False, reason="warming_up", expected_reopen_at="2026-10-18T09:05:00+00:00"
    )
    set_status(store, accepting=True, reason="open")
    assert "expectedReopenAt" not in get_status(store)


def test_draining_is_internal_and_reported_as_maintenance():
    store = InMemoryStore()
    set_status(store, accepting=False, reason="maintenance", draining=True)
    assert get_status(store)["reason"] == "maintenance"
    assert "draining" not in get_status(store)  # not part of the public contract
    assert store.get("SERVICE#status", "META")["draining"] is True


def test_only_contract_reasons_are_accepted():
    import pytest

    with pytest.raises(ValueError):
        set_status(InMemoryStore(), accepting=False, reason="draining")
