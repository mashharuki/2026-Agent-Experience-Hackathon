"""Post-race debrief: one Amazon Bedrock (Nova Lite) call per finished race.

Runs on AWS Lambda behind an API Gateway JWT authorizer. Only boto3 (part of the
Lambda runtime) is used. The text is grounded in the submitted decision log: every
[D<n>] reference must point to a logged decision, otherwise it is removed.
"""

import json
import os
import re
import time
from datetime import UTC, datetime

import boto3
from botocore.exceptions import ClientError

BOATS = ("aurora", "zephyr", "coral", "jade")
OUTCOMES = ("finished", "timed_out", "aborted")
SOURCES = ("decider", "preview", "fallback")
STATUSES = ("applied", "expired", "rejected", "failed")
TACTIC = re.compile(
    r"^(hold_course|tack_now|jibe_now|approach_mark|head_to_finish"
    r"|seek_visible_pressure_(patch_[01]|gust_([0-9]|1[0-2])))$"
)
RACE_ID = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
USER = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
REFERENCE = re.compile(r"\[D(\d{1,3})\]")
MAX_BODY = 32 * 1024

_bedrock = None
_dynamodb = None


def clients():
    global _bedrock, _dynamodb
    if _bedrock is None:
        _bedrock = boto3.client("bedrock-runtime")
        _dynamodb = boto3.client("dynamodb")
    return _bedrock, _dynamodb


class Invalid(ValueError):
    pass


def _number(value, low, high, allow_none=False):
    if value is None and allow_none:
        return None
    if isinstance(value, bool) or not isinstance(value, int | float) or not low <= value <= high:
        raise Invalid("number")
    return value


def validate(payload: dict) -> dict:
    """Strict, bounded summary of one race. Unknown fields are rejected."""
    if not isinstance(payload, dict) or set(payload) != {
        "raceId",
        "language",
        "prediction",
        "outcome",
        "finishes",
        "decisions",
    }:
        raise Invalid("fields")
    if not isinstance(payload["raceId"], str) or not RACE_ID.match(payload["raceId"]):
        raise Invalid("raceId")
    if payload["language"] not in ("ja", "en"):
        raise Invalid("language")
    if payload["prediction"] not in BOATS:
        raise Invalid("prediction")
    if payload["outcome"] not in OUTCOMES:
        raise Invalid("outcome")
    finishes = payload["finishes"]
    if not isinstance(finishes, list) or len(finishes) != 4:
        raise Invalid("finishes")
    seen = set()
    for item in finishes:
        if not isinstance(item, dict) or set(item) != {"boatId", "seconds"}:
            raise Invalid("finish")
        if item["boatId"] not in BOATS or item["boatId"] in seen:
            raise Invalid("finish")
        seen.add(item["boatId"])
        _number(item["seconds"], 0, 180, allow_none=True)
    decisions = payload["decisions"]
    if not isinstance(decisions, list) or len(decisions) > 96:
        raise Invalid("decisions")
    for item in decisions:
        if not isinstance(item, dict) or set(item) != {
            "boatId",
            "selected",
            "source",
            "status",
            "observedTick",
            "appliedTick",
        }:
            raise Invalid("decision")
        if item["boatId"] not in BOATS or item["source"] not in SOURCES:
            raise Invalid("decision")
        if item["status"] not in STATUSES:
            raise Invalid("decision")
        if not isinstance(item["selected"], str) or not TACTIC.match(item["selected"]):
            raise Invalid("decision")
        _number(item["observedTick"], 0, 5400)
        _number(item["appliedTick"], 0, 5400, allow_none=True)
    return payload


def build_prompt(race: dict) -> str:
    finished = sorted(
        (f for f in race["finishes"] if f["seconds"] is not None), key=lambda f: f["seconds"]
    )
    order = ", ".join(f"{f['boatId']} {f['seconds']:.1f}s" for f in finished) or "none"
    unfinished = [f["boatId"] for f in race["finishes"] if f["seconds"] is None]
    lines = [
        f"[D{i + 1}] t={d['observedTick'] / 30:.1f}s boat={d['boatId']} tactic={d['selected']} "
        f"source={d['source']} status={d['status']}"
        for i, d in enumerate(race["decisions"])
    ]
    language = "Japanese" if race["language"] == "ja" else "English"
    return (
        "You are a sailing commentator writing a short post-race debrief for a spectator game "
        "with four identical Snipe-class AI boats. Use ONLY the facts below. "
        "Cite decisions with their [D<n>] labels. Do not invent decisions, wind data, "
        "internal reasoning of the AI, or claims that another choice would certainly have won. "
        "Say 'the record shows' rather than speculating. Applied decisions changed the course; "
        "expired, rejected or failed ones did not. "
        f"Write 3 to 5 sentences in {language}.\n\n"
        f"Outcome: {race['outcome']}. Finish order: {order}. "
        f"Did not finish: {', '.join(unfinished) or 'none'}. "
        f"The spectator predicted: {race['prediction']}.\n"
        "Decision log:\n" + ("\n".join(lines) or "(no decisions)")
    )


