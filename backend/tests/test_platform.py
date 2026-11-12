from __future__ import annotations

import math
import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def test_client() -> TestClient:
    tmp_dir = tempfile.mkdtemp(prefix="uai_test_")
    db_file = Path(tmp_dir) / "test_uai.sqlite"
    os.environ["ROADSCOPE_DEMO_MODE"] = "true"
    os.environ["UAI_SQLITE_PATH"] = str(db_file)

    # Reload config/db modules against isolated test DB
    import importlib
    import app.config as cfg
    import app.db as db_mod
    import app.main as main_mod

    importlib.reload(cfg)
    importlib.reload(db_mod)
    importlib.reload(main_mod)

    with TestClient(main_mod.app) as client:
        yield client


def test_health_and_dual_crs_meta(test_client: TestClient) -> None:
    res = test_client.get("/api/v1/health")
    assert res.status_code == 200
    body = res.json()
    assert body["canonical_crs"] == "EPSG:25832"
    assert body["web_crs"] == "EPSG:4326"
    assert body["datasets_initialized"] >= 1

    meta = test_client.get("/api/v1/meta").json()
    assert meta["active_dataset"]["is_synthetic"] is True
    assert meta["active_dataset"]["crs_epsg"] == 25832
    assert len(meta["categories"]) >= 7
    assert len(meta["severities"]) == 4


def test_crs_roundtrip_projection(test_client: TestClient) -> None:
    p1 = test_client.post("/api/v1/crs/project", json={"x_m": 477600.0, "y_m": 5551950.0})
    assert p1.status_code == 200
    d1 = p1.json()
    assert 8.60 < d1["lon"] < 8.78
    assert 50.05 < d1["lat"] < 50.18

    p2 = test_client.post("/api/v1/crs/project", json={"lon": d1["lon"], "lat": d1["lat"]}).json()
    assert abs(p2["x_m"] - 477600.0) < 0.05
    assert abs(p2["y_m"] - 5551950.0) < 0.05


def test_network_distance_exceeds_euclidean_across_river_and_overpass() -> None:
    from app.db import db_session
    from app.services.network_generator import (
        exact_network_distance_between_snapped_points,
        get_lixel_network_topology,
    )

    with db_session() as conn:
        ds_id = int(conn.execute("SELECT id FROM dataset_sources WHERE is_active = 1").fetchone()["id"])
        topo = get_lixel_network_topology(conn, ds_id)

        # Find two river quays on opposite banks of the Main River (Schaumainkai vs Mainkai at column 2)
        s_south = conn.execute(
            "SELECT id, length_m FROM road_segments WHERE dataset_id = ? AND name LIKE 'Schaumainkai%[3]%'",
            (ds_id,),
        ).fetchone()
        s_north = conn.execute(
            "SELECT id, length_m FROM road_segments WHERE dataset_id = ? AND name LIKE 'Mainkai (North Quay)%[3]%'",
            (ds_id,),
        ).fetchone()
        assert s_south and s_north

        d_net = exact_network_distance_between_snapped_points(
            topo,
            int(s_south["id"]),
            float(s_south["length_m"]) * 0.5,
            int(s_north["id"]),
            float(s_north["length_m"]) * 0.5,
        )
        # Straight-line distance across the Main River is ~320m, whereas shortest-path via bridge is > 750m!
        assert d_net > 750.0

        # Grade-separated overpass midspan vs crossed Berliner Strasse underneath:
        s_ovp = conn.execute(
            "SELECT id, length_m FROM road_segments WHERE dataset_id = ? AND elevation_level = 1 AND name LIKE '%Elevated Span Süd%'",
            (ds_id,),
        ).fetchone()
        s_art = conn.execute(
            "SELECT id, length_m FROM road_segments WHERE dataset_id = ? AND elevation_level = 0 AND name LIKE '%Berliner%[3]%'",
            (ds_id,),
        ).fetchone()
        assert s_ovp and s_art
        d_ovp_net = exact_network_distance_between_snapped_points(
            topo,
            int(s_ovp["id"]),
            float(s_ovp["length_m"]) * 0.9,
            int(s_art["id"]),
            20.0,
        )
        # Despite crossing right over Berliner Strasse in 2D (<30m Euclidean), network path must travel to terminal ramp (>1400m)!
        assert d_ovp_net > 1400.0


