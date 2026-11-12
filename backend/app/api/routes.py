from __future__ import annotations

import json
import sqlite3
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Response

from ..config import CANONICAL_EPSG, WEB_EPSG
from ..crs import metric_circle_geojson_4326, to_metric, to_wgs84
from ..db import db_session
from ..schemas import (
    CitizenReportSubmitRequest,
    CmvQueryRequest,
    CoordinateProjectRequest,
    CorroborateRequest,
    DirectedTransportRequest,
    MergeDuplicateClusterRequest,
    NetworkAutocorrelationRequest,
    NetworkDbscanRequest,
    NkdeRequest,
    RiskEbEvaluationRequest,
    SimulationRequest,
    SnapConflatePreviewRequest,
    StewardReviewRequest,
)
from ..services.analytics_cmv import (
    export_job_to_csv,
    get_network_layers_geojson,
    query_synchronized_cmv_state,
)
from ..services.directed_topology import build_directed_lixel_topology
from ..services.directed_transport import run_directed_transport
from ..services.map_matching import (
    compute_topological_snap_candidates,
    find_spatiotemporal_conflation_candidates,
)
from ..services.network_generator import get_study_area_context_geojson
from ..services.point_process_sim import SCENARIO_METADATA, run_stochastic_network_simulation
from ..services.risk_eb_engine import compute_exposure_risk_and_eb
from ..services.spatial_lab import (
    run_covariate_cross_comparison,
    run_network_autocorrelation,
    run_network_dbscan,
    run_nkde_analysis,
)
from ..services.stewardship import (
    corroborate_existing_incident,
    get_steward_duplicate_clusters,
    get_vgi_quality_diagnostics,
    merge_duplicate_cluster,
    steward_review_incident,
    submit_citizen_vgi_report,
    validate_metric_bounds,
)


def _trusted_role(legacy: str) -> str:
    from ..security import demo_enabled, identity

    principal = identity.get()
    return legacy if demo_enabled() else (principal.role if principal else "anonymous")


router = APIRouter(prefix="/api/v1")


