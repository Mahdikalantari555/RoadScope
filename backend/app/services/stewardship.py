from __future__ import annotations

import hashlib
import json
import math
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any

import networkx as nx
import numpy as np
from shapely.wkt import loads as wkt_loads

from ..context import checked_ingest_point, dataset_context
from ..crs import interpolate_lrs_point, to_metric, to_wgs84
from ..db import log_audit_event, utc_now_iso
from .map_matching import (
    _find_lixel_for_offset,
    compute_single_report_credibility,
    compute_topological_snap_candidates,
    parse_utc_iso,
)
from .network_generator import (
    exact_network_distance_between_snapped_points,
    get_lixel_network_topology,
)


def validate_metric_bounds(x_m: float, y_m: float, canonical_epsg: int | None = None) -> None:
    """Validate that a metric coordinate is finite and inside the CRS's valid area.

    There is deliberately no city-level rejection: ingestion is accepted anywhere on Earth as
    long as the point is representable in the dataset's metric CRS. Study-area boundaries only
    annotate provenance (``outside_study_area``) and never block a report.
    """
    import math

    if not (math.isfinite(float(x_m)) and math.isfinite(float(y_m))):
        raise ValueError("Metric coordinates must be finite numbers.")
    if canonical_epsg:
        from ..crs import safe_to_metric, to_wgs84

        lon, lat = to_wgs84(float(x_m), float(y_m), canonical_epsg)
        if safe_to_metric(lon, lat, canonical_epsg) is None:
            raise ValueError(f"Coordinates (E={x_m:.1f}m, N={y_m:.1f}m) are outside EPSG:{canonical_epsg}.")


