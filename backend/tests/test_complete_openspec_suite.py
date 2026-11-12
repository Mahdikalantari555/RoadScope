"""Comprehensive scientific & API tests for the final 12 OpenSpec research tasks."""
from __future__ import annotations

import json
import math

import networkx as nx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.advanced_network import (
    compute_inhomogeneous_network_k,
    embed_deidentified_narratives_local,
    scrub_narrative_pii,
)
from app.services.spatial_bayes import (
    build_riebler_scaled_icar_basis,
    fit_bym2_spatial_counts,
)
from app.services.surrogate_bivariate import (
    fit_bivariate_poisson_lognormal,
    generate_paired_crash_surrogate_data,
)


def test_riebler_scaling_disconnected_components_and_isolates():
    # Component 1: 3-node path (0-1-2); Component 2: 2-node edge (3-4); Node 5: isolate
    adj = np.zeros((6, 6), dtype=float)
    adj[0, 1] = adj[1, 0] = 1.0
    adj[1, 2] = adj[2, 1] = 1.0
    adj[3, 4] = adj[4, 3] = 1.0

    res = build_riebler_scaled_icar_basis(adj)
    assert res["component_count"] == 3
    assert res["isolate_count"] == 1
    assert bool(res["is_isolate"][5]) is True

    l_star = res["l_star"]
    cov = l_star @ l_star.T
    # Isolate must have zero spatial structured variance
    assert cov[5, 5] == pytest.approx(0.0, abs=1e-12)
    # Each connected component of size >= 2 must sum to zero and have geometric-mean marginal variance == 1.0
    assert abs(float(np.sum(cov[:3, :3]))) < 1e-9
    geom_var_c1 = math.exp(float(np.mean(np.log(np.diag(cov[:3, :3])))))
    geom_var_c2 = math.exp(float(np.mean(np.log(np.diag(cov[3:5, 3:5])))))
    assert geom_var_c1 == pytest.approx(1.0, rel=1e-6)
    assert geom_var_c2 == pytest.approx(1.0, rel=1e-6)


def test_bym2_mcmc_convergence_and_zero_count_safety():
    adj = np.zeros((5, 5), dtype=float)
    for i in range(4):
        adj[i, i + 1] = adj[i + 1, i] = 1.0
    counts = np.array([12.0, 9.0, 4.0, 1.0, 0.0])
    offset = np.zeros(5)
    cov = np.linspace(-1.0, 1.0, 5)

    fit = fit_bym2_spatial_counts(counts, offset, cov, adj, chains=4, draws_per_chain=220, random_seed=42)
    assert fit["converged"] is True
    assert fit["diagnostics"]["max_split_rhat"] <= 1.10
    assert fit["diagnostics"]["min_bulk_ess"] >= 40.0
    # Spatial smoothing pulls adjacent segments smoothly in monotone order
    means = fit["posterior_mean"]
    assert means[0] > means[2] > means[4] > 0.0

    # Degenerate zero-count dataset does not diverge or NaN
    zero_fit = fit_bym2_spatial_counts(np.zeros(5), offset, cov, adj, chains=2, draws_per_chain=100, random_seed=7)
    assert all(math.isfinite(v) and v >= 0.0 for v in zero_fit["posterior_mean"])


def test_bivariate_surrogate_distinguishes_zero_conflict_from_uncovered_and_beats_crash_only():
    lengths_km = np.full(18, 0.5)
    aadt = np.linspace(6000.0, 24000.0, 18)
    sim = generate_paired_crash_surrogate_data(
        lengths_km,
        aadt,
        sensor_coverage_prob=0.72,
        true_correlation_rho=0.82,
        sigma_crash=0.65,
        sigma_surrogate=0.65,
        random_seed=101,
    )
    fit = fit_bivariate_poisson_lognormal(
        sim["crash_train"],
        sim["crash_exposure"],
        sim["covered_mask"],
        sim["surrogate_counts"],
        sim["surrogate_exposure"],
        sim["covariate_centered"],
        chains=4,
        draws_per_chain=200,
        random_seed=101,
    )
    assert fit["converged"] is True
    assert fit["latent_correlation_rho"] > 0.35

    # Compare two identical-exposure segments with 1 crash:
    # Segment 0: covered with 0 conflicts across high exposure -> downward shrinkage
    # Segment 1: uncovered (missing sensor) -> no surrogate shrinkage, higher posterior mean & wider uncertainty
    crashes = np.array([1.0, 1.0, 5.0, 6.0, 0.0, 4.0])
    c_exp = np.ones(6)
    cov_mask = np.array([True, False, True, True, True, True])
    s_counts = np.array([0.0, -1.0, 45.0, 55.0, 2.0, 38.0])
    s_exp = np.array([10.0, 0.0, 10.0, 10.0, 10.0, 10.0])
    contrast = fit_bivariate_poisson_lognormal(crashes, c_exp, cov_mask, s_counts, s_exp, random_seed=55)
    assert contrast["crash_posterior_mean"][0] < contrast["crash_posterior_mean"][1]


