# T009 spike: Connexion 3 + Mangum (throwaway)

Verifies research R-003 locally. Not product code; handlers are stubs.

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python "connexion[flask,uvicorn,swagger-ui]" mangum pytest pyyaml
.venv/bin/python -m pytest -q -p no:cacheprovider -W ignore test_spike.py
```

- `app.py`: loads `specs/001-pre-photo-grooming-assist/contracts/openapi.draft.yaml`,
  wraps the whole Connexion app in Mangum, reads identity only from the API Gateway
  v2 authorizer claims, maps errors to the contract's `Error` schema.
- `test_spike.py`: 23 checks using synthetic API Gateway HTTP API v2 events
  (built from the documented payload format, **not** captured from a real gateway).

Versions tested: connexion 3.3.0, mangum 0.22.0, flask 3.1.3, starlette 1.8.0, Python 3.12.
Not tested: a real API Gateway / Lambda, x86_64 Linux packaging, Swagger UI, load.
