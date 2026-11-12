from __future__ import annotations

import json
import math
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
from shapely.wkt import loads as wkt_loads

from ..context import dataset_context
from ..crs import interpolate_lrs_point, to_wgs84
from ..db import log_audit_event, utc_now_iso
from .map_matching import (
    compute_single_report_credibility,
    compute_topological_snap_candidates,
)
from .network_generator import (
    TEHRAN_DEMO_ORIGIN_3857,
    create_network_and_lixels,
    invalidate_topology_cache,
)
from .study_area_service import resolve_study_area

# Demo hotspots are defined relative to the synthetic network origin (see
# network_generator.TEHRAN_DEMO_ORIGIN_3857) so they stay valid for any CRS.
_DEMO_OX, _DEMO_OY = TEHRAN_DEMO_ORIGIN_3857
DEMO_HOTSPOTS = [
    (_DEMO_OX + 1770.0, _DEMO_OY + 1420.0, 240.0, 1.65),  # bridge/expressway interchange
    (_DEMO_OX + 2100.0, _DEMO_OY + 1400.0, 260.0, 1.45),  # central signalised hub
]

SCENARIO_METADATA: dict[str, dict[str, Any]] = {
    "MULTI_COVARIATE_URBAN": {
        "title": "Multi-Covariate Complex Urban (Cox-Poisson)",
        "description": "Inhomogeneous network Cox/Poisson intensity combining AADT exposure, junction shortest-path decay, road curvature/bridges, diurnal waves, and wet-weather shocks.",
    },
    "INTERSECTION_CLUSTERED": {
        "title": "Intersection-Clustered Network Process",
        "description": "Strong exponential decay around true topological junctions (alpha=5.8, tau=42m), excluding grade-separated overpass spans.",
    },
    "DIURNAL_RUSH_HOUR_SHOCK": {
        "title": "Diurnal Commuter Rush-Hour Shock",
        "description": "Concentrated bimodal commuter shocks (07:00-09:00 & 16:30-19:00) along primary arterials and Main River bridges.",
    },
    "UNIFORM_BASELINE": {
        "title": "Complete Spatial Randomness on Network (CSR-Net)",
        "description": "Homogeneous 1D Poisson baseline lambda(e,m,t) = lambda_0 across all road lixels for null-hypothesis benchmarking.",
    },
}


def _sample_diurnal_hour(rng: np.random.Generator, scenario_key: str) -> tuple[int, int]:
    """Return (day_of_week 0=Mon..6=Sun, hour_utc 0..23) with realistic urban rush-hour waves."""
    if scenario_key == "UNIFORM_BASELINE":
        return int(rng.integers(0, 7)), int(rng.integers(0, 24))

    dow_probs = np.array([0.155, 0.160, 0.160, 0.165, 0.175, 0.105, 0.080])
    dow_probs /= dow_probs.sum()
    dow = int(rng.choice(7, p=dow_probs))

    hours = np.arange(24)
    if scenario_key == "DIURNAL_RUSH_HOUR_SHOCK":
        weights = (
            0.12
            + 2.8 * np.exp(-0.5 * ((hours - 8.0) / 1.1) ** 2)
            + 3.4 * np.exp(-0.5 * ((hours - 17.5) / 1.3) ** 2)
        )
    else:
        if dow < 5:
            weights = (
                0.22
                + 1.65 * np.exp(-0.5 * ((hours - 8.0) / 1.5) ** 2)
                + 2.10 * np.exp(-0.5 * ((hours - 17.2) / 1.8) ** 2)
                + 0.45 * np.exp(-0.5 * ((hours - 13.0) / 2.2) ** 2)
            )
        else:
            weights = (
                0.35
                + 0.85 * np.exp(-0.5 * ((hours - 14.5) / 3.0) ** 2)
                + 1.15 * np.exp(-0.5 * ((hours - 22.5) / 2.0) ** 2)
                + 0.65 * np.exp(-0.5 * ((hours - 1.5) / 1.5) ** 2)
            )
    weights /= weights.sum()
    hr = int(rng.choice(24, p=weights))
    return dow, hr


