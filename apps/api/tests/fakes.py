"""In-memory test doubles for the AWS-facing ports."""

import itertools
from datetime import UTC, datetime, timedelta


class FixedClock:
    def __init__(self, start: datetime | None = None) -> None:
        self.current = start or datetime(2026, 10, 18, 9, 0, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.current

    def advance(self, **kwargs: float) -> None:
        self.current += timedelta(**kwargs)


class FakeUploads:
    """Stands in for S3: records presign requests and which objects 'exist'."""

    def __init__(self) -> None:
        self.presigned: list[dict] = []
        self.objects: dict[str, int] = {}
        self.deleted_sessions: list[str] = []

    def presign_post(self, key: str, content_type: str, max_bytes: int, expires_s: int) -> dict:
        self.presigned.append(
            {
                "key": key,
                "content_type": content_type,
                "max_bytes": max_bytes,
                "expires_s": expires_s,
            }
        )
        return {
            "url": "https://images.example.test/",
            "fields": {"key": key, "Content-Type": content_type},
        }

    def object_size(self, key: str) -> int | None:
        return self.objects.get(key)

    def put_object(self, key: str, size: int = 1000) -> None:
        self.objects[key] = size

    def delete_session_images(self, session_id: str) -> int:
        prefix = f"uploads/{session_id}/"
        gone = [k for k in self.objects if k.startswith(prefix)]
        for key in gone:
            del self.objects[key]
        self.deleted_sessions.append(session_id)
        return len(gone)


class FakeQueue:
    def __init__(self) -> None:
        self.sent: list[str] = []
        self.fail = False

    def send(self, job_id: str) -> None:
        if self.fail:
            raise RuntimeError("queue unavailable")
        self.sent.append(job_id)


def sequential_ids(prefix: str = "id"):
    counter = itertools.count(1)
    return lambda: f"{prefix}{next(counter):08d}"
