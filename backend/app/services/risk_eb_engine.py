from __future__ import annotations

import json
import math
import sqlite3
from typing import Any

import numpy as np

from ..context import dataset_context
from .cure_diagnostics import cure_by_aadt
from .length_spf import fit_length_scaled_nb_spf

# Colorblind-safe 3x3 Stevens/Brewer Bivariate Palette:
# First axis = Risk Terctile (1=Low, 2=Med, 3=High), Second axis = Uncertainty Terctile (1=Low, 2=Med, 3=High)
BIVARIATE_PALETTE_3X3: dict[str, str] = {
    "1-1": "#e8e8e8",  # Low Risk, Low Uncertainty (High Confidence Safe)
    "2-1": "#b5c0da",  # Med Risk, Low Uncertainty
    "3-1": "#6c83b5",  # High Risk, Low Uncertainty (High Confidence Priority!)
    "1-2": "#b8d6be",  # Low Risk, Med Uncertainty
    "2-2": "#90b2b3",  # Med Risk, Med Uncertainty
    "3-2": "#567994",  # High Risk, Med Uncertainty
    "1-3": "#73ae80",  # Low Risk, High Uncertainty (Under-observed corridor)
    "2-3": "#5a9178",  # Med Risk, High Uncertainty
    "3-3": "#2a5a5b",  # High Risk, High Uncertainty (Needs urgent audit + sensors)
}


def _minmax_norm(arr: np.ndarray) -> np.ndarray:
    lo = float(np.min(arr))
    hi = float(np.max(arr))
    if hi - lo < 1e-9:
        return np.zeros_like(arr, dtype=np.float64)
    return (arr - lo) / (hi - lo)