def ground(text: str, count: int) -> tuple[str, list[int]]:
    """Drop references to decisions that do not exist; return the ones kept."""
    kept = []

    def keep(match):
        number = int(match.group(1))
        if 1 <= number <= count:
            kept.append(number)
            return match.group(0)
        return ""

    return REFERENCE.sub(keep, text).strip(), sorted(set(kept))


def reserve_quota(user: str, now: float) -> str | None:
    """Atomically count one debrief for the user and for everyone, or refuse."""
    _, dynamodb = clients()
    day = datetime.fromtimestamp(now, UTC).strftime("%Y-%m-%d")
    expires = str(int(now) + 2 * 86400)
    table = os.environ["QUOTA_TABLE"]

    def update(key, limit):
        return {
            "Update": {
                "TableName": table,
                "Key": {"pk": {"S": key}},
                "UpdateExpression": "ADD used :one SET expiresAt = :ttl",
                "ConditionExpression": "attribute_not_exists(used) OR used < :limit",
                "ExpressionAttributeValues": {
                    ":one": {"N": "1"},
                    ":limit": {"N": str(limit)},
                    ":ttl": {"N": expires},
                },
            }
        }

    try:
        dynamodb.transact_write_items(
            TransactItems=[
                update(f"debrief#user#{user}#{day}", int(os.environ.get("USER_DAILY_LIMIT", "5"))),
                update(f"debrief#all#{day}", int(os.environ.get("GLOBAL_DAILY_LIMIT", "20"))),
            ]
        )
    except ClientError as error:
        if error.response["Error"]["Code"] == "TransactionCanceledException":
            return "daily_limit"
        raise
    return None


def response(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(body, ensure_ascii=False),
    }


def handler(event, _context):
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    user = claims.get("sub")
    if not isinstance(user, str) or not USER.match(user):
        return response(403, {"error": "forbidden"})
    raw = event.get("body") or ""
    if event.get("isBase64Encoded") or not 0 < len(raw) <= MAX_BODY:
        return response(413, {"error": "body_size"})
    try:
        race = validate(json.loads(raw))
    except (Invalid, json.JSONDecodeError):
        return response(400, {"error": "invalid_request"})
    if not any(d["source"] == "decider" for d in race["decisions"]):
        # Debriefs explain real model decisions; previews are not sent to Bedrock.
        return response(422, {"error": "no_model_decisions"})
    refused = reserve_quota(user, time.time())
    if refused:
        return response(429, {"error": refused})
    bedrock, _ = clients()
    started = time.perf_counter()
    try:
        result = bedrock.converse(
            modelId=os.environ.get("MODEL_ID", "amazon.nova-lite-v1:0"),
            messages=[{"role": "user", "content": [{"text": build_prompt(race)}]}],
            inferenceConfig={"maxTokens": 800, "temperature": 0.3},
        )
        text = "".join(part.get("text", "") for part in result["output"]["message"]["content"])
    except (ClientError, KeyError):
        # No automatic retry: a failed paid call is reported, not repeated.
        return response(502, {"error": "debrief_failed"})
    grounded, references = ground(text, len(race["decisions"]))
    if not grounded:
        return response(502, {"error": "debrief_failed"})
    usage = result.get("usage", {})
    print(
        json.dumps(
            {
                "event": "debrief",
                "latencyMs": round((time.perf_counter() - started) * 1000),
                "inputTokens": usage.get("inputTokens"),
                "outputTokens": usage.get("outputTokens"),
                "references": len(references),
            }
        )
    )
    return response(
        200,
        {
            "raceId": race["raceId"],
            "text": grounded,
            "references": references,
            "model": "Amazon Nova Lite",
        },
    )