def test_probabilistic_topological_map_matching_overpass_disambiguation(test_client: TestClient) -> None:
    """
    Verify US-3.1: At the grade-separated overpass crossing (E=477604, N=5551955),
    a PEDESTRIAN_CROSSING crash located closer in 2D Euclidean space to the elevated motorway
    centerline MUST be topologically matched to the surface arterial underneath!
    """
    res = test_client.post(
        "/api/v1/vgi/preview-snap-and-conflate",
        json={
            "x_m": 477604.0,
            "y_m": 5551962.0,
            "observational_radius_m": 22.0,
            "occurred_at_utc": "2026-11-08T17:30:00Z",
            "category_code": "PEDESTRIAN_CROSSING",
        },
    )
    assert res.status_code == 200
    cands = res.json()["candidate_snaps"]
    assert len(cands) >= 2
    best = cands[0]
    assert best["elevation_level"] == 0, "Pedestrian crash must snap to surface street, not elevated motorway overpass!"
    assert best["road_class"] != "motorway_overpass"


def test_vgi_validation_corroboration_and_steward_rbac(test_client: TestClient) -> None:
    # 1. Out-of-bounds metric coordinates rejected
    bad_coord = test_client.post(
        "/api/v1/vgi/submit",
        json={
            "x_m": 100000.0,
            "y_m": 100000.0,
            "observational_radius_m": 15.0,
            "occurred_at_utc": "2026-11-09T10:00:00Z",
            "reported_at_utc": "2026-11-09T10:15:00Z",
            "category_code": "REAR_END",
            "severity_code": "PDO",
        },
    )
    assert bad_coord.status_code == 422

    # 2. Temporal sanity check: occurred_at AFTER reported_at rejected
    bad_time = test_client.post(
        "/api/v1/vgi/submit",
        json={
            "x_m": 477800.0,
            "y_m": 5551950.0,
            "observational_radius_m": 15.0,
            "occurred_at_utc": "2026-11-09T12:00:00Z",
            "reported_at_utc": "2026-11-09T10:00:00Z",
            "category_code": "REAR_END",
            "severity_code": "PDO",
        },
    )
    assert bad_time.status_code == 422

    # 3. Valid citizen VGI report starts strictly as unverified_raw_vgi with EXIF-stripped attachment
    ok_sub = test_client.post(
        "/api/v1/vgi/submit",
        json={
            "x_m": 477820.0,
            "y_m": 5551952.0,
            "observational_radius_m": 16.0,
            "occurred_at_utc": "2026-11-09T08:15:00Z",
            "reported_at_utc": "2026-11-09T08:22:00Z",
            "category_code": "REAR_END",
            "severity_code": "MINOR_INJURY",
            "narrative": "Two-car rear-end queue impact at morning signal.",
            "attachment_filenames": ["dashcam_frame_01.jpg"],
        },
    )
    assert ok_sub.status_code == 200
    sub_data = ok_sub.json()
    acc_id = sub_data["accident_id"]
    assert sub_data["verification_status"] == "unverified_raw_vgi"
    assert sub_data["attachments"][0]["exif_stripped"] is True
    initial_cred = sub_data["vgi_credibility_score"]

    # 4. Multi-witness corroboration boosts credibility & witness_count
    corr = test_client.post(
        f"/api/v1/vgi/{acc_id}/corroborate",
        json={"witness_notes": "Confirmed ambulance on scene.", "observational_radius_m": 12.0},
    )
    assert corr.status_code == 200
    corr_data = corr.json()
    assert corr_data["witness_count"] == 2
    assert corr_data["vgi_credibility_score"] > initial_cred
    assert corr_data["verification_status"] == "corroborated_pending"

    # 5. RBAC check: non-steward cannot verify report
    forbidden = test_client.post(
        "/api/v1/steward/review",
        json={
            "accident_id": acc_id,
            "new_status": "verified_canonical",
            "actor_role": "citizen_reporter",
        },
    )
    assert forbidden.status_code == 403

    # 6. Steward role succeeds and logs verification
    allowed = test_client.post(
        "/api/v1/steward/review",
        json={
            "accident_id": acc_id,
            "new_status": "verified_canonical",
            "review_notes": "Verified against dual witness reports.",
            "actor_role": "data_steward",
        },
    )
    assert allowed.status_code == 200
    assert allowed.json()["new_status"] == "verified_canonical"


def test_nkde_mass_conservation_and_ground_truth_benchmark(test_client: TestClient) -> None:
    res = test_client.post(
        "/api/v1/lab/nkde",
        json={
            "kernel": "quartic",
            "bandwidth_m": 180.0,
            "weighting": "uniform",
            "equal_split_mass_conserving": True,
            "include_unverified_vgi": False,
        },
    )
    assert res.status_code == 200
    body = res.json()
    sm = body["summary_metrics"]
    # Mass conservation: integral of NKDE over all lixels equals exact crash count!
    assert math.isclose(sm["total_weighted_mass"], sm["conserved_nkde_mass"], rel_tol=1e-3)
    assert body["ground_truth_eval"] is not None
    assert body["ground_truth_eval"]["nkde"]["pai"] > 1.0

    # Export job as GeoJSON & CSV
    job_id = body["job_id"]
    exp_geo = test_client.get(f"/api/v1/lab/jobs/{job_id}/export?fmt=geojson")
    assert exp_geo.status_code == 200
    assert exp_geo.json()["type"] == "FeatureCollection"

    exp_csv = test_client.get(f"/api/v1/lab/jobs/{job_id}/export?fmt=csv")
    assert exp_csv.status_code == 200
    assert "nkde_density" in exp_csv.text


