from __future__ import annotations

import json
import math
import sqlite3
from datetime import datetime, timezone
from typing import Any

from shapely.geometry import Point
from shapely.wkt import loads as wkt_loads

from ..context import dataset_context
from ..crs import interpolate_lrs_point, to_wgs84
from .network_generator import (
    exact_network_distance_between_snapped_points,
    get_lixel_network_topology,
)


def parse_utc_iso(ts: str) -> datetime:
    cleaned = ts.strip().replace(" ", "T")
    if cleaned.endswith("Z"):
        cleaned = cleaned[:-1] + "+00:00"
    dt = datetime.fromisoformat(cleaned)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _load_category_priors(conn: sqlite3.Connection, category_code: str) -> dict[str, float]:
    row = conn.execute(
        "SELECT compatible_road_classes_json FROM accident_categories WHERE code = ?",
        (category_code,),
    ).fetchone()
    if not row:
        return {}
    return {k: float(v) for k, v in json.loads(row["compatible_road_classes_json"]).items()}


def _find_lixel_for_offset(conn: sqlite3.Connection, segment_id: int, m_offset: float) -> int | None:
    row = conn.execute(
        """
        SELECT id FROM road_lixels
        WHERE parent_segment_id = ? AND m_start_m <= ? AND m_end_m >= ?
        ORDER BY lixel_index LIMIT 1
        """,
        (segment_id, m_offset + 1e-3, m_offset - 1e-3),
    ).fetchone()
    if row:
        return int(row["id"])
    fallback = conn.execute(
        "SELECT id FROM road_lixels WHERE parent_segment_id = ? ORDER BY ABS(midpoint_m - ?) LIMIT 1",
        (segment_id, m_offset),
    ).fetchone()
    return int(fallback["id"]) if fallback else None


