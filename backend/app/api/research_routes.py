"""Explicit versioned research contracts; no planned model masquerades as a fit."""
from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ..db import db_session
from ..services import research as r
from ..services.adaptive_tnkde import run_dataset_tnkde
from ..services.advanced_network import (
    run_dataset_inhomogeneous_k,
    run_maup_multiseed_sensitivity_benchmark,
    run_text_enhanced_ablation_experiment,
    run_zinb_st_graph_benchmark,
)
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
from ..services.spatial_bayes import (
    fit_joint_link_node_research_model,
    run_dataset_bym2_and_vgi_imputation,
)
from ..services.surrogate_bivariate import run_dataset_surrogate_joint_fusion

router = APIRouter(prefix="/api/v1/research", tags=["research"])

GATES = {
    "external_cloud_llm_narratives": (
        "Transmitting witness narratives to external cloud LLMs is permanently disabled; only opt-in local PII-scrubbed embeddings are permitted.",
        "ارسال روایت‌های شاهدان به سرویس‌های هوش مصنوعی ابری بیرونی به‌طور دائمی مسدود است؛ صرفاً استخراج ویژگی محلی پس از حذف اطلاعات هویتی و با تأیید رضایت مجاز است.",
    ),
    "uncalibrated_operational_deployment": (
        "Synthetic benchmark models are research decision-support prototypes and cannot be used as standalone legal or automated enforcement evidence without empirical field calibration.",
        "مدل‌های بنچمارک مصنوعی صرفاً نمونهٔ پژوهشی پشتیبان تصمیم هستند و بدون کالیبراسیون میدانی داده‌های واقعی نباید مبنای تصمیم‌گیری خودکار یا حقوقی قرار گیرند.",
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


class Bym2ResearchRequest(Strict):
    dataset_id: int | None = None
    include_unverified_vgi: bool = True
    imputations_m: int = Field(default=12, ge=2, le=50)
    chains: int = Field(default=4, ge=2, le=8)
    draws_per_chain: int = Field(default=180, ge=60, le=600)
    random_seed: int = 42


class JointLinkNodeRequest(Strict):
    dataset_id: int | None = None
    junction_buffer_m: float = Field(default=22.0, ge=5.0, le=80.0)
    chains: int = Field(default=4, ge=2, le=8)
    draws_per_chain: int = Field(default=160, ge=60, le=500)
    random_seed: int = 42


class SurrogateJointRequest(Strict):
    dataset_id: int | None = None
    seed_synthetic_if_empty: bool = True
    sensor_coverage_prob: float = Field(default=0.68, ge=0.1, le=1.0)
    true_correlation_rho: float = Field(default=0.78, ge=-0.95, le=0.95)
    random_seed: int = 42


class NetworkKRequest(Strict):
    dataset_id: int | None = None
    max_radius_m: float = Field(default=350.0, ge=50.0, le=1500.0)
    n_radii: int = Field(default=10, ge=4, le=30)
    n_simulations: int = Field(default=39, ge=9, le=199)
    random_seed: int = 42


class VoronoiRequest(Strict):
    dataset_id: int | None = None


class TrajectoryHmmRequest(Strict):
    dataset_id: int | None = None
    fixes: list[dict[int, float]] | None = None
    synthetic_steps: int = Field(default=5, ge=1, le=20)
    transition_scale_m: float = Field(default=100.0, gt=5.0, le=2000.0)
    random_seed: int = 42


class StGraphRequest(Strict):
    dataset_id: int | None = None
    n_periods: int = Field(default=8, ge=4, le=24)
    seeds: list[int] = Field(default_factory=lambda: [11, 29, 47], min_length=1, max_length=10)


class TextAblationRequest(Strict):
    dataset_id: int | None = None
    consent_verified: bool = False
    random_seed: int = 42


class MaupSensitivityRequest(Strict):
    dataset_id: int | None = None
    resolutions_m: list[float] = Field(default_factory=lambda: [10.0, 25.0, 50.0], min_length=2, max_length=6)
    seeds: list[int] = Field(default_factory=lambda: [17, 42, 89, 137], min_length=2, max_length=12)
    bandwidth_m: float = Field(default=175.0, ge=30.0, le=800.0)


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
            "bym2_spatial_mcmc_and_vgi_mi",
            "joint_link_node_bym2",
            "evpi",
            "incident_allocations",
            "vgi_diagnostics",
            "stabilized_ipw",
            "upstream_hawkes_simulation_and_declustering",
            "surrogate_aggregate_ingestion",
            "surrogate_bivariate_poisson_lognormal",
            "inhomogeneous_network_k_envelopes",
            "network_voronoi_intensity",
            "trajectory_viterbi_hmm",
            "zinb_spatiotemporal_graph_benchmark",
            "privacy_scrubbed_text_ablation",
            "chronological_holdout_benchmark",
            "maup_multiseed_resolution_sensitivity",
        ],
        "primitives_only": [
            "fixed_tnkde",
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


@router.post("/bym2")
def run_bym2_endpoint(req: Bym2ResearchRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            ds_id = _active_dataset(conn, req.dataset_id)
            result = run_dataset_bym2_and_vgi_imputation(
                conn,
                dataset_id=ds_id,
                include_unverified_vgi=req.include_unverified_vgi,
                imputations_m=req.imputations_m,
                chains=req.chains,
                draws_per_chain=req.draws_per_chain,
                random_seed=req.random_seed,
            )
            return _store_research_run(
                conn,
                dataset_id=ds_id,
                method="bym2_spatial_mcmc_and_vgi_mi",
                params=req.model_dump(),
                inputs={"dataset_id": ds_id, "random_seed": req.random_seed},
                result=result,
                limitations=result["limitations"],
            )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/joint-link-node")
def run_joint_link_node_endpoint(req: JointLinkNodeRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            ds_id = _active_dataset(conn, req.dataset_id)
            result = fit_joint_link_node_research_model(
                conn,
                dataset_id=ds_id,
                junction_buffer_m=req.junction_buffer_m,
                chains=req.chains,
                draws_per_chain=req.draws_per_chain,
                random_seed=req.random_seed,
            )
            return _store_research_run(
                conn,
                dataset_id=ds_id,
                method="joint_link_node_bym2",
                params=req.model_dump(),
                inputs={"dataset_id": ds_id, "links": result["link_count"], "nodes": result["node_count"]},
                result=result,
                limitations=result["limitations"],
            )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/surrogate-joint")
def run_surrogate_joint_endpoint(req: SurrogateJointRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            ds_id = _active_dataset(conn, req.dataset_id)
            result = run_dataset_surrogate_joint_fusion(
                conn,
                dataset_id=ds_id,
                seed_synthetic_if_empty=req.seed_synthetic_if_empty,
                sensor_coverage_prob=req.sensor_coverage_prob,
                true_correlation_rho=req.true_correlation_rho,
                random_seed=req.random_seed,
            )
            return _store_research_run(
                conn,
                dataset_id=ds_id,
                method="surrogate_bivariate_poisson_lognormal",
                params=req.model_dump(),
                inputs={"dataset_id": ds_id, "source_mode": result.get("source_mode")},
                result=result,
                limitations="Associative shared latent correlation; aggregate 60+ min buckets only.",
            )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/network-k")
def run_network_k_endpoint(req: NetworkKRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            ds_id = _active_dataset(conn, req.dataset_id)
            result = run_dataset_inhomogeneous_k(
                conn,
                dataset_id=ds_id,
                max_radius_m=req.max_radius_m,
                n_radii=req.n_radii,
                n_simulations=req.n_simulations,
                random_seed=req.random_seed,
            )
            return _store_research_run(
                conn,
                dataset_id=ds_id,
                method="inhomogeneous_network_k_envelopes",
                params=req.model_dump(),
                inputs={"dataset_id": ds_id, "events": result.get("event_count")},
                result=result,
                limitations="First-order pilot intensity estimated from exposure; interpret envelopes conditional on pilot model.",
            )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/voronoi")
def run_voronoi_endpoint(req: VoronoiRequest) -> dict[str, Any]:
    import networkx as nx

    try:
        with db_session() as conn:
            ds_id = _active_dataset(conn, req.dataset_id)
            topo = build_directed_lixel_topology(conn, ds_id)
            ug = nx.Graph()
            for state, attrs in topo.graph.nodes(data=True):
                lx_id = int(attrs["lixel_id"])
                if lx_id not in ug:
                    ug.add_node(lx_id, length_m=float(attrs["length_m"]))
            for u_st, v_st, edata in topo.graph.edges(data=True):
                u_lx = int(topo.graph.nodes[u_st]["lixel_id"])
                v_lx = int(topo.graph.nodes[v_st]["lixel_id"])
                if u_lx != v_lx:
                    w = float(edata.get("weight_m", edata.get("distance_m", 10.0)))
                    if not ug.has_edge(u_lx, v_lx) or w < ug[u_lx][v_lx]["distance_m"]:
                        ug.add_edge(u_lx, v_lx, distance_m=w)

            inc_rows = conn.execute(
                """SELECT DISTINCT snapped_lixel_id FROM accidents
                   WHERE dataset_id = ? AND verification_status = 'verified_canonical'
                     AND snapped_lixel_id IS NOT NULL LIMIT 400""",
                (ds_id,),
            ).fetchall()
            ev_nodes = [int(x[0]) for x in inc_rows if int(x[0]) in ug]
            intensities = r.network_voronoi(ug, ev_nodes) if ev_nodes else {int(n): None for n in ug.nodes()}
            valid_vals = [v * 1000.0 for v in intensities.values() if v is not None]
            result = {
                "event_seeds": len(ev_nodes),
                "lixel_count": ug.number_of_nodes(),
                "supported_lixels": len(valid_vals),
                "disconnected_empty_lixels": sum(1 for v in intensities.values() if v is None),
                "max_voronoi_per_km": round(max(valid_vals), 4) if valid_vals else 0.0,
                "median_voronoi_per_km": round(float(sum(sorted(valid_vals)[len(valid_vals)//2:len(valid_vals)//2+1])), 4) if valid_vals else 0.0,
            }
            return _store_research_run(
                conn,
                dataset_id=ds_id,
                method="network_voronoi_intensity",
                params=req.model_dump(),
                inputs={"dataset_id": ds_id, "seeds": len(ev_nodes)},
                result=result,
                limitations="Non-parametric 1/cell_length estimator; high variance in sparse corridors.",
            )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/trajectory-hmm")
def run_trajectory_hmm_endpoint(req: TrajectoryHmmRequest) -> dict[str, Any]:
    import networkx as nx
    import numpy as np

    try:
        with db_session() as conn:
            ds_id = _active_dataset(conn, req.dataset_id)
            topo = build_directed_lixel_topology(conn, ds_id)
            dg = nx.DiGraph()
            for state, attrs in topo.graph.nodes(data=True):
                label = f"{state[0]}:{state[1]}:{'+' if state[2] >= 0 else '-'}"
                dg.add_node(label, length_m=float(attrs["length_m"]), lixel_id=int(attrs["lixel_id"]))
            for u_st, v_st, edata in topo.graph.edges(data=True):
                u_lbl = f"{u_st[0]}:{u_st[1]}:{'+' if u_st[2] >= 0 else '-'}"
                v_lbl = f"{v_st[0]}:{v_st[1]}:{'+' if v_st[2] >= 0 else '-'}"
                dg.add_edge(u_lbl, v_lbl, distance_m=float(edata.get("weight_m", 10.0)))

            if req.fixes is not None:
                emissions = [{str(k): float(v) for k, v in step.items()} for step in req.fixes]
                true_walk = None
            else:
                if req.synthetic_steps < 2:
                    raise ValueError("Trajectory HMM requires at least two fixes; use single-fix matching.")
                rng = np.random.default_rng(req.random_seed)
                nodes = sorted(dg.nodes())
                walk: list[str] = []
                for idx_start in rng.permutation(len(nodes)):
                    cur = nodes[int(idx_start)]
                    candidate_walk = [cur]
                    for _ in range(req.synthetic_steps - 1):
                        succs = sorted(dg.successors(cur))
                        if not succs:
                            break
                        cur = succs[int(rng.integers(len(succs)))]
                        candidate_walk.append(cur)
                    if len(candidate_walk) == req.synthetic_steps:
                        walk = candidate_walk
                        break
                if len(walk) < 2:
                    raise ValueError("Could not sample a multi-step legal trajectory on this graph.")
                true_walk = walk
                emissions = []
                for true_st in walk:
                    distractor = nodes[int(rng.integers(len(nodes)))]
                    step_em = {true_st: 0.72}
                    if distractor != true_st:
                        step_em[distractor] = 0.28
                    emissions.append(step_em)

            matched = r.trajectory_hmm(dg, emissions, transition_scale_m=req.transition_scale_m)
            exact_acc = (
                round(sum(int(a == b) for a, b in zip(matched["path"], true_walk)) / len(true_walk), 4)
                if true_walk
                else None
            )
            result = {
                **matched,
                "fix_count": len(emissions),
                "synthetic_ground_truth_path": true_walk,
                "exact_state_recovery_rate": exact_acc,
            }
            return _store_research_run(
                conn,
                dataset_id=ds_id,
                method="trajectory_viterbi_hmm",
                params={"synthetic_steps": req.synthetic_steps, "transition_scale_m": req.transition_scale_m},
                inputs={"dataset_id": ds_id, "fixes": len(emissions)},
                result=result,
                limitations=matched["limitation"],
            )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/st-graph")
def run_st_graph_endpoint(req: StGraphRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            ds_id = _active_dataset(conn, req.dataset_id)
            result = run_zinb_st_graph_benchmark(
                conn,
                dataset_id=ds_id,
                n_periods=req.n_periods,
                seeds=req.seeds,
            )
            return _store_research_run(
                conn,
                dataset_id=ds_id,
                method="zinb_spatiotemporal_graph_benchmark",
                params=req.model_dump(),
                inputs={"dataset_id": ds_id, "periods": req.n_periods},
                result=result,
                limitations=result.get("negative_result_note") or "Chronological panel benchmark on urban road graph.",
            )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/text-ablation")
def run_text_ablation_endpoint(req: TextAblationRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            ds_id = _active_dataset(conn, req.dataset_id)
            result = run_text_enhanced_ablation_experiment(
                conn,
                dataset_id=ds_id,
                consent_verified=req.consent_verified,
                random_seed=req.random_seed,
            )
            return _store_research_run(
                conn,
                dataset_id=ds_id,
                method="privacy_scrubbed_text_ablation",
                params=req.model_dump(),
                inputs={"dataset_id": ds_id, "consent_verified": req.consent_verified},
                result=result,
                limitations="Strictly offline hashed n-gram SVD embedding after regex PII redaction.",
            )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/maup-sensitivity")
def run_maup_sensitivity_endpoint(req: MaupSensitivityRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            ds_id = _active_dataset(conn, req.dataset_id)
            result = run_maup_multiseed_sensitivity_benchmark(
                conn,
                dataset_id=ds_id,
                resolutions_m=req.resolutions_m,
                seeds=req.seeds,
                bandwidth_m=req.bandwidth_m,
            )
            return _store_research_run(
                conn,
                dataset_id=ds_id,
                method="maup_multiseed_resolution_sensitivity",
                params=req.model_dump(),
                inputs={"dataset_id": ds_id, "resolutions_m": req.resolutions_m, "seeds": req.seeds},
                result=result,
                limitations=result["zoning_sensitivity_note"],
            )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
