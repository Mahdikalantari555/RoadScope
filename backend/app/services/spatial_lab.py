from __future__ import annotations

import json
import math
import sqlite3
import time
from typing import Any

import networkx as nx
import numpy as np
from scipy.stats import spearmanr
from shapely.geometry import MultiPoint
from shapely.ops import unary_union

from ..config import CANONICAL_EPSG
from ..crs import (
    extract_lixel_linestring,
    linestring_25832_to_geojson_dict,
    polygon_25832_to_geojson_dict,
)
from ..db import log_audit_event, utc_now_iso
from .network_generator import (
    LixelNetworkTopology,
    exact_network_distance_between_snapped_points,
    get_lixel_network_topology,
)


def _kernel_eval(u: np.ndarray, kernel_name: str) -> np.ndarray:
    k = kernel_name.lower()
    if k == "quartic":
        mask = u <= 1.0
        out = np.zeros_like(u, dtype=np.float64)
        out[mask] = (15.0 / 16.0) * ((1.0 - u[mask] ** 2) ** 2)
        return out
    if k == "epanechnikov":
        mask = u <= 1.0
        out = np.zeros_like(u, dtype=np.float64)
        out[mask] = 0.75 * (1.0 - u[mask] ** 2)
        return out
    if k == "gaussian":
        mask = u <= 3.0
        out = np.zeros_like(u, dtype=np.float64)
        out[mask] = (1.0 / math.sqrt(2.0 * math.pi)) * np.exp(-0.5 * (u[mask] ** 2))
        return out
    raise ValueError(f"Unsupported kernel '{kernel_name}'. Choose from: quartic, epanechnikov, gaussian.")


def _benjamini_hochberg_fdr(p_vals: np.ndarray) -> np.ndarray:
    """Compute Benjamini-Hochberg FDR adjusted q-values for M hypothesis tests."""
    m = len(p_vals)
    if m == 0:
        return p_vals
    order = np.argsort(p_vals)
    ranked_p = p_vals[order]
    ranks = np.arange(1, m + 1, dtype=np.float64)
    q_ranked = ranked_p * (m / ranks)
    q_ranked = np.minimum.accumulate(q_ranked[::-1])[::-1]
    q_ranked = np.clip(q_ranked, 0.0, 1.0)
    q_out = np.empty_like(q_ranked)
    q_out[order] = q_ranked
    return q_out


def evaluate_against_ground_truth(
    *,
    estimated_intensity_per_km: np.ndarray,
    true_lambda_per_km: np.ndarray,
    lengths_m: np.ndarray,
    hotspot_mask: np.ndarray | None = None,
    top_pct: float = 0.15,
) -> dict[str, Any]:
    """
    Quantitative Ground-Truth Benchmarking (US-1.4):
    Computes Prediction Accuracy Index (PAI), Recapture Rate Index (RRI),
    length-weighted RMSE, NRMSE, and Spearman rank correlation against true lambda(e,m,t).
    """
    lengths_km = lengths_m / 1000.0
    total_len_km = float(np.sum(lengths_km))
    true_expected_counts = true_lambda_per_km * lengths_km
    total_true_mass = float(np.sum(true_expected_counts))

    if hotspot_mask is None or not np.any(hotspot_mask):
        # Select top `top_pct` of network length ranked by estimated_intensity_per_km
        order = np.argsort(estimated_intensity_per_km)[::-1]
        cum_len = np.cumsum(lengths_km[order])
        cutoff_idx = np.searchsorted(cum_len, top_pct * total_len_km, side="right")
        cutoff_idx = max(1, min(len(order), int(cutoff_idx)))
        mask = np.zeros(len(lengths_m), dtype=bool)
        mask[order[:cutoff_idx]] = True
    else:
        mask = hotspot_mask.astype(bool)

    hot_len_km = float(np.sum(lengths_km[mask]))
    area_prop = max(1e-6, hot_len_km / max(1e-6, total_len_km))
    hit_rate = float(np.sum(true_expected_counts[mask])) / max(1e-6, total_true_mass)
    pai = hit_rate / area_prop

    # Recapture Rate Index (overlap of top-k estimated vs top-k true intensity mass)
    true_order = np.argsort(true_lambda_per_km)[::-1]
    true_cum_len = np.cumsum(lengths_km[true_order])
    true_cut = max(1, min(len(true_order), int(np.searchsorted(true_cum_len, hot_len_km, side="right"))))
    oracle_mass = float(np.sum(true_expected_counts[true_order[:true_cut]]))
    rri = float(np.sum(true_expected_counts[mask])) / max(1e-6, oracle_mass)

    # Length-weighted RMSE (in crashes / km / yr)
    mse = float(np.sum(lengths_km * ((estimated_intensity_per_km - true_lambda_per_km) ** 2)) / max(1e-6, total_len_km))
    rmse = math.sqrt(max(0.0, mse))
    mean_true = float(np.sum(true_expected_counts) / max(1e-6, total_len_km))
    nrmse = rmse / max(1e-6, mean_true)

    rho, _ = spearmanr(estimated_intensity_per_km, true_lambda_per_km)
    if np.isnan(rho):
        rho = 0.0

    return {
        "pai": round(float(pai), 3),
        "hit_rate_pct": round(float(hit_rate * 100.0), 2),
        "network_coverage_pct": round(float(area_prop * 100.0), 2),
        "rri": round(float(rri), 4),
        "rmse_per_km_yr": round(float(rmse), 4),
        "nrmse": round(float(nrmse), 4),
        "spearman_rho": round(float(rho), 4),
    }


