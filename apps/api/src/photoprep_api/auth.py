"""Identity from the API Gateway JWT authorizer result.

API Gateway validates the token (issuer, audience, expiry, signature, scope). The app
reads only the authorizer claims in the Lambda event and fails closed when they are
missing. The bearer string and any request header are never treated as identity.
"""

from dataclasses import dataclass

REQUIRED_SCOPE = "photoprep/session"


@dataclass(frozen=True)
class Identity:
    sub: str
    scopes: frozenset[str]


def claims_from_event(event: dict | None) -> dict | None:
    request_context = (event or {}).get("requestContext") or {}
    jwt = (request_context.get("authorizer") or {}).get("jwt") or {}
    return jwt.get("claims") or None


def identity_from_claims(claims: dict | None) -> Identity | None:
    """Return the caller identity, or None when the claims are not acceptable.

    Only Cognito *access* tokens are accepted; ID tokens must not authenticate the API.
    """
    if not claims:
        return None
    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub:
        return None
    if claims.get("token_use") != "access":
        return None
    raw_scope = claims.get("scope", "")
    scopes = frozenset(raw_scope.split()) if isinstance(raw_scope, str) else frozenset()
    if REQUIRED_SCOPE not in scopes:
        return None
    return Identity(sub=sub, scopes=scopes)


def bearer_info(token, request) -> dict | None:  # noqa: ARG001
    """Connexion security function (named by the BEARERINFO_FUNC environment variable).

    Returning None makes Connexion answer 401. ``user`` handler argument becomes ``sub``.
    """
    identity = identity_from_claims(claims_from_event(request.scope.get("aws.event")))
    if identity is None:
        return None
    return {"sub": identity.sub, "scopes": sorted(identity.scopes)}
