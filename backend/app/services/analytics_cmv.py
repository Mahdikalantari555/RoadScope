from __future__ import annotations

import csv
import io
import json
import sqlite3
from datetime import datetime
from typing import Any

from shapely.geometry import Point, Polygon

from ..context import dataset_context
from ..crs import metric_circle_geojson_4326, to_metric
from .map_matching import parse_utc_iso


def get_network_layers_geojson(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    include_lixels: bool = True,
) -> dict[str, Any]:
    """
    Return EPSG:4326 GeoJSON FeatureCollections for road_segments, road_nodes, and
    ground-truth road_lixels (including hidden true intensity lambda(e,m,t) for US-1.4).
    """
    seg_rows = conn.execute(
        """
        SELECT s.id, s.edge_code, s.name, s.road_class, s.speed_limit_kmh, s.lanes,
               s.length_m, s.sinuosity, s.slope_pct, s.elevation_level, s.aadt, s.geojson_4326,
               t.aadt_vehicles_per_day AS obs_aadt, t.is_imputed, t.coverage_confidence,
               d.direction AS oneway_direction, d.source AS direction_source
        FROM road_segments s
        LEFT JOIN traffic_observations t ON t.segment_id = s.id AND t.dataset_id = s.dataset_id
        LEFT JOIN road_segment_directions d ON d.segment_id = s.id AND d.dataset_id = s.dataset_id
        WHERE s.dataset_id = ?
        ORDER BY s.elevation_level ASC, s.id ASC
        """,
        (dataset_id,),
    ).fetchall()

    seg_features = [
        {
            "type": "Feature",
            "properties": {
                "segment_id": int(r["id"]),
                "edge_code": r["edge_code"],
                "name": r["name"],
                "road_class": r["road_class"],
                "speed_limit_kmh": int(r["speed_limit_kmh"]),
                "lanes": int(r["lanes"]),
                "length_m": round(float(r["length_m"]), 1),
                "sinuosity": round(float(r["sinuosity"]), 4),
                "slope_pct": round(float(r["slope_pct"]), 2),
                "elevation_level": int(r["elevation_level"]),
                "oneway_direction": r["oneway_direction"],
                "direction_source": r["direction_source"],
                "aadt": int(r["obs_aadt"] if r["obs_aadt"] is not None else r["aadt"]) if (r["obs_aadt"] is not None or r["aadt"] is not None) else None,
                "aadt_is_imputed": bool(r["is_imputed"]) if r["is_imputed"] is not None else None,
                "coverage_confidence": round(float(r["coverage_confidence"]), 3) if r["coverage_confidence"] is not None else None,
            },
            "geometry": json.loads(r["geojson_4326"]),
        }
        for r in seg_rows
    ]

    node_rows = conn.execute(
        """
        SELECT id, node_code, node_type, degree, elevation_level, x_m, y_m, lon, lat
        FROM road_nodes WHERE dataset_id = ?
        """,
        (dataset_id,),
    ).fetchall()

    node_features = [
        {
            "type": "Feature",
            "properties": {
                "node_id": int(r["id"]),
                "node_code": r["node_code"],
                "node_type": r["node_type"],
                "degree": int(r["degree"]),
                "elevation_level": int(r["elevation_level"]),
                "x_m": round(float(r["x_m"]), 2),
                "y_m": round(float(r["y_m"]), 2),
            },
            "geometry": {"type": "Point", "coordinates": [float(r["lon"]), float(r["lat"])]},
        }
        for r in node_rows
    ]

    lixel_fc = {"type": "FeatureCollection", "features": []}
    if include_lixels:
        lix_rows = conn.execute(
            """
            SELECT l.id, l.parent_segment_id, l.lixel_index, l.m_start_m, l.m_end_m,
                   l.length_m, l.dist_to_nearest_junction_m, l.true_lambda_per_km_yr,
                   l.geojson_4326, s.name AS segment_name, s.road_class, s.elevation_level
            FROM road_lixels l
            JOIN road_segments s ON s.id = l.parent_segment_id
            WHERE l.dataset_id = ?
            ORDER BY l.id
            """,
            (dataset_id,),
        ).fetchall()
        max_lam = max([float(r["true_lambda_per_km_yr"]) for r in lix_rows] + [1.0])
        lixel_fc["features"] = [
            {
                "type": "Feature",
                "properties": {
                    "lixel_id": int(r["id"]),
                    "segment_id": int(r["parent_segment_id"]),
                    "segment_name": r["segment_name"],
                    "road_class": r["road_class"],
                    "elevation_level": int(r["elevation_level"]),
                    "lixel_index": int(r["lixel_index"]),
                    "m_start_m": round(float(r["m_start_m"]), 1),
                    "m_end_m": round(float(r["m_end_m"]), 1),
                    "length_m": round(float(r["length_m"]), 2),
                    "dist_junc_m": round(float(r["dist_to_nearest_junction_m"]), 1),
                    "true_lambda": round(float(r["true_lambda_per_km_yr"]), 3),
                    "true_lambda_norm": round(float(r["true_lambda_per_km_yr"]) / max_lam, 4),
                },
                "geometry": json.loads(r["geojson_4326"]),
            }
            for r in lix_rows
        ]

    return {
        "segments_geojson": {"type": "FeatureCollection", "features": seg_features},
        "nodes_geojson": {"type": "FeatureCollection", "features": node_features},
        "lixels_geojson": lixel_fc,
    }