def _fetch_filtered_incidents(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    include_unverified_vgi: bool = False,
    start_utc: str | None = None,
    end_utc: str | None = None,
) -> list[sqlite3.Row]:
    statuses = (
        ("verified_canonical", "corroborated_pending", "unverified_raw_vgi")
        if include_unverified_vgi
        else ("verified_canonical",)
    )
    ph = ",".join("?" for _ in statuses)
    sql = f"""
        SELECT a.id, a.snapped_segment_id, a.snapped_lixel_id, a.linear_offset_m,
               a.snapped_x_m, a.snapped_y_m, a.snapped_lon, a.snapped_lat,
               a.vgi_credibility_score, a.occurred_at_utc, a.verification_status,
               sv.code AS severity_code, sv.epdo_weight,
               c.code AS category_code
        FROM accidents a
        JOIN severity_levels sv ON sv.id = a.severity_id
        JOIN accident_categories c ON c.id = a.category_id
        WHERE a.dataset_id = ?
          AND a.snapped_lixel_id IS NOT NULL
          AND a.verification_status IN ({ph})
    """
    params: list[Any] = [dataset_id, *statuses]
    if start_utc:
        sql += " AND a.occurred_at_utc >= ?"
        params.append(start_utc)
    if end_utc:
        sql += " AND a.occurred_at_utc <= ?"
        params.append(end_utc)
    return conn.execute(sql, params).fetchall()