def _resolve_dataset_id(conn: sqlite3.Connection, requested_id: int | None) -> int:
    if requested_id is not None:
        row = conn.execute("SELECT id FROM dataset_sources WHERE id = ?", (requested_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Dataset #{requested_id} not found.")
        return int(row["id"])
    row = conn.execute("SELECT id FROM dataset_sources WHERE is_active = 1 ORDER BY id DESC LIMIT 1").fetchone()
    if not row:
        row = conn.execute("SELECT id FROM dataset_sources ORDER BY id DESC LIMIT 1").fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No dataset initialized.")
    return int(row["id"])


@router.get("/health")
def health_check() -> dict[str, Any]:
    with db_session() as conn:
        ds_cnt = conn.execute("SELECT COUNT(*) AS c FROM dataset_sources").fetchone()["c"]
    return {
        "status": "ok",
        "canonical_crs": f"EPSG:{CANONICAL_EPSG}",
        "web_crs": f"EPSG:{WEB_EPSG}",
        "datasets_initialized": int(ds_cnt),
    }


@router.get("/meta")
def get_platform_metadata() -> dict[str, Any]:
    with db_session() as conn:
        datasets = [
            {
                **dict(r),
                "is_synthetic": bool(r["is_synthetic"]),
                "is_active": bool(r["is_active"]),
                "generator_params": json.loads(r["generator_params_json"] or "{}"),
            }
            for r in conn.execute("SELECT * FROM dataset_sources ORDER BY id DESC").fetchall()
        ]
        active_ds = next((d for d in datasets if d["is_active"]), datasets[0] if datasets else None)
        categories = [dict(r) for r in conn.execute("SELECT id, code, label, description FROM accident_categories ORDER BY id").fetchall()]
        severities = [dict(r) for r in conn.execute("SELECT id, code, rank, label, epdo_weight, color_hex FROM severity_levels ORDER BY rank").fetchall()]
        users = [dict(r) for r in conn.execute("SELECT id, username, full_name, role, trust_weight FROM users ORDER BY id").fetchall()]

    return {
        "canonical_crs": f"EPSG:{CANONICAL_EPSG}",
        "canonical_crs_name": "ETRS89 / UTM Zone 32N (Metric, meters)",
        "web_crs": f"EPSG:{WEB_EPSG}",
        "study_area": "Frankfurt am Main Urban Network Core",
        "center_4326": [8.6821, 50.1109],
        "active_dataset": active_ds,
        "datasets": datasets,
        "categories": categories,
        "severities": severities,
        "personas": users,
        "scenarios": [
            {"key": k, **v} for k, v in SCENARIO_METADATA.items()
        ],
        "context_geojson": get_study_area_context_geojson(),
    }


@router.post("/datasets/{dataset_id}/activate")
def activate_dataset(dataset_id: int) -> dict[str, Any]:
    with db_session() as conn:
        row = conn.execute("SELECT id, name FROM dataset_sources WHERE id = ?", (dataset_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Dataset #{dataset_id} not found.")
        conn.execute("UPDATE dataset_sources SET is_active = 0")
        conn.execute("UPDATE dataset_sources SET is_active = 1 WHERE id = ?", (dataset_id,))
        return {"activated_dataset_id": dataset_id, "name": row["name"]}


@router.post("/crs/project")
def project_coordinates(req: CoordinateProjectRequest) -> dict[str, Any]:
    if req.lon is not None and req.lat is not None:
        x_m, y_m = to_metric(req.lon, req.lat)
        return {"lon": round(req.lon, 7), "lat": round(req.lat, 7), "x_m": x_m, "y_m": y_m, "srid": CANONICAL_EPSG}
    if req.x_m is not None and req.y_m is not None:
        lon, lat = to_wgs84(req.x_m, req.y_m)
        return {"lon": lon, "lat": lat, "x_m": round(req.x_m, 3), "y_m": round(req.y_m, 3), "srid": CANONICAL_EPSG}
    raise HTTPException(status_code=422, detail="Provide either (lon, lat) or (x_m, y_m).")


@router.post("/simulator/generate")
def generate_simulation_dataset(req: SimulationRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            return run_stochastic_network_simulation(
                conn,
                scenario_key=req.scenario_key,
                lixel_resolution_m=req.lixel_resolution_m,
                random_seed=req.random_seed,
                base_intensity_scale=req.base_intensity_scale,
                vgi_positional_sigma_m=req.vgi_positional_sigma_m,
                vgi_duplicate_rate=req.vgi_duplicate_rate,
                vgi_false_alarm_count=req.vgi_false_alarm_count,
                study_period_years=req.study_period_years,
                activate_dataset=True,
                actor_role=_trusted_role(req.actor_role),
            )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/network/layers")
def fetch_network_layers(
    dataset_id: int | None = Query(default=None),
    include_lixels: bool = Query(default=True),
) -> dict[str, Any]:
    with db_session() as conn:
        ds_id = _resolve_dataset_id(conn, dataset_id)
        return get_network_layers_geojson(conn, dataset_id=ds_id, include_lixels=include_lixels)


@router.get("/network/directed-topology")
def directed_topology_endpoint(
    dataset_id: int | None = Query(default=None),
    include_edges: bool = Query(default=False),
) -> dict[str, Any]:
    """Return experimental topology metadata, optionally including edge states."""
    with db_session() as conn:
        conn.execute("BEGIN")
        ds_id = _resolve_dataset_id(conn, dataset_id)
        try:
            topo = build_directed_lixel_topology(conn, ds_id)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        result: dict[str, Any] = {
            "dataset_id": ds_id,
            "topology_version": topo.version,
            "state_count": topo.graph.number_of_nodes(),
            "transition_count": topo.graph.number_of_edges(),
            "assumed_bidirectional_segments": topo.assumed_direction_segments,
            "direction_convention": "+1 is u to v, -1 is v to u, 0 is bidirectional",
            "distance_unit": "m",
            "status": "experimental topology; metric-graph heat diffusion is not implemented",
        }
        if include_edges:
            def state(s: tuple[int, int, int]) -> dict[str, int]:
                return {"segment_id": s[0], "lixel_id": s[1], "direction": s[2]}

            result["states"] = [state(s) for s in topo.graph.nodes]
            result["transitions"] = [
                {
                    "from": state(a),
                    "to": state(b),
                    "weight_m": attrs["weight_m"],
                    "kind": attrs["kind"],
                    "via_node": attrs.get("via_node"),
                }
                for a, b, attrs in topo.graph.edges(data=True)
            ]
        return result


@router.post("/network/directed-transport")
def directed_transport_endpoint(req: DirectedTransportRequest) -> dict[str, Any]:
    with db_session() as conn:
        conn.execute("BEGIN")
        ds_id = _resolve_dataset_id(conn, req.dataset_id)
        try:
            topology = build_directed_lixel_topology(conn, ds_id)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        return run_directed_transport(
            topology,
            (req.segment_id, req.lixel_id, req.direction),
            mass=req.mass,
            speed_m_s=req.speed_m_s,
            duration_s=req.duration_s,
            steps=req.steps,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ArithmeticError as exc:
        raise HTTPException(status_code=500, detail="Transport numerical validation failed") from exc


@router.post("/vgi/preview-snap-and-conflate")
def preview_vgi_snap_and_conflate(req: SnapConflatePreviewRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            ds_id = _resolve_dataset_id(conn, req.dataset_id)
            if req.x_m is not None and req.y_m is not None:
                rx_m, ry_m = float(req.x_m), float(req.y_m)
                rlon, rlat = to_wgs84(rx_m, ry_m)
            elif req.lon is not None and req.lat is not None:
                rlon, rlat = float(req.lon), float(req.lat)
                rx_m, ry_m = to_metric(rlon, rlat)
            else:
                raise ValueError("Provide either (lon, lat) or (x_m, y_m).")

            validate_metric_bounds(rx_m, ry_m)

            cands = compute_topological_snap_candidates(
                conn,
                dataset_id=ds_id,
                raw_x_m=rx_m,
                raw_y_m=ry_m,
                observational_radius_m=req.observational_radius_m,
                category_code=req.category_code,
            )
            best = cands[0]
            conflation_matches = find_spatiotemporal_conflation_candidates(
                conn,
                dataset_id=ds_id,
                snapped_segment_id=best["segment_id"],
                linear_offset_m=best["linear_offset_m"],
                occurred_at_utc=req.occurred_at_utc,
                category_code=req.category_code,
                max_net_dist_m=req.max_net_dist_m,
                max_time_diff_min=req.max_time_diff_min,
            )

            circle_geojson = metric_circle_geojson_4326(rx_m, ry_m, req.observational_radius_m)
            return {
                "raw_point": {"lon": rlon, "lat": rlat, "x_m": rx_m, "y_m": ry_m, "srid": CANONICAL_EPSG},
                "uncertainty_circle_geojson": circle_geojson,
                "candidate_snaps": cands,
                "conflation_alerts": conflation_matches,
            }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/vgi/submit")
def submit_vgi_endpoint(req: CitizenReportSubmitRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            ds_id = _resolve_dataset_id(conn, req.dataset_id)
            return submit_citizen_vgi_report(
                conn,
                dataset_id=ds_id,
                lon=req.lon,
                lat=req.lat,
                x_m=req.x_m,
                y_m=req.y_m,
                observational_radius_m=req.observational_radius_m,
                occurred_at_utc=req.occurred_at_utc,
                reported_at_utc=req.reported_at_utc,
                category_code=req.category_code,
                severity_code=req.severity_code,
                involved_vehicles=req.involved_vehicles,
                involved_pedestrians=req.involved_pedestrians,
                involved_cyclists=req.involved_cyclists,
                emergency_response_present=req.emergency_response_present,
                weather_condition=req.weather_condition,
                road_surface=req.road_surface,
                lighting_condition=req.lighting_condition,
                narrative=req.narrative,
                attachment_filenames=req.attachment_filenames,
                selected_segment_id=req.selected_segment_id,
                actor_role=_trusted_role(req.actor_role),
            )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/vgi/{accident_id}/corroborate")
def corroborate_vgi_endpoint(accident_id: int, req: CorroborateRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            return corroborate_existing_incident(
                conn,
                target_accident_id=accident_id,
                witness_notes=req.witness_notes,
                observational_radius_m=req.observational_radius_m,
                actor_role=_trusted_role(req.actor_role),
            )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/steward/workspace")
def steward_workspace_endpoint(
    dataset_id: int | None = Query(default=None),
    max_net_dist_m: float = Query(default=110.0, ge=20.0, le=500.0),
    max_time_diff_min: float = Query(default=55.0, ge=5.0, le=360.0),
) -> dict[str, Any]:
    with db_session() as conn:
        ds_id = _resolve_dataset_id(conn, dataset_id)
        queue_rows = conn.execute(
            """
            SELECT a.id, a.source_type, a.verification_status, a.occurred_at_utc, a.reported_at_utc,
                   a.reporting_lag_min, a.observational_radius_m,
                   a.raw_lon, a.raw_lat, a.raw_x_m, a.raw_y_m,
                   a.snapped_lon, a.snapped_lat, a.snapped_segment_id, a.linear_offset_m,
                   a.orthogonal_snap_dist_m, a.snap_probability, a.snap_candidates_json,
                   a.vgi_credibility_score, a.witness_count, a.narrative,
                   c.code AS category_code, c.label AS category_label,
                   sv.code AS severity_code, sv.label AS severity_label, sv.color_hex,
                   rs.name AS segment_name, rs.road_class, rs.elevation_level
            FROM accidents a
            JOIN accident_categories c ON c.id = a.category_id
            JOIN severity_levels sv ON sv.id = a.severity_id
            LEFT JOIN road_segments rs ON rs.id = a.snapped_segment_id
            WHERE a.dataset_id = ?
              AND a.source_type IN ('synthetic_vgi', 'citizen_vgi')
            ORDER BY
              CASE a.verification_status
                WHEN 'flagged_review' THEN 1
                WHEN 'corroborated_pending' THEN 2
                WHEN 'unverified_raw_vgi' THEN 3
                ELSE 4
              END,
              a.vgi_credibility_score DESC,
              a.id DESC
            LIMIT 120
            """,
            (ds_id,),
        ).fetchall()

        queue = []
        for r in queue_rows:
            d = dict(r)
            d["snap_candidates"] = json.loads(d.pop("snap_candidates_json") or "[]")
            queue.append(d)

        clusters = get_steward_duplicate_clusters(
            conn,
            dataset_id=ds_id,
            max_net_dist_m=max_net_dist_m,
            max_time_diff_min=max_time_diff_min,
        )
        diagnostics = get_vgi_quality_diagnostics(conn, dataset_id=ds_id)
        return {
            "dataset_id": ds_id,
            "triage_queue": queue,
            "duplicate_clusters": clusters,
            "diagnostics": diagnostics,
        }


@router.post("/steward/review")
def steward_review_endpoint(req: StewardReviewRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            return steward_review_incident(
                conn,
                accident_id=req.accident_id,
                new_status=req.new_status,
                override_segment_id=req.override_segment_id,
                override_offset_m=req.override_offset_m,
                override_severity_code=req.override_severity_code,
                review_notes=req.review_notes,
                actor_role=_trusted_role(req.actor_role),
            )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/steward/merge-cluster")
def steward_merge_endpoint(req: MergeDuplicateClusterRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            return merge_duplicate_cluster(
                conn,
                canonical_id=req.canonical_id,
                duplicate_ids=req.duplicate_ids,
                verify_canonical=req.verify_canonical,
                review_notes=req.review_notes,
                actor_role=_trusted_role(req.actor_role),
            )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/lab/nkde")
def lab_nkde_endpoint(req: NkdeRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            ds_id = _resolve_dataset_id(conn, req.dataset_id)
            return run_nkde_analysis(
                conn,
                dataset_id=ds_id,
                kernel=req.kernel,
                bandwidth_m=req.bandwidth_m,
                weighting=req.weighting,
                equal_split_mass_conserving=req.equal_split_mass_conserving,
                include_unverified_vgi=req.include_unverified_vgi,
                allocation_mode=req.allocation_mode,
                top_hotspot_pct=req.top_hotspot_pct,
                actor_role=_trusted_role(req.actor_role),
            )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/lab/autocorrelation")
def lab_autocorrelation_endpoint(req: NetworkAutocorrelationRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            ds_id = _resolve_dataset_id(conn, req.dataset_id)
            return run_network_autocorrelation(
                conn,
                dataset_id=ds_id,
                weight_scheme=req.weight_scheme,
                distance_threshold_m=req.distance_threshold_m,
                contiguity_order_k=req.contiguity_order_k,
                permutations=req.permutations,
                attribute_mode=req.attribute_mode,
                include_unverified_vgi=req.include_unverified_vgi,
                random_seed=req.random_seed,
                actor_role=_trusted_role(req.actor_role),
            )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/lab/ndbscan")
def lab_ndbscan_endpoint(req: NetworkDbscanRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            ds_id = _resolve_dataset_id(conn, req.dataset_id)
            return run_network_dbscan(
                conn,
                dataset_id=ds_id,
                eps_net_m=req.eps_net_m,
                min_samples=req.min_samples,
                include_unverified_vgi=req.include_unverified_vgi,
                actor_role=_trusted_role(req.actor_role),
            )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/lab/covariates")
def lab_covariates_endpoint(
    dataset_id: int | None = Query(default=None),
    include_unverified_vgi: bool = Query(default=False),
) -> dict[str, Any]:
    with db_session() as conn:
        ds_id = _resolve_dataset_id(conn, dataset_id)
        return run_covariate_cross_comparison(
            conn, dataset_id=ds_id, include_unverified_vgi=include_unverified_vgi
        )


@router.get("/lab/jobs")
def list_lab_jobs(dataset_id: int | None = Query(default=None)) -> dict[str, Any]:
    with db_session() as conn:
        ds_id = _resolve_dataset_id(conn, dataset_id)
        rows = conn.execute(
            """
            SELECT j.id, j.job_type, j.status, j.parameters_json, j.crs_epsg,
                   j.sample_size, j.runtime_ms, j.created_at_utc,
                   r.summary_metrics_json, r.ground_truth_eval_json
            FROM spatial_analysis_jobs j
            LEFT JOIN spatial_analysis_results r ON r.job_id = j.id
            WHERE j.dataset_id = ?
            ORDER BY j.id DESC LIMIT 25
            """,
            (ds_id,),
        ).fetchall()
        return {
            "jobs": [
                {
                    "job_id": int(r["id"]),
                    "job_type": r["job_type"],
                    "status": r["status"],
                    "parameters": json.loads(r["parameters_json"] or "{}"),
                    "crs_epsg": int(r["crs_epsg"]),
                    "sample_size": int(r["sample_size"]),
                    "runtime_ms": float(r["runtime_ms"]),
                    "created_at_utc": r["created_at_utc"],
                    "summary_metrics": json.loads(r["summary_metrics_json"]) if r["summary_metrics_json"] else None,
                    "ground_truth_eval": json.loads(r["ground_truth_eval_json"]) if r["ground_truth_eval_json"] else None,
                }
                for r in rows
            ]
        }


@router.get("/lab/jobs/{job_id}/export")
def export_lab_job(
    job_id: int,
    fmt: str = Query(default="geojson", pattern="^(geojson|csv)$"),
) -> Response:
    with db_session() as conn:
        row = conn.execute(
            """
            SELECT j.job_type, r.layer_geojson_text
            FROM spatial_analysis_jobs j
            JOIN spatial_analysis_results r ON r.job_id = j.id
            WHERE j.id = ?
            """,
            (job_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Job #{job_id} not found.")
        if fmt == "geojson":
            return Response(
                content=row["layer_geojson_text"],
                media_type="application/geo+json",
                headers={
                    "Content-Disposition": f'attachment; filename="uai_{row["job_type"].lower()}_job_{job_id}.geojson"'
                },
            )
        csv_body = export_job_to_csv(conn, job_id)
        return Response(
            content=csv_body,
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="uai_{row["job_type"].lower()}_job_{job_id}.csv"'
            },
        )


@router.post("/risk/evaluate")
def evaluate_risk_eb_endpoint(req: RiskEbEvaluationRequest) -> dict[str, Any]:
    try:
        with db_session() as conn:
            ds_id = _resolve_dataset_id(conn, req.dataset_id)
            return compute_exposure_risk_and_eb(
                conn,
                dataset_id=ds_id,
                w_eb_risk=req.w_eb_risk,
                w_epdo_severity=req.w_epdo_severity,
                w_geometric_hazard=req.w_geometric_hazard,
                w_environmental_cov=req.w_environmental_cov,
            )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/analytics/cmv")
def synchronized_cmv_endpoint(req: CmvQueryRequest) -> dict[str, Any]:
    with db_session() as conn:
        ds_id = _resolve_dataset_id(conn, req.dataset_id)
        return query_synchronized_cmv_state(
            conn,
            dataset_id=ds_id,
            verification_mode=req.verification_mode,
            start_utc=req.start_utc,
            end_utc=req.end_utc,
            severity_codes=req.severity_codes,
            category_codes=req.category_codes,
            dow_filter=req.dow_filter,
            hour_filter=req.hour_filter,
            segment_id=req.segment_id,
            bbox_4326=req.bbox_4326,
            polygon_4326=req.polygon_4326,
        )