def test_network_gi_star_and_ndbscan(test_client: TestClient) -> None:
    gi_res = test_client.post(
        "/api/v1/lab/autocorrelation",
        json={
            "weight_scheme": "inverse_network_distance",
            "distance_threshold_m": 200.0,
            "permutations": 199,
            "attribute_mode": "crash_density",
        },
    )
    assert gi_res.status_code == 200
    gi_body = gi_res.json()
    assert gi_body["summary_metrics"]["assumptions_verified"]["positive_variance_ok"] is True
    assert "hotspot_99" in gi_body["summary_metrics"]["class_counts"]

    db_res = test_client.post(
        "/api/v1/lab/ndbscan",
        json={"eps_net_m": 90.0, "min_samples": 4},
    )
    assert db_res.status_code == 200
    assert db_res.json()["summary_metrics"]["cluster_count"] >= 1


def test_empirical_bayes_rtm_smoothing_and_cmv_cross_filtering(test_client: TestClient) -> None:
    eb_res = test_client.post(
        "/api/v1/risk/evaluate",
        json={
            "w_eb_risk": 0.45,
            "w_epdo_severity": 0.25,
            "w_geometric_hazard": 0.15,
            "w_environmental_cov": 0.15,
        },
    )
    assert eb_res.status_code == 200
    eb_data = eb_res.json()
    assert "NOT a calibrated crash probability" in eb_data["metric_epistemology_disclaimer"]
    corridors = eb_data["ranked_corridors"]
    assert len(corridors) > 30

    # Check EB mathematical shrinkage property: eb_expected lies strictly between spf_prior and raw_crash_frequency
    for c in corridors:
        lo = min(c["spf_prior_expected"], c["raw_crash_frequency"]) - 1e-3
        hi = max(c["spf_prior_expected"], c["raw_crash_frequency"]) + 1e-3
        assert lo <= c["eb_expected_crashes"] <= hi

    # Test CMV spatial bounding-box filter reduces incident count relative to full network
    full_cmv = test_client.post("/api/v1/analytics/cmv", json={"verification_mode": "verified_only"}).json()
    sub_cmv = test_client.post(
        "/api/v1/analytics/cmv",
        json={
            "verification_mode": "verified_only",
            "bbox_4326": [8.675, 50.108, 8.690, 50.118],
        },
    ).json()
    assert full_cmv["kpis"]["filtered_incidents"] > sub_cmv["kpis"]["filtered_incidents"] >= 0


def test_duplicate_cluster_merge_and_seeded_simulation(test_client: TestClient) -> None:
    ws = test_client.get("/api/v1/steward/workspace").json()
    clusters = ws["duplicate_clusters"]
    assert len(clusters) >= 1
    first = clusters[0]
    canon_id = first["recommended_canonical_id"]
    dup_ids = [mid for mid in first["member_ids"] if mid != canon_id]

    merge_res = test_client.post(
        "/api/v1/steward/merge-cluster",
        json={
            "canonical_id": canon_id,
            "duplicate_ids": dup_ids,
            "verify_canonical": True,
            "review_notes": "Automated test canonical merge.",
            "actor_role": "data_steward",
        },
    )
    assert merge_res.status_code == 200
    assert merge_res.json()["verification_status"] == "verified_canonical"

    # Generate new seeded INTERSECTION_CLUSTERED dataset at 50m lixel resolution
    sim_res = test_client.post(
        "/api/v1/simulator/generate",
        json={
            "scenario_key": "INTERSECTION_CLUSTERED",
            "lixel_resolution_m": 50.0,
            "random_seed": 77,
            "base_intensity_scale": 1.0,
            "vgi_positional_sigma_m": 12.0,
            "vgi_duplicate_rate": 0.3,
            "vgi_false_alarm_count": 5,
            "study_period_years": 1.0,
            "actor_role": "simulation_scientist",
        },
    )
    assert sim_res.status_code == 200
    assert sim_res.json()["lixel_resolution_m"] == 50.0

    # Verify compiled React/MapLibre SPA bundle is served at root
    spa = test_client.get("/")
    assert spa.status_code == 200
    assert "RoadScope" in spa.text