def _choose_category_and_severity(
    rng: np.random.Generator,
    road_class: str,
    elevation_level: int,
    dist_junc_m: float,
    weather: str,
    cat_map: dict[str, int],
    sev_map: dict[str, int],
) -> tuple[str, int, str, int]:
    if elevation_level > 0 or road_class == "motorway_overpass":
        cat_choices = ["REAR_END", "SIDESWIPE", "RUN_OFF_ROAD", "MULTI_VEHICLE_PILEUP"]
        cat_p = np.array([0.46, 0.26, 0.16, 0.12])
    elif dist_junc_m < 35.0:
        cat_choices = ["ANGLE_INTERSECTION", "REAR_END", "PEDESTRIAN_CROSSING", "CYCLIST_CONFLICT", "SIDESWIPE"]
        cat_p = np.array([0.40, 0.24, 0.16, 0.13, 0.07])
    elif road_class in ("local_street", "collector"):
        cat_choices = ["PEDESTRIAN_CROSSING", "CYCLIST_CONFLICT", "ANGLE_INTERSECTION", "REAR_END", "RUN_OFF_ROAD"]
        cat_p = np.array([0.28, 0.27, 0.20, 0.17, 0.08])
    else:
        cat_choices = ["REAR_END", "SIDESWIPE", "ANGLE_INTERSECTION", "CYCLIST_CONFLICT", "PEDESTRIAN_CROSSING", "RUN_OFF_ROAD"]
        cat_p = np.array([0.34, 0.20, 0.16, 0.12, 0.09, 0.09])

    if weather in ("rain", "heavy_rain", "snow_ice") and "RUN_OFF_ROAD" in cat_choices:
        idx_ror = cat_choices.index("RUN_OFF_ROAD")
        cat_p[idx_ror] += 0.12
    cat_p /= cat_p.sum()
    cat_code = str(rng.choice(cat_choices, p=cat_p))

    if cat_code in ("PEDESTRIAN_CROSSING", "MULTI_VEHICLE_PILEUP"):
        sev_p = np.array([0.30, 0.40, 0.23, 0.07])
    elif road_class in ("motorway_overpass", "primary_arterial", "bridge_link"):
        sev_p = np.array([0.54, 0.30, 0.125, 0.035])
    else:
        sev_p = np.array([0.64, 0.26, 0.085, 0.015])
    sev_codes = ["PDO", "MINOR_INJURY", "SERIOUS_INJURY", "FATAL"]
    sev_code = str(rng.choice(sev_codes, p=sev_p))
    return cat_code, cat_map[cat_code], sev_code, sev_map[sev_code]


