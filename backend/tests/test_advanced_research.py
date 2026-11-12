from __future__ import annotations

import importlib
import json
import math

from fastapi.testclient import TestClient
import networkx as nx
import numpy as np
import pytest

from app.services.adaptive_tnkde import (
    adaptive_space_time_density,
    evaluate_event_loo_intensities,
    select_tnkde_bandwidths_lcv,
)
from app.services.hawkes_network import decluster_upstream_hawkes, simulate_upstream_hawkes
from app.services.length_spf import fit_length_scaled_nb_spf


def test_adaptive_tnkde_conserves_mass_and_prevents_loo_and_causal_leakage() -> None:
    dist_mat = np.array(
        [
            [0.0, 40.0, 80.0],
            [40.0, 0.0, 40.0],
            [80.0, 40.0, 0.0],
        ],
        dtype=float,
    )
    lengths_m = np.array([40.0, 40.0, 40.0], dtype=float)
    # Event 0 has fractional candidate allocation (0.6 on lixel 0, 0.4 on lixel 1)
    allocs = [[(0, 0.6), (1, 0.4)], [(1, 1.0)], [(2, 1.0)], [(1, 1.0)]]
    times_s = np.array([2.0, 5.0, 8.0, 14.0], dtype=float)
    weights = np.ones(4, dtype=float)
    slices = np.linspace(0.0, 20.0, 2001)

    res = adaptive_space_time_density(
        dist_mat,
        lengths_m,
        allocs,
        times_s,
        slices,
        spatial_m=50.0,
        temporal_s=3.0,
        domain_s=(0.0, 20.0),
        adaptive=True,
        clip_factor=2.5,
        causal=False,
        event_weights=weights,
    )
    mat_m_s = np.asarray(res["intensity_m_s"], dtype=float)
    total_mass = float(np.trapezoid(mat_m_s @ lengths_m, slices))
    assert total_mass == pytest.approx(4.0, abs=5e-3)
    lo_f, hi_f = res["abramson_factor_range"]
    assert 1.0 / 2.5 - 1e-9 <= lo_f <= hi_f <= 2.5 + 1e-9

    # Event-level LOO with single fractional event must be strictly zero (no candidate self-leakage)
    single_loo, _ = evaluate_event_loo_intensities(
        dist_mat,
        lengths_m,
        [[(0, 0.52), (1, 0.48)]],
        np.array([10.0]),
        np.array([1.0]),
        np.array([50.0]),
        np.array([3.0]),
        (0.0, 20.0),
        causal=False,
        exclude_self=True,
    )
    assert single_loo[0] == pytest.approx(0.0)

    # Causal LOO: earliest event cannot receive mass from future events
    causal_loo, _ = evaluate_event_loo_intensities(
        dist_mat,
        lengths_m,
        allocs,
        times_s,
        weights,
        np.full(4, 50.0),
        np.full(4, 3.0),
        (0.0, 20.0),
        causal=True,
        exclude_self=True,
    )
    assert causal_loo[0] == pytest.approx(0.0)
    assert causal_loo[-1] > 0.0

    lcv = select_tnkde_bandwidths_lcv(
        dist_mat,
        lengths_m,
        allocs,
        times_s,
        weights,
        [30.0, 60.0],
        [2.0, 5.0],
        (0.0, 20.0),
        adaptive=True,
        clip_factor=2.0,
    )
    assert lcv["status"] == "ok"
    assert len(lcv["grid"]) == 4


