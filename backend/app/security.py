"""Server-owned bearer identities; role/persona fields are compatibility hints only."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
from contextvars import ContextVar
from dataclasses import dataclass

from fastapi import Request
from fastapi.responses import JSONResponse

from .db import db_session


@dataclass(frozen=True)
class Identity:
    user_id: int | None
    role: str


identity: ContextVar[Identity | None] = ContextVar("identity", default=None)

# Demo identity is intentionally powerful, so never allow it to see real incident datasets.
# Network import and study-area mutations are disabled until isolated profiles are supported.


READ_POSTS = {
    "/api/v1/crs/project",
    "/api/v1/vgi/preview-snap-and-conflate",
    "/api/v1/analytics/cmv",
    "/api/v1/risk/evaluate",
    "/api/v1/network/directed-transport",
    # Tracking is a read: it returns the reporter's own coarse status and is rate limited.
    "/api/v1/pilot/tracking",
}

# Anonymous reads that must remain reachable even when real (non-synthetic) data exists. They
# expose aggregates only, never individual reports, and each returns nothing while the relevant
# publication flag is disabled.
PUBLIC_READ_PATHS = {
    "/api/v1/health",
    "/api/v1/tehran-preview",
    "/api/v1/pilot/aggregates",
    "/api/v1/pilot/status",
    "/api/v1/pilot/threat-model",
    # Sanitized bootstrap for a pilot participant: framing, categories and the published
    # disclosure only. It never includes reports, coordinates or candidate lists.
    "/api/v1/pilot/bootstrap",
}

# Routes that a pilot participant (not a steward) must be able to call. Ownership for these is
# proven inside the handler (consent + unguessable credential), never by a client-supplied role.
REPORTER_POSTS = {
    "/api/v1/pilot/reports",
    "/api/v1/pilot/tracking",
}

# Paths whose `{id}` segment is chosen by the caller, so an exact-match set cannot cover them.
# Ownership is still proven inside the handler (tracking credential, or a steward).
REPORTER_POST_PATTERNS = (
    re.compile(r"^/api/v1/pilot/reports/[^/]+/withdraw-consent$"),
)


def _is_reporter_post(path: str) -> bool:
    """True when a pilot participant (not only a steward) may call this POST.

    Consent withdrawal is a reporter's *right*, not a steward's privilege: if this check misses a
    path, the reporter is told "Insufficient server-side role" and cannot withdraw. The handler
    still requires the per-report credential, and the credential is verified before anything is
    deleted or hidden.
    """
    return path in REPORTER_POSTS or any(p.match(path) for p in REPORTER_POST_PATTERNS)

STEWARD_ONLY_PREFIXES = (
    "/api/v1/ingest/",
    "/api/v1/study-areas",
    "/api/v1/pilot/configuration",
    "/api/v1/pilot/moderation",
    "/api/v1/pilot/corrections",
    "/api/v1/pilot/publication",
    "/api/v1/pilot/retention",
    "/api/v1/pilot/flags",
)


def demo_enabled() -> bool:
    return os.getenv("ROADSCOPE_DEMO_MODE", "false").lower() == "true"


def install_security(app) -> None:
    @app.middleware("http")
    async def authorize(request: Request, call_next):
        path = request.url.path
        principal: Identity | None = None
        if path.startswith("/api/v1"):
            if demo_enabled():
                with db_session() as conn:
                    real_dataset = conn.execute(
                        "SELECT 1 FROM dataset_sources WHERE is_synthetic = 0 LIMIT 1"
                    ).fetchone()
                if real_dataset:
                    return JSONResponse(
                        {"detail": "Demo mode refuses non-synthetic datasets."}, status_code=503
                    )
                # Network/study-area administration stays disabled in demo mode; so does every
                # real-pilot mutation (intake, moderation, publication, flags, retention).
                if request.method not in {"GET", "HEAD", "OPTIONS"} and (
                    path.startswith("/api/v1/ingest/")
                    or path.startswith("/api/v1/study-areas")
                    or path.startswith("/api/v1/pilot/")
                ):
                    return JSONResponse(
                        {
                            "detail": (
                                "Network administration and real pilot operations are disabled "
                                "in synthetic demo mode."
                            )
                        },
                        status_code=403,
                    )
                principal = Identity(None, "data_steward")
            else:
                bearer = request.headers.get("authorization", "").removeprefix("Bearer ")
                try:
                    token_map = json.loads(os.getenv("ROADSCOPE_API_TOKENS", "{}"))
                except json.JSONDecodeError:
                    token_map = {}
                if isinstance(token_map, dict):
                    for token, username in token_map.items():
                        if bearer and hmac.compare_digest(bearer, str(token)):
                            with db_session() as conn:
                                user = conn.execute(
                                    "SELECT id, role FROM users WHERE username=?",
                                    (str(username),),
                                ).fetchone()
                            if user:
                                principal = Identity(int(user["id"]), str(user["role"]))
                            break
                # Until real-data disclosure policy and per-route authorization are approved,
                # isolate the entire instance as soon as any real incident dataset exists.
                # This deliberately includes GETs, exports and read-only POSTs; query parameters
                # cannot be trusted to identify every dataset touched by an endpoint.
                if request.method != "OPTIONS":
                    with db_session() as conn:
                        real_dataset = conn.execute(
                            "SELECT 1 FROM dataset_sources WHERE is_synthetic = 0 LIMIT 1"
                        ).fetchone()
                    if real_dataset and path not in PUBLIC_READ_PATHS:
                        if principal is None:
                            return JSONResponse({"detail": "Authentication required."}, status_code=401)
                        if principal.role != "data_steward" and not _is_reporter_post(path):
                            return JSONResponse(
                                {"detail": "Insufficient server-side role."}, status_code=403
                            )
            mutation = request.method not in {"GET", "HEAD", "OPTIONS"} and path not in READ_POSTS
            if mutation and not path.startswith("/api/v1/pilot/"):
                if principal is None:
                    return JSONResponse({"detail": "Authentication required."}, status_code=401)
                role = principal.role
                allowed = True
                if path.startswith(STEWARD_ONLY_PREFIXES):
                    allowed = role == "data_steward"
                elif "/steward/" in path:
                    allowed = role == "data_steward"
                elif "/simulator/" in path or "/datasets/" in path:
                    allowed = role in {"simulation_scientist", "data_steward"}
                elif "/lab/" in path or "/research/" in path:
                    allowed = role in {
                        "gis_researcher",
                        "safety_engineer",
                        "data_steward",
                        "simulation_scientist",
                    }
                if not allowed:
                    return JSONResponse({"detail": "Insufficient server-side role."}, status_code=403)
                # Distributed-safe limit: a database window shared by all worker processes.
                if not demo_enabled() and principal.user_id is not None:
                    from .config import RATE_LIMIT_MUTATIONS_PER_MINUTE
                    from .services.pilot import consume_rate_limit

                    with db_session() as conn:
                        limit = consume_rate_limit(
                            conn,
                            bucket="mutations_minute",
                            limit=RATE_LIMIT_MUTATIONS_PER_MINUTE,
                            window_seconds=60,
                            identity_hint=str(principal.user_id),
                        )
                    if not limit["allowed"]:
                        return JSONResponse(
                            {
                                "detail": "Mutation rate limit exceeded.",
                                "retry_after_seconds": limit["retry_after_seconds"],
                            },
                            status_code=429,
                        )
            # Pilot mutations and reporter POSTs enforce authorization inside each handler so
            # ownership (consent + credential) and steward roles are checked against the database,
            # never against a client-supplied persona field.
            _ = hashlib  # documentation-only import keep: hashing lives in the services layer
        marker = identity.set(principal)
        try:
            response = await call_next(request)
            response.headers["X-RoadScope-Mode"] = "synthetic-demo" if demo_enabled() else "authenticated"
            return response
        finally:
            identity.reset(marker)
