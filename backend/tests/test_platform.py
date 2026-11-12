from __future__ import annotations

import math
import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def test_client() -> TestClient:
    with tempfile.TemporaryDirectory(prefix="roadscope_test_") as tmp_dir:
        db_file = Path(tmp_dir) / "test.sqlite"
        env = pytest.MonkeyPatch()
        env.setenv("ROADSCOPE_DEMO_MODE", "true")
        env.setenv("ROADSCOPE_SQLITE_PATH", str(db_file))
        env.setenv("UAI_SQLITE_PATH", str(db_file))
        env.setenv("ROADSCOPE_WEB_EPSG", "4326")
        env.setenv("ROADSCOPE_DEFAULT_STUDY_AREA", "tehran")
        env.setenv("ROADSCOPE_DEFAULT_SEED", "42")

        import importlib
        import app.config as cfg
        import app.db as db_mod
        import app.main as main_mod

        try:
            importlib.reload(cfg)
            importlib.reload(db_mod)
            importlib.reload(main_mod)
            with TestClient(main_mod.app) as client:
                yield client
        finally:
            env.undo()
            importlib.reload(cfg)
            importlib.reload(db_mod)
            importlib.reload(main_mod)


def test_health_and_dual_crs_meta(test_client: TestClient) -> None:
    res = test_client.get("/api/v1/health")
    assert res.status_code == 200
    body = res.json()
    # The default demo dataset is Tehran (metric EPSG:3857, valid worldwide).
    assert body["canonical_crs"] == "EPSG:3857"
    assert body["web_crs"] == "EPSG:4326"
    assert body["study_area_key"] == "tehran"
    assert body["datasets_initialized"] >= 1

    meta = test_client.get("/api/v1/meta").json()
    assert meta["active_dataset"]["is_synthetic"] is True
    assert meta["active_dataset"]["crs_epsg"] == 3857
    assert meta["active_dataset"]["study_area_key"] == "tehran"
    assert meta["ingestion_scope"] == "worldwide"
    assert meta["boundary_enforced"] is False
    assert any(a["key"] == "tehran" for a in meta["study_areas"])
    # The map framing comes from the data, not from a hard-coded city.
    assert meta["study_area_key"] == "tehran"
    assert 51.0 < meta["center_4326"][0] < 51.7 and 35.4 < meta["center_4326"][1] < 35.9
    assert meta["network_bbox_4326"] is None or meta["network_bbox_4326"]["min_lon"] > 50.0
    assert len(meta["categories"]) >= 7
    assert len(meta["severities"]) == 4


def test_directed_network_topology_api(test_client: TestClient) -> None:
    result = test_client.get("/api/v1/network/directed-topology").json()
    assert result["state_count"] > 0
    assert result["transition_count"] > 0
    assert result["assumed_bidirectional_segments"] > 0
    assert "not implemented" in result["status"]
    details = test_client.get("/api/v1/network/directed-topology?include_edges=true").json()
    assert len(details["states"]) == result["state_count"]
    assert len(details["transitions"]) == result["transition_count"]
    layers = test_client.get("/api/v1/network/layers?include_lixels=false").json()
    first = layers["segments_geojson"]["features"][0]["properties"]
    assert first["oneway_direction"] == 0
    assert first["direction_source"] == "assumed_bidirectional"
    initial = details["states"][0]
    response = test_client.post("/api/v1/network/directed-transport", json={**initial, "mass": 2, "duration_s": 10})
    assert response.status_code == 200, response.text
    transport = response.json()
    assert transport["final_mass"] == pytest.approx(2)
    assert transport["topology_version"] == result["topology_version"]
    assert transport["status"].startswith("experimental")
    invalid = test_client.post("/api/v1/network/directed-transport", json={**initial, "speed_m_s": 0})
    assert invalid.status_code == 422


def test_crs_roundtrip_projection(test_client: TestClient) -> None:
    # Round-trip a Tehran coordinate through the active dataset's metric CRS.
    p2 = test_client.post("/api/v1/crs/project", json={"lon": 51.3890, "lat": 35.6892}).json()
    assert 51.3 < p2["lon"] < 51.5 and 35.6 < p2["lat"] < 35.8
    assert p2["srid"] == 3857

    p1 = test_client.post("/api/v1/crs/project", json={"x_m": p2["x_m"], "y_m": p2["y_m"]})
    assert p1.status_code == 200
    d1 = p1.json()
    assert abs(d1["lon"] - 51.3890) < 1e-4
    assert abs(d1["lat"] - 35.6892) < 1e-4


DEMO_ORIGIN_3857 = (5719500.0, 4252000.0)