def test_length_scaled_nb_spf_mle_and_zero_crash_guard() -> None:
    rng = np.random.default_rng(123)
    length_km = rng.uniform(0.15, 1.2, size=50)
    aadt = rng.uniform(3000.0, 28000.0, size=50)
    true_mu = length_km * np.exp(-0.3 + 0.8 * np.log(aadt / 1000.0))
    alpha_vec = 0.2 / length_km
    r_shape = 1.0 / alpha_vec
    gamma_means = rng.gamma(shape=r_shape, scale=true_mu / r_shape)
    counts = rng.poisson(gamma_means).astype(float)

    fit = fit_length_scaled_nb_spf(counts, aadt, length_km, study_period_years=1.0)
    assert fit["status"] in ("ok", "suboptimal_convergence")
    assert fit["alpha_1_per_km"] > 0
    assert fit["cure_diagnostic"]["status"] == "ok"
    eb = np.asarray(fit["eb_expected"], dtype=float)
    mu = np.asarray(fit["expected_spf"], dtype=float)
    for i in range(len(counts)):
        lo = min(counts[i], mu[i]) - 1e-5
        hi = max(counts[i], mu[i]) + 1e-5
        assert lo <= eb[i] <= hi

    zero_fit = fit_length_scaled_nb_spf(np.zeros(6), aadt[:6], length_km[:6])
    assert zero_fit["status"] == "zero_crashes_unidentifiable"


def test_upstream_hawkes_simulation_and_em_declustering() -> None:
    g = nx.DiGraph()
    for idx in range(5):
        g.add_node(idx, length_m=50.0)
    for idx in range(4):
        g.add_edge(idx, idx + 1, weight_m=50.0)

    sim = simulate_upstream_hawkes(
        g,
        background_rate_per_hr=1.5,
        window_hr=20.0,
        branching_ratio=0.45,
        temporal_decay_min=20.0,
        spatial_decay_m=120.0,
        seed=19,
    )
    by_id = {e["id"]: e for e in sim["events"]}
    for ev in sim["events"]:
        if ev["parent_id"] is not None:
            parent = by_id[ev["parent_id"]]
            assert ev["state"] <= parent["state"]  # upstream on 0 -> 1 -> 2 -> 3 -> 4
            assert ev["time_s"] > parent["time_s"]

    decl = decluster_upstream_hawkes(
        g,
        sim["events"],
        window_s=20.0 * 3600.0,
        temporal_decay_s=20.0 * 60.0,
        spatial_decay_m=120.0,
    )
    assert decl["monotonic_likelihood"] is True
    assert decl["subcritical_stable"] is True
    assert 0.0 <= decl["estimated_branching_ratio"] < 1.0
    assert decl["synthetic_calibration"] is not None
    assert 0.0 <= decl["synthetic_calibration"]["brier_score"] <= 0.5