def _save_analysis_job(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    job_type: str,
    parameters: dict[str, Any],
    sample_size: int,
    runtime_ms: float,
    summary_metrics: dict[str, Any],
    ground_truth_eval: dict[str, Any] | None,
    mathematical_notes: dict[str, Any],
    layer_geojson: dict[str, Any],
    tabular_results: list[dict[str, Any]],
    actor_role: str = "gis_researcher",
) -> int:
    now = utc_now_iso()
    cur = conn.execute(
        """
        INSERT INTO spatial_analysis_jobs
        (dataset_id, job_type, status, parameters_json, crs_epsg, sample_size, runtime_ms,
         progress_pct, created_by_user_id, created_at_utc, completed_at_utc)
        VALUES (?, ?, 'completed', ?, ?, ?, ?, 100, 5, ?, ?)
        """,
        (
            dataset_id,
            job_type,
            json.dumps(parameters),
            CANONICAL_EPSG,
            sample_size,
            round(runtime_ms, 2),
            now,
            now,
        ),
    )
    job_id = int(cur.lastrowid)
    conn.execute(
        """
        INSERT INTO spatial_analysis_results
        (job_id, summary_metrics_json, ground_truth_eval_json, mathematical_notes_json,
         layer_geojson_text, tabular_results_json, created_at_utc)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            job_id,
            json.dumps(summary_metrics),
            json.dumps(ground_truth_eval) if ground_truth_eval is not None else None,
            json.dumps(mathematical_notes),
            json.dumps(layer_geojson, separators=(",", ":")),
            json.dumps(tabular_results),
            now,
        ),
    )
    log_audit_event(
        conn,
        actor_user_id=5,
        actor_role=actor_role,
        action_type=f"RUN_{job_type}",
        entity_type="spatial_analysis_jobs",
        entity_id=job_id,
        after_state={"sample_size": sample_size, "runtime_ms": round(runtime_ms, 2), "parameters": parameters},
    )
    return job_id


def run_nkde_analysis(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    kernel: str = "quartic",
    bandwidth_m: float = 180.0,
    weighting: str = "uniform",
    equal_split_mass_conserving: bool = True,
    include_unverified_vgi: bool = False,
    top_hotspot_pct: float = 0.15,
    actor_role: str = "gis_researcher",
) -> dict[str, Any]:
    """
    Network-Constrained KDE (NKDE) vs Planar Euclidean KDE across Lixels (US-4.1 & US-1.4):
    Computes exact shortest-path Lixel NKDE, Planar KDE comparison, Planar Distortion Bias
    (Planar - NKDE), and quantitative Ground-Truth PAI/RRI/RMSE benchmarks for BOTH methods.
    """
    t0 = time.perf_counter()
    if bandwidth_m < 15.0 or bandwidth_m > 1500.0:
        raise ValueError("Bandwidth h_net must lie between 15m and 1500m.")

    ds_row = conn.execute(
        "SELECT is_synthetic, study_period_years FROM dataset_sources WHERE id = ?", (dataset_id,)
    ).fetchone()
    if not ds_row:
        raise ValueError(f"Dataset #{dataset_id} not found.")
    period_yr = float(ds_row["study_period_years"] or 1.0)

    topo = get_lixel_network_topology(conn, dataset_id)
    incidents = _fetch_filtered_incidents(
        conn, dataset_id=dataset_id, include_unverified_vgi=include_unverified_vgi
    )
    if len(incidents) < 3:
        raise ValueError("Insufficient incident sample size (N < 3) for kernel density estimation.")

    M = len(topo.lixel_ids)
    lengths_km = topo.lengths_m / 1000.0

    # Aggregate incident weights onto host lixels
    event_lix_indices: list[int] = []
    event_weights: list[float] = []
    event_x: list[float] = []
    event_y: list[float] = []

    for inc in incidents:
        lid = int(inc["snapped_lixel_id"])
        if lid not in topo.lixel_id_to_idx:
            continue
        idx = topo.lixel_id_to_idx[lid]
        if weighting == "epdo_severity":
            w = float(inc["epdo_weight"])
        elif weighting == "credibility_weighted":
            w = float(inc["vgi_credibility_score"])
        else:
            w = 1.0
        event_lix_indices.append(idx)
        event_weights.append(w)
        event_x.append(float(inc["snapped_x_m"]))
        event_y.append(float(inc["snapped_y_m"]))

    ev_idx_arr = np.array(event_lix_indices, dtype=np.int64)
    ev_w_arr = np.array(event_weights, dtype=np.float64)
    total_weight = float(np.sum(ev_w_arr))

    # 1. Network KDE over shortest-path distances D_net[:, ev_idx_arr] (shape M x N)
    d_net_sub = topo.dist_net_matrix[:, ev_idx_arr]
    u_net = d_net_sub / float(bandwidth_m)
    k_net = _kernel_eval(u_net, kernel)  # shape (M, N)

    if equal_split_mass_conserving:
        # Diggle / Okabe-Sugihara mass-conserving 1D topological normalization:
        # Z_i = sum_q K(d_net(q, s_i)/h) * length_km(q)
        z_net = np.sum(k_net * lengths_km[:, None], axis=0)
        z_net = np.maximum(z_net, 1e-9)
        nkde_per_km_yr = np.sum(k_net * (ev_w_arr[None, :] / z_net[None, :]), axis=1) / period_yr
    else:
        h_km = bandwidth_m / 1000.0
        nkde_per_km_yr = np.sum(k_net * ev_w_arr[None, :], axis=1) / (h_km * period_yr)

    # 2. Planar 2D Euclidean KDE evaluated at lixel midpoints (rescaled to equal total network crash mass)
    ev_x_arr = np.array(event_x, dtype=np.float64)
    ev_y_arr = np.array(event_y, dtype=np.float64)
    dx = topo.mid_x_m[:, None] - ev_x_arr[None, :]
    dy = topo.mid_y_m[:, None] - ev_y_arr[None, :]
    d_euc_sub = np.hypot(dx, dy)
    u_euc = d_euc_sub / float(bandwidth_m)
    k_euc = _kernel_eval(u_euc, kernel)
    raw_planar = np.sum(k_euc * ev_w_arr[None, :], axis=1)
    planar_mass = float(np.sum(raw_planar * lengths_km))
    if planar_mass > 1e-9:
        planar_per_km_yr = (raw_planar * (total_weight / planar_mass)) / period_yr
    else:
        planar_per_km_yr = np.zeros(M, dtype=np.float64)

    # Planar Distortion Bias: positive => Planar KDE overestimates risk (e.g. across bridges/overpasses!)
    planar_bias = planar_per_km_yr - nkde_per_km_yr

    # Ground-truth evaluation (NKDE vs Planar KDE head-to-head!)
    gt_eval = None
    if int(ds_row["is_synthetic"]) == 1:
        # For EPDO weighting, compare rank/PAI and rescale intensity if uniform
        nkde_eval = evaluate_against_ground_truth(
            estimated_intensity_per_km=nkde_per_km_yr,
            true_lambda_per_km=topo.true_lambda,
            lengths_m=topo.lengths_m,
            top_pct=top_hotspot_pct,
        )
        planar_eval = evaluate_against_ground_truth(
            estimated_intensity_per_km=planar_per_km_yr,
            true_lambda_per_km=topo.true_lambda,
            lengths_m=topo.lengths_m,
            top_pct=top_hotspot_pct,
        )
        gt_eval = {
            "nkde": nkde_eval,
            "planar_kde": planar_eval,
            "pai_advantage_pct": round(
                ((nkde_eval["pai"] - planar_eval["pai"]) / max(1e-6, planar_eval["pai"])) * 100.0, 2
            ),
            "rmse_reduction_pct": round(
                ((planar_eval["rmse_per_km_yr"] - nkde_eval["rmse_per_km_yr"]) / max(1e-6, planar_eval["rmse_per_km_yr"])) * 100.0,
                2,
            ),
        }

    # Build GeoJSON layer of lixels + segment-level summary table
    lix_geo_rows = conn.execute(
        """
        SELECT l.id, l.lixel_index, l.m_start_m, l.m_end_m, l.length_m, l.geojson_4326,
               s.name AS segment_name, s.road_class, s.elevation_level
        FROM road_lixels l
        JOIN road_segments s ON s.id = l.parent_segment_id
        WHERE l.dataset_id = ?
        ORDER BY l.parent_segment_id, l.lixel_index
        """,
        (dataset_id,),
    ).fetchall()

    max_nkde = max(1e-6, float(np.percentile(nkde_per_km_yr, 99)))
    max_abs_bias = max(1e-6, float(np.percentile(np.abs(planar_bias), 99)))

    features: list[dict[str, Any]] = []
    tabular: list[dict[str, Any]] = []
    for idx, r in enumerate(lix_geo_rows):
        nk_v = round(float(nkde_per_km_yr[idx]), 4)
        pl_v = round(float(planar_per_km_yr[idx]), 4)
        bi_v = round(float(planar_bias[idx]), 4)
        tr_v = round(float(topo.true_lambda[idx]), 4)
        props = {
            "lixel_id": int(r["id"]),
            "segment_id": int(topo.parent_segment_ids[idx]),
            "segment_name": r["segment_name"],
            "road_class": r["road_class"],
            "elevation_level": int(r["elevation_level"]),
            "m_start_m": round(float(r["m_start_m"]), 1),
            "m_end_m": round(float(r["m_end_m"]), 1),
            "length_m": round(float(r["length_m"]), 2),
            "nkde_density": nk_v,
            "planar_density": pl_v,
            "planar_bias": bi_v,
            "true_lambda": tr_v,
            "nkde_norm": round(min(1.0, nk_v / max_nkde), 4),
            "bias_norm": round(max(-1.0, min(1.0, bi_v / max_abs_bias)), 4),
        }
        features.append(
            {
                "type": "Feature",
                "properties": props,
                "geometry": json.loads(r["geojson_4326"]),
            }
        )
        tabular.append(props)

    tabular_sorted = sorted(tabular, key=lambda x: abs(x["planar_bias"]), reverse=True)[:80]
    runtime_ms = (time.perf_counter() - t0) * 1000.0

    summary = {
        "lixel_count": M,
        "incident_sample_size": len(ev_idx_arr),
        "total_weighted_mass": round(total_weight, 2),
        "conserved_nkde_mass": round(float(np.sum(nkde_per_km_yr * lengths_km * period_yr)), 2),
        "max_nkde_per_km_yr": round(float(np.max(nkde_per_km_yr)), 3),
        "max_planar_overestimation": round(float(np.max(planar_bias)), 3),
        "mean_abs_planar_distortion": round(float(np.mean(np.abs(planar_bias))), 4),
    }
    math_notes = {
        "method": "Mass-Conserving Lixel Network Kernel Density Estimation (Okabe-Sugihara / Diggle)",
        "formula_latex": r"\hat{\lambda}_{\mathrm{NKDE}}(q) = \sum_{i=1}^{n} w_i \frac{K(d_{\mathrm{net}}(q,s_i)/h_{\mathrm{net}})}{\sum_{q' \in \mathcal{L}} K(d_{\mathrm{net}}(q',s_i)/h_{\mathrm{net}})\,|\ell_{q'}|}",
        "crs": f"EPSG:{CANONICAL_EPSG} (ETRS89 / UTM Zone 32N, meters)",
        "planar_comparison_note": "Planar Euclidean KDE uses 2D straight-line distances d_Euc, causing topological spillover across Main River bridges, parallel quays, and the grade-separated City-Viadukt overpass.",
    }
    geojson_fc = {"type": "FeatureCollection", "features": features}
    params = {
        "kernel": kernel,
        "bandwidth_m": bandwidth_m,
        "weighting": weighting,
        "equal_split_mass_conserving": equal_split_mass_conserving,
        "include_unverified_vgi": include_unverified_vgi,
        "top_hotspot_pct": top_hotspot_pct,
    }

    job_id = _save_analysis_job(
        conn,
        dataset_id=dataset_id,
        job_type="NKDE",
        parameters=params,
        sample_size=len(ev_idx_arr),
        runtime_ms=runtime_ms,
        summary_metrics=summary,
        ground_truth_eval=gt_eval,
        mathematical_notes=math_notes,
        layer_geojson=geojson_fc,
        tabular_results=tabular_sorted,
        actor_role=actor_role,
    )

    return {
        "job_id": job_id,
        "job_type": "NKDE",
        "crs_epsg": CANONICAL_EPSG,
        "runtime_ms": round(runtime_ms, 2),
        "parameters": params,
        "summary_metrics": summary,
        "ground_truth_eval": gt_eval,
        "mathematical_notes": math_notes,
        "layer_geojson": geojson_fc,
        "top_distortion_lixels": tabular_sorted[:25],
    }


def run_network_autocorrelation(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    weight_scheme: str = "inverse_network_distance",
    distance_threshold_m: float = 200.0,
    contiguity_order_k: int = 3,
    permutations: int = 499,
    attribute_mode: str = "crash_density",
    include_unverified_vgi: bool = False,
    random_seed: int = 42,
    actor_role: str = "gis_researcher",
) -> dict[str, Any]:
    """
    Network-Constrained Local Getis-Ord Gi* & Global/Local Moran's I (US-4.2):
    Constructs topological spatial weights W_net strictly over shortest-path network distances,
    validates statistical assumptions, executes Monte Carlo spatial permutations, and applies
    Benjamini-Hochberg False Discovery Rate (FDR) adjustment.
    """
    t0 = time.perf_counter()
    topo = get_lixel_network_topology(conn, dataset_id)
    incidents = _fetch_filtered_incidents(
        conn, dataset_id=dataset_id, include_unverified_vgi=include_unverified_vgi
    )

    M = len(topo.lixel_ids)
    if M < 20:
        raise ValueError("Statistical assumption violation: Network requires at least 20 lixels.")
    if len(incidents) < 10:
        raise ValueError(
            f"Statistical assumption violation: Minimum sample size N >= 10 required for permutation inference (got N={len(incidents)})."
        )

    lengths_km = topo.lengths_m / 1000.0
    counts = np.zeros(M, dtype=np.float64)
    epdo_sums = np.zeros(M, dtype=np.float64)
    for inc in incidents:
        lid = int(inc["snapped_lixel_id"])
        if lid in topo.lixel_id_to_idx:
            idx = topo.lixel_id_to_idx[lid]
            counts[idx] += 1.0
            epdo_sums[idx] += float(inc["epdo_weight"])

    if attribute_mode == "epdo_rate":
        x = epdo_sums / np.maximum(lengths_km, 1e-4)
    elif attribute_mode == "raw_count":
        x = counts
    else:
        x = counts / np.maximum(lengths_km, 1e-4)

    x_mean = float(np.mean(x))
    x_var = float(np.mean((x - x_mean) ** 2))
    if x_var <= 1e-12:
        raise ValueError("Statistical assumption violation: Lixel attribute variance is zero (Var(X) <= 0).")
    s_std = math.sqrt(x_var)

    # Build W_net (for Gi* includes self-weight w_ii; for Moran's I zero diagonal)
    D = topo.dist_net_matrix
    if weight_scheme == "fixed_network_band":
        W_star = (D <= float(distance_threshold_m)).astype(np.float64)
    elif weight_scheme == "k_order_contiguity":
        mean_step = float(np.mean(topo.lengths_m)) * max(1, int(contiguity_order_k))
        W_star = (D <= mean_step * 1.05).astype(np.float64)
    else:
        # inverse_network_distance within distance_threshold_m
        mask = D <= float(distance_threshold_m)
        W_star = np.zeros_like(D, dtype=np.float64)
        W_star[mask] = 1.0 / (1.0 + D[mask] / 50.0)

    # Analytical Getis-Ord Gi* z-scores
    sum_w = np.sum(W_star, axis=1)
    sum_w2 = np.sum(W_star ** 2, axis=1)
    denom_term = np.maximum(1e-12, (M * sum_w2 - (sum_w ** 2)) / max(1, M - 1))
    gi_denom = s_std * np.sqrt(denom_term)
    gi_z = (W_star @ x - x_mean * sum_w) / gi_denom

    # Row-standardized zero-diagonal weights for Global & Local Moran's I
    W_zero = W_star.copy()
    np.fill_diagonal(W_zero, 0.0)
    row_sums = np.sum(W_zero, axis=1)
    W_row_std = np.divide(W_zero, np.maximum(row_sums[:, None], 1e-12))

    z_dev = (x - x_mean) / s_std
    lag_z = W_row_std @ z_dev
    local_moran_i = z_dev * lag_z
    non_isolated = row_sums > 0
    global_moran_i = float(np.sum(z_dev[non_isolated] * lag_z[non_isolated]) / max(1, int(np.sum(non_isolated))))

    # Vectorized Monte Carlo spatial permutations for pseudo p-values (Gi* & Local Moran)
    R = max(99, min(999, int(permutations)))
    rng = np.random.default_rng(random_seed)
    # Permute x across columns (shape M x R)
    perm_matrix = np.empty((M, R), dtype=np.float64)
    for r_idx in range(R):
        perm_matrix[:, r_idx] = rng.permutation(x)

    perm_gi_num = (W_star @ perm_matrix) - (x_mean * sum_w[:, None])
    perm_gi_z = perm_gi_num / gi_denom[:, None]
    exceed_counts = np.sum(np.abs(perm_gi_z) >= np.abs(gi_z)[:, None], axis=1)
    pseudo_p = (exceed_counts + 1.0) / (R + 1.0)
    fdr_q = _benjamini_hochberg_fdr(pseudo_p)

    # Global Moran's I permutation p-value
    perm_z_dev = (perm_matrix - x_mean) / s_std
    perm_global_i = np.sum(perm_z_dev[non_isolated, :] * (W_row_std @ perm_z_dev)[non_isolated, :], axis=0) / max(
        1, int(np.sum(non_isolated))
    )
    global_moran_p = float((np.sum(np.abs(perm_global_i) >= abs(global_moran_i)) + 1.0) / (R + 1.0))

    # Ground-truth evaluation on significant hotspot lixels (p < 0.05 & Gi* > 0)
    sig_hotspot_mask = (gi_z > 0) & (pseudo_p < 0.05)
    ds_row = conn.execute("SELECT is_synthetic FROM dataset_sources WHERE id = ?", (dataset_id,)).fetchone()
    gt_eval = None
    if ds_row and int(ds_row["is_synthetic"]) == 1:
        gt_eval = evaluate_against_ground_truth(
            estimated_intensity_per_km=np.maximum(0.0, gi_z),
            true_lambda_per_km=topo.true_lambda,
            lengths_m=topo.lengths_m,
            hotspot_mask=sig_hotspot_mask if np.any(sig_hotspot_mask) else None,
        )

    lix_geo_rows = conn.execute(
        """
        SELECT l.id, l.m_start_m, l.m_end_m, l.length_m, l.geojson_4326,
               s.name AS segment_name, s.road_class
        FROM road_lixels l
        JOIN road_segments s ON s.id = l.parent_segment_id
        WHERE l.dataset_id = ?
        ORDER BY l.parent_segment_id, l.lixel_index
        """,
        (dataset_id,),
    ).fetchall()

    features: list[dict[str, Any]] = []
    tabular: list[dict[str, Any]] = []
    class_counts = {
        "hotspot_99": 0,
        "hotspot_95": 0,
        "hotspot_fdr_05": 0,
        "not_significant": 0,
        "coldspot_95": 0,
        "coldspot_99": 0,
    }

    for idx, r in enumerate(lix_geo_rows):
        z_val = float(gi_z[idx])
        p_val = float(pseudo_p[idx])
        q_val = float(fdr_q[idx])
        if z_val > 0 and p_val < 0.01:
            sig_class = "hotspot_99"
        elif z_val > 0 and p_val < 0.05:
            sig_class = "hotspot_95"
        elif z_val < 0 and p_val < 0.01:
            sig_class = "coldspot_99"
        elif z_val < 0 and p_val < 0.05:
            sig_class = "coldspot_95"
        else:
            sig_class = "not_significant"
        class_counts[sig_class] += 1
        if z_val > 0 and q_val < 0.05:
            class_counts["hotspot_fdr_05"] += 1

        if p_val < 0.05:
            if z_dev[idx] >= 0 and lag_z[idx] >= 0:
                lisa_cluster = "HH"
            elif z_dev[idx] < 0 and lag_z[idx] < 0:
                lisa_cluster = "LL"
            elif z_dev[idx] >= 0 and lag_z[idx] < 0:
                lisa_cluster = "HL"
            else:
                lisa_cluster = "LH"
        else:
            lisa_cluster = "NS"

        props = {
            "lixel_id": int(r["id"]),
            "segment_id": int(topo.parent_segment_ids[idx]),
            "segment_name": r["segment_name"],
            "road_class": r["road_class"],
            "m_start_m": round(float(r["m_start_m"]), 1),
            "m_end_m": round(float(r["m_end_m"]), 1),
            "observed_value": round(float(x[idx]), 3),
            "crash_count": int(counts[idx]),
            "gi_star_z": round(z_val, 4),
            "pseudo_p": round(p_val, 4),
            "fdr_q": round(q_val, 4),
            "significance_class": sig_class,
            "fdr_significant": bool(q_val < 0.05 and z_val > 0),
            "local_moran_i": round(float(local_moran_i[idx]), 4),
            "lisa_cluster": lisa_cluster,
        }
        features.append(
            {
                "type": "Feature",
                "properties": props,
                "geometry": json.loads(r["geojson_4326"]),
            }
        )
        tabular.append(props)

    tabular_sorted = sorted(tabular, key=lambda item: item["gi_star_z"], reverse=True)[:80]
    runtime_ms = (time.perf_counter() - t0) * 1000.0

    summary = {
        "lixel_count": M,
        "incident_sample_size": len(incidents),
        "global_network_morans_i": round(global_moran_i, 4),
        "global_morans_p_value": round(global_moran_p, 4),
        "permutations": R,
        "max_gi_star_z": round(float(np.max(gi_z)), 3),
        "class_counts": class_counts,
        "assumptions_verified": {
            "min_sample_size_ok": True,
            "positive_variance_ok": True,
            "variance_value": round(x_var, 4),
            "isolated_lixels": int(np.sum(~non_isolated)),
        },
    }
    math_notes = {
        "method": "Network Getis-Ord Gi*(d_net) & Local Moran's I with Benjamini-Hochberg FDR",
        "formula_latex": r"G_i^* = \frac{\sum_j w_{ij}x_j - \bar{X}\sum_j w_{ij}}{S\sqrt{\frac{M\sum_j w_{ij}^2 - (\sum_j w_{ij})^2}{M-1}}}, \quad q_i = \min_{k \ge \mathrm{rank}(i)} \frac{M}{k}p_{(k)}",
        "crs": f"EPSG:{CANONICAL_EPSG}",
    }
    geojson_fc = {"type": "FeatureCollection", "features": features}
    params = {
        "weight_scheme": weight_scheme,
        "distance_threshold_m": distance_threshold_m,
        "contiguity_order_k": contiguity_order_k,
        "permutations": R,
        "attribute_mode": attribute_mode,
        "include_unverified_vgi": include_unverified_vgi,
        "random_seed": random_seed,
    }

    job_id = _save_analysis_job(
        conn,
        dataset_id=dataset_id,
        job_type="NETWORK_GI_STAR",
        parameters=params,
        sample_size=len(incidents),
        runtime_ms=runtime_ms,
        summary_metrics=summary,
        ground_truth_eval=gt_eval,
        mathematical_notes=math_notes,
        layer_geojson=geojson_fc,
        tabular_results=tabular_sorted,
        actor_role=actor_role,
    )

    return {
        "job_id": job_id,
        "job_type": "NETWORK_GI_STAR",
        "crs_epsg": CANONICAL_EPSG,
        "runtime_ms": round(runtime_ms, 2),
        "parameters": params,
        "summary_metrics": summary,
        "ground_truth_eval": gt_eval,
        "mathematical_notes": math_notes,
        "layer_geojson": geojson_fc,
        "top_hotspot_lixels": tabular_sorted[:25],
    }


def run_network_dbscan(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    eps_net_m: float = 85.0,
    min_samples: int = 4,
    include_unverified_vgi: bool = False,
    actor_role: str = "gis_researcher",
) -> dict[str, Any]:
    """
    Network DBSCAN (N-DBSCAN — US-4.3):
    Evaluates epsilon-neighborhoods strictly via shortest-path graph traversal distance d_net,
    outputting clustered points, topological road subgraphs, and metric buffered convex hulls.
    """
    t0 = time.perf_counter()
    if eps_net_m < 10.0 or eps_net_m > 1000.0:
        raise ValueError("eps_net_m must be between 10m and 1000m.")
    if min_samples < 2:
        raise ValueError("min_samples must be >= 2.")

    topo = get_lixel_network_topology(conn, dataset_id)
    incidents = _fetch_filtered_incidents(
        conn, dataset_id=dataset_id, include_unverified_vgi=include_unverified_vgi
    )
    n = len(incidents)
    if n < min_samples:
        raise ValueError(f"Insufficient incidents (N={n}) for N-DBSCAN with min_samples={min_samples}.")

    # Pairwise shortest-path network distance matrix over N incidents
    d_inc = np.zeros((n, n), dtype=np.float64)
    for i in range(n):
        si = int(incidents[i]["snapped_segment_id"])
        mi = float(incidents[i]["linear_offset_m"] or 0.0)
        for j in range(i + 1, n):
            sj = int(incidents[j]["snapped_segment_id"])
            mj = float(incidents[j]["linear_offset_m"] or 0.0)
            dist_val = exact_network_distance_between_snapped_points(topo, si, mi, sj, mj)
            d_inc[i, j] = dist_val
            d_inc[j, i] = dist_val

    neighbors = [np.where(d_inc[i] <= eps_net_m)[0].tolist() for i in range(n)]
    is_core = [len(neighbors[i]) >= min_samples for i in range(n)]
    labels = [-1] * n
    cluster_id = 0

    for i in range(n):
        if labels[i] != -1 or not is_core[i]:
            continue
        labels[i] = cluster_id
        queue = list(neighbors[i])
        visited = set(queue)
        while queue:
            curr = queue.pop(0)
            if labels[curr] == -1:
                labels[curr] = cluster_id
            if is_core[curr]:
                for nb in neighbors[curr]:
                    if nb not in visited:
                        visited.add(nb)
                        queue.append(nb)
        cluster_id += 1

    # Generate convex hulls + topological subgraph segments + point assignments
    features: list[dict[str, Any]] = []
    cluster_summaries: list[dict[str, Any]] = []

    palette = [
        "#22d3ee", "#f97316", "#a855f7", "#10b981", "#f43f5e",
        "#eab308", "#3b82f6", "#ec4899", "#14b8a6", "#84cc16",
    ]

    clustered_lixel_mask = np.zeros(len(topo.lixel_ids), dtype=bool)

    for cid in range(cluster_id):
        member_idxs = [i for i, lb in enumerate(labels) if lb == cid]
        color = palette[cid % len(palette)]
        pts_25832 = [(float(incidents[i]["snapped_x_m"]), float(incidents[i]["snapped_y_m"])) for i in member_idxs]
        epdo_total = sum(float(incidents[i]["epdo_weight"]) for i in member_idxs)

        # Convex hull buffered by 18m in EPSG:25832 metric space
        hull_25832 = MultiPoint(pts_25832).convex_hull.buffer(18.0, quad_segs=12)
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "geom_role": "cluster_hull",
                    "cluster_id": cid + 1,
                    "member_count": len(member_idxs),
                    "epdo_sum": round(epdo_total, 1),
                    "color": color,
                },
                "geometry": polygon_25832_to_geojson_dict(hull_25832),
            }
        )

        # Topological subgraph: extract exact segment spans covered by cluster members
        by_seg: dict[int, list[float]] = {}
        for i in member_idxs:
            sid = int(incidents[i]["snapped_segment_id"])
            lid = int(incidents[i]["snapped_lixel_id"])
            if lid in topo.lixel_id_to_idx:
                clustered_lixel_mask[topo.lixel_id_to_idx[lid]] = True
            by_seg.setdefault(sid, []).append(float(incidents[i]["linear_offset_m"] or 0.0))

        subgraph_len_m = 0.0
        seg_names: list[str] = []
        for sid, offsets in by_seg.items():
            smeta = topo.segment_meta[sid]
            seg_names.append(smeta["name"])
            m0 = max(0.0, min(offsets) - 15.0)
            m1 = min(smeta["length_m"], max(offsets) + 15.0)
            sub_line = extract_lixel_linestring(smeta["geom_25832"], m0, m1)
            subgraph_len_m += float(sub_line.length)
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "geom_role": "cluster_subgraph",
                        "cluster_id": cid + 1,
                        "segment_id": sid,
                        "segment_name": smeta["name"],
                        "color": color,
                    },
                    "geometry": linestring_25832_to_geojson_dict(sub_line),
                }
            )

        cluster_summaries.append(
            {
                "cluster_id": cid + 1,
                "incident_count": len(member_idxs),
                "epdo_sum": round(epdo_total, 2),
                "subgraph_length_m": round(subgraph_len_m, 1),
                "density_per_100m": round(len(member_idxs) / max(0.1, subgraph_len_m / 100.0), 2),
                "primary_corridors": ", ".join(sorted(set(seg_names))[:3]),
                "color": color,
            }
        )

    # Point features (clustered + noise)
    for i, inc in enumerate(incidents):
        lb = labels[i]
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "geom_role": "incident_point",
                    "accident_id": int(inc["id"]),
                    "cluster_id": (lb + 1) if lb >= 0 else 0,
                    "is_noise": lb < 0,
                    "is_core": is_core[i],
                    "severity_code": inc["severity_code"],
                    "category_code": inc["category_code"],
                    "color": palette[lb % len(palette)] if lb >= 0 else "#64748b",
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(inc["snapped_lon"]), float(inc["snapped_lat"])],
                },
            }
        )

    cluster_summaries.sort(key=lambda c: (c["incident_count"], c["epdo_sum"]), reverse=True)
    runtime_ms = (time.perf_counter() - t0) * 1000.0

    ds_row = conn.execute("SELECT is_synthetic FROM dataset_sources WHERE id = ?", (dataset_id,)).fetchone()
    gt_eval = None
    if ds_row and int(ds_row["is_synthetic"]) == 1 and np.any(clustered_lixel_mask):
        gt_eval = evaluate_against_ground_truth(
            estimated_intensity_per_km=clustered_lixel_mask.astype(np.float64),
            true_lambda_per_km=topo.true_lambda,
            lengths_m=topo.lengths_m,
            hotspot_mask=clustered_lixel_mask,
        )

    noise_count = sum(1 for lb in labels if lb < 0)
    summary = {
        "incident_sample_size": n,
        "cluster_count": cluster_id,
        "clustered_incidents": n - noise_count,
        "noise_incidents": noise_count,
        "noise_ratio_pct": round((noise_count / max(1, n)) * 100.0, 2),
    }
    math_notes = {
        "method": "Network-Constrained DBSCAN (N-DBSCAN)",
        "formula_latex": r"N_{\varepsilon_{\mathrm{net}}}(s_i) = \{s_j \in \mathcal{S} : d_{\mathrm{net}}(s_i, s_j) \le \varepsilon_{\mathrm{net}}\}, \quad |N_{\varepsilon_{\mathrm{net}}}(s_i)| \ge \mathrm{MinPts}",
        "crs": f"EPSG:{CANONICAL_EPSG}",
    }
    geojson_fc = {"type": "FeatureCollection", "features": features}
    params = {
        "eps_net_m": eps_net_m,
        "min_samples": min_samples,
        "include_unverified_vgi": include_unverified_vgi,
    }

    job_id = _save_analysis_job(
        conn,
        dataset_id=dataset_id,
        job_type="N_DBSCAN",
        parameters=params,
        sample_size=n,
        runtime_ms=runtime_ms,
        summary_metrics=summary,
        ground_truth_eval=gt_eval,
        mathematical_notes=math_notes,
        layer_geojson=geojson_fc,
        tabular_results=cluster_summaries,
        actor_role=actor_role,
    )

    return {
        "job_id": job_id,
        "job_type": "N_DBSCAN",
        "crs_epsg": CANONICAL_EPSG,
        "runtime_ms": round(runtime_ms, 2),
        "parameters": params,
        "summary_metrics": summary,
        "ground_truth_eval": gt_eval,
        "mathematical_notes": math_notes,
        "layer_geojson": geojson_fc,
        "clusters": cluster_summaries,
    }


def run_covariate_cross_comparison(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    include_unverified_vgi: bool = False,
) -> dict[str, Any]:
    """
    Dynamic Spatiotemporal Aggregation & Covariate Cross-Comparison (US-4.4):
    Cross-tabulates crash density and severity against environmental conditions (weather, lighting,
    road surface) and geometric infrastructure attributes (road class, speed limit, sinuosity, junction degree).
    """
    statuses = (
        ("verified_canonical", "corroborated_pending", "unverified_raw_vgi")
        if include_unverified_vgi
        else ("verified_canonical",)
    )
    ph = ",".join("?" for _ in statuses)

    by_weather = conn.execute(
        f"""
        SELECT COALESCE(e.weather_condition, 'clear') AS weather,
               COUNT(*) AS crash_count,
               ROUND(AVG(sv.epdo_weight), 2) AS mean_epdo,
               SUM(CASE WHEN sv.rank >= 3 THEN 1 ELSE 0 END) AS ksi_count
        FROM accidents a
        JOIN severity_levels sv ON sv.id = a.severity_id
        LEFT JOIN environmental_observations e ON e.accident_id = a.id
        WHERE a.dataset_id = ? AND a.verification_status IN ({ph})
        GROUP BY COALESCE(e.weather_condition, 'clear')
        ORDER BY crash_count DESC
        """,
        [dataset_id, *statuses],
    ).fetchall()

    by_lighting = conn.execute(
        f"""
        SELECT COALESCE(e.lighting_condition, 'daylight') AS lighting,
               COUNT(*) AS crash_count,
               ROUND(AVG(sv.epdo_weight), 2) AS mean_epdo
        FROM accidents a
        JOIN severity_levels sv ON sv.id = a.severity_id
        LEFT JOIN environmental_observations e ON e.accident_id = a.id
        WHERE a.dataset_id = ? AND a.verification_status IN ({ph})
        GROUP BY COALESCE(e.lighting_condition, 'daylight')
        ORDER BY crash_count DESC
        """,
        [dataset_id, *statuses],
    ).fetchall()

    by_infrastructure = conn.execute(
        f"""
        SELECT s.road_class,
               COUNT(DISTINCT s.id) AS segment_count,
               ROUND(SUM(s.length_m) / 1000.0, 3) AS total_km,
               ROUND(AVG(s.speed_limit_kmh), 1) AS avg_speed_kmh,
               ROUND(AVG(s.sinuosity), 4) AS avg_sinuosity,
               COUNT(a.id) AS crash_count,
               ROUND(COALESCE(SUM(sv.epdo_weight), 0.0), 1) AS total_epdo
        FROM road_segments s
        LEFT JOIN accidents a
               ON a.snapped_segment_id = s.id
              AND a.dataset_id = s.dataset_id
              AND a.verification_status IN ({ph})
        LEFT JOIN severity_levels sv ON sv.id = a.severity_id
        WHERE s.dataset_id = ?
        GROUP BY s.road_class
        ORDER BY crash_count DESC
        """,
        [*statuses, dataset_id],
    ).fetchall()

    infra_out = []
    for r in by_infrastructure:
        d = dict(r)
        km = max(0.01, float(d["total_km"] or 0.01))
        d["crashes_per_km"] = round(float(d["crash_count"]) / km, 2)
        d["epdo_per_km"] = round(float(d["total_epdo"]) / km, 2)
        infra_out.append(d)

    return {
        "by_weather": [dict(r) for r in by_weather],
        "by_lighting": [dict(r) for r in by_lighting],
        "by_infrastructure": infra_out,
    }