def test_inhomogeneous_network_k_detects_clustering_and_handles_edge_cases():
    g = nx.Graph()
    for i in range(20):
        g.add_node(i, length_m=25.0)
        if i > 0:
            g.add_edge(i - 1, i, length=25.0)
    lam = {i: 0.02 for i in range(20)}

    # Edge case: < 2 events
    empty_res = compute_inhomogeneous_network_k(g, [3], lam, [25.0, 50.0, 100.0])
    assert empty_res["status"] == "insufficient_events"

    # Tightly clustered events on nodes 2, 3, 4 vs uniform intensity -> exceeds upper 95% envelope
    clustered = [2, 2, 3, 3, 3, 4, 4, 3]
    res = compute_inhomogeneous_network_k(g, clustered, lam, [30.0, 60.0, 120.0, 200.0], n_simulations=39, random_seed=12)
    assert res["status"] == "ok"
    assert res["exceeds_upper_envelope"] is True
    assert res["dclf_global_p_value"] <= 0.10


def test_pii_scrubber_and_deterministic_local_embedding():
    raw = "Crash near Mainzer Str; witness Max (max.mueller@gmail.de, +49 69 9876543) saw plate F-RS 2026."
    scrubbed, red = scrub_narrative_pii(raw)
    assert "gmail.de" not in scrubbed
    assert "9876543" not in scrubbed
    assert "F-RS 2026" not in scrubbed
    assert red["email"] == 1 and red["phone"] == 1 and red["plate"] == 1

    e1 = embed_deidentified_narratives_local([scrubbed, "Wet asphalt rear end collision"], n_components=2)
    e2 = embed_deidentified_narratives_local([scrubbed, "Wet asphalt rear end collision"], n_components=2)
    assert np.allclose(e1, e2)


def test_all_new_research_endpoints_end_to_end(tmp_path, monkeypatch):
    import importlib
    import app.config
    import app.db
    import app.main

    monkeypatch.setenv("ROADSCOPE_SQLITE_PATH", str(tmp_path / "complete_suite.sqlite"))
    monkeypatch.setenv("ROADSCOPE_DEMO_MODE", "true")
    importlib.reload(app.config)
    importlib.reload(app.db)
    importlib.reload(app.main)

    with TestClient(app.main.app) as client:
        # 1. BYM2 + VGI Multiple Imputation
        r_bym2 = client.post("/api/v1/research/bym2", json={"imputations_m": 8, "chains": 3, "draws_per_chain": 120})
        assert r_bym2.status_code == 200, r_bym2.text
        b_body = r_bym2.json()["result"]
        assert b_body["bym2"]["converged"] is True
        assert b_body["vgi_multiple_imputation"]["imputations_m"] == 8

        # 2. Joint Link-Node BYM2
        r_jln = client.post("/api/v1/research/joint-link-node", json={"junction_buffer_m": 20.0, "chains": 3, "draws_per_chain": 100})
        assert r_jln.status_code == 200, r_jln.text
        assert r_jln.json()["result"]["node_count"] >= 2

        # 3. Bivariate Crash-Surrogate Fusion (including held-out evaluation vs crash-only & exposure-only)
        r_surr = client.post("/api/v1/research/surrogate-joint", json={"seed_synthetic_if_empty": True, "random_seed": 42})
        assert r_surr.status_code == 200, r_surr.text
        surr_res = r_surr.json()["result"]
        assert surr_res["model"]["covered_segments"] >= 2
        assert surr_res["held_out_evaluation"]["joint_bivariate_pln"]["latent_mu_rmse"] < surr_res["held_out_evaluation"]["exposure_only_spf"]["latent_mu_rmse"]

        # 4. Inhomogeneous Network K-function & Voronoi & Trajectory HMM
        r_nk = client.post("/api/v1/research/network-k", json={"max_radius_m": 300.0, "n_radii": 6, "n_simulations": 19})
        assert r_nk.status_code == 200, r_nk.text
        assert r_nk.json()["result"]["status"] == "ok"

        r_vor = client.post("/api/v1/research/voronoi", json={})
        assert r_vor.status_code == 200, r_vor.text
        assert r_vor.json()["result"]["lixel_count"] > 0

        # Single-fix trajectory must be rejected (422)
        r_hmm_bad = client.post("/api/v1/research/trajectory-hmm", json={"synthetic_steps": 1})
        assert r_hmm_bad.status_code == 422

        r_hmm_ok = client.post("/api/v1/research/trajectory-hmm", json={"synthetic_steps": 4, "random_seed": 42})
        assert r_hmm_ok.status_code == 200, r_hmm_ok.text
        assert len(r_hmm_ok.json()["result"]["path"]) == 4

        # 5. ZINB-STGraph multi-seed chronological benchmark
        r_stg = client.post("/api/v1/research/st-graph", json={"n_periods": 6, "seeds": [11, 29]})
        assert r_stg.status_code == 200, r_stg.text
        assert len(r_stg.json()["result"]["comparisons"]) == 4

        # 6. Text Ablation gate (403 without consent, 200 with consent)
        assert client.post("/api/v1/research/text-ablation", json={"consent_verified": False}).status_code == 403
        r_txt = client.post("/api/v1/research/text-ablation", json={"consent_verified": True})
        assert r_txt.status_code == 200, r_txt.text
        assert len(r_txt.json()["result"]["ablations"]) == 4
        assert r_txt.json()["result"]["external_network_calls"] == 0

        # 7. Multi-seed, multi-resolution MAUP sensitivity
        r_maup = client.post("/api/v1/research/maup-sensitivity", json={"resolutions_m": [10.0, 25.0, 50.0], "seeds": [17, 42]})
        assert r_maup.status_code == 200, r_maup.text
        assert len(r_maup.json()["result"]["resolutions"]) == 3
