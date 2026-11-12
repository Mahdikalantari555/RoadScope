"""Explicit versioned research contracts; no planned model masquerades as a fit."""
from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ..db import db_session
from ..services import research as r
from ..services.adaptive_tnkde import run_dataset_tnkde
from ..services.allocations import incident_distribution
from ..services.benchmarks import (
    compute_dataset_vgi_diagnostics,
    ingest_surrogate_observations,
    run_chronological_holdout_benchmark,
    summarize_surrogate_coverage,
)
from ..services.directed_topology import build_directed_lixel_topology
from ..services.hawkes_network import decluster_upstream_hawkes, simulate_upstream_hawkes
from ..services.length_spf import evaluate_dataset_length_eb

router = APIRouter(prefix="/api/v1/research", tags=["research"])

GATES = {
    "bym2": (
        "Validated posterior inference, component scaling and convergence diagnostics are not implemented.",
        "استنباط پسین، مقیاس‌بندی مؤلفه‌ها و تشخیص همگرایی معتبر هنوز پیاده‌سازی نشده است.",
    ),
    "surrogate_joint": (
        "Aggregate surrogate storage and descriptive exposure rates are active; bivariate Poisson-lognormal joint posterior inference remains gated.",
        "ذخیره‌سازی تجمیعی معیارهای جایگزین و نرخ‌های توصیفی فعال است؛ استنباط پسین مشترک دومتغیره پواسون-لگ‌نرمال هنوز دروازه‌بندی شده است.",
    ),
    "st_gnn": (
        "Exposure-aware longitudinal data and a validated multi-seed holdout protocol are required.",
        "داده‌های طولی مبتنی بر مواجهه و پروتکل اعتبارسنجی چندبذری لازم است.",
    ),
    "text_gnn": (
        "Consented narratives, license verification and privacy review are required; no text is sent externally.",
        "روایت‌های دارای رضایت، بررسی مجوز و ممیزی حریم خصوصی لازم است؛ هیچ متنی به بیرون ارسال نمی‌شود.",
    ),
    "joint_link_node": (
        "Node exposure observations and validated coupled junction-link inference are required.",
        "مشاهدات مواجهه گره‌ها و استنباط مشترک تقاطع-یال لازم است.",
    ),
    "inhomogeneous_second_order": (
        "Intensity-weighted null simulation and network boundary correction require validation.",
        "شبیه‌سازی فرض صفر وزن‌دار و تصحیح مرز شبکه نیازمند اعتبارسنجی است.",
    ),
}


def _active_dataset(conn: Any, requested: int | None = None) -> int:
    if requested is not None:
        if not conn.execute("SELECT 1 FROM dataset_sources WHERE id=?", (requested,)).fetchone():
            raise HTTPException(404, "Dataset not found.")
        return int(requested)
    row = conn.execute("SELECT id FROM dataset_sources ORDER BY is_active DESC, id DESC LIMIT 1").fetchone()
    if not row:
        raise HTTPException(404, "No dataset available.")
    return int(row[0])


def _store_research_run(
    conn: Any,
    *,
    dataset_id: int,
    method: str,
    params: dict[str, Any],
    inputs: dict[str, Any],
    result: dict[str, Any],
    limitations: str | None = None,
) -> dict[str, Any]:
    provenance = r.manifest(method, params, inputs)
    if limitations:
        provenance["limitations"] = limitations
    cursor = conn.execute(
        """INSERT INTO research_runs(contract_version, method, dataset_id, manifest_json, result_json)
           VALUES(?, ?, ?, ?, ?)""",
        (r.CONTRACT, method, dataset_id, json.dumps(provenance, sort_keys=True), json.dumps(result, sort_keys=True)),
    )
    return {"run_id": int(cursor.lastrowid), "manifest": provenance, "result": result}


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Initial(Strict):
    lixel_id: int
    direction: Literal[-1, 1] = 1
    mass: float = Field(ge=0)


class Diffusion(Strict):
    dataset_id: int | None = None
    method: Literal["directed_diffusion", "symmetric_heat"] = "directed_diffusion"
    initial: list[Initial] = Field(min_length=1, max_length=1000)
    duration_s: float = Field(default=1.0, ge=0.0, le=10000.0)
    rate_per_s: float = Field(default=1.0, ge=0.0, le=100.0)


