"""Dependencies the handlers use, injectable for tests and built from the environment
(set by CDK) on first use in Lambda."""

import os
import secrets
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol

from .store import Store


class Uploads(Protocol):
    def presign_post(self, key: str, content_type: str, max_bytes: int, expires_s: int) -> dict: ...

    def object_size(self, key: str) -> int | None: ...

    def delete_session_images(self, session_id: str) -> int: ...


@dataclass
class Limits:
    """Daily session quotas (FR-022): initial values from the architecture, JST day."""

    user_per_day: int = 10
    global_per_day: int = 100


class JobQueue(Protocol):
    def send(self, job_id: str) -> None: ...


@dataclass
class Container:
    store: Store
    uploads: Uploads
    queue: JobQueue
    now: Callable[[], datetime]
    new_id: Callable[[], str]
    limits: Limits = field(default_factory=Limits)


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _new_id() -> str:
    return secrets.token_urlsafe(16)  # 22 URL-safe characters, unguessable


_container: Container | None = None


def configure(container: Container | None) -> None:
    global _container  # noqa: PLW0603
    _container = container


def from_env() -> Container:
    from .aws import S3Uploads, SqsQueue
    from .store import DynamoStore

    return Container(
        store=DynamoStore(os.environ["TABLE_NAME"], region=os.environ.get("AWS_REGION")),
        uploads=S3Uploads(os.environ["IMAGE_BUCKET"]),
        queue=SqsQueue(os.environ["QUEUE_URL"]),
        now=_utcnow,
        new_id=_new_id,
    )


def get_container() -> Container:
    global _container  # noqa: PLW0603
    if _container is None:
        _container = from_env()
    return _container