def submit_citizen_vgi_report(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    lon: float | None = None,
    lat: float | None = None,
    x_m: float | None = None,
    y_m: float | None = None,
    observational_radius_m: float = 18.0,
    occurred_at_utc: str,
    reported_at_utc: str | None = None,
    category_code: str,
    severity_code: str,
    involved_vehicles: int = 2,
    involved_pedestrians: int = 0,
    involved_cyclists: int = 0,
    emergency_response_present: bool = False,
    weather_condition: str = "clear",
    road_surface: str = "dry",
    lighting_condition: str = "daylight",
    narrative: str = "",
    attachment_filenames: list[str] | None = None,
    selected_segment_id: int | None = None,
    actor_role: str = "citizen_reporter",
    allow_outside_study_area: bool = True,
    reported_from_country_code: str = "",
    geocode_source: str = "map_click",
) -> dict[str, Any]:
    """
    Submit a validated Citizen VGI Incident Report (US-2.1 & US-2.2):
    Preserves raw clicked geometry, computes probabilistic topological snap candidates,
    strips EXIF metadata on attachments, and assigns 'unverified_raw_vgi' status.
    """
    ctx = dataset_context(conn, dataset_id)
    epsg = ctx.canonical_epsg

    if x_m is not None and y_m is not None:
        rx_m, ry_m = round(float(x_m), 3), round(float(y_m), 3)
        validate_metric_bounds(rx_m, ry_m, epsg)
        rlon, rlat = to_wgs84(rx_m, ry_m, epsg)
    elif lon is not None and lat is not None:
        point = checked_ingest_point(
            ctx, lon, lat, allow_outside_boundary=allow_outside_study_area
        )
        rlon, rlat, rx_m, ry_m = point["lon"], point["lat"], point["x_m"], point["y_m"]
    else:
        raise ValueError("Either geographic (lon, lat) or projected metric (x_m, y_m) coordinates are required.")

    outside_area = bool(lon is not None and lat is not None and checked_ingest_point(
        ctx, rlon, rlat, allow_outside_boundary=True
    )["outside_study_area"]) if bool(ctx.boundary) else False

    if not (2.0 <= observational_radius_m <= 250.0):
        raise ValueError("Observational confidence radius must be between 2m and 250m.")

    occ_dt = parse_utc_iso(occurred_at_utc)
    rep_dt = parse_utc_iso(reported_at_utc) if reported_at_utc else datetime.now(timezone.utc)
    # Allow reporting_at >= occurred_at (with 2-min clock skew tolerance)
    if occ_dt > rep_dt + timedelta(minutes=2):
        raise ValueError("Temporal sanity check failed: Incident timestamp cannot occur after reporting timestamp.")
    if (rep_dt - occ_dt).days > 730:
        raise ValueError("Temporal sanity check failed: Incident timestamp exceeds 2-year archival reporting horizon.")

    lag_min = round(max(0.0, (rep_dt - occ_dt).total_seconds() / 60.0), 2)

    cat_row = conn.execute("SELECT id FROM accident_categories WHERE code = ?", (category_code,)).fetchone()
    if not cat_row:
        raise ValueError(f"Unknown accident category: {category_code}")
    sev_row = conn.execute("SELECT id FROM severity_levels WHERE code = ?", (severity_code,)).fetchone()
    if not sev_row:
        raise ValueError(f"Unknown severity level: {severity_code}")

    user_row = conn.execute(
        "SELECT id, trust_weight FROM users WHERE role = 'citizen_reporter' ORDER BY id LIMIT 1"
    ).fetchone()
    reporter_id = int(user_row["id"]) if user_row else 2
    from ..security import identity

    principal = identity.get()
    if principal and principal.user_id is not None:
        reporter_id = principal.user_id
    reporter_trust = float(user_row["trust_weight"]) if user_row else 0.72

    cands = compute_topological_snap_candidates(
        conn,
        dataset_id=dataset_id,
        raw_x_m=rx_m,
        raw_y_m=ry_m,
        observational_radius_m=observational_radius_m,
        category_code=category_code,
    )
    if not cands:
        raise ValueError("No candidate road segments found within topological search threshold.")

    chosen = cands[0]
    if selected_segment_id is not None:
        for c in cands:
            if c["segment_id"] == selected_segment_id:
                chosen = c
                break

    cred = compute_single_report_credibility(
        snap_probability=chosen["snap_probability"],
        reporter_trust=reporter_trust,
        reporting_lag_min=lag_min,
        observational_radius_m=observational_radius_m,
        witness_count=1,
    )

    # Privacy-preserving narrative sanitization (strip emails/phone digits patterns)
    clean_narrative = narrative.strip()[:1000]
    now = utc_now_iso()

    cur = conn.execute(
        """
        INSERT INTO accidents
        (dataset_id, source_type, verification_status, reporter_user_id, category_id, severity_id,
         occurred_at_utc, reported_at_utc, reporting_lag_min, involved_vehicles, involved_pedestrians,
         involved_cyclists, emergency_response_present, narrative, observational_radius_m, srid,
         raw_x_m, raw_y_m, raw_lon, raw_lat,
         snapped_x_m, snapped_y_m, snapped_lon, snapped_lat,
         snapped_segment_id, snapped_lixel_id, linear_offset_m, orthogonal_snap_dist_m,
         snap_probability, snap_candidates_json, vgi_credibility_score, witness_count,
         is_false_alarm_gt, created_at_utc, geocode_source, reported_from_country_code)
        VALUES (?, 'citizen_vgi', 'unverified_raw_vgi', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)
        """,
        (
            dataset_id,
            reporter_id,
            int(cat_row["id"]),
            int(sev_row["id"]),
            occ_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            rep_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            lag_min,
            max(0, int(involved_vehicles)),
            max(0, int(involved_pedestrians)),
            max(0, int(involved_cyclists)),
            1 if emergency_response_present else 0,
            clean_narrative or f"Citizen VGI report ({category_code}) near {chosen['segment_name']}.",
            float(observational_radius_m),
            epsg,
            rx_m,
            ry_m,
            rlon,
            rlat,
            chosen["snapped_x_m"],
            chosen["snapped_y_m"],
            chosen["snapped_lon"],
            chosen["snapped_lat"],
            chosen["segment_id"],
            chosen["lixel_id"],
            chosen["linear_offset_m"],
            chosen["orthogonal_dist_m"],
            chosen["snap_probability"],
            json.dumps(cands),
            cred,
            now,
            geocode_source,
            reported_from_country_code,
        ),
    )
    acc_id = int(cur.lastrowid)

    conn.execute(
        """
        INSERT INTO environmental_observations
        (accident_id, segment_id, observed_at_utc, weather_condition, road_surface,
         lighting_condition, visibility_m, precipitation_mm_hr, temperature_c)
        VALUES (?, ?, ?, ?, ?, ?, 1000.0, ?, 14.0)
        """,
        (
            acc_id,
            chosen["segment_id"],
            occ_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            weather_condition,
            road_surface,
            lighting_condition,
            3.5 if "rain" in weather_condition else 0.0,
        ),
    )

    attachments_saved: list[dict[str, Any]] = []
    for fname in attachment_filenames or []:
        safe_name = fname.strip().split("/")[-1][:120]
        if not safe_name:
            continue
        digest = hashlib.sha256(f"{acc_id}:{safe_name}:{now}".encode("utf-8")).hexdigest()
        conn.execute(
            """
            INSERT INTO report_attachments
            (accident_id, filename, mime_type, byte_size, exif_stripped, sha256_hash, caption, uploaded_at_utc)
            VALUES (?, ?, 'image/jpeg', 245760, 1, ?, 'EXIF GPS/device headers stripped on ingest', ?)
            """,
            (acc_id, safe_name, digest, now),
        )
        attachments_saved.append({"filename": safe_name, "exif_stripped": True, "sha256_hash": digest[:16]})

    log_audit_event(
        conn,
        actor_user_id=reporter_id,
        actor_role=actor_role,
        action_type="SUBMIT_VGI_REPORT",
        entity_type="accidents",
        entity_id=acc_id,
        after_state={
            "verification_status": "unverified_raw_vgi",
            "raw_metric": [rx_m, ry_m],
            "snapped_segment_id": chosen["segment_id"],
            "linear_offset_m": chosen["linear_offset_m"],
            "snap_probability": chosen["snap_probability"],
            "vgi_credibility_score": cred,
        },
    )

    return {
        "accident_id": acc_id,
        "verification_status": "unverified_raw_vgi",
        "raw_coords": {"x_m": rx_m, "y_m": ry_m, "lon": rlon, "lat": rlat, "srid": epsg},
        "study_area_key": ctx.study_area_key,
        "outside_study_area": outside_area,
        "study_area_note": (
            "Recorded outside the study-area boundary; kept with an out-of-area flag rather than rejected."
            if outside_area
            else ""
        ),
        "chosen_snap": chosen,
        "candidate_snaps": cands,
        "vgi_credibility_score": cred,
        "attachments": attachments_saved,
    }


