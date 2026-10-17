"""Connexion application factory.

The spec (``packages/api-spec/openapi.yaml``) is the source of truth: Connexion routes
by ``operationId`` and validates requests and responses. Operations without a handler
yet answer 501 with the contract's ``Error`` shape (replaced as handlers are added).
"""

import os
import pathlib
from collections.abc import Callable, Mapping

import connexion
from connexion.options import SwaggerUIOptions
from connexion.resolver import Resolver

from .errors import register_error_handlers
from .logs import install_log_redaction

# Where the contract lives: next to the code in the Lambda package (copied there by
# scripts/build_lambda.py), or in packages/api-spec when running from the repository.
_BUNDLED_SPEC_DIR = pathlib.Path(__file__).resolve().parent / "spec"


def repo_spec_dir(module_file: pathlib.PurePath) -> pathlib.PurePath | None:
    """The repository's contract folder, or None when this code is not inside the repository.

    The Lambda package is shallow (``/var/task/photoprep_api/app.py``), so the parent lookup
    must not run unguarded at import time.
    """
    parents = module_file.parents
    if len(parents) <= 4:
        return None
    return parents[4] / "packages" / "api-spec"


def resolve_spec_dir() -> pathlib.Path:
    """``PHOTOPREP_SPEC_DIR`` if set, else the bundled copy, else the repository's."""
    override = os.environ.get("PHOTOPREP_SPEC_DIR")
    if override:
        return pathlib.Path(override)
    if (_BUNDLED_SPEC_DIR / "openapi.yaml").is_file():
        return _BUNDLED_SPEC_DIR
    repo = repo_spec_dir(pathlib.Path(__file__).resolve())
    if repo is None:
        raise FileNotFoundError(
            "openapi.yaml is not bundled with the package and no repository was found"
        )
    return pathlib.Path(repo)


Handler = Callable[..., object]


def _not_implemented(**_: object):
    return {"code": "internal_error", "message": "未実装です"}, 501


def create_app(
    handlers: Mapping[str, Handler] | None = None,
    spec_dir: pathlib.Path | str | None = None,
) -> connexion.FlaskApp:
    # The security function is named by env var so the spec stays free of app extensions.
    os.environ.setdefault("BEARERINFO_FUNC", "photoprep_api.auth.bearer_info")
    install_log_redaction()
    table = dict(handlers or {})
    app = connexion.FlaskApp(__name__, specification_dir=str(spec_dir or resolve_spec_dir()))
    app.add_api(
        "openapi.yaml",
        resolver=Resolver(function_resolver=lambda op_id: table.get(op_id, _not_implemented)),
        validate_responses=True,
        strict_validation=True,
        # No docs UI in the Lambda package (not installed, and it would add a public route).
        swagger_ui_options=SwaggerUIOptions(swagger_ui=False),
    )
    register_error_handlers(app)
    return app