def run_stochastic_network_simulation(
    conn: sqlite3.Connection,
    *,
    scenario_key: str = "MULTI_COVARIATE_URBAN",
    lixel_resolution_m: float = 25.0,
    random_seed: int = 42,
    base_intensity_scale: float = 1.0,
    vgi_positional_sigma_m: float = 14.0,
    vgi_duplicate_rate: float = 0.35,
    vgi_false_alarm_count: int = 12,
    study_period_years: float = 1.0,
    activate_dataset: bool = True,
    actor_role: str = "simulation_scientist",
    study_area_key: str | None = None,
    network_generator: str | None = None,
) -> dict[str, Any]:
    """
    Generate a complete seeded synthetic road network, lixelation, mathematical ground-truth
    intensity lambda(e,m,t), verified crash realizations, and noisy/multi-witness VGI reports.
    """
    if scenario_key not in SCENARIO_METADATA:
        raise ValueError(f"Unsupported scenario_key: {scenario_key}")

    rng = np.random.default_rng(random_seed)
    meta = SCENARIO_METADATA[scenario_key]
    now = utc_now_iso()

    params = {
        "scenario_key": scenario_key,
        "lixel_resolution_m": lixel_resolution_m,
        "random_seed": random_seed,
        "base_intensity_scale": base_intensity_scale,
        "vgi_positional_sigma_m": vgi_positional_sigma_m,
        "vgi_duplicate_rate": vgi_duplicate_rate,
        "vgi_false_alarm_count": vgi_false_alarm_count,
        "study_period_years": study_period_years,
    }

    if activate_dataset:
        conn.execute("UPDATE dataset_sources SET is_active = 0")

    area = resolve_study_area(study_area_key)
    epsg = int(area.canonical_epsg)
    generator = network_generator or area.network_generator
    params.update({"study_area_key": area.key, "network_generator": generator})

    ds_name = (
        f"[SYNTHETIC] {meta['title']} · {area.name_en} "
        f"(Lixel {int(lixel_resolution_m)}m · Seed {random_seed})"
    )
    cur = conn.execute(
        """
        INSERT INTO dataset_sources
        (name, scenario_key, is_synthetic, crs_epsg, lixel_resolution_m, study_period_years,
         random_seed, generator_params_json, description, study_area_key, epsg_definition,
         is_active, created_at_utc)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            ds_name,
            scenario_key,
            epsg,
            float(lixel_resolution_m),
            float(study_period_years),
            int(random_seed),
            json.dumps(params),
            meta["description"],
            area.key,
            f"EPSG:{epsg}",
            1 if activate_dataset else 0,
            now,
        ),
    )
    dataset_id = int(cur.lastrowid)

    net_stats = create_network_and_lixels(
        conn,
        dataset_id=dataset_id,
        lixel_resolution_m=lixel_resolution_m,
        rng_seed=random_seed,
        network_generator=generator or "tehran_demo_v1",
    )

    # Load segments + lixels to evaluate exact analytical ground-truth intensity lambda(e, m)
    seg_rows = conn.execute(
        """
        SELECT s.id, s.name, s.road_class, s.speed_limit_kmh, s.lanes, s.length_m,
               s.sinuosity, s.slope_pct, s.elevation_level, s.wkt_m,
               t.aadt_vehicles_per_day AS eff_aadt
        FROM road_segments s
        LEFT JOIN traffic_observations t ON t.segment_id = s.id AND t.dataset_id = s.dataset_id
        WHERE s.dataset_id = ?
        """,
        (dataset_id,),
    ).fetchall()
    seg_dict = {int(r["id"]): dict(r) for r in seg_rows}
    for s in seg_dict.values():
        s["geom"] = wkt_loads(s["wkt_m"])

    lix_rows = conn.execute(
        """
        SELECT id, parent_segment_id, m_start_m, m_end_m, length_m, midpoint_m,
               dist_to_nearest_junction_m, mid_x_m, mid_y_m
        FROM road_lixels
        WHERE dataset_id = ?
        ORDER BY id
        """,
        (dataset_id,),
    ).fetchall()

    # Evaluate true mathematical intensity lambda_q (crashes per km per year) on every lixel
    lambda_updates: list[tuple[float, int]] = []
    lixel_records: list[dict[str, Any]] = []

    class_mult = {
        "motorway_overpass": 1.15,
        "primary_arterial": 1.35,
        "bridge_link": 1.48,
        "secondary_corridor": 1.05,
        "collector": 0.72,
        "local_street": 0.45,
    }

    for r in lix_rows:
        lid = int(r["id"])
        sid = int(r["parent_segment_id"])
        s = seg_dict[sid]
        d_junc = float(r["dist_to_nearest_junction_m"])
        aadt = float(s["eff_aadt"] or 10000.0)
        sinu = float(s["sinuosity"])
        elev = int(s["elevation_level"])
        rclass = str(s["road_class"])

        if scenario_key == "UNIFORM_BASELINE":
            lam = 8.2 * base_intensity_scale
        elif scenario_key == "INTERSECTION_CLUSTERED":
            junc_term = 1.0 + (5.8 * math.exp(-d_junc / 42.0) if elev == 0 else 0.15)
            lam = 3.2 * base_intensity_scale * junc_term * (aadt / 18000.0) ** 0.35
        elif scenario_key == "DIURNAL_RUSH_HOUR_SHOCK":
            corridor_boost = 2.35 if rclass in ("primary_arterial", "bridge_link", "motorway_overpass") else 0.45
            junc_term = 1.0 + (1.8 * math.exp(-d_junc / 55.0) if elev == 0 else 0.1)
            lam = 4.6 * base_intensity_scale * corridor_boost * junc_term * (aadt / 18000.0) ** 0.65
        else:
            # MULTI_COVARIATE_URBAN: Cox-Poisson spatial surface
            exposure_term = (aadt / 15000.0) ** 0.72
            junc_term = 1.0 + (3.25 * math.exp(-d_junc / 48.0) if elev == 0 else 0.25)
            geom_term = 1.0 + 2.4 * max(0.0, sinu - 1.0) + 0.08 * abs(float(s["slope_pct"]))
            # Two deterministic hotspot corridors of the seeded demo network: a bridge approach
            # and a central signalised hub. Coordinates are derived from the demo origin, so the
            # intensity surface never depends on a hard-coded city.
            spatial_hotspot = 1.0
            mx, my = float(r["mid_x_m"]), float(r["mid_y_m"])
            for hx, hy, radius_m, boost in DEMO_HOTSPOTS:
                if math.hypot(mx - hx, my - hy) < radius_m and elev == 0:
                    spatial_hotspot += boost
            lam = 3.4 * base_intensity_scale * class_mult.get(rclass, 1.0) * exposure_term * junc_term * geom_term * spatial_hotspot

        lam = round(float(lam), 4)
        lambda_updates.append((lam, lid))
        lixel_records.append(
            {
                "id": lid,
                "segment_id": sid,
                "m_start_m": float(r["m_start_m"]),
                "m_end_m": float(r["m_end_m"]),
                "length_m": float(r["length_m"]),
                "dist_junc_m": d_junc,
                "lambda": lam,
            }
        )

    conn.executemany(
        "UPDATE road_lixels SET true_lambda_per_km_yr = ? WHERE id = ?",
        lambda_updates,
    )
    invalidate_topology_cache(dataset_id)

    # Lookup IDs for categories, severities, and users
    cat_map = {
        r["code"]: int(r["id"])
        for r in conn.execute("SELECT id, code FROM accident_categories").fetchall()
    }
    sev_map = {
        r["code"]: int(r["id"])
        for r in conn.execute("SELECT id, code FROM severity_levels").fetchall()
    }
    user_rows = conn.execute("SELECT id, role, trust_weight FROM users").fetchall()
    citizen_users = [(int(r["id"]), float(r["trust_weight"])) for r in user_rows if r["role"] == "citizen_reporter"]
    steward_id = next((int(r["id"]) for r in user_rows if r["role"] == "data_steward"), 1)

    # Reference temporal window: trailing 365 days up to 2026-11-10 UTC
    end_dt = datetime(2026, 11, 10, 23, 0, 0, tzinfo=timezone.utc)
    start_dt = end_dt - timedelta(days=int(round(365 * study_period_years)))

    verified_count = 0
    vgi_raw_count = 0
    duplicate_burst_count = 0

    for lix in lixel_records:
        expected_crashes = lix["lambda"] * (lix["length_m"] / 1000.0) * study_period_years
        n_events = int(rng.poisson(expected_crashes))
        if n_events <= 0:
            continue

        seg = seg_dict[lix["segment_id"]]
        line = seg["geom"]
        elev = int(seg["elevation_level"])
        rclass = str(seg["road_class"])

        for ev_idx in range(n_events):
            gt_uid = f"GT-{dataset_id}-{lix['id']}-{ev_idx}"
            m_exact = float(rng.uniform(lix["m_start_m"], lix["m_end_m"]))
            tx_m, ty_m = interpolate_lrs_point(line, m_exact)
            tlon, tlat = to_wgs84(tx_m, ty_m)

            # Sample timestamp with diurnal + weekly structure
            dow, hour_utc = _sample_diurnal_hour(rng, scenario_key)
            week_idx = int(rng.integers(0, max(1, int(52 * study_period_years))))
            minute = int(rng.integers(0, 60))
            occ_dt = start_dt + timedelta(days=week_idx * 7 + dow, hours=hour_utc, minutes=minute)
            if occ_dt > end_dt:
                occ_dt = end_dt - timedelta(hours=int(rng.integers(1, 72)))
            occ_iso = occ_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

            # Environmental state
            weather = str(
                rng.choice(
                    ["clear", "rain", "heavy_rain", "fog", "snow_ice"],
                    p=[0.64, 0.21, 0.06, 0.06, 0.03],
                )
            )
            surface = (
                "dry"
                if weather == "clear"
                else ("icy" if weather == "snow_ice" else ("standing_water" if weather == "heavy_rain" else "wet"))
            )
            lighting = (
                "daylight"
                if 7 <= hour_utc <= 16
                else ("twilight" if hour_utc in (6, 17, 18) else ("night_lit" if rclass != "local_street" else "night_unlit"))
            )

            cat_code, cat_id, sev_code, sev_id = _choose_category_and_severity(
                rng, rclass, elev, lix["dist_junc_m"], weather, cat_map, sev_map
            )

            vehicles = 1 if cat_code == "RUN_OFF_ROAD" else (int(rng.integers(3, 6)) if cat_code == "MULTI_VEHICLE_PILEUP" else 2)
            peds = 1 if cat_code == "PEDESTRIAN_CROSSING" else 0
            cycs = 1 if cat_code == "CYCLIST_CONFLICT" else 0
            emerg = 1 if sev_code in ("SERIOUS_INJURY", "FATAL") or rng.random() < 0.35 else 0

            # 82% of ground-truth realizations are already steward-verified canonical records;
            # 18% remain purely in the VGI citizen triage pipeline as noisy/multi-witness observations!
            is_verified_gt = rng.random() < 0.82

            if is_verified_gt:
                lag_min = round(float(rng.lognormal(mean=2.1, sigma=0.5)), 1)
                rep_iso = (occ_dt + timedelta(minutes=lag_min)).strftime("%Y-%m-%dT%H:%M:%SZ")
                # Slight GPS jitter on raw coordinate (~3.5m), exact snapped geometry on network
                rx_m = round(tx_m + float(rng.normal(0.0, 3.5)), 3)
                ry_m = round(ty_m + float(rng.normal(0.0, 3.5)), 3)
                rlon, rlat = to_wgs84(rx_m, ry_m)
                d_ortho = round(math.hypot(tx_m - rx_m, ty_m - ry_m), 3)

                cur_acc = conn.execute(
                    """
                    INSERT INTO accidents
                    (dataset_id, source_type, verification_status, reporter_user_id, category_id, severity_id,
                     occurred_at_utc, reported_at_utc, reporting_lag_min, involved_vehicles, involved_pedestrians,
                     involved_cyclists, emergency_response_present, narrative, observational_radius_m, srid,
                     raw_x_m, raw_y_m, raw_lon, raw_lat,
                     snapped_x_m, snapped_y_m, snapped_lon, snapped_lat,
                     snapped_segment_id, snapped_lixel_id, linear_offset_m, orthogonal_snap_dist_m,
                     snap_probability, snap_candidates_json, vgi_credibility_score, witness_count,
                     is_false_alarm_gt, gt_source_event_uid, created_at_utc)
                    VALUES (?, 'ground_truth_realization', 'verified_canonical', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 8.0, ?,
                            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.97, '[]', 0.96, 1, 0, ?, ?)
                    """,
                    (
                        dataset_id,
                        steward_id,
                        cat_id,
                        sev_id,
                        occ_iso,
                        rep_iso,
                        lag_min,
                        vehicles,
                        peds,
                        cycs,
                        emerg,
                        f"Confirmed {cat_code.lower().replace('_', ' ')} on {seg['name']} (LRS m={m_exact:.1f}m).",
                        epsg,
                        rx_m,
                        ry_m,
                        rlon,
                        rlat,
                        tx_m,
                        ty_m,
                        tlon,
                        tlat,
                        lix["segment_id"],
                        lix["id"],
                        round(m_exact, 3),
                        d_ortho,
                        gt_uid,
                        now,
                    ),
                )
                acc_id = int(cur_acc.lastrowid)
                verified_count += 1
                conn.execute(
                    """
                    INSERT INTO environmental_observations
                    (accident_id, segment_id, observed_at_utc, weather_condition, road_surface,
                     lighting_condition, visibility_m, precipitation_mm_hr, temperature_c)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        acc_id,
                        lix["segment_id"],
                        occ_iso,
                        weather,
                        surface,
                        lighting,
                        round(float(rng.uniform(120, 350) if weather == "fog" else rng.uniform(800, 2500)), 0),
                        round(float(rng.uniform(2.5, 14.0) if "rain" in weather else 0.0), 1),
                        round(float(rng.uniform(-2.0, 2.0) if weather == "snow_ice" else rng.uniform(7.0, 22.0)), 1),
                    ),
                )
            else:
                # Inject VGI Citizen Reports with 2D Gaussian positional drift + multi-witness bursts!
                is_burst = (sev_code in ("SERIOUS_INJURY", "FATAL")) or (rng.random() < vgi_duplicate_rate)
                n_witnesses = int(rng.integers(2, 4)) if is_burst else 1
                if n_witnesses > 1:
                    duplicate_burst_count += 1

                for w_idx in range(n_witnesses):
                    c_uid, c_trust = citizen_users[(ev_idx + w_idx) % len(citizen_users)]
                    rx_m = round(tx_m + float(rng.normal(0.0, vgi_positional_sigma_m)), 3)
                    ry_m = round(ty_m + float(rng.normal(0.0, vgi_positional_sigma_m)), 3)
                    rlon, rlat = to_wgs84(rx_m, ry_m)
                    obs_rad = round(max(8.0, float(rng.uniform(12.0, 35.0))), 1)

                    # Witness temporal jitter & reporting lag
                    w_occ_dt = occ_dt + timedelta(minutes=float(rng.normal(0.0, 4.0)))
                    lag_min = round(max(1.5, float(rng.lognormal(mean=2.6, sigma=0.75))), 1)
                    w_rep_dt = w_occ_dt + timedelta(minutes=lag_min)

                    cands = compute_topological_snap_candidates(
                        conn,
                        dataset_id=dataset_id,
                        raw_x_m=rx_m,
                        raw_y_m=ry_m,
                        observational_radius_m=obs_rad,
                        category_code=cat_code,
                    )
                    best = cands[0]
                    cred = compute_single_report_credibility(
                        snap_probability=best["snap_probability"],
                        reporter_trust=c_trust,
                        reporting_lag_min=lag_min,
                        observational_radius_m=obs_rad,
                        witness_count=1,
                    )
                    status = "corroborated_pending" if n_witnesses > 1 and w_idx == 0 else "unverified_raw_vgi"

                    cur_vgi = conn.execute(
                        """
                        INSERT INTO accidents
                        (dataset_id, source_type, verification_status, reporter_user_id, category_id, severity_id,
                         occurred_at_utc, reported_at_utc, reporting_lag_min, involved_vehicles, involved_pedestrians,
                         involved_cyclists, emergency_response_present, narrative, observational_radius_m, srid,
                         raw_x_m, raw_y_m, raw_lon, raw_lat,
                         snapped_x_m, snapped_y_m, snapped_lon, snapped_lat,
                         snapped_segment_id, snapped_lixel_id, linear_offset_m, orthogonal_snap_dist_m,
                         snap_probability, snap_candidates_json, vgi_credibility_score, witness_count,
                         is_false_alarm_gt, gt_source_event_uid, created_at_utc)
                        VALUES (?, 'synthetic_vgi', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
                        """,
                        (
                            dataset_id,
                            status,
                            c_uid,
                            cat_id,
                            sev_id,
                            w_occ_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                            w_rep_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                            lag_min,
                            vehicles,
                            peds,
                            cycs,
                            emerg,
                            f"Citizen witness #{w_idx + 1}: observed {cat_code.lower().replace('_', ' ')} near {best['segment_name']}.",
                            obs_rad,
                            epsg,
                            rx_m,
                            ry_m,
                            rlon,
                            rlat,
                            best["snapped_x_m"],
                            best["snapped_y_m"],
                            best["snapped_lon"],
                            best["snapped_lat"],
                            best["segment_id"],
                            best["lixel_id"],
                            best["linear_offset_m"],
                            best["orthogonal_dist_m"],
                            best["snap_probability"],
                            json.dumps(cands[:3]),
                            cred,
                            gt_uid,
                            now,
                        ),
                    )
                    vgi_id = int(cur_vgi.lastrowid)
                    vgi_raw_count += 1
                    conn.execute(
                        """
                        INSERT INTO environmental_observations
                        (accident_id, segment_id, observed_at_utc, weather_condition, road_surface,
                         lighting_condition, visibility_m, precipitation_mm_hr, temperature_c)
                        VALUES (?, ?, ?, ?, ?, ?, 1200.0, 0.0, 14.0)
                        """,
                        (vgi_id, best["segment_id"], w_occ_dt.strftime("%Y-%m-%dT%H:%M:%SZ"), weather, surface, lighting),
                    )

    # Specifically inject 2 deterministic overpass-crossing VGI reports (pedestrian/cyclist on the
    # surface street directly beneath an elevated expressway span) so stewards can immediately inspect
    # Probabilistic Topological Map-Matching overriding Naive Euclidean Nearest-Neighbor.
    # Two deterministic reports whose surface location sits directly beneath the elevated
    # expressway span, so stewards can inspect topological map-matching overriding a naive
    # Euclidean nearest-neighbour that would snap them to the overpass deck.
    overpass_demo_points = [
        (
            _DEMO_OX + 1782.0, _DEMO_OY + 1395.0, "PEDESTRIAN_CROSSING", "MINOR_INJURY",
            "Pedestrian clipped at crosswalk directly beneath the elevated expressway span.",
        ),
        (
            _DEMO_OX + 2102.0, _DEMO_OY + 2082.0, "CYCLIST_CONFLICT", "SERIOUS_INJURY",
            "Cyclist right-hook conflict on the surface street under the elevated highway.",
        ),
    ]
    for idx_ov, (ox, oy, ocat, osev, onarr) in enumerate(overpass_demo_points):
        c_uid, c_trust = citizen_users[idx_ov % len(citizen_users)]
        olon, olat = to_wgs84(ox, oy)
        cands = compute_topological_snap_candidates(
            conn,
            dataset_id=dataset_id,
            raw_x_m=ox,
            raw_y_m=oy,
            observational_radius_m=22.0,
            category_code=ocat,
        )
        best = cands[0]
        occ_dt = end_dt - timedelta(days=3 + idx_ov, hours=6)
        rep_dt = occ_dt + timedelta(minutes=9)
        cred = compute_single_report_credibility(
            snap_probability=best["snap_probability"],
            reporter_trust=c_trust,
            reporting_lag_min=9.0,
            observational_radius_m=22.0,
            witness_count=1,
        )
        cur_ov = conn.execute(
            """
            INSERT INTO accidents
            (dataset_id, source_type, verification_status, reporter_user_id, category_id, severity_id,
             occurred_at_utc, reported_at_utc, reporting_lag_min, involved_vehicles, involved_pedestrians,
             involved_cyclists, emergency_response_present, narrative, observational_radius_m, srid,
             raw_x_m, raw_y_m, raw_lon, raw_lat,
             snapped_x_m, snapped_y_m, snapped_lon, snapped_lat,
             snapped_segment_id, snapped_lixel_id, linear_offset_m, orthogonal_snap_dist_m,
             snap_probability, snap_candidates_json, vgi_credibility_score, witness_count,
             is_false_alarm_gt, gt_source_event_uid, created_at_utc)
            VALUES (?, 'synthetic_vgi', 'flagged_review', ?, ?, ?, ?, ?, 9.0, 1, ?, ?, 1, ?, 22.0, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
            """,
            (
                dataset_id,
                c_uid,
                cat_map[ocat],
                sev_map[osev],
                occ_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                rep_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                1 if ocat == "PEDESTRIAN_CROSSING" else 0,
                1 if ocat == "CYCLIST_CONFLICT" else 0,
                onarr,
                epsg,
                ox,
                oy,
                olon,
                olat,
                best["snapped_x_m"],
                best["snapped_y_m"],
                best["snapped_lon"],
                best["snapped_lat"],
                best["segment_id"],
                best["lixel_id"],
                best["linear_offset_m"],
                best["orthogonal_dist_m"],
                best["snap_probability"],
                json.dumps(cands[:4]),
                cred,
                f"GT-OVP-{dataset_id}-{idx_ov}",
                now,
            ),
        )
        conn.execute(
            """
            INSERT INTO environmental_observations
            (accident_id, segment_id, observed_at_utc, weather_condition, road_surface,
             lighting_condition, visibility_m, precipitation_mm_hr, temperature_c)
            VALUES (?, ?, ?, 'rain', 'wet', 'twilight', 650.0, 3.2, 11.5)
            """,
            (int(cur_ov.lastrowid), best["segment_id"], occ_dt.strftime("%Y-%m-%dT%H:%M:%SZ")),
        )
        vgi_raw_count += 1

    # Inject unverified False Alarm VGI noise points (off-road / large lag / low credibility)
    for fa_idx in range(vgi_false_alarm_count):
        c_uid, _ = citizen_users[fa_idx % len(citizen_users)]
        bbox = conn.execute(
            "SELECT min(min_x) AS x0, max(max_x) AS x1, min(min_y) AS y0, max(max_y) AS y1 "
            "FROM road_segments WHERE dataset_id = ?",
            (dataset_id,),
        ).fetchone()
        fx = round(float(rng.uniform(bbox["x0"], bbox["x1"])), 3)
        fy = round(float(rng.uniform(bbox["y0"], bbox["y1"])), 3)
        flon, flat = to_wgs84(fx, fy)
        obs_rad = round(float(rng.uniform(38.0, 75.0)), 1)
        lag_min = round(float(rng.uniform(95.0, 420.0)), 1)
        occ_dt = end_dt - timedelta(days=int(rng.integers(2, 180)), hours=int(rng.integers(0, 24)))
        rep_dt = occ_dt + timedelta(minutes=lag_min)

        cands = compute_topological_snap_candidates(
            conn,
            dataset_id=dataset_id,
            raw_x_m=fx,
            raw_y_m=fy,
            observational_radius_m=obs_rad,
            category_code="PDO" if "PDO" in cat_map else "REAR_END",
        )
        best = cands[0]
        cred = compute_single_report_credibility(
            snap_probability=best["snap_probability"],
            reporter_trust=0.45,
            reporting_lag_min=lag_min,
            observational_radius_m=obs_rad,
            witness_count=1,
        )
        conn.execute(
            """
            INSERT INTO accidents
            (dataset_id, source_type, verification_status, reporter_user_id, category_id, severity_id,
             occurred_at_utc, reported_at_utc, reporting_lag_min, involved_vehicles, involved_pedestrians,
             involved_cyclists, emergency_response_present, narrative, observational_radius_m, srid,
             raw_x_m, raw_y_m, raw_lon, raw_lat,
             snapped_x_m, snapped_y_m, snapped_lon, snapped_lat,
             snapped_segment_id, snapped_lixel_id, linear_offset_m, orthogonal_snap_dist_m,
             snap_probability, snap_candidates_json, vgi_credibility_score, witness_count,
             is_false_alarm_gt, gt_source_event_uid, created_at_utc)
            VALUES (?, 'synthetic_vgi', 'unverified_raw_vgi', ?, ?, ?, ?, ?, ?, 1, 0, 0, 0, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, NULL, ?)
            """,
            (
                dataset_id,
                c_uid,
                cat_map["REAR_END"],
                sev_map["PDO"],
                occ_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                rep_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                lag_min,
                "Unverified noisy report: heard loud braking sound from adjacent block, exact spot uncertain.",
                obs_rad,
                epsg,
                fx,
                fy,
                flon,
                flat,
                best["snapped_x_m"],
                best["snapped_y_m"],
                best["snapped_lon"],
                best["snapped_lat"],
                best["segment_id"],
                best["lixel_id"],
                best["linear_offset_m"],
                best["orthogonal_dist_m"],
                best["snap_probability"],
                json.dumps(cands[:3]),
                cred,
                now,
            ),
        )
        vgi_raw_count += 1

    log_audit_event(
        conn,
        actor_user_id=1,
        actor_role=actor_role,
        action_type="SIMULATE_STOCHASTIC_DATASET",
        entity_type="dataset_sources",
        entity_id=dataset_id,
        after_state={
            "dataset_id": dataset_id,
            "scenario_key": scenario_key,
            "verified_crashes": verified_count,
            "vgi_reports": vgi_raw_count,
            **net_stats,
        },
    )

    return {
        "dataset_id": dataset_id,
        "name": ds_name,
        "scenario_key": scenario_key,
        "is_synthetic": True,
        "crs_epsg": epsg,
        "lixel_resolution_m": lixel_resolution_m,
        "random_seed": random_seed,
        "verified_crash_count": verified_count,
        "vgi_report_count": vgi_raw_count,
        "duplicate_burst_groups": duplicate_burst_count,
        **net_stats,
    }