class Pai(Strict):
    scores: list[float] = Field(min_length=1, max_length=20000)
    lengths_m: list[float] = Field(min_length=1, max_length=20000)
    counts: list[float] = Field(min_length=1, max_length=20000)
    fractions: list[float] | None = Field(default=None, max_length=1000)


class Eb(Strict):
    counts: list[float] = Field(min_length=1, max_length=20000)
    predicted: list[float] = Field(min_length=1, max_length=20000)
    length_km: list[float] = Field(min_length=1, max_length=20000)
    alpha_1: float = Field(gt=0)
    exposure_source: str = Field(default="segment_aadt", min_length=1, max_length=500)


class Decision(Strict):
    losses: list[list[float]] = Field(min_length=2, max_length=10000)
    actions: list[str] = Field(min_length=2, max_length=20)
    loss_unit: str = Field(default="EUR_equivalent", min_length=1, max_length=100)
    horizon_years: float = Field(default=1.0, gt=0)


class DatasetTnkdeRequest(Strict):
    dataset_id: int | None = None
    spatial_bandwidth_m: float = Field(default=180.0, ge=15.0, le=1500.0)
    temporal_bandwidth_days: float = Field(default=14.0, ge=0.25, le=180.0)
    slice_count: int = Field(default=12, ge=4, le=36)
    adaptive: bool = True
    clip_factor: float = Field(default=2.5, ge=1.0, le=10.0)
    causal: bool = False
    select_via_lcv: bool = True
    allocation_mode: Literal["hard", "fractional"] = "hard"
    include_unverified_vgi: bool = False


class FitLengthSpfRequest(Strict):
    dataset_id: int | None = None


class HawkesResearchRequest(Strict):
    dataset_id: int | None = None
    background_rate_per_hr: float = Field(default=0.8, ge=0.01, le=50.0)
    window_hr: float = Field(default=12.0, gt=0.1, le=168.0)
    branching_ratio: float = Field(default=0.35, ge=0.0, lt=1.0)
    temporal_decay_min: float = Field(default=25.0, gt=0.5, le=360.0)
    spatial_decay_m: float = Field(default=150.0, gt=5.0, le=2000.0)
    seed: int = 42
    run_em_declustering: bool = True


class BenchmarkResearchRequest(Strict):
    dataset_id: int | None = None
    train_fraction: float = Field(default=0.7, ge=0.3, le=0.9)
    nkde_bandwidth_m: float = Field(default=180.0, ge=20.0, le=1500.0)


class IpwRequest(Strict):
    observed: list[float] = Field(min_length=1, max_length=10000)
    exposure: list[float] = Field(min_length=1, max_length=10000)
    clip: float = Field(default=10.0, ge=1.0, le=100.0)


class SurrogateRecordInput(Strict):
    segment_id: int
    start_utc: str
    end_utc: str
    definition: Literal["hard_braking", "ittc_conflict", "post_encroachment_time", "speed_variance_event"]
    count: int = Field(ge=0)
    exposure: float = Field(gt=0)
    exposure_unit: str = Field(min_length=1, max_length=64)
    coverage_fraction: float = Field(default=1.0, gt=0.0, le=1.0)
    source: str = Field(min_length=1, max_length=128)
    privacy_provenance: str = Field(min_length=1, max_length=256)


class SurrogateIngestRequest(Strict):
    dataset_id: int | None = None
    records: list[SurrogateRecordInput] = Field(min_length=1, max_length=1000)


@router.get("/capabilities")
def capabilities() -> dict[str, Any]:
    from ..security import demo_enabled

    return {
        "contract": r.CONTRACT,
        "research_only": True,
        "synthetic_demo": demo_enabled(),
        "available": [
            "directed_diffusion",
            "symmetric_heat",
            "spatiotemporal_adaptive_tnkde",
            "pai_curve",
            "length_eb",
            "fit_length_spf",
            "evpi",
            "incident_allocations",
            "vgi_diagnostics",
            "stabilized_ipw",
            "upstream_hawkes_simulation_and_declustering",
            "surrogate_aggregate_ingestion",
            "chronological_holdout_benchmark",
        ],
        "primitives_only": [
            "fixed_tnkde",
            "trajectory_hmm",
            "network_voronoi",
            "hawkes_simulation",
        ],
        "unavailable": {key: {"reason": {"en": value[0], "fa": value[1]}} for key, value in GATES.items()},
    }


