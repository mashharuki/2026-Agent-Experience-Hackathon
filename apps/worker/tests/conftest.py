import pytest
from photoprep_common.store import InMemoryStore

from photoprep_worker.pipeline import Deps
from tests.fakes import (
    FakeBedrock,
    FakeDecider,
    FakeImages,
    FixedClock,
    jpeg_bytes,
    observation_text,
)

SESSION = "sess0001"
JOB = "job00001"
KEY = f"uploads/{SESSION}/up000001"


class World:
    """A session mid-analysis plus everything the worker talks to (all fakes)."""

    def __init__(self) -> None:
        self.store = InMemoryStore()
        self.images = FakeImages()
        self.clock = FixedClock()
        self.decider = FakeDecider()
        self.bedrock = FakeBedrock(observation_text(), "眉ブラシで毛流れを整えてみましょう。")
        self.deps = Deps(
            store=self.store,
            images=self.images,
            bedrock=lambda: self.bedrock,
            decider=self.decider,
            now=self.clock,
            worker_id="worker-1",
        )

    def seed(
        self,
        *,
        phase="before",
        scope="brow",
        restrictions=(),
        wish=None,
        changes_used=0,
        prev_state="CONSULTING",
        state="ANALYZING",
        baseline=None,
        image=True,
        job_status="QUEUED",
        tools=(),
    ):
        session = {
            "ownerSub": "user-123",
            "scope": scope,
            "restrictions": list(restrictions),
            "state": state,
            "changesUsed": changes_used,
            "analysesUsed": 1,
            "expiresAt": "2026-10-19T09:00:00+00:00",
        }
        if wish:
            session["wish"] = wish
        if baseline:
            session["baseline"] = baseline
        self.store.create_if_absent(f"SESSION#{SESSION}", "META", session)
        self.store.create_if_absent(
            "UPLOAD#up000001",
            "META",
            {
                "ownerSub": "user-123",
                "sessionId": SESSION,
                "key": KEY,
                "phase": phase,
                "used": True,
            },
        )
        self.store.create_if_absent(
            f"JOB#{JOB}",
            "META",
            {
                "jobId": JOB,
                "ownerSub": "user-123",
                "sessionId": SESSION,
                "uploadId": "up000001",
                "phase": phase,
                "prevState": prev_state,
                "status": job_status,
                "tools": list(tools),
            },
        )
        if image:
            self.images.objects[KEY] = jpeg_bytes()
        return self

    def job(self):
        return self.store.get(f"JOB#{JOB}", "META")

    def session(self):
        return self.store.get(f"SESSION#{SESSION}", "META")

    def decision(self):
        return self.store.get(f"SESSION#{SESSION}", f"DECISION#{JOB}")


@pytest.fixture
def world():
    return World()
