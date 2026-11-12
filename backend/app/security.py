"""Server-owned bearer identities; role/persona fields are compatibility hints only."""
from __future__ import annotations
import hmac
import json
import os
import time
from collections import defaultdict, deque
from contextvars import ContextVar
from dataclasses import dataclass
from fastapi import Request
from fastapi.responses import JSONResponse
from .db import db_session

@dataclass(frozen=True)
class Identity:
    user_id: int | None
    role: str

identity: ContextVar[Identity | None] = ContextVar('identity', default=None)
READ_POSTS = {'/api/v1/crs/project', '/api/v1/vgi/preview-snap-and-conflate',
              '/api/v1/analytics/cmv', '/api/v1/risk/evaluate'}


def demo_enabled() -> bool:
    return os.getenv('ROADSCOPE_DEMO_MODE', 'false').lower() == 'true'


def install_security(app):
    attempts = defaultdict(deque)

    @app.middleware('http')
    async def authorize(request: Request, call_next):
        path = request.url.path
        principal = None
        if path.startswith('/api/v1'):
            if demo_enabled():
                with db_session() as conn:
                    if conn.execute('SELECT 1 FROM dataset_sources WHERE is_synthetic = 0 LIMIT 1').fetchone():
                        return JSONResponse({'detail': 'Demo mode refuses non-synthetic datasets.'}, status_code=503)
                principal = Identity(None, 'data_steward')
            else:
                bearer = request.headers.get('authorization', '').removeprefix('Bearer ')
                for token, username in json.loads(os.getenv('ROADSCOPE_API_TOKENS', '{}')).items():
                    if bearer and hmac.compare_digest(bearer, token):
                        with db_session() as conn:
                            user = conn.execute('SELECT id, role FROM users WHERE username=?', (username,)).fetchone()
                        if user:
                            principal = Identity(user['id'], user['role'])
                        break
            mutation = request.method not in {'GET', 'HEAD', 'OPTIONS'} and path not in READ_POSTS
            if mutation:
                if principal is None:
                    return JSONResponse({'detail': 'Authentication required.'}, status_code=401)
                role = principal.role
                allowed = True
                if '/steward/' in path:
                    allowed = role == 'data_steward'
                elif '/simulator/' in path or '/datasets/' in path:
                    allowed = role in {'simulation_scientist', 'data_steward'}
                elif '/lab/' in path or '/research/' in path:
                    allowed = role in {'gis_researcher', 'safety_engineer', 'data_steward'}
                if not allowed:
                    return JSONResponse({'detail': 'Insufficient server-side role.'}, status_code=403)
                key = principal.user_id
                now = time.monotonic()
                q = attempts[key]
                while q and q[0] < now - 60:
                    q.popleft()
                if len(q) >= 30:
                    return JSONResponse({'detail': 'Mutation rate limit exceeded.'}, status_code=429)
                q.append(now)
        marker = identity.set(principal)
        try:
            response = await call_next(request)
            response.headers['X-RoadScope-Mode'] = 'synthetic-demo' if demo_enabled() else 'authenticated'
            return response
        finally:
            identity.reset(marker)
