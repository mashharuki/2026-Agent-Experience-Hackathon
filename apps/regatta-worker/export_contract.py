"""Snapshot the local experiment's typed schema, not the production API contract."""

import json
from pathlib import Path

import yaml

from local_server import Request

root = Path(__file__).resolve().parents[2]
schema = Request.model_json_schema()
definitions = schema.pop("$defs")
definitions["Request"] = schema
schemas = json.loads(json.dumps(definitions).replace("#/$defs/", "#/components/schemas/"))
document = {
    "openapi": "3.1.0",
    "info": {
        "title": "Local fleet Decider experiment (draft)",
        "version": "0.2.0",
        "description": "Local experiment only. Cloud contract and generated middleware pending.",
    },
    "servers": [{"url": "http://127.0.0.1:8766"}],
    "security": [{"LocalToken": []}],
    "paths": {
        "/health": {
            "get": {
                "responses": {
                    "200": {
                        "description": "Readiness, device and call count; no inference."
                    },
                    "403": {"description": "Missing/wrong local token or origin."},
                }
            }
        },
        "/decide": {
            "post": {
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {"schema": {"$ref": "#/components/schemas/Request"}}
                    },
                },
                "responses": {
                    str(code): {"description": description}
                    for code, description in [
                        (
                            200,
                            "Validated choice, scores and request identity.",
                        ),
                        (400, "Invalid or expired request."),
                        (403, "Forbidden."),
                        (410, "Expired during inference; result discarded."),
                        (413, "Body over 16KiB."),
                        (415, "Requires application/json."),
                        (429, "Busy (no queue) or process call cap."),
                        (500, "Inference failed."),
                        (503, "Not ready."),
                    ]
                },
            }
        },
    },
    "components": {
        "securitySchemes": {
            "LocalToken": {"type": "apiKey", "in": "header", "name": "X-Regatta-Local-Token"}
        },
        "schemas": schemas,
    },
}
(root / "specs/003-regatta-spectator/contracts/local-experiment.yaml").write_text(
    yaml.safe_dump(document, sort_keys=False)
)