def test_advanced_research_endpoints_end_to_end(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ROADSCOPE_SQLITE_PATH", str(tmp_path / "adv.sqlite"))
    monkeypatch.setenv("ROADSCOPE_DEMO_MODE", "true")
    import app.config
    import app.db
    import app.main

    importlib.reload(app.config)
    importlib.reload(app.db)
    importlib.reload(app.main)

    with TestClient(app.main.app) as client:
        caps = client.get("/api/v1/research/capabilities").json()
        assert "spatiotemporal_adaptive_tnkde" in caps["available"]
        assert "chronological_holdout_benchmark" in caps["available"]

        # Fractional NKDE vs Hard NKDE
        nkde_frac = client.post(
            "/api/v1/lab/nkde",
            json={
                "bandwidth_m": 180.0,
                "allocation_mode": "fractional",
                "include_unverified_vgi": True,
            },
        )
        assert nkde_frac.status_code == 200, nkde_frac.text
        sm = nkde_frac.json()["summary_metrics"]
        assert sm["allocation_mode"] == "fractional"
        assert math.isclose(sm["total_weighted_mass"], sm["conserved_nkde_mass"], rel_tol=1e-3)
        assert sm["allocation_comparison"]["mode"] == "fractional"

        # Dataset Adaptive TNKDE
        tnkde_res = client.post(
            "/api/v1/research/tnkde",
            json={
                "spatial_bandwidth_m": 200.0,
                "temporal_bandwidth_days": 14.0,
                "slice_count": 6,
                "adaptive": True,
                "select_via_lcv": True,
                "allocation_mode": "fractional",
                "include_unverified_vgi": True,
            },
        )
        assert tnkde_res.status_code == 200, tnkde_res.text
        tnkde_body = tnkde_res.json()
        assert len(tnkde_body["result"]["slices_utc"]) == 6
        assert len(tnkde_body["result"]["layer_geojson"]["features"]) > 50

        # Length-scaled NB-SPF endpoint & risk endpoint integration
        spf_res = client.post("/api/v1/research/fit-length-spf", json={})
        assert spf_res.status_code == 200, spf_res.text
        assert spf_res.json()["result"]["alpha_1_per_km"] > 0
        risk_res = client.post("/api/v1/risk/evaluate", json={}).json()
        assert risk_res["length_scaled_eb"]["model_version"] == "length-nb-spf/1"

        # Upstream Hawkes simulation + EM declustering
        hawkes_res = client.post(
            "/api/v1/research/hawkes",
            json={"background_rate_per_hr": 0.6, "window_hr": 8.0, "branching_ratio": 0.35, "seed": 42},
        )
        assert hawkes_res.status_code == 200, hawkes_res.text
        assert hawkes_res.json()["result"]["declustering"]["subcritical_stable"] is True

        # Chronological holdout benchmark
        bench_res = client.post("/api/v1/research/benchmark", json={"train_fraction": 0.7})
        assert bench_res.status_code == 200, bench_res.text
        methods = {m["method"] for m in bench_res.json()["result"]["methods"]}
        assert methods == {"historical_count", "linear_density", "nkde_legacy", "exposure_length_eb"}

        # VGI diagnostics & IPW
        vgi_diag = client.get("/api/v1/research/vgi-diagnostics").json()
        assert vgi_diag["active_supported_incidents"] > 10
        ipw_res = client.post("/api/v1/research/ipw", json={"observed": [25, 40, 15], "exposure": [100, 100, 100]})
        assert ipw_res.status_code == 200

        # Privacy-preserving surrogate ingestion & zero-coverage separation
        from app.db import db_session

        with db_session() as conn:
            sids = [int(r[0]) for r in conn.execute("SELECT id FROM road_segments ORDER BY id LIMIT 2")]
        bad_surr = client.post(
            "/api/v1/research/surrogates",
            json={
                "records": [
                    {
                        "segment_id": sids[0],
                        "start_utc": "2026-01-01T00:00:00Z",
                        "end_utc": "2026-01-02T00:00:00Z",
                        "definition": "hard_braking",
                        "count": 4,
                        "exposure": 1200.0,
                        "exposure_unit": "vehicles",
                        "source": "connected_fleet_agg",
                        "privacy_provenance": "k-anonymized segment bin k>=20",
                        "raw_lat": 50.11,
                    }
                ]
            },
        )
        assert bad_surr.status_code == 422  # Rejects raw coordinate field!

        ok_surr = client.post(
            "/api/v1/research/surrogates",
            json={
                "records": [
                    {
                        "segment_id": sids[0],
                        "start_utc": "2026-01-01T00:00:00Z",
                        "end_utc": "2026-01-02T00:00:00Z",
                        "definition": "hard_braking",
                        "count": 5,
                        "exposure": 1200.0,
                        "exposure_unit": "vehicles",
                        "source": "connected_fleet_agg",
                        "privacy_provenance": "k-anonymized segment bin k>=20",
                    },
                    {
                        "segment_id": sids[1],
                        "start_utc": "2026-01-01T00:00:00Z",
                        "end_utc": "2026-01-02T00:00:00Z",
                        "definition": "ittc_conflict",
                        "count": 0,
                        "exposure": 900.0,
                        "exposure_unit": "vehicles",
                        "source": "connected_fleet_agg",
                        "privacy_provenance": "k-anonymized segment bin k>=20",
                    },
                ]
            },
        )
        assert ok_surr.status_code == 200, ok_surr.text
        surr_summary = client.get("/api/v1/research/surrogates").json()
        assert surr_summary["covered_positive_conflict_segments"] == 1
        assert surr_summary["covered_zero_conflict_segments"] == 1
        assert surr_summary["uncovered_segments"] == surr_summary["total_segments"] - 2