@router.post("/diffusion")
def diffusion(req: Diffusion) -> dict[str, Any]:
    try:
        with db_session() as conn:
            dataset_id = _active_dataset(conn, req.dataset_id)
            graph, topology = r.directed_lixel_graph(conn, dataset_id)
            initial: dict[tuple[int, int], float] = {}
            for item in req.initial:
                key = (item.lixel_id, item.direction)
                initial[key] = initial.get(key, 0.0) + item.mass
            mass, diagnostics = r.diffuse(
                graph,
                initial,
                req.duration_s,
                req.rate_per_s,
                req.method == "symmetric_heat",
            )
            result = {
                "states": [{"lixel_id": k[0], "direction": k[1], "mass": v} for k, v in mass.items()],
                "diagnostics": diagnostics,
            }
            provenance = r.manifest(
                req.method,
                req.model_dump(),
                {"topology": topology, "initial": req.model_dump()["initial"]},
            )
            provenance["topology_sha256"] = topology
            provenance["limitations"] = "Finite-state mass operator; not a continuous metric-graph PDE. Legacy NKDE is unchanged."
            cursor = conn.execute(
                "INSERT INTO research_runs(contract_version,method,dataset_id,manifest_json,result_json) VALUES(?,?,?,?,?)",
                (r.CONTRACT, req.method, dataset_id, json.dumps(provenance), json.dumps(result)),
            )
            return {"run_id": int(cursor.lastrowid), "manifest": provenance, "result": result}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/tnkde")
