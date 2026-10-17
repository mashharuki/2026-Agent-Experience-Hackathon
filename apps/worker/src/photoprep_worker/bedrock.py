"""Bedrock access: a narrow port, a call budget and the boto3 adapter."""

from typing import Protocol

DEFAULT_MODEL_ID = "amazon.nova-lite-v1:0"  # in-region in Tokyo; no cross-region profile
MAX_OUTPUT_TOKENS = 800  # per call (architecture limit)
MAX_CALLS_PER_JOB = 2  # one observation + at most one explanation


class Bedrock(Protocol):
    def converse(self, system: str, content: list[dict]) -> str: ...


class CallBudgetExceeded(Exception):
    pass


class BudgetedBedrock:
    """Refuses a call beyond the per-job budget, whatever the pipeline does."""

    def __init__(self, inner: Bedrock, max_calls: int = MAX_CALLS_PER_JOB) -> None:
        self._inner = inner
        self._max = max_calls
        self.calls = 0

    def converse(self, system: str, content: list[dict]) -> str:
        if self.calls >= self._max:
            raise CallBudgetExceeded
        self.calls += 1
        return self._inner.converse(system, content)


class BedrockConverse:
    """boto3 ``bedrock-runtime`` Converse. Temperature 0 keeps answers repeatable."""

    def __init__(
        self, model_id: str = DEFAULT_MODEL_ID, client=None, region: str | None = None
    ) -> None:
        import boto3

        self._model_id = model_id
        self._client = client or boto3.client("bedrock-runtime", region_name=region)

    def converse(self, system: str, content: list[dict]) -> str:
        response = self._client.converse(
            modelId=self._model_id,
            system=[{"text": system}],
            messages=[{"role": "user", "content": content}],
            inferenceConfig={"maxTokens": MAX_OUTPUT_TOKENS, "temperature": 0},
        )
        parts = response["output"]["message"]["content"]
        return "".join(p.get("text", "") for p in parts)