def compute_topological_snap_candidates(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    raw_x_m: float,
    raw_y_m: float,
    observational_radius_m: float = 18.0,
    category_code: str = "REAR_END",
    search_radius_m: float = 110.0,
    max_candidates: int = 5,
) -> list[dict[str, Any]]:
    """
    Probabilistic Topological Map-Matching (US-3.1):
    Uses SQLite R*Tree spatial index in EPSG:25832 to retrieve candidate edges and computes
    posterior snap probabilities balancing orthogonal distance, road hierarchy compatibility,
    grade-separation (overpass vs surface), and intersection node topology.
    """
    eff_radius = max(search_radius_m, observational_radius_m * 2.5)
    rows = conn.execute(
        """
        SELECT s.id, s.edge_code, s.name, s.road_class, s.speed_limit_kmh, s.lanes,
               s.length_m, s.elevation_level, s.wkt_m,
               nu.degree AS u_deg, nu.node_type AS u_type,
               nv.degree AS v_deg, nv.node_type AS v_type
        FROM rtree_road_segments r
        JOIN road_segments s ON s.id = r.id
        JOIN road_nodes nu ON nu.id = s.u_node_id
        JOIN road_nodes nv ON nv.id = s.v_node_id
        WHERE s.dataset_id = ?
          AND r.max_x >= ? AND r.min_x <= ?
          AND r.max_y >= ? AND r.min_y <= ?
        """,
        (
            dataset_id,
            raw_x_m - eff_radius,
            raw_x_m + eff_radius,
            raw_y_m - eff_radius,
            raw_y_m + eff_radius,
        ),
    ).fetchall()

    # Fallback to nearest segments across dataset if user clicked far from road network
    if not rows:
        rows = conn.execute(
            """
            SELECT s.id, s.edge_code, s.name, s.road_class, s.speed_limit_kmh, s.lanes,
                   s.length_m, s.elevation_level, s.wkt_m,
                   nu.degree AS u_deg, nu.node_type AS u_type,
                   nv.degree AS v_deg, nv.node_type AS v_type
            FROM road_segments s
            JOIN road_nodes nu ON nu.id = s.u_node_id
            JOIN road_nodes nv ON nv.id = s.v_node_id
            WHERE s.dataset_id = ?
            """,
            (dataset_id,),
        ).fetchall()

    ctx = dataset_context(conn, dataset_id)
    priors = _load_category_priors(conn, category_code)
    pt = Point(float(raw_x_m), float(raw_y_m))
    sigma_r = max(8.0, 0.55 * float(observational_radius_m))

    scored: list[dict[str, Any]] = []
    min_ortho = float("inf")
    naive_nearest_seg_id: int | None = None

    for r in rows:
        line = wkt_loads(r["wkt_m"])
        L = float(r["length_m"])
        m_proj = float(line.project(pt))
        m_proj = max(0.0, min(m_proj, L))
        sx_m, sy_m = interpolate_lrs_point(line, m_proj)
        d_ortho = math.hypot(sx_m - raw_x_m, sy_m - raw_y_m)

        if d_ortho < min_ortho:
            min_ortho = d_ortho
            naive_nearest_seg_id = int(r["id"])

        # 1. Spatial Gaussian emission likelihood
        spatial_lh = math.exp(-(d_ortho * d_ortho) / (2.0 * sigma_r * sigma_r))
        # Guard underflow if all segments are very far
        spatial_lh = max(spatial_lh, 1e-12)

        # 2. Road class & grade-separation prior given incident taxonomy
        rclass = str(r["road_class"])
        elev = int(r["elevation_level"])
        class_prior = float(priors.get(rclass, 0.75))
        if elev > 0 and category_code in ("PEDESTRIAN_CROSSING", "CYCLIST_CONFLICT", "ANGLE_INTERSECTION"):
            class_prior *= 0.15

        # 3. Intersection topological factor
        dist_to_u = m_proj
        dist_to_v = L - m_proj
        near_u = dist_to_u <= 38.0 and int(r["u_deg"]) >= 3
        near_v = dist_to_v <= 38.0 and int(r["v_deg"]) >= 3
        max_end_deg = max(int(r["u_deg"]) if near_u else 2, int(r["v_deg"]) if near_v else 2)

        if category_code == "ANGLE_INTERSECTION":
            topo_factor = 1.45 if (near_u or near_v) and elev == 0 else 0.45
        elif category_code in ("PEDESTRIAN_CROSSING", "CYCLIST_CONFLICT"):
            topo_factor = 1.20 if elev == 0 else 0.20
        else:
            topo_factor = 1.0 + 0.04 * max(0, max_end_deg - 2)

        unnorm_score = spatial_lh * class_prior * topo_factor
        slon, slat = to_wgs84(sx_m, sy_m, ctx.canonical_epsg)
        lixel_id = _find_lixel_for_offset(conn, int(r["id"]), m_proj)

        scored.append(
            {
                "segment_id": int(r["id"]),
                "edge_code": r["edge_code"],
                "segment_name": r["name"],
                "road_class": rclass,
                "elevation_level": elev,
                "speed_limit_kmh": int(r["speed_limit_kmh"]),
                "lixel_id": lixel_id,
                "linear_offset_m": round(m_proj, 3),
                "segment_length_m": round(L, 3),
                "orthogonal_dist_m": round(d_ortho, 3),
                "snapped_x_m": sx_m,
                "snapped_y_m": sy_m,
                "snapped_lon": slon,
                "snapped_lat": slat,
                "spatial_likelihood": round(spatial_lh, 5),
                "class_prior": round(class_prior, 4),
                "topo_factor": round(topo_factor, 4),
                "_unnorm": unnorm_score,
            }
        )

    scored.sort(key=lambda item: item["_unnorm"], reverse=True)
    top = scored[:max_candidates]
    total_mass = sum(item["_unnorm"] for item in top) or 1.0

    for rank_idx, item in enumerate(top):
        prob = item.pop("_unnorm") / total_mass
        item["snap_probability"] = round(float(prob), 4)
        item["rank"] = rank_idx + 1
        item["is_naive_euclidean_nearest"] = item["segment_id"] == naive_nearest_seg_id
        item["topological_override"] = (rank_idx == 0) and (item["segment_id"] != naive_nearest_seg_id)

    return top


def compute_single_report_credibility(
    *,
    snap_probability: float,
    reporter_trust: float,
    reporting_lag_min: float,
    observational_radius_m: float,
    witness_count: int = 1,
    attribute_consistency: float = 1.0,
) -> float:
    """
    Composite VGI Credibility Score C in [0, 1] (US-3.2):
    Monotonically increases with independent witness corroboration, topological snap certainty,
    reporter trust, low reporting time lag, and tight observational radius.
    """
    lag_factor = math.exp(-max(0.0, reporting_lag_min) / 180.0)
    radius_factor = math.exp(-max(0.0, observational_radius_m - 10.0) / 85.0)
    single_ev = 0.72 * max(0.15, snap_probability) * max(0.2, reporter_trust) * (0.45 + 0.55 * lag_factor) * (0.55 + 0.45 * radius_factor)
    single_ev = min(0.88, max(0.08, single_ev))

    # Independent multi-witness corroboration: 1 - (1 - p)^W
    combined = 1.0 - ((1.0 - single_ev) ** max(1, witness_count))
    final_score = combined * max(0.5, min(1.0, attribute_consistency))
    return round(float(min(0.995, max(0.05, final_score))), 4)