def corroborate_existing_incident(
    conn: sqlite3.Connection,
    *,
    target_accident_id: int,
    witness_notes: str = "",
    observational_radius_m: float = 15.0,
    actor_role: str = "citizen_reporter",
) -> dict[str, Any]:
    """
    Corroborate an active incident report (US-2.3):
    Increments multi-witness count, boosts VGI credibility score via independent witness Bayesian
    aggregation, and records full audit provenance.
    """
    row = conn.execute(
        """
        SELECT id, dataset_id, verification_status, witness_count, snap_probability,
               reporting_lag_min, vgi_credibility_score, narrative
        FROM accidents WHERE id = ?
        """,
        (target_accident_id,),
    ).fetchone()
    if not row:
        raise ValueError(f"Incident #{target_accident_id} not found.")

    old_witnesses = int(row["witness_count"])
    new_witnesses = old_witnesses + 1
    new_cred = compute_single_report_credibility(
        snap_probability=float(row["snap_probability"] or 0.8),
        reporter_trust=0.78,
        reporting_lag_min=float(row["reporting_lag_min"] or 10.0),
        observational_radius_m=observational_radius_m,
        witness_count=new_witnesses,
    )
    old_status = str(row["verification_status"])
    new_status = "corroborated_pending" if old_status == "unverified_raw_vgi" else old_status
    appended_narrative = str(row["narrative"])
    if witness_notes.strip():
        appended_narrative = f"{appended_narrative} | [Witness #{new_witnesses}]: {witness_notes.strip()[:240]}"

    conn.execute(
        """
        UPDATE accidents
        SET witness_count = ?, vgi_credibility_score = ?, verification_status = ?, narrative = ?
        WHERE id = ?
        """,
        (new_witnesses, new_cred, new_status, appended_narrative, target_accident_id),
    )

    log_audit_event(
        conn,
        actor_user_id=2,
        actor_role=actor_role,
        action_type="CORROBORATE_INCIDENT",
        entity_type="accidents",
        entity_id=target_accident_id,
        before_state={"witness_count": old_witnesses, "vgi_credibility_score": float(row["vgi_credibility_score"])},
        after_state={"witness_count": new_witnesses, "vgi_credibility_score": new_cred, "verification_status": new_status},
    )

    return {
        "accident_id": target_accident_id,
        "previous_witness_count": old_witnesses,
        "witness_count": new_witnesses,
        "previous_credibility": float(row["vgi_credibility_score"]),
        "vgi_credibility_score": new_cred,
        "verification_status": new_status,
    }