def run_tnkde_endpoint(req: DatasetTnkdeRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            dataset_id = _active_dataset(conn, req.dataset_id)
            result = run_dataset_tnkde(
                conn,
                dataset_id=dataset_id,
                spatial_bandwidth_m=req.spatial_bandwidth_m,
                temporal_bandwidth_days=req.temporal_bandwidth_days,
                slice_count=req.slice_count,
                adaptive=req.adaptive,
                clip_factor=req.clip_factor,
                causal=req.causal,
                select_via_lcv=req.select_via_lcv,
                allocation_mode=req.allocation_mode,
                include_unverified_vgi=req.include_unverified_vgi,
            )
            compact = {k: v for k, v in result.items() if k not in ("layer_geojson", "slice_lixel_km_day")}
            stored = _store_research_run(
                conn,
                dataset_id=dataset_id,
                method="spatiotemporal_adaptive_tnkde",
                params=req.model_dump(),
                inputs={"dataset_id": dataset_id, "sample_size": result["sample_size"]},
                result=compact,
                limitations="Separable network-temporal product kernel with bounded Abramson pilot scaling.",
            )
            return {**stored, "result": result}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/fit-length-spf")
def fit_length_spf_endpoint(req: FitLengthSpfRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            dataset_id = _active_dataset(conn, req.dataset_id)
            result = evaluate_dataset_length_eb(conn, dataset_id)
            return _store_research_run(
                conn,
                dataset_id=dataset_id,
                method="fit_length_spf",
                params=req.model_dump(),
                inputs={"dataset_id": dataset_id, "segments": len(result["segment_ids"])},
                result=result,
                limitations=result.get("limitations"),
            )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/hawkes")
def run_hawkes_endpoint(req: HawkesResearchRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            dataset_id = _active_dataset(conn, req.dataset_id)
            topo = build_directed_lixel_topology(conn, dataset_id)
            sim = simulate_upstream_hawkes(
                topo.graph,
                background_rate_per_hr=req.background_rate_per_hr,
                window_hr=req.window_hr,
                branching_ratio=req.branching_ratio,
                temporal_decay_min=req.temporal_decay_min,
                spatial_decay_m=req.spatial_decay_m,
                seed=req.seed,
            )
            declust = (
                decluster_upstream_hawkes(
                    topo.graph,
                    sim["events"],
                    window_s=req.window_hr * 3600.0,
                    temporal_decay_s=req.temporal_decay_min * 60.0,
                    spatial_decay_m=req.spatial_decay_m,
                )
                if req.run_em_declustering
                else None
            )
            result = {"topology_version": topo.version, "simulation": sim, "declustering": declust}
            return _store_research_run(
                conn,
                dataset_id=dataset_id,
                method="upstream_hawkes",
                params=req.model_dump(),
                inputs={"dataset_id": dataset_id, "topology_version": topo.version, "seed": req.seed},
                result=result,
                limitations="Research-only upstream excitation model; probabilistic declustering is not causal proof.",
            )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/benchmark")
def run_benchmark_endpoint(req: BenchmarkResearchRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            dataset_id = _active_dataset(conn, req.dataset_id)
            result = run_chronological_holdout_benchmark(
                conn,
                dataset_id=dataset_id,
                train_fraction=req.train_fraction,
                nkde_bandwidth_m=req.nkde_bandwidth_m,
            )
            return _store_research_run(
                conn,
                dataset_id=dataset_id,
                method="chronological_holdout_benchmark",
                params=req.model_dump(),
                inputs={"dataset_id": dataset_id, "train_events": result["train_events"], "holdout_events": result["holdout_events"]},
                result=result,
                limitations="Single-dataset chronological holdout evaluation without unobserved covariate adjustment.",
            )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/ipw")
def run_ipw_endpoint(req: IpwRequest) -> dict[str, Any]:
    try:
        return r.stabilized_ipw(req.observed, req.exposure, clip=req.clip)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/vgi-diagnostics")
def get_vgi_diagnostics(dataset_id: int | None = None) -> dict[str, Any]:
    with db_session() as conn:
        ds_id = _active_dataset(conn, dataset_id)
        return compute_dataset_vgi_diagnostics(conn, ds_id)


@router.post("/surrogates")
def ingest_surrogates_endpoint(req: SurrogateIngestRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            ds_id = _active_dataset(conn, req.dataset_id)
            return ingest_surrogate_observations(
                conn,
                dataset_id=ds_id,
                records=[rec.model_dump() for rec in req.records],
            )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/surrogates")
def get_surrogates_endpoint(dataset_id: int | None = None) -> dict[str, Any]:
    with db_session() as conn:
        ds_id = _active_dataset(conn, dataset_id)
        return summarize_surrogate_coverage(conn, ds_id)


@router.get("/runs/{run_id}")
def run_export(run_id: int) -> dict[str, Any]:
    with db_session() as conn:
        row = conn.execute("SELECT * FROM research_runs WHERE id=?", (run_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Research run not found.")
        return {
            "run_id": int(row["id"]),
            "manifest": json.loads(row["manifest_json"]),
            "result": json.loads(row["result_json"]),
        }


@router.post("/pai")
def pai(req: Pai) -> dict[str, Any]:
    try:
        return r.pai_curve(req.scores, req.lengths_m, req.counts, req.fractions)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/length-eb")
def eb(req: Eb) -> dict[str, Any]:
    try:
        return {
            **r.length_eb(req.counts, req.predicted, req.length_km, req.alpha_1),
            "exposure_source": req.exposure_source,
        }
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/evpi")
def decision(req: Decision) -> dict[str, Any]:
    try:
        if any(len(row) != len(req.actions) for row in req.losses):
            raise ValueError("Every draw must specify loss for every action, including costs.")
        return {
            **r.evpi(req.losses),
            "actions": req.actions,
            "loss_unit": req.loss_unit,
            "horizon_years": req.horizon_years,
            "assumption": "User-supplied posterior losses; not inferred from MCDA scores.",
        }
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/incidents/{accident_id}/allocations")
@router.post("/incidents/{accident_id}/allocations")
def incident_allocations(accident_id: int) -> dict[str, Any]:
    try:
        with db_session() as conn:
            return incident_distribution(conn, accident_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