def compute_exposure_risk_and_eb(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    w_eb_risk: float = 0.40,
    w_epdo_severity: float = 0.30,
    w_geometric_hazard: float = 0.15,
    w_environmental_cov: float = 0.15,
) -> dict[str, Any]:
    """
    Exposure-Aware Safety Metrics, Empirical Bayes (EB) RTM Smoothing, Multi-Criteria
    Vulnerability Index, and Epistemic/Aleatoric Uncertainty Cartography (Epic 5).
    """
    ds_row = conn.execute(
        "SELECT is_synthetic, study_period_years FROM dataset_sources WHERE id = ?",
        (dataset_id,),
    ).fetchone()
    if not ds_row:
        raise ValueError(f"Dataset #{dataset_id} not found.")
    period_yr = float(ds_row["study_period_years"] or 1.0)

    seg_rows = conn.execute(
        """
        SELECT s.id, s.edge_code, s.name, s.road_class, s.speed_limit_kmh, s.lanes,
               s.length_m, s.sinuosity, s.slope_pct, s.elevation_level, s.aadt, s.geojson_4326,
               nu.degree AS u_deg, nv.degree AS v_deg,
               t.aadt_vehicles_per_day AS obs_aadt, t.exposure_mvkt_annual,
               t.coverage_confidence, t.is_imputed
        FROM road_segments s
        JOIN road_nodes nu ON nu.id = s.u_node_id
        JOIN road_nodes nv ON nv.id = s.v_node_id
        LEFT JOIN traffic_observations t ON t.segment_id = s.id AND t.dataset_id = s.dataset_id
        WHERE s.dataset_id = ?
        ORDER BY s.id
        """,
        (dataset_id,),
    ).fetchall()

    acc_rows = conn.execute(
        """
        SELECT a.snapped_segment_id, a.verification_status, a.snap_probability,
               sv.epdo_weight, sv.rank AS sev_rank,
               COALESCE(e.weather_condition, 'clear') AS weather,
               COALESCE(e.lighting_condition, 'daylight') AS lighting
        FROM accidents a
        JOIN severity_levels sv ON sv.id = a.severity_id
        LEFT JOIN environmental_observations e ON e.accident_id = a.id
        WHERE a.dataset_id = ?
          AND a.snapped_segment_id IS NOT NULL
          AND a.verification_status != 'rejected_false_alarm'
          AND a.verification_status != 'merged_duplicate'
        """,
        (dataset_id,),
    ).fetchall()

    # Aggregate verified vs unverified VGI per segment
    seg_stats: dict[int, dict[str, Any]] = {}
    for r in seg_rows:
        sid = int(r["id"])
        seg_stats[sid] = {
            "verified_n": 0,
            "unverified_vgi_n": 0,
            "epdo_sum": 0.0,
            "ksi_count": 0,
            "adverse_env_count": 0,
            "snap_probs": [],
        }

    for ar in acc_rows:
        sid = int(ar["snapped_segment_id"])
        if sid not in seg_stats:
            continue
        st = seg_stats[sid]
        if ar["verification_status"] == "verified_canonical":
            st["verified_n"] += 1
            st["epdo_sum"] += float(ar["epdo_weight"])
            if int(ar["sev_rank"]) >= 3:
                st["ksi_count"] += 1
            if ar["weather"] != "clear" or ar["lighting"] in ("night_lit", "night_unlit", "twilight"):
                st["adverse_env_count"] += 1
        else:
            st["unverified_vgi_n"] += 1
        if ar["snap_probability"] is not None:
            st["snap_probs"].append(float(ar["snap_probability"]))

    # Fit Road-Class Stratified Negative Binomial SPF:
    # mu_e = L_km * T_yr * exp(b0_c) * (AADT_e / 10000)^b1 * (1 + 0.12 * junc_complexity)
    # Calibrate b0_c and overdispersion alpha_c empirically per road_class stratum!
    by_class: dict[str, list[int]] = {}
    M = len(seg_rows)
    obs_N = np.zeros(M, dtype=np.float64)
    len_km = np.zeros(M, dtype=np.float64)
    eff_aadt = np.zeros(M, dtype=np.float64)
    junc_factor = np.zeros(M, dtype=np.float64)
    road_classes: list[str] = []

    for idx, r in enumerate(seg_rows):
        sid = int(r["id"])
        rc = str(r["road_class"])
        road_classes.append(rc)
        by_class.setdefault(rc, []).append(idx)
        obs_N[idx] = float(seg_stats[sid]["verified_n"])
        len_km[idx] = max(0.02, float(r["length_m"]) / 1000.0)
        eff_aadt[idx] = float(r["obs_aadt"] or r["aadt"] or 8000.0)
        max_deg = max(int(r["u_deg"]), int(r["v_deg"]))
        junc_factor[idx] = 1.0 + (0.14 * max(0, max_deg - 2) if int(r["elevation_level"]) == 0 else 0.0)

    # Fit global elasticity beta_1 via log-linear regression on segments with N > 0, bounded to realistic HSM range [0.55, 0.95]
    pos_mask = obs_N > 0
    if np.sum(pos_mask) >= 6:
        x_reg = np.log(eff_aadt[pos_mask] / 10000.0)
        y_reg = np.log(obs_N[pos_mask] / (len_km[pos_mask] * period_yr * junc_factor[pos_mask]))
        if np.var(x_reg) > 1e-6:
            slope = float(np.cov(x_reg, y_reg, bias=True)[0, 1] / np.var(x_reg))
            beta_1 = max(0.50, min(0.95, slope))
        else:
            beta_1 = 0.72
    else:
        beta_1 = 0.72

    spf_mu = np.zeros(M, dtype=np.float64)
    spf_alpha = np.zeros(M, dtype=np.float64)
    stratum_diagnostics: list[dict[str, Any]] = []

    for rc, idxs in by_class.items():
        idx_arr = np.array(idxs, dtype=np.int64)
        exposure_base = len_km[idx_arr] * period_yr * ((eff_aadt[idx_arr] / 10000.0) ** beta_1) * junc_factor[idx_arr]
        sum_n = float(np.sum(obs_N[idx_arr]))
        sum_exp = max(1e-6, float(np.sum(exposure_base)))
        rate_c = max(0.35, sum_n / sum_exp)
        mu_c = rate_c * exposure_base
        spf_mu[idx_arr] = mu_c

        # Method-of-moments Negative Binomial overdispersion alpha_c: Var(N) = mu + alpha * mu^2
        num_disp = float(np.sum(((obs_N[idx_arr] - mu_c) ** 2) - mu_c))
        den_disp = max(1e-6, float(np.sum(mu_c ** 2)))
        alpha_c = max(0.12, min(1.80, num_disp / den_disp))
        spf_alpha[idx_arr] = alpha_c
        stratum_diagnostics.append(
            {
                "road_class": rc,
                "segment_count": len(idxs),
                "base_rate_exp_b0": round(rate_c, 3),
                "aadt_elasticity_b1": round(beta_1, 3),
                "overdispersion_alpha": round(alpha_c, 4),
            }
        )

    # Empirical Bayes Shrinkage: w_e = 1 / (1 + alpha_c * mu_e)
    eb_weight = 1.0 / (1.0 + spf_alpha * spf_mu)
    eb_expected = eb_weight * spf_mu + (1.0 - eb_weight) * obs_N
    eb_variance = (1.0 - eb_weight) * np.maximum(eb_expected, 0.05)
    eb_se = np.sqrt(eb_variance)
    psi_excess = eb_expected - spf_mu
    rtm_correction = obs_N - eb_expected  # Positive => raw spike shrunk downward!

    # 4-Tier Metrics + Multi-Criteria Vulnerability Components
    linear_density = obs_N / (len_km * period_yr)
    eb_density = eb_expected / (len_km * period_yr)
    epdo_arr = np.array([seg_stats[int(r["id"])]["epdo_sum"] for r in seg_rows], dtype=np.float64)
    epdo_per_km = epdo_arr / (len_km * period_yr)

    mvkt_arr = np.array(
        [max(0.01, float(r["exposure_mvkt_annual"] or 0.5) * period_yr) for r in seg_rows],
        dtype=np.float64,
    )
    mvkt_rate = obs_N / mvkt_arr

    geom_hazard_raw = np.array(
        [
            0.40 * (float(r["speed_limit_kmh"]) / 80.0)
            + 0.35 * min(1.0, max(0.0, (float(r["sinuosity"]) - 1.0) * 8.0))
            + 0.15 * min(1.0, abs(float(r["slope_pct"])) / 5.0)
            + 0.10 * (max(int(r["u_deg"]), int(r["v_deg"])) / 5.0)
            for r in seg_rows
        ],
        dtype=np.float64,
    )
    env_cov_raw = np.array(
        [
            seg_stats[int(r["id"])]["adverse_env_count"] / max(1.0, seg_stats[int(r["id"])]["verified_n"])
            for r in seg_rows
        ],
        dtype=np.float64,
    )

    # Normalize multi-criteria weights cleanly
    w_sum = max(1e-6, float(w_eb_risk + w_epdo_severity + w_geometric_hazard + w_environmental_cov))
    wn_eb = w_eb_risk / w_sum
    wn_epdo = w_epdo_severity / w_sum
    wn_geom = w_geometric_hazard / w_sum
    wn_env = w_environmental_cov / w_sum

    mcda_score = 100.0 * (
        wn_eb * _minmax_norm(eb_density)
        + wn_epdo * _minmax_norm(epdo_per_km)
        + wn_geom * _minmax_norm(geom_hazard_raw)
        + wn_env * _minmax_norm(env_cov_raw)
    )

    # Epistemic & Aleatoric Uncertainty Quantification (US-5.4)
    aleatoric_cv = np.clip(eb_se / np.maximum(eb_expected, 0.35), 0.0, 1.5)
    epistemic_u = np.zeros(M, dtype=np.float64)

    for idx, r in enumerate(seg_rows):
        sid = int(r["id"])
        st = seg_stats[sid]
        cov_conf = float(r["coverage_confidence"] or 0.65)
        is_imp = bool(r["is_imputed"])
        tot_rep = st["verified_n"] + st["unverified_vgi_n"]
        unver_ratio = st["unverified_vgi_n"] / max(1, tot_rep) if tot_rep > 0 else 0.35
        mean_snap_p = float(np.mean(st["snap_probs"])) if st["snap_probs"] else 0.85
        sparsity = math.exp(-obs_N[idx] / 2.5)

        u_val = (
            0.35 * (1.0 - cov_conf + (0.15 if is_imp else 0.0))
            + 0.30 * unver_ratio
            + 0.15 * (1.0 - mean_snap_p)
            + 0.20 * sparsity
        )
        epistemic_u[idx] = min(1.0, max(0.03, u_val))

    # Compute 3x3 Bivariate Risk (EB Density) x Uncertainty (Epistemic + Aleatoric composite) tertiles
    combined_uncertainty = np.clip(0.65 * epistemic_u + 0.35 * np.minimum(1.0, aleatoric_cv), 0.0, 1.0)
    r_q1, r_q2 = np.quantile(eb_density, [0.333, 0.667])
    u_q1, u_q2 = np.quantile(combined_uncertainty, [0.333, 0.667])

    features: list[dict[str, Any]] = []
    corridor_table: list[dict[str, Any]] = []

    for idx, r in enumerate(seg_rows):
        sid = int(r["id"])
        st = seg_stats[sid]
        r_bin = 1 if eb_density[idx] <= r_q1 else (2 if eb_density[idx] <= r_q2 else 3)
        u_bin = 1 if combined_uncertainty[idx] <= u_q1 else (2 if combined_uncertainty[idx] <= u_q2 else 3)
        biv_code = f"{r_bin}-{u_bin}"

        ci_low = max(0.0, float(eb_expected[idx] - 1.96 * eb_se[idx]))
        ci_high = float(eb_expected[idx] + 1.96 * eb_se[idx])

        props = {
            "segment_id": sid,
            "edge_code": r["edge_code"],
            "name": r["name"],
            "road_class": r["road_class"],
            "elevation_level": int(r["elevation_level"]),
            "length_m": round(float(r["length_m"]), 1),
            "speed_limit_kmh": int(r["speed_limit_kmh"]),
            "sinuosity": round(float(r["sinuosity"]), 4),
            "aadt": int(eff_aadt[idx]),
            "aadt_is_imputed": bool(r["is_imputed"]),
            "exposure_confidence": round(float(r["coverage_confidence"] or 0.7), 3),
            # 4 Rigorous Safety Metrics (US-5.1)
            "raw_crash_frequency": int(obs_N[idx]),
            "unverified_vgi_count": int(st["unverified_vgi_n"]),
            "linear_crash_density_per_km": round(float(linear_density[idx]), 3),
            "epdo_total": round(float(epdo_arr[idx]), 2),
            "epdo_per_km": round(float(epdo_per_km[idx]), 2),
            "exposure_mvkt_rate": round(float(mvkt_rate[idx]), 3),
            # Empirical Bayes & RTM Metrics (US-5.2)
            "spf_prior_expected": round(float(spf_mu[idx]), 3),
            "eb_weight_w": round(float(eb_weight[idx]), 4),
            "eb_expected_crashes": round(float(eb_expected[idx]), 3),
            "eb_density_per_km": round(float(eb_density[idx]), 3),
            "eb_se": round(float(eb_se[idx]), 3),
            "eb_ci95_low": round(ci_low, 3),
            "eb_ci95_high": round(ci_high, 3),
            "psi_excess_crashes": round(float(psi_excess[idx]), 3),
            "rtm_shrinkage_delta": round(float(rtm_correction[idx]), 3),
            # Multi-Criteria Heuristic Index (US-5.3)
            "mcda_vulnerability_index": round(float(mcda_score[idx]), 2),
            # Epistemic & Aleatoric Uncertainty (US-5.4)
            "epistemic_uncertainty": round(float(epistemic_u[idx]), 4),
            "aleatoric_cv": round(float(aleatoric_cv[idx]), 4),
            "combined_uncertainty": round(float(combined_uncertainty[idx]), 4),
            "bivariate_class": biv_code,
            "bivariate_color": BIVARIATE_PALETTE_3X3[biv_code],
        }
        features.append(
            {
                "type": "Feature",
                "properties": props,
                "geometry": json.loads(r["geojson_4326"]),
            }
        )
        corridor_table.append(props)

    corridor_ranked = sorted(corridor_table, key=lambda x: x["mcda_vulnerability_index"], reverse=True)
    for rk, row_item in enumerate(corridor_ranked, start=1):
        row_item["priority_rank"] = rk

    return {
        "crs_epsg": dataset_context(conn, dataset_id).canonical_epsg,
        "metric_epistemology_disclaimer": (
            "MCDA Vulnerability Index (0-100) is an interpretable multi-criteria decision-support score, "
            "NOT a calibrated crash probability. Use Empirical Bayes Expected Crashes (EB) and PSI for "
            "exposure-calibrated Regression-to-the-Mean safety evaluation."
        ),
        "normalized_weights": {
            "w_eb_risk": round(wn_eb, 3),
            "w_epdo_severity": round(wn_epdo, 3),
            "w_geometric_hazard": round(wn_geom, 3),
            "w_environmental_cov": round(wn_env, 3),
        },
        "spf_strata_diagnostics": stratum_diagnostics,
        "cure_diagnostic": cure_by_aadt(
            eff_aadt,
            obs_N,
            spf_mu,
            spf_alpha,
            np.array([bool(r["is_imputed"]) or not (r["obs_aadt"] or r["aadt"]) for r in seg_rows]),
        ),
        "length_scaled_eb": (
            lambda _fit: {
                k: v
                for k, v in _fit.items()
                if k not in ("expected_spf", "alpha_i", "eb_expected", "eb_posterior_sd", "psi_excess", "shrinkage_weight")
            }
            | {
                "rank_spearman_vs_legacy": round(
                    float(
                        0.0
                        if len(eb_expected) < 3
                        else np.corrcoef(
                            np.argsort(np.argsort(eb_expected)),
                            np.argsort(np.argsort(np.asarray(_fit["eb_expected"], dtype=float))),
                        )[0, 1]
                    ),
                    4,
                )
                if _fit["status"] != "zero_crashes_unidentifiable"
                else None
            }
        )(
            fit_length_scaled_nb_spf(
                obs_N,
                eff_aadt,
                len_km,
                study_period_years=period_yr,
                imputed_mask=np.array([bool(r["is_imputed"]) or not (r["obs_aadt"] or r["aadt"]) for r in seg_rows]),
            )
        ),
        "network_summary": {
            "segment_count": M,
            "total_verified_crashes": int(np.sum(obs_N)),
            "total_eb_expected": round(float(np.sum(eb_expected)), 2),
            "positive_psi_corridors": int(np.sum(psi_excess > 0.25)),
            "imputed_aadt_segments": int(sum(1 for r in seg_rows if r["is_imputed"])),
            "mean_epistemic_uncertainty": round(float(np.mean(epistemic_u)), 3),
        },
        "bivariate_palette": BIVARIATE_PALETTE_3X3,
        "layer_geojson": {"type": "FeatureCollection", "features": features},
        "ranked_corridors": corridor_ranked,
    }
