"""Server-owned bearer identities; role/persona fields are compatibility hints only."""
from __future__ import annotations

from collections import defaultdict, deque
from contextvars import ContextVar
from dataclasses import dataclass
import hmac
import json
import os
import time

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
}


def demo_enabled() -> bool:
    return os.getenv("ROADSCOPE_DEMO_MODE", "false").lower() == "true"


def install_security(app) -> None:
    attempts: dict[int | None, deque[float]] = defaultdict(deque)

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
                if request.method not in {"GET", "HEAD", "OPTIONS"} and (
                    path.startswith("/api/v1/ingest/") or path.startswith("/api/v1/study-areas")
                ):
                    return JSONResponse({"detail": "Network administration is disabled in demo mode."}, status_code=403)
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
                    if real_dataset:
                        if principal is None:
                            return JSONResponse({"detail": "Authentication required."}, status_code=401)
                        if principal.role != "data_steward":
                            return JSONResponse({"detail": "Insufficient server-side role."}, status_code=403)
            mutation = request.method not in {"GET", "HEAD", "OPTIONS"} and path not in READ_POSTS
            if mutation:
                if principal is None:
                    return JSONResponse({"detail": "Authentication required."}, status_code=401)
                role = principal.role
                allowed = True
                if path.startswith(("/api/v1/ingest/", "/api/v1/study-areas")):
                    allowed = role == "data_steward"
                elif "/steward/" in path:
                    allowed = role == "data_steward"
                elif "/simulator/" in path or "/datasets/" in path:
                    allowed = role in {"simulation_scientist", "data_steward"}
                elif "/lab/" in path or "/research/" in path:
                    allowed = role in {"gis_researcher", "safety_engineer", "data_steward", "simulation_scientist"}
                if not allowed:
                    return JSONResponse({"detail": "Insufficient server-side role."}, status_code=403)
                key = principal.user_id
                now = time.monotonic()
                q = attempts[key]
                while q and q[0] < now - 60:
                    q.popleft()
                if len(q) >= 30:
                    return JSONResponse({"detail": "Mutation rate limit exceeded."}, status_code=429)
                q.append(now)
        marker = identity.set(principal)
        try:
            response = await call_next(request)
            response.headers["X-RoadScope-Mode"] = "synthetic-demo" if demo_enabled() else "authenticated"
            return response
        finally:
            identity.reset(marker)