def query_synchronized_cmv_state(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    verification_mode: str = "verified_only",
    start_utc: str | None = None,
    end_utc: str | None = None,
    severity_codes: list[str] | None = None,
    category_codes: list[str] | None = None,
    dow_filter: int | None = None,
    hour_filter: int | None = None,
    segment_id: int | None = None,
    bbox_4326: list[float] | None = None,
    polygon_4326: list[list[float]] | None = None,
) -> dict[str, Any]:
    """
    Bidirectional Linked Brushing & Cross-Filtering Engine (Epic 6 — US-6.1 & US-6.2):
    Executes spatial R*Tree / polygon containment + temporal + categorical filtering and
    dynamically recomputes all statistical charts and map GeoJSON layers.
    """
    if verification_mode == "vgi_queue":
        statuses = ("unverified_raw_vgi", "corroborated_pending", "flagged_review")
    elif verification_mode == "all_active":
        statuses = ("verified_canonical", "unverified_raw_vgi", "corroborated_pending", "flagged_review")
    else:
        statuses = ("verified_canonical",)

    epsg = dataset_context(conn, dataset_id).canonical_epsg
    ph = ",".join("?" for _ in statuses)
    params: list[Any] = [dataset_id, *statuses]
    rtree_join = ""
    rtree_clause = ""

    # Use R*Tree spatial index when bounding box filter is active!
    if bbox_4326 and len(bbox_4326) == 4:
        min_x, min_y = to_metric(bbox_4326[0], bbox_4326[1], epsg)
        max_x, max_y = to_metric(bbox_4326[2], bbox_4326[3], epsg)
        lo_x, hi_x = min(min_x, max_x), max(min_x, max_x)
        lo_y, hi_y = min(min_y, max_y), max(min_y, max_y)
        rtree_join = "JOIN rtree_accidents_snapped rt ON rt.id = a.id"
        rtree_clause = " AND rt.max_x >= ? AND rt.min_x <= ? AND rt.max_y >= ? AND rt.min_y <= ?"
        params.extend([lo_x, hi_x, lo_y, hi_y])

    sql = f"""
        SELECT a.id, a.source_type, a.verification_status, a.occurred_at_utc, a.reported_at_utc,
               a.reporting_lag_min, a.involved_vehicles, a.involved_pedestrians, a.involved_cyclists,
               a.emergency_response_present, a.narrative, a.observational_radius_m,
               a.raw_x_m, a.raw_y_m, a.raw_lon, a.raw_lat,
               a.snapped_x_m, a.snapped_y_m, a.snapped_lon, a.snapped_lat,
               a.snapped_segment_id, a.snapped_lixel_id, a.linear_offset_m,
               a.orthogonal_snap_dist_m, a.snap_probability, a.snap_candidates_json,
               a.vgi_credibility_score, a.witness_count,
               c.code AS category_code, c.label AS category_label,
               sv.code AS severity_code, sv.label AS severity_label,
               sv.rank AS severity_rank, sv.epdo_weight, sv.color_hex,
               rs.name AS segment_name, rs.road_class, rs.elevation_level, rs.length_m AS segment_length_m,
               COALESCE(e.weather_condition, 'clear') AS weather_condition,
               COALESCE(e.lighting_condition, 'daylight') AS lighting_condition,
               COALESCE(e.road_surface, 'dry') AS road_surface
        FROM accidents a
        {rtree_join}
        JOIN accident_categories c ON c.id = a.category_id
        JOIN severity_levels sv ON sv.id = a.severity_id
        LEFT JOIN road_segments rs ON rs.id = a.snapped_segment_id
        LEFT JOIN environmental_observations e ON e.accident_id = a.id
        WHERE a.dataset_id = ?
          AND a.verification_status IN ({ph})
          {rtree_clause}
        ORDER BY a.occurred_at_utc DESC
    """
    all_rows = conn.execute(sql, params).fetchall()

    # Optional polygon lasso containment in the dataset's canonical metric CRS
    poly_metric: Polygon | None = None
    if polygon_4326 and len(polygon_4326) >= 3:
        metric_ring = [to_metric(pt[0], pt[1], epsg) for pt in polygon_4326]
        if metric_ring[0] != metric_ring[-1]:
            metric_ring.append(metric_ring[0])
        poly_metric = Polygon(metric_ring)

    # First compute baseline weekly timeline (prior to temporal brush so brush always displays context!)
    baseline_weekly: dict[str, int] = {}
    filtered_rows: list[tuple[sqlite3.Row, datetime]] = []

    start_dt = parse_utc_iso(start_utc) if start_utc else None
    end_dt = parse_utc_iso(end_utc) if end_utc else None
    sev_set = set(severity_codes) if severity_codes else None
    cat_set = set(category_codes) if category_codes else None

    for r in all_rows:
        sx = float(r["snapped_x_m"] or r["raw_x_m"])
        sy = float(r["snapped_y_m"] or r["raw_y_m"])
        if poly_metric is not None and not poly_metric.contains(Point(sx, sy)):
            continue
        if segment_id is not None and int(r["snapped_segment_id"] or -1) != int(segment_id):
            continue

        dt = parse_utc_iso(r["occurred_at_utc"])
        # ISO week bucket start (Monday)
        iso_year, iso_week, _ = dt.isocalendar()
        week_monday = datetime.fromisocalendar(iso_year, iso_week, 1).strftime("%Y-%m-%d")
        baseline_weekly[week_monday] = baseline_weekly.get(week_monday, 0) + 1

        if start_dt and dt < start_dt:
            continue
        if end_dt and dt > end_dt:
            continue
        if sev_set and r["severity_code"] not in sev_set:
            continue
        if cat_set and r["category_code"] not in cat_set:
            continue
        if dow_filter is not None and dt.weekday() != int(dow_filter):
            continue
        if hour_filter is not None and dt.hour != int(hour_filter):
            continue

        filtered_rows.append((r, dt))

    # Build Weekly Time-Series + Diurnal 7x24 Matrix + Severity + Taxonomy + Corridor Ranking
    selected_weekly: dict[str, int] = {}
    diurnal_matrix = [[0 for _ in range(24)] for _ in range(7)]  # 7 days (0=Mon..6=Sun) x 24 hours
    sev_agg: dict[str, dict[str, Any]] = {}
    cat_agg: dict[str, dict[str, Any]] = {}
    seg_agg: dict[int, dict[str, Any]] = {}

    incident_features: list[dict[str, Any]] = []
    displacement_features: list[dict[str, Any]] = []
    uncertainty_circles: list[dict[str, Any]] = []

    total_epdo = 0.0
    ksi_count = 0
    cred_sum = 0.0
    drift_sum = 0.0

    for r, dt in filtered_rows:
        iso_y, iso_w, _ = dt.isocalendar()
        wk = datetime.fromisocalendar(iso_y, iso_w, 1).strftime("%Y-%m-%d")
        selected_weekly[wk] = selected_weekly.get(wk, 0) + 1
        diurnal_matrix[dt.weekday()][dt.hour] += 1

        scode = str(r["severity_code"])
        epdo_w = float(r["epdo_weight"])
        total_epdo += epdo_w
        if int(r["severity_rank"]) >= 3:
            ksi_count += 1
        cred_sum += float(r["vgi_credibility_score"])
        drift_sum += float(r["orthogonal_snap_dist_m"] or 0.0)

        if scode not in sev_agg:
            sev_agg[scode] = {
                "code": scode,
                "label": r["severity_label"],
                "rank": int(r["severity_rank"]),
                "color": r["color_hex"],
                "count": 0,
                "epdo_sum": 0.0,
            }
        sev_agg[scode]["count"] += 1
        sev_agg[scode]["epdo_sum"] = round(sev_agg[scode]["epdo_sum"] + epdo_w, 2)

        ccode = str(r["category_code"])
        if ccode not in cat_agg:
            cat_agg[ccode] = {
                "code": ccode,
                "label": r["category_label"],
                "count": 0,
                "epdo_sum": 0.0,
            }
        cat_agg[ccode]["count"] += 1
        cat_agg[ccode]["epdo_sum"] = round(cat_agg[ccode]["epdo_sum"] + epdo_w, 2)

        if r["snapped_segment_id"] is not None:
            sid = int(r["snapped_segment_id"])
            if sid not in seg_agg:
                seg_agg[sid] = {
                    "segment_id": sid,
                    "name": r["segment_name"] or f"Segment #{sid}",
                    "road_class": r["road_class"],
                    "length_m": round(float(r["segment_length_m"] or 100.0), 1),
                    "count": 0,
                    "epdo_sum": 0.0,
                    "ksi_count": 0,
                }
            seg_agg[sid]["count"] += 1
            seg_agg[sid]["epdo_sum"] = round(seg_agg[sid]["epdo_sum"] + epdo_w, 2)
            if int(r["severity_rank"]) >= 3:
                seg_agg[sid]["ksi_count"] += 1

        slon = float(r["snapped_lon"] if r["snapped_lon"] is not None else r["raw_lon"])
        slat = float(r["snapped_lat"] if r["snapped_lat"] is not None else r["raw_lat"])
        rlon = float(r["raw_lon"])
        rlat = float(r["raw_lat"])

        props = {
            "id": int(r["id"]),
            "source_type": r["source_type"],
            "verification_status": r["verification_status"],
            "occurred_at_utc": r["occurred_at_utc"],
            "reported_at_utc": r["reported_at_utc"],
            "reporting_lag_min": round(float(r["reporting_lag_min"]), 1),
            "category_code": ccode,
            "category_label": r["category_label"],
            "severity_code": scode,
            "severity_label": r["severity_label"],
            "severity_rank": int(r["severity_rank"]),
            "epdo_weight": epdo_w,
            "color": r["color_hex"],
            "segment_id": int(r["snapped_segment_id"]) if r["snapped_segment_id"] is not None else None,
            "segment_name": r["segment_name"],
            "road_class": r["road_class"],
            "linear_offset_m": round(float(r["linear_offset_m"] or 0.0), 2),
            "orthogonal_snap_dist_m": round(float(r["orthogonal_snap_dist_m"] or 0.0), 2),
            "snap_probability": round(float(r["snap_probability"] or 1.0), 3),
            "vgi_credibility_score": round(float(r["vgi_credibility_score"]), 3),
            "witness_count": int(r["witness_count"]),
            "observational_radius_m": round(float(r["observational_radius_m"]), 1),
            "weather_condition": r["weather_condition"],
            "lighting_condition": r["lighting_condition"],
            "road_surface": r["road_surface"],
            "involved_vehicles": int(r["involved_vehicles"]),
            "involved_pedestrians": int(r["involved_pedestrians"]),
            "involved_cyclists": int(r["involved_cyclists"]),
            "narrative": r["narrative"],
            "raw_lon": rlon,
            "raw_lat": rlat,
            "raw_x_m": round(float(r["raw_x_m"]), 2),
            "raw_y_m": round(float(r["raw_y_m"]), 2),
            "snapped_x_m": round(float(r["snapped_x_m"] or r["raw_x_m"]), 2),
            "snapped_y_m": round(float(r["snapped_y_m"] or r["raw_y_m"]), 2),
            "snap_candidates": json.loads(r["snap_candidates_json"] or "[]"),
        }

        incident_features.append(
            {
                "type": "Feature",
                "properties": props,
                "geometry": {"type": "Point", "coordinates": [slon, slat]},
            }
        )

        # For VGI records with non-trivial positional drift, emit raw->snapped displacement line + uncertainty circle!
        if r["source_type"] in ("synthetic_vgi", "citizen_vgi"):
            displacement_features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "id": int(r["id"]),
                        "drift_m": round(float(r["orthogonal_snap_dist_m"] or 0.0), 2),
                        "verification_status": r["verification_status"],
                    },
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[rlon, rlat], [slon, slat]],
                    },
                }
            )
            if len(uncertainty_circles) < 120:
                uncertainty_circles.append(
                    {
                        "type": "Feature",
                        "properties": {
                            "id": int(r["id"]),
                            "radius_m": round(float(r["observational_radius_m"]), 1),
                            "credibility": round(float(r["vgi_credibility_score"]), 3),
                        },
                        "geometry": metric_circle_geojson_4326(
                            float(r["raw_x_m"]),
                            float(r["raw_y_m"]),
                            float(r["observational_radius_m"]),
                            canonical_epsg=epsg,
                        ),
                    }
                )

    all_weeks = sorted(baseline_weekly.keys())
    weekly_series = [
        {
            "week_start": wk,
            "total_count": baseline_weekly.get(wk, 0),
            "selected_count": selected_weekly.get(wk, 0),
        }
        for wk in all_weeks
    ]

    top_segments = sorted(
        [
            {
                **v,
                "density_per_km": round(v["count"] / max(0.02, v["length_m"] / 1000.0), 2),
                "epdo_per_km": round(v["epdo_sum"] / max(0.02, v["length_m"] / 1000.0), 2),
            }
            for v in seg_agg.values()
        ],
        key=lambda x: (x["epdo_sum"], x["count"]),
        reverse=True,
    )[:15]

    n_filt = len(filtered_rows)
    return {
        "kpis": {
            "filtered_incidents": n_filt,
            "total_epdo": round(total_epdo, 1),
            "ksi_severe_fatal_count": ksi_count,
            "ksi_share_pct": round((ksi_count / max(1, n_filt)) * 100.0, 1),
            "mean_credibility": round(cred_sum / max(1, n_filt), 3),
            "mean_snap_drift_m": round(drift_sum / max(1, n_filt), 2),
        },
        "weekly_series": weekly_series,
        "diurnal_matrix": diurnal_matrix,
        "severity_breakdown": sorted(sev_agg.values(), key=lambda x: x["rank"]),
        "taxonomy_breakdown": sorted(cat_agg.values(), key=lambda x: x["count"], reverse=True),
        "top_segments": top_segments,
        "incidents_geojson": {"type": "FeatureCollection", "features": incident_features},
        "vgi_displacement_geojson": {"type": "FeatureCollection", "features": displacement_features},
        "vgi_uncertainty_geojson": {"type": "FeatureCollection", "features": uncertainty_circles},
    }


def export_job_to_csv(conn: sqlite3.Connection, job_id: int) -> str:
    row = conn.execute(
        "SELECT tabular_results_json FROM spatial_analysis_results WHERE job_id = ?",
        (job_id,),
    ).fetchone()
    if not row:
        raise ValueError(f"Analysis job #{job_id} result not found.")
    records = json.loads(row["tabular_results_json"])
    if not records:
        return "empty\n"
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(records[0].keys()))
    writer.writeheader()
    writer.writerows(records)
    return buf.getvalue()