def find_spatiotemporal_conflation_candidates(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    snapped_segment_id: int,
    linear_offset_m: float,
    occurred_at_utc: str,
    category_code: str | None = None,
    max_net_dist_m: float = 150.0,
    max_time_diff_min: float = 75.0,
    exclude_accident_id: int | None = None,
) -> list[dict[str, Any]]:
    """
    Query spatiotemporal network neighborhood (US-2.3 & US-3.2):
    Evaluates shortest-path graph distance d_net <= max_net_dist_m AND |Delta t| <= max_time_diff_min.
    """
    topo = get_lixel_network_topology(conn, dataset_id)
    target_dt = parse_utc_iso(occurred_at_utc)

    # Pre-filter active incidents in dataset
    rows = conn.execute(
        """
        SELECT a.id, a.verification_status, a.source_type, a.occurred_at_utc,
               a.snapped_segment_id, a.linear_offset_m, a.snapped_lon, a.snapped_lat,
               a.vgi_credibility_score, a.witness_count, a.narrative,
               c.code AS category_code, c.label AS category_label,
               sv.code AS severity_code, sv.label AS severity_label, sv.color_hex,
               rs.name AS segment_name
        FROM accidents a
        JOIN accident_categories c ON c.id = a.category_id
        JOIN severity_levels sv ON sv.id = a.severity_id
        LEFT JOIN road_segments rs ON rs.id = a.snapped_segment_id
        WHERE a.dataset_id = ?
          AND a.snapped_segment_id IS NOT NULL
          AND a.verification_status IN ('unverified_raw_vgi', 'corroborated_pending', 'verified_canonical')
        """,
        (dataset_id,),
    ).fetchall()

    matches: list[dict[str, Any]] = []
    h_s = max(40.0, max_net_dist_m * 0.5)
    h_t = max(15.0, max_time_diff_min * 0.5)

    for r in rows:
        aid = int(r["id"])
        if exclude_accident_id is not None and aid == exclude_accident_id:
            continue
        dt_r = parse_utc_iso(r["occurred_at_utc"])
        time_diff_min = abs((target_dt - dt_r).total_seconds()) / 60.0
        if time_diff_min > max_time_diff_min:
            continue

        d_net = exact_network_distance_between_snapped_points(
            topo,
            snapped_segment_id,
            linear_offset_m,
            int(r["snapped_segment_id"]),
            float(r["linear_offset_m"] or 0.0),
        )
        if d_net > max_net_dist_m:
            continue

        cat_agree = 1.0 if (category_code is None or r["category_code"] == category_code) else 0.78
        st_kernel = math.exp(-d_net / h_s) * math.exp(-time_diff_min / h_t) * cat_agree

        matches.append(
            {
                "accident_id": aid,
                "verification_status": r["verification_status"],
                "source_type": r["source_type"],
                "occurred_at_utc": r["occurred_at_utc"],
                "segment_id": int(r["snapped_segment_id"]),
                "segment_name": r["segment_name"],
                "linear_offset_m": round(float(r["linear_offset_m"] or 0.0), 2),
                "network_distance_m": round(d_net, 2),
                "time_diff_min": round(time_diff_min, 1),
                "spatiotemporal_kernel_score": round(st_kernel, 4),
                "category_code": r["category_code"],
                "category_label": r["category_label"],
                "severity_code": r["severity_code"],
                "severity_label": r["severity_label"],
                "severity_color": r["color_hex"],
                "vgi_credibility_score": float(r["vgi_credibility_score"]),
                "witness_count": int(r["witness_count"]),
                "snapped_lon": float(r["snapped_lon"]),
                "snapped_lat": float(r["snapped_lat"]),
                "narrative": r["narrative"],
            }
        )

    matches.sort(key=lambda m: m["spatiotemporal_kernel_score"], reverse=True)
    return matches