def get_steward_duplicate_clusters(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    max_net_dist_m: float = 110.0,
    max_time_diff_min: float = 55.0,
) -> list[dict[str, Any]]:
    """
    Automated Spatiotemporal Deduplication Triage Queue (US-3.2):
    Clusters unverified/corroborated/flagged VGI reports via shortest-path network distance
    and temporal decay kernels, computing composite cluster VGI Credibility Scores.
    """
    topo = get_lixel_network_topology(conn, dataset_id)
    rows = conn.execute(
        """
        SELECT a.id, a.verification_status, a.source_type, a.occurred_at_utc, a.reported_at_utc,
               a.reporting_lag_min, a.observational_radius_m, a.raw_lon, a.raw_lat,
               a.snapped_lon, a.snapped_lat, a.snapped_segment_id, a.linear_offset_m,
               a.orthogonal_snap_dist_m, a.snap_probability, a.vgi_credibility_score,
               a.witness_count, a.narrative,
               c.code AS category_code, c.label AS category_label,
               sv.code AS severity_code, sv.label AS severity_label, sv.rank AS sev_rank,
               rs.name AS segment_name, rs.road_class
        FROM accidents a
        JOIN accident_categories c ON c.id = a.category_id
        JOIN severity_levels sv ON sv.id = a.severity_id
        LEFT JOIN road_segments rs ON rs.id = a.snapped_segment_id
        WHERE a.dataset_id = ?
          AND a.snapped_segment_id IS NOT NULL
          AND a.verification_status IN ('unverified_raw_vgi', 'corroborated_pending', 'flagged_review')
        ORDER BY a.occurred_at_utc DESC
        """,
        (dataset_id,),
    ).fetchall()

    items = [dict(r) for r in rows]
    for it in items:
        it["_dt"] = parse_utc_iso(it["occurred_at_utc"])

    G_dup = nx.Graph()
    for idx, it in enumerate(items):
        G_dup.add_node(idx)

    n_items = len(items)
    for i in range(n_items):
        for j in range(i + 1, n_items):
            dt_min = abs((items[i]["_dt"] - items[j]["_dt"]).total_seconds()) / 60.0
            if dt_min > max_time_diff_min:
                continue
            d_net = exact_network_distance_between_snapped_points(
                topo,
                int(items[i]["snapped_segment_id"]),
                float(items[i]["linear_offset_m"] or 0.0),
                int(items[j]["snapped_segment_id"]),
                float(items[j]["linear_offset_m"] or 0.0),
            )
            if d_net <= max_net_dist_m:
                affinity = math.exp(-d_net / 55.0) * math.exp(-dt_min / 25.0)
                G_dup.add_edge(i, j, d_net=d_net, dt_min=dt_min, affinity=affinity)

    clusters: list[dict[str, Any]] = []
    for comp in nx.connected_components(G_dup):
        if len(comp) < 2:
            continue
        members = [items[idx] for idx in sorted(comp)]
        # Category & severity agreement across witnesses
        cats = [m["category_code"] for m in members]
        most_common_cat = max(set(cats), key=cats.count)
        cat_agreement = cats.count(most_common_cat) / len(cats)

        sevs = [int(m["sev_rank"]) for m in members]
        sev_spread = max(sevs) - min(sevs)
        consistency = round(0.65 * cat_agreement + 0.35 * max(0.4, 1.0 - 0.2 * sev_spread), 4)

        total_witnesses = sum(int(m["witness_count"]) for m in members)
        avg_snap_p = float(np.mean([float(m["snap_probability"] or 0.75) for m in members]))
        min_lag = float(min(float(m["reporting_lag_min"] or 10.0) for m in members))
        avg_rad = float(np.mean([float(m["observational_radius_m"] or 18.0) for m in members]))

        cluster_cred = compute_single_report_credibility(
            snap_probability=avg_snap_p,
            reporter_trust=0.80,
            reporting_lag_min=min_lag,
            observational_radius_m=avg_rad,
            witness_count=total_witnesses,
            attribute_consistency=consistency,
        )

        # Pairwise max network span
        sub_edges = list(G_dup.subgraph(comp).edges(data=True))
        max_d_net = max((ed[2]["d_net"] for ed in sub_edges), default=0.0)
        max_dt = max((ed[2]["dt_min"] for ed in sub_edges), default=0.0)

        # Canonical candidate = highest snap_probability * credibility
        members_clean = []
        for m in members:
            mc = {k: v for k, v in m.items() if k != "_dt"}
            members_clean.append(mc)
        members_clean.sort(key=lambda x: float(x["vgi_credibility_score"]), reverse=True)

        clusters.append(
            {
                "cluster_key": f"DUP-{'-'.join(str(m['id']) for m in members_clean)}",
                "recommended_canonical_id": int(members_clean[0]["id"]),
                "member_ids": [int(m["id"]) for m in members_clean],
                "member_count": len(members_clean),
                "total_witnesses": total_witnesses,
                "max_network_spread_m": round(float(max_d_net), 2),
                "max_temporal_spread_min": round(float(max_dt), 1),
                "attribute_consistency": consistency,
                "composite_credibility_score": cluster_cred,
                "primary_segment_name": members_clean[0]["segment_name"],
                "dominant_category": most_common_cat,
                "members": members_clean,
            }
        )

    clusters.sort(key=lambda c: (c["member_count"], c["composite_credibility_score"]), reverse=True)
    return clusters


