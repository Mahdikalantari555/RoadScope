from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api.routes import router as api_router
from .config import DEFAULT_SEED, FRONTEND_DIST_DIR
from .db import db_session, init_schema_and_reference_data
from .services.point_process_sim import run_stochastic_network_simulation


def ensure_initialized() -> None:
    init_schema_and_reference_data()
    with db_session() as conn:
        cnt = conn.execute("SELECT COUNT(*) AS c FROM dataset_sources").fetchone()["c"]
        if int(cnt) == 0:
            run_stochastic_network_simulation(
                conn,
                scenario_key="MULTI_COVARIATE_URBAN",
                lixel_resolution_m=25.0,
                random_seed=DEFAULT_SEED,
                base_intensity_scale=1.0,
                vgi_positional_sigma_m=14.0,
                vgi_duplicate_rate=0.35,
                vgi_false_alarm_count=12,
                study_period_years=1.0,
                activate_dataset=True,
                actor_role="simulation_scientist",
            )


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    ensure_initialized()
    yield


app = FastAPI(
    title="Urban Accident Intelligence (UAI) Geocomputational Platform",
    description="Network-Constrained Spatiotemporal Road Accident Analysis, VGI Conflation & Empirical Bayes Safety Engine",
    version="1.0.0",
    docs_url="/api/v1/docs",
    openapi_url="/api/v1/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


if FRONTEND_DIST_DIR.exists():
    assets_dir = FRONTEND_DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str) -> FileResponse:
        candidate: Path = (FRONTEND_DIST_DIR / full_path).resolve()
        if full_path and candidate.is_file() and str(candidate).startswith(str(FRONTEND_DIST_DIR.resolve())):
            return FileResponse(str(candidate))
        return FileResponse(str(FRONTEND_DIST_DIR / "index.html"))
