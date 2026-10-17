"""Connexion application factory.

The spec (``packages/api-spec/openapi.yaml``) is the source of truth: Connexion routes
by ``operationId`` and validates requests and responses. Operations without a handler
yet answer 501 with the contract's ``Error`` shape (replaced as handlers are added).
"""

import os
import pathlib
from collections.abc import Callable, Mapping

import connexion
from connexion.resolver import Resolver

from .errors import register_error_handlers
from .logs import install_log_redaction

DEFAULT_SPEC_DIR = pathlib.Path(__file__).resolve().parents[4] / "packages" / "api-spec"

Handler = Callable[..., object]


def _not_implemented(**_: object):
    return {"code": "internal_error", "message": "未実装です"}, 501


def create_app(
    handlers: Mapping[str, Handler] | None = None,
    spec_dir: pathlib.Path | str = DEFAULT_SPEC_DIR,
) -> connexion.FlaskApp:
    # The security function is named by env var so the spec stays free of app extensions.
    os.environ.setdefault("BEARERINFO_FUNC", "photoprep_api.auth.bearer_info")
    install_log_redaction()
    table = dict(handlers or {})
    app = connexion.FlaskApp(__name__, specification_dir=str(spec_dir))
    app.add_api(
        "openapi.yaml",
        resolver=Resolver(function_resolver=lambda op_id: table.get(op_id, _not_implemented)),
        validate_responses=True,
        strict_validation=True,
    )
    register_error_handlers(app)
    return app