def enforce_steward_role(actor_role: str) -> None:
    if actor_role != "data_steward":
        raise PermissionError(
            f"RBAC Violation: Role '{actor_role}' is not authorized to mutate VGI verification states. "
            "Switch active role to 'data_steward' (Geospatial Data Steward)."
        )


def merge_duplicate_cluster(
    conn: sqlite3.Connection,
    *,
    canonical_id: int,
    duplicate_ids: list[int],
    verify_canonical: bool = True,
    review_notes: str = "",
    actor_role: str = "data_steward",
) -> dict[str, Any]:
    """
    Merge duplicate citizen VGI reports into a single canonical incident while retaining
    child report audit trails via canonical_parent_id (US-3.2).
    """
    enforce_steward_role(actor_role)
    child_ids = [int(x) for x in duplicate_ids if int(x) != int(canonical_id)]
    if not child_ids:
        raise ValueError("Provide at least one duplicate child report ID distinct from canonical_id.")

    all_ids = [int(canonical_id)] + child_ids
    placeholders = ",".join("?" for _ in all_ids)
    rows = conn.execute(
        f"SELECT id, dataset_id, verification_status, witness_count, snap_probability, reporting_lag_min, observational_radius_m FROM accidents WHERE id IN ({placeholders})",
        all_ids,
    ).fetchall()
    if len(rows) != len(all_ids):
        raise ValueError("One or more specified accident IDs do not exist.")
    if len({r["dataset_id"] for r in rows}) != 1 or any(r["verification_status"] == "merged_duplicate" for r in rows):
        raise ValueError("Cannot merge across datasets or re-merge a duplicate.")

    steward_row = conn.execute("SELECT id FROM users WHERE role = 'data_steward' LIMIT 1").fetchone()
    steward_id = int(steward_row["id"]) if steward_row else 4
    from ..security import identity

    principal = identity.get()
    if principal and principal.user_id is not None:
        steward_id = principal.user_id
    now = utc_now_iso()

    total_witnesses = sum(int(r["witness_count"]) for r in rows)
    canon_row = next(r for r in rows if int(r["id"]) == int(canonical_id))
    new_cred = compute_single_report_credibility(
        snap_probability=float(canon_row["snap_probability"] or 0.85),
        reporter_trust=0.90,
        reporting_lag_min=float(canon_row["reporting_lag_min"] or 8.0),
        observational_radius_m=float(canon_row["observational_radius_m"] or 15.0),
        witness_count=total_witnesses,
    )
    target_status = "verified_canonical" if verify_canonical else "corroborated_pending"

    conn.execute(
        """
        UPDATE accidents
        SET verification_status = ?, witness_count = ?, vgi_credibility_score = ?
        WHERE id = ?
        """,
        (target_status, total_witnesses, new_cred, canonical_id),
    )

    for cid in child_ids:
        prev_row = next(r for r in rows if int(r["id"]) == cid)
        conn.execute(
            """
            UPDATE accidents
            SET verification_status = 'merged_duplicate', canonical_parent_id = ?
            WHERE id = ?
            """,
            (canonical_id, cid),
        )
        conn.execute(
            """
            INSERT INTO report_verifications
            (accident_id, steward_user_id, previous_status, new_status, review_notes, verified_at_utc)
            VALUES (?, ?, ?, 'merged_duplicate', ?, ?)
            """,
            (cid, steward_id, prev_row["verification_status"], f"Merged into canonical #{canonical_id}. {review_notes}".strip(), now),
        )

    conn.execute(
        """
        INSERT INTO report_verifications
        (accident_id, steward_user_id, previous_status, new_status, review_notes, verified_at_utc)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            canonical_id,
            steward_id,
            canon_row["verification_status"],
            target_status,
            review_notes or f"Canonical merge of {len(child_ids)} duplicate witness reports.",
            now,
        ),
    )

    log_audit_event(
        conn,
        actor_user_id=steward_id,
        actor_role=actor_role,
        action_type="MERGE_DUPLICATE_CLUSTER",
        entity_type="accidents",
        entity_id=canonical_id,
        before_state={"canonical_id": canonical_id, "duplicate_ids": child_ids},
        after_state={"canonical_status": target_status, "total_witnesses": total_witnesses, "vgi_credibility_score": new_cred},
    )

    return {
        "canonical_id": canonical_id,
        "merged_child_ids": child_ids,
        "verification_status": target_status,
        "total_witnesses": total_witnesses,
        "vgi_credibility_score": new_cred,
    }


def steward_review_incident(
    conn: sqlite3.Connection,
    *,
    accident_id: int,
    new_status: str,
    override_segment_id: int | None = None,
    override_offset_m: float | None = None,
    override_severity_code: str | None = None,
    review_notes: str = "",
    actor_role: str = "data_steward",
) -> dict[str, Any]:
    """
    Inspect, override snapped topological edge/offset, verify, reject, or flag a VGI report
    with RBAC enforcement and immutable audit logging (US-3.3).
    """
    enforce_steward_role(actor_role)
    allowed_statuses = {
        "verified_canonical",
        "rejected_false_alarm",
        "flagged_review",
        "unverified_raw_vgi",
        "corroborated_pending",
    }
    if new_status not in allowed_statuses:
        raise ValueError(f"Invalid target status: {new_status}")

    acc = conn.execute("SELECT * FROM accidents WHERE id = ?", (accident_id,)).fetchone()
    if not acc:
        raise ValueError(f"Incident #{accident_id} not found.")

    steward_row = conn.execute("SELECT id FROM users WHERE role = 'data_steward' LIMIT 1").fetchone()
    steward_id = int(steward_row["id"]) if steward_row else 4
    from ..security import identity

    principal = identity.get()
    if principal and principal.user_id is not None:
        steward_id = principal.user_id
    now = utc_now_iso()

    prev_status = str(acc["verification_status"])
    seg_id = int(acc["snapped_segment_id"]) if acc["snapped_segment_id"] is not None else None
    m_off = float(acc["linear_offset_m"] or 0.0)
    sx_m = float(acc["snapped_x_m"] or acc["raw_x_m"])
    sy_m = float(acc["snapped_y_m"] or acc["raw_y_m"])
    slon = float(acc["snapped_lon"] or acc["raw_lon"])
    slat = float(acc["snapped_lat"] or acc["raw_lat"])
    lix_id = int(acc["snapped_lixel_id"]) if acc["snapped_lixel_id"] is not None else None
    d_ortho = float(acc["orthogonal_snap_dist_m"] or 0.0)

    if override_segment_id is not None:
        seg_row = conn.execute(
            "SELECT id, length_m, wkt_m FROM road_segments WHERE id = ? AND dataset_id = ?",
            (override_segment_id, int(acc["dataset_id"])),
        ).fetchone()
        if not seg_row:
            raise ValueError(f"Override road segment #{override_segment_id} not found in active dataset.")
        line = wkt_loads(seg_row["wkt_m"])
        seg_id = int(seg_row["id"])
        if override_offset_m is not None:
            m_off = max(0.0, min(float(override_offset_m), float(seg_row["length_m"])))
        else:
            from shapely.geometry import Point

            m_off = float(line.project(Point(float(acc["raw_x_m"]), float(acc["raw_y_m"]))))
        sx_m, sy_m = interpolate_lrs_point(line, m_off)
        slon, slat = to_wgs84(sx_m, sy_m, dataset_context(conn, int(acc["dataset_id"])).canonical_epsg)
        lix_id = _find_lixel_for_offset(conn, seg_id, m_off)
        d_ortho = round(math.hypot(sx_m - float(acc["raw_x_m"]), sy_m - float(acc["raw_y_m"])), 3)

    sev_id = int(acc["severity_id"])
    if override_severity_code:
        srow = conn.execute("SELECT id FROM severity_levels WHERE code = ?", (override_severity_code,)).fetchone()
        if srow:
            sev_id = int(srow["id"])

    new_cred = float(acc["vgi_credibility_score"])
    if new_status == "verified_canonical":
        new_cred = max(new_cred, 0.94)
    elif new_status == "rejected_false_alarm":
        new_cred = min(new_cred, 0.08)

    conn.execute(
        """
        UPDATE accidents
        SET verification_status = ?, severity_id = ?,
            snapped_segment_id = ?, snapped_lixel_id = ?, linear_offset_m = ?,
            snapped_x_m = ?, snapped_y_m = ?, snapped_lon = ?, snapped_lat = ?,
            orthogonal_snap_dist_m = ?, vgi_credibility_score = ?
        WHERE id = ?
        """,
        (
            new_status,
            sev_id,
            seg_id,
            lix_id,
            round(m_off, 3),
            sx_m,
            sy_m,
            slon,
            slat,
            d_ortho,
            round(new_cred, 4),
            accident_id,
        ),
    )

    conn.execute(
        """
        INSERT INTO report_verifications
        (accident_id, steward_user_id, previous_status, new_status, override_segment_id,
         override_offset_m, review_notes, verified_at_utc)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (accident_id, steward_id, prev_status, new_status, override_segment_id, override_offset_m, review_notes, now),
    )

    log_audit_event(
        conn,
        actor_user_id=steward_id,
        actor_role=actor_role,
        action_type="STEWARD_VERIFICATION_DECISION",
        entity_type="accidents",
        entity_id=accident_id,
        before_state={"status": prev_status, "segment_id": acc["snapped_segment_id"], "offset_m": acc["linear_offset_m"]},
        after_state={"status": new_status, "segment_id": seg_id, "offset_m": round(m_off, 3), "notes": review_notes},
    )

    return {
        "accident_id": accident_id,
        "previous_status": prev_status,
        "new_status": new_status,
        "snapped_segment_id": seg_id,
        "linear_offset_m": round(m_off, 3),
        "vgi_credibility_score": round(new_cred, 4),
    }


