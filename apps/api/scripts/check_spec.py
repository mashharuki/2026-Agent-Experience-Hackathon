"""Lint the OpenAPI contract and prove Connexion can load it.

Usage: uv run python scripts/check_spec.py [path/to/openapi.yaml]
Checks: YAML parses, valid OpenAPI 3.0.x, operationIds unique, every operation is
authenticated (no empty ``security``), 3.1-only keywords absent, Connexion loads it.
"""

import pathlib
import sys

import yaml
from openapi_spec_validator import validate

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))

from photoprep_api.app import create_app  # noqa: E402

HTTP_METHODS = {"get", "put", "post", "delete", "patch", "head", "options"}
FORBIDDEN_31_KEYS = {"$defs", "prefixItems", "unevaluatedProperties", "webhooks", "const"}


def walk(node, found):
    if isinstance(node, dict):
        for key, value in node.items():
            if key in FORBIDDEN_31_KEYS:
                found.add(key)
            walk(value, found)
    elif isinstance(node, list):
        for item in node:
            walk(item, found)


def main(path: pathlib.Path) -> int:
    spec = yaml.safe_load(path.read_text(encoding="utf-8"))
    errors: list[str] = []

    if not str(spec.get("openapi", "")).startswith("3.0."):
        errors.append(f"openapi must be 3.0.x, got {spec.get('openapi')!r}")
    validate(spec)  # raises on schema violations

    op_ids: list[str] = []
    for url, item in spec["paths"].items():
        for method, op in item.items():
            if method not in HTTP_METHODS:
                continue
            op_ids.append(op.get("operationId", f"<missing {method} {url}>"))
            if "operationId" not in op:
                errors.append(f"{method.upper()} {url}: operationId missing")
            if op.get("security") == []:
                errors.append(f"{method.upper()} {url}: security is explicitly empty")
            if not spec.get("security") and "security" not in op:
                errors.append(f"{method.upper()} {url}: no security requirement")
    for op_id in {i for i in op_ids if op_ids.count(i) > 1}:
        errors.append(f"duplicate operationId: {op_id}")

    found: set[str] = set()
    walk(spec, found)
    if found:
        errors.append(f"3.1-only keywords present: {sorted(found)}")

    create_app(spec_dir=path.parent)  # raises if Connexion cannot load the spec

    if errors:
        print("\n".join(f"ERROR: {e}" for e in errors))
        return 1
    print(f"OK: {len(op_ids)} operations ({', '.join(sorted(op_ids))})")
    return 0


if __name__ == "__main__":
    target = pathlib.Path(
        sys.argv[1] if len(sys.argv) > 1 else "../../packages/api-spec/openapi.yaml"
    )
    sys.exit(main(target.resolve()))