def test_network_distance_exceeds_euclidean_across_river_and_overpass() -> None:
    from app.db import db_session
    from app.services.network_generator import (
        exact_network_distance_between_snapped_points,
        get_lixel_network_topology,
    )

    with db_session() as conn:
        ds_id = int(conn.execute("SELECT id FROM dataset_sources WHERE is_active = 1").fetchone()["id"])
        topo = get_lixel_network_topology(conn, ds_id)

        # Two river quays on opposite banks of the demo river channel.
        s_south = conn.execute(
            "SELECT id, length_m FROM road_segments WHERE dataset_id = ? AND name = 'South Riverbank Quay (3)'",
            (ds_id,),
        ).fetchone()
        s_north = conn.execute(
            "SELECT id, length_m FROM road_segments WHERE dataset_id = ? AND name = 'North Riverbank Quay (3)'",
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
        # The straight line between the quays is ~700 m (the river channel), while the only
        # topological route is via a bridge, so the network distance must be strictly larger.
        assert d_net > 1000.0

        # Grade-separated expressway midspan vs the surface street crossed underneath:
        s_ovp = conn.execute(
            "SELECT id, length_m FROM road_segments WHERE dataset_id = ? AND elevation_level = 1 "
            "AND name = 'Sadr Expressway Elevated Span South'",
            (ds_id,),
        ).fetchone()
        s_art = conn.execute(
            "SELECT id, length_m FROM road_segments WHERE dataset_id = ? AND elevation_level = 0 "
            "AND min_x <= ? AND max_x >= ? AND min_y <= ? AND max_y >= ? ORDER BY id LIMIT 1",
            (ds_id, DEMO_ORIGIN_3857[0] + 1780.0, DEMO_ORIGIN_3857[0] + 1780.0,
             DEMO_ORIGIN_3857[1] + 1400.0, DEMO_ORIGIN_3857[1] + 1400.0),
        ).fetchone()
        assert s_ovp and s_art
        d_ovp_net = exact_network_distance_between_snapped_points(
            topo,
            int(s_ovp["id"]),
            float(s_ovp["length_m"]) * 0.9,
            int(s_art["id"]),
            20.0,
        )
        # Despite crossing the surface street in 2D, the network path must travel to a ramp.
        assert d_ovp_net > 1400.0


def test_probabilistic_topological_map_matching_overpass_disambiguation(test_client: TestClient) -> None:
    """
    Verify US-3.1: at a point beneath the elevated expressway span, a PEDESTRIAN_CROSSING
    report must be topologically matched to the surface street underneath rather than to the
    elevated motorway deck.
    """
    origin_x, origin_y = DEMO_ORIGIN_3857
    res = test_client.post(
        "/api/v1/vgi/preview-snap-and-conflate",
        json={
            "x_m": origin_x + 1782.0,
            "y_m": origin_y + 1395.0,
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
    # 1. Coordinates are no longer rejected because they are outside a city: a valid WGS84 point
    #    anywhere on Earth is ingestible (it is flagged when outside the study-area boundary).
    far_away = test_client.post(
        "/api/v1/vgi/submit",
        json={
            "lon": -58.3816,
            "lat": -34.6037,  # Buenos Aires, far outside the demo Tehran boundary
            "observational_radius_m": 15.0,
            "occurred_at_utc": "2026-11-09T10:00:00Z",
            "reported_at_utc": "2026-11-09T10:15:00Z",
            "category_code": "REAR_END",
            "severity_code": "PDO",
        },
    )
    assert far_away.status_code == 200, far_away.text
    assert far_away.json()["outside_study_area"] is True
    assert far_away.json()["study_area_key"] == "tehran"

    # ... but genuinely invalid geographic input and non-representable metric input still fail.
    invalid_geo = test_client.post(
        "/api/v1/vgi/submit",
        json={
            "lon": 500.0,
            "lat": 35.0,
            "occurred_at_utc": "2026-11-09T10:00:00Z",
            "category_code": "REAR_END",
            "severity_code": "PDO",
        },
    )
    assert invalid_geo.status_code == 422

    # 2. Temporal sanity check: occurred_at AFTER reported_at rejected
    bad_time = test_client.post(
        "/api/v1/vgi/submit",
        json={
            "x_m": DEMO_ORIGIN_3857[0] + 1300.0,
            "y_m": DEMO_ORIGIN_3857[1] + 700.0,
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
            "x_m": DEMO_ORIGIN_3857[0] + 1350.0,
            "y_m": DEMO_ORIGIN_3857[1] + 720.0,
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
    curve = body["ground_truth_eval"]["nkde"]["pai_curve"]
    assert curve["status"] == "ok"
    assert curve["points"][-1]["pai"] == pytest.approx(1.0)
    assert "not held-out" in curve["evaluation_scope"]

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
    cure = eb_data["cure_diagnostic"]
    assert cure["status"] == "ok"
    assert cure["points"][-1]["segment_count"] == eb_data["network_summary"]["segment_count"]
    assert "not a simultaneous" in cure["assumptions"].lower()
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
            "bbox_4326": [51.378, 35.644, 51.384, 35.648],
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

    # Verify compiled React/MapLibre SPA bundle is served at root when built
    from app.config import FRONTEND_DIST_DIR

    spa = test_client.get("/")
    if (FRONTEND_DIST_DIR / "index.html").exists():
        assert spa.status_code == 200
        assert "RoadScope" in spa.text
    else:
        assert spa.status_code == 404