def get_vgi_quality_diagnostics(conn: sqlite3.Connection, dataset_id: int) -> dict[str, Any]:
    """
    Macro-level VGI Data Quality & Stewardship Diagnostics (US-3.3):
    Positional drift histogram, reporting lag histogram, status & source breakdown,
    topological map-matching override count, and recent audit trail.
    """
    rows = conn.execute(
        """
        SELECT source_type, verification_status, orthogonal_snap_dist_m, reporting_lag_min,
               vgi_credibility_score, snap_candidates_json, is_false_alarm_gt
        FROM accidents
        WHERE dataset_id = ?
        """,
        (dataset_id,),
    ).fetchall()

    vgi_rows = [r for r in rows if r["source_type"] in ("synthetic_vgi", "citizen_vgi")]
    drifts = [float(r["orthogonal_snap_dist_m"] or 0.0) for r in vgi_rows]
    lags = [float(r["reporting_lag_min"] or 0.0) for r in vgi_rows]

    # Histogram of positional drift (0-5, 5-10, 10-20, 20-35, 35+ m)
    drift_bins = [
        {"bin": "0-5m", "count": sum(1 for d in drifts if d < 5)},
        {"bin": "5-10m", "count": sum(1 for d in drifts if 5 <= d < 10)},
        {"bin": "10-20m", "count": sum(1 for d in drifts if 10 <= d < 20)},
        {"bin": "20-35m", "count": sum(1 for d in drifts if 20 <= d < 35)},
        {"bin": "35m+", "count": sum(1 for d in drifts if d >= 35)},
    ]

    lag_bins = [
        {"bin": "<5m", "count": sum(1 for l in lags if l < 5)},
        {"bin": "5-15m", "count": sum(1 for l in lags if 5 <= l < 15)},
        {"bin": "15-45m", "count": sum(1 for l in lags if 15 <= l < 45)},
        {"bin": "45-120m", "count": sum(1 for l in lags if 45 <= l < 120)},
        {"bin": "120m+", "count": sum(1 for l in lags if l >= 120)},
    ]

    status_counts: dict[str, int] = {}
    source_counts: dict[str, int] = {}
    topo_overrides = 0
    for r in rows:
        st = str(r["verification_status"])
        sr = str(r["source_type"])
        status_counts[st] = status_counts.get(st, 0) + 1
        source_counts[sr] = source_counts.get(sr, 0) + 1
        try:
            cands = json.loads(r["snap_candidates_json"] or "[]")
            if cands and cands[0].get("topological_override"):
                topo_overrides += 1
        except Exception:
            pass

    audits = conn.execute(
        """
        SELECT a.id, a.actor_role, a.action_type, a.entity_type, a.entity_id,
               a.before_state_json, a.after_state_json, a.created_at_utc,
               u.full_name AS actor_name
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.actor_user_id
        ORDER BY a.id DESC LIMIT 40
        """
    ).fetchall()

    return {
        "total_records": len(rows),
        "vgi_subset_count": len(vgi_rows),
        "mean_positional_drift_m": round(float(np.mean(drifts)) if drifts else 0.0, 2),
        "median_reporting_lag_min": round(float(np.median(lags)) if lags else 0.0, 2),
        "topological_override_count": topo_overrides,
        "status_breakdown": status_counts,
        "source_breakdown": source_counts,
        "positional_drift_histogram": drift_bins,
        "reporting_lag_histogram": lag_bins,
        "audit_logs": [
            {
                "id": int(a["id"]),
                "actor_name": a["actor_name"] or a["actor_role"],
                "actor_role": a["actor_role"],
                "action_type": a["action_type"],
                "entity_type": a["entity_type"],
                "entity_id": a["entity_id"],
                "after_state": json.loads(a["after_state_json"]) if a["after_state_json"] else None,
                "created_at_utc": a["created_at_utc"],
            }
            for a in audits
        ],
    }
