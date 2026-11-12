"""Fitted Length-Scaled Negative Binomial SPF & Empirical Bayes diagnostics.

Model specification (Hauer 1997 / Highway Safety Manual length-dependent NB):
- Expected crashes over study period T (years) on segment i of length L_i (km):
      mu_i = L_i * T * exp(beta_0 + beta_1 * log(AADT_i / 1000))
- Length-scaled overdispersion parameter:
      alpha_i = alpha_1 / L_i,   Var(N_i | mu_i) = mu_i + alpha_i * mu_i^2
  so combining adjacent identical homogeneous segments preserves variance additivity.
- Fitted via bounded maximum likelihood with finite-difference Hessian uncertainty
  diagnostics, compared transparently against legacy road-class constant-alpha EB.
"""
from __future__ import annotations

import math
import sqlite3
from typing import Any

import numpy as np
from scipy.optimize import minimize
from scipy.special import gammaln
from scipy.stats import spearmanr

from .cure_diagnostics import cure_by_aadt


def fit_length_scaled_nb_spf(
    counts: np.ndarray,
    aadt: np.ndarray,
    length_km: np.ndarray,
    study_period_years: float = 1.0,
    imputed_mask: np.ndarray | None = None,
) -> dict[str, Any]:
    """Fit pooled length-scaled NB-SPF and compute EB posterior expectations."""
    n = np.asarray(counts, dtype=float)
    q = np.asarray(aadt, dtype=float)
    length = np.asarray(length_km, dtype=float)
    if n.ndim != 1 or q.ndim != 1 or length.ndim != 1 or not (len(n) == len(q) == len(length)) or len(n) < 3:
        raise ValueError("At least 3 aligned segments with counts, AADT, and positive length_km are required.")
    if (
        not all(np.isfinite(x).all() for x in (n, q, length))
        or (n < 0).any()
        or (q <= 0).any()
        or (length <= 0).any()
        or study_period_years <= 0
        or not math.isfinite(study_period_years)
    ):
        raise ValueError("Counts >= 0, AADT > 0, length_km > 0, and positive study_period_years are required.")

    imputed = np.zeros(len(n), dtype=bool) if imputed_mask is None else np.asarray(imputed_mask, dtype=bool)
    total_crashes = float(np.sum(n))
    offset = np.log(length * float(study_period_years))
    x_log_aadt = np.log(q / 1000.0)
    x_centered = x_log_aadt - float(np.mean(x_log_aadt))

    if total_crashes == 0:
        return {
            "status": "zero_crashes_unidentifiable",
            "model_version": "length-nb-spf/1",
            "converged": False,
            "beta_0": None,
            "beta_1_log_aadt": None,
            "alpha_1_per_km": None,
            "expected_spf": np.zeros_like(n).tolist(),
            "eb_expected": np.zeros_like(n).tolist(),
            "eb_posterior_sd": np.zeros_like(n).tolist(),
            "psi_excess": np.zeros_like(n).tolist(),
            "shrinkage_weight": np.ones_like(n).tolist(),
            "cure_diagnostic": cure_by_aadt(
                q,
                n,
                np.zeros_like(n),
                np.full_like(n, 0.2),
                imputed,
                model_label="length-scaled NB-SPF (zero-count degenerate)",
            ),
            "limitations": "Zero total observed crashes: NB-SPF parameters are not identifiable.",
        }

    def neg_loglik(params: np.ndarray) -> float:
        b0_c, b1, log_a1 = float(params[0]), float(params[1]), float(params[2])
        eta = np.clip(offset + b0_c + b1 * x_centered, -20.0, 15.0)
        mu = np.exp(eta)
        alpha_1 = math.exp(log_a1)
        r_shape = length / alpha_1  # 1 / alpha_i = L_i / alpha_1
        ll = (
            gammaln(n + r_shape)
            - gammaln(r_shape)
            - gammaln(n + 1.0)
            + r_shape * np.log(r_shape / (r_shape + mu))
            + n * np.log(np.maximum(mu, 1e-15) / (r_shape + mu))
        )
        return float(-np.sum(ll))

    init_rate = max(1e-4, total_crashes / float(np.sum(length * study_period_years)))
    x0 = np.array([math.log(init_rate), 0.75, math.log(0.15)], dtype=float)
    bounds = [(-12.0, 8.0), (-1.0, 3.5), (math.log(1e-4), math.log(10.0))]
    opt = minimize(neg_loglik, x0, method="L-BFGS-B", bounds=bounds)

    b0_c, b1, log_a1 = (float(v) for v in opt.x)
    b0 = b0_c - b1 * float(np.mean(x_log_aadt))
    alpha_1 = math.exp(log_a1)
    mu = np.exp(np.clip(offset + b0_c + b1 * x_centered, -20.0, 15.0))
    alpha_vec = alpha_1 / length
    weight = 1.0 / (1.0 + alpha_vec * mu)
    eb_expected = weight * mu + (1.0 - weight) * n
    eb_var = (n + 1.0 / alpha_vec) * ((alpha_vec * mu) / (1.0 + alpha_vec * mu)) ** 2
    eb_sd = np.sqrt(np.maximum(0.0, eb_var))
    psi = eb_expected - mu

    # Finite-difference diagonal curvature for transparent parameter SE diagnostics
    eps = 1e-4
    f0 = neg_loglik(opt.x)
    se_list: list[float | None] = []
    for k in range(3):
        step = np.zeros(3, dtype=float)
        step[k] = eps
        d2 = (neg_loglik(opt.x + step) - 2.0 * f0 + neg_loglik(opt.x - step)) / (eps**2)
        se_list.append(round(float(1.0 / math.sqrt(d2)), 5) if d2 > 1e-8 and math.isfinite(d2) else None)

    cure = cure_by_aadt(
        q,
        n,
        mu,
        alpha_vec,
        imputed,
        model_label="fitted length-scaled NB-SPF (alpha_i = alpha_1 / L_i)",
    )

    return {
        "status": "ok" if bool(opt.success) else "suboptimal_convergence",
        "model_version": "length-nb-spf/1",
        "converged": bool(opt.success),
        "log_likelihood": round(float(-f0), 4),
        "beta_0": round(b0, 5),
        "beta_1_log_aadt": round(b1, 5),
        "alpha_1_per_km": round(alpha_1, 5),
        "parameter_se": {
            "beta_0_centered_se": se_list[0],
            "beta_1_log_aadt_se": se_list[1],
            "log_alpha_1_se": se_list[2],
        },
        "mean_shrinkage_weight": round(float(np.mean(weight)), 4),
        "expected_spf": np.round(mu, 4).tolist(),
        "alpha_i": np.round(alpha_vec, 5).tolist(),
        "eb_expected": np.round(eb_expected, 4).tolist(),
        "eb_posterior_sd": np.round(eb_sd, 4).tolist(),
        "psi_excess": np.round(psi, 4).tolist(),
        "shrinkage_weight": np.round(weight, 4).tolist(),
        "cure_diagnostic": cure,
        "limitations": (
            "Pooled MLE Negative Binomial SPF with length-scaled dispersion alpha_1 / L_i; "
            "EB posterior treats point-estimated SPF parameters as fixed (plug-in EB, not full spatial BYM2)."
        ),
    }


