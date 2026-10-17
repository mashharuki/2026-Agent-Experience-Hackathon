"""T098: the demo export of decision records (operator tool). It must never emit anything
that identifies a person or reproduces user content."""

import json

from photoprep_common.store import InMemoryStore
from tools.export_decisions import export_decisions


def record(job, session, selected="grooming_tip", **extra):
    return {
        "job_id": job,
        "session_id": session,
        "question_version": "v1",
        "probabilities": {"grooming_tip": 0.7, "clarify": 0.3},
        "confidence": 0.7,
        "decider_choice": "grooming_tip",
        "selected": selected,
        "guard_override": None,
        "invoked": ["bedrock.observe", "bedrock.explain"],
        "created_at": "2026-10-18T09:00:00+00:00",
        "ownerSub": "user-123",
        "ttl": 1792226453,
        **extra,
    }


def seeded():
    store = InMemoryStore()
    store.create_if_absent("SESSION#s1", "DECISION#j1", record("j1", "s1"))
    store.create_if_absent(
        "SESSION#s1", "DECISION#j2", record("j2", "s1", "clarify", guard_override="restriction")
    )
    store.create_if_absent("SESSION#s2", "DECISION#j3", record("j3", "s2"))
    store.create_if_absent("SESSION#s1", "META", {"ownerSub": "user-123", "wish": "秘密の希望文"})
    store.create_if_absent(
        "JOB#j1", "META", {"ownerSub": "user-123", "result": {"text": "秘密の助言文"}}
    )
    return store


def test_exports_only_decision_records_in_time_order():
    rows = export_decisions(seeded())
    assert [r["job_id"] for r in rows] == ["j1", "j2", "j3"]
    assert rows[1]["selected"] == "clarify" and rows[1]["guard_override"] == "restriction"


def test_nothing_identifying_or_user_written_is_exported():
    text = json.dumps(export_decisions(seeded()), ensure_ascii=False)
    for forbidden in ("user-123", "ownerSub", "秘密の希望文", "秘密の助言文", "wish", "ttl"):
        assert forbidden not in text


def test_sessions_are_pseudonymised_the_same_way_every_time():
    first = export_decisions(seeded())
    second = export_decisions(seeded())
    assert first[0]["session"] == second[0]["session"] != "s1"
    assert first[0]["session"] == first[1]["session"] != first[2]["session"]


def test_one_session_can_be_selected():
    rows = export_decisions(seeded(), session_id="s2")
    assert [r["job_id"] for r in rows] == ["j3"]