def evaluate_dataset_length_eb(
    conn: sqlite3.Connection,
    dataset_id: int,
    legacy_eb_expected: np.ndarray | None = None,
) -> dict[str, Any]:
    """Fit length-scaled NB-SPF on a SQLite dataset and compare with legacy EB."""
    ds = conn.execute(
        "SELECT study_period_years FROM dataset_sources WHERE id=?",
        (dataset_id,),
    ).fetchone()
    if not ds:
        raise ValueError(f"Dataset #{dataset_id} not found.")
    period_yr = float(ds["study_period_years"] or 1.0)
    rows = conn.execute(
        """SELECT s.id, s.name, s.length_m, s.aadt,
                  t.aadt_vehicles_per_day AS obs_aadt, t.is_imputed,
                  (SELECT COUNT(*) FROM accidents a
                   WHERE a.dataset_id = s.dataset_id
                     AND a.snapped_segment_id = s.id
                     AND a.verification_status = 'verified_canonical') AS crash_count
           FROM road_segments s
           LEFT JOIN traffic_observations t ON t.segment_id = s.id AND t.dataset_id = s.dataset_id
           WHERE s.dataset_id = ?
           ORDER BY s.id""",
        (dataset_id,),
    ).fetchall()
    if len(rows) < 3:
        raise ValueError("Dataset has fewer than 3 road segments.")

    counts = np.array([float(r["crash_count"]) for r in rows], dtype=float)
    aadt = np.array([float(r["obs_aadt"] or r["aadt"] or 8000) for r in rows], dtype=float)
    length_km = np.array([float(r["length_m"]) / 1000.0 for r in rows], dtype=float)
    imputed = np.array([bool(r["is_imputed"]) or not (r["obs_aadt"] or r["aadt"]) for r in rows], dtype=bool)

    fit = fit_length_scaled_nb_spf(counts, aadt, length_km, study_period_years=period_yr, imputed_mask=imputed)
    fit["segment_ids"] = [int(r["id"]) for r in rows]
    if legacy_eb_expected is not None and len(legacy_eb_expected) == len(rows) and fit["status"] != "zero_crashes_unidentifiable":
        eb_arr = np.asarray(fit["eb_expected"], dtype=float)
        rho, _ = spearmanr(eb_arr, np.asarray(legacy_eb_expected, dtype=float))
        fit["rank_spearman_vs_legacy"] = round(float(0.0 if np.isnan(rho) else rho), 4)
        fit["max_abs_diff_vs_legacy"] = round(float(np.max(np.abs(eb_arr - legacy_eb_expected))), 4)
    return fit
