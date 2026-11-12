"""Validated Spatial Hierarchical BYM2, VGI Multiple Imputation, and Joint Link-Node Models.

Implements OpenSpec requirements:
- `safety-bayes-and-decisions` (1.3, 1.4): Edge-node shared adjacency, Riebler geometric-mean
  connected-component scaling, isolate handling, multi-chain Generalized / Laplace-Preconditioned
  Elliptical Slice Sampling (Murray, Adams & MacKay 2010; Nishihara, Murray & Adams 2014) with
  split-Rhat and ESS diagnostics, and VGI latent count Multiple Imputation.
- `vgi-bias-and-uncertainty` (1.4): Rubin's rules combining within- and between-imputation variance
  across M discrete categorical allocations without misapplying discrete likelihoods to fractional counts.
- `advanced-network-research` (1.3): Coupled bipartite link-node incidence graph model compared
  against segment-only BYM2.
"""
from __future__ import annotations

import math
import sqlite3
import time
from typing import Any

import networkx as nx
import numpy as np
from scipy.optimize import minimize
from scipy.special import gammaln

from .allocations import incident_distribution
from .length_spf import fit_length_scaled_nb_spf


def split_rhat_and_ess(chains: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Compute Gelman-Rubin split-Rhat and bulk Effective Sample Size (chains: C x S x D)."""
    arr = np.asarray(chains, dtype=float)
    c_count, n_samples, dim = arr.shape
    half = n_samples // 2
    if half < 4 or c_count < 2:
        return np.ones(dim), np.full(dim, float(c_count * n_samples))

    split = np.concatenate([arr[:, :half, :], arr[:, -half:, :]], axis=0)
    m_chains, n_len, _ = split.shape
    chain_means = np.mean(split, axis=1)
    chain_vars = np.var(split, axis=1, ddof=1)
    w_var = np.mean(chain_vars, axis=0)
    b_var = n_len * np.var(chain_means, axis=0, ddof=1)

    var_hat = ((n_len - 1.0) / n_len) * w_var + (1.0 / n_len) * b_var
    rhat = np.sqrt(np.where(w_var > 1e-14, var_hat / np.maximum(w_var, 1e-14), 1.0))

    max_lag = min(25, n_len - 2)
    centered = split - chain_means[:, None, :]
    rho_sum = np.zeros(dim, dtype=float)
    for lag in range(1, max_lag + 1):
        gamma_lag = np.mean(centered[:, :-lag, :] * centered[:, lag:, :], axis=(0, 1))
        rho_lag = np.where(var_hat > 1e-14, gamma_lag / np.maximum(var_hat, 1e-14), 0.0)
        pos = np.maximum(rho_lag, 0.0)
        rho_sum += pos
    ess = (m_chains * n_len) / (1.0 + 2.0 * rho_sum)
    ess = np.clip(ess, 1.0, float(m_chains * n_len))
    return rhat, ess


def sample_poisson_glmm_preconditioned_ess(
    design_a: np.ndarray,
    base_eta: np.ndarray,
    y_obs: np.ndarray,
    obs_mask: np.ndarray | None = None,
    *,
    chains: int = 4,
    draws_per_chain: int = 200,
    warmup: int = 60,
    thin: int = 3,
    random_seed: int = 42,
) -> np.ndarray:
    """Exact MCMC sampling for z ~ N(0, I), y | z ~ Poisson(exp(base_eta + A @ z)) on obs_mask
    via Laplace-Preconditioned Elliptical Slice Sampling (Nishihara, Murray & Adams 2014).

    Preserves the exact non-Gaussian target posterior while eliminating ridge / high-count
    curvature bottlenecks via an exact analytic Newton/L-BFGS mode + Hessian Cholesky basis.
    Returns posterior z draws of shape (chains, draws_per_chain, dim_z).
    """
    a_mat = np.asarray(design_a, dtype=float)
    eta0 = np.asarray(base_eta, dtype=float)
    y = np.asarray(y_obs, dtype=float)
    mask = np.ones(len(y), dtype=bool) if obs_mask is None else np.asarray(obs_mask, dtype=bool)

    a_obs = a_mat[mask, :]
    eta0_obs = eta0[mask]
    y_m = y[mask]
    dim_z = a_mat.shape[1]
    const_ll = float(np.sum(gammaln(y_m + 1.0)))

    def neg_log_post_and_grad(z: np.ndarray) -> tuple[float, np.ndarray]:
        eta = np.clip(eta0_obs + a_obs @ z, -20.0, 16.0)
        mu = np.exp(eta)
        nlp = 0.5 * float(np.dot(z, z)) + float(np.sum(mu - y_m * eta)) + const_ll
        grad = z + a_obs.T @ (mu - y_m)
        return nlp, grad

    opt = minimize(
        neg_log_post_and_grad,
        np.zeros(dim_z, dtype=float),
        jac=True,
        method="L-BFGS-B",
        options={"maxiter": 150, "ftol": 1e-10},
    )
    z_hat = opt.x
    mu_hat = np.exp(np.clip(eta0_obs + a_obs @ z_hat, -20.0, 16.0))
    hess = np.eye(dim_z, dtype=float) + (a_obs.T * mu_hat[None, :]) @ a_obs
    eigvals, eigvecs = np.linalg.eigh(hess)
    eigvals = np.maximum(eigvals, 1e-6)
    chol_cov = eigvecs @ np.diag(1.0 / np.sqrt(eigvals))

    def pseudo_log_lik(v: np.ndarray) -> float:
        z = z_hat + chol_cov @ v
        eta = np.clip(eta0_obs + a_obs @ z, -20.0, 16.0)
        mu = np.exp(eta)
        log_p = float(np.sum(y_m * eta - mu)) - const_ll - 0.5 * float(np.dot(z, z))
        return log_p + 0.5 * float(np.dot(v, v))

    z_draws = np.zeros((chains, draws_per_chain, dim_z), dtype=float)

    for c_idx in range(chains):
        rng = np.random.default_rng(random_seed + 1009 * (c_idx + 1))
        v_cur = rng.normal(0.0, 1.0, size=dim_z)
        pll_cur = pseudo_log_lik(v_cur)

        def step_ess(v_in: np.ndarray, pll_in: float) -> tuple[np.ndarray, float]:
            nu = rng.normal(0.0, 1.0, size=dim_z)
            log_thresh = pll_in + math.log(max(float(rng.random()), 1e-15))
            angle = float(rng.uniform(0.0, 2.0 * math.pi))
            angle_min, angle_max = angle - 2.0 * math.pi, angle
            while True:
                v_prop = math.cos(angle) * v_in + math.sin(angle) * nu
                pll_prop = pseudo_log_lik(v_prop)
                if pll_prop >= log_thresh:
                    return v_prop, pll_prop
                if angle < 0.0:
                    angle_min = angle
                else:
                    angle_max = angle
                angle = float(rng.uniform(angle_min, angle_max))

        for _ in range(warmup):
            v_cur, pll_cur = step_ess(v_cur, pll_cur)

        for draw_idx in range(draws_per_chain):
            for _ in range(max(1, thin)):
                v_cur, pll_cur = step_ess(v_cur, pll_cur)
            z_draws[c_idx, draw_idx, :] = z_hat + chol_cov @ v_cur

    return z_draws


def build_riebler_scaled_icar_basis(adj_matrix: np.ndarray) -> dict[str, Any]:
    """Decompose an undirected adjacency matrix into connected components and build a
    Riebler geometric-mean scaled generative basis L_star such that u_star = L_star @ z
    (z ~ N(0, I)) has sum-to-zero per component, 0 on isolates, and geometric-mean marginal
    variance equal to 1 on every connected component of size >= 2.
    """
    w = np.asarray(adj_matrix, dtype=float)
    n = w.shape[0]
    if w.shape != (n, n):
        raise ValueError("Adjacency matrix must be square.")
    w = 0.5 * (w + w.T)
    np.fill_diagonal(w, 0.0)

    g = nx.from_numpy_array(w > 0)
    components = [sorted(list(comp)) for comp in nx.connected_components(g)]
    basis_cols: list[np.ndarray] = []
    is_isolate = np.zeros(n, dtype=bool)
    component_scales: list[dict[str, Any]] = []

    for comp_idx, nodes in enumerate(components):
        m = len(nodes)
        if m == 1:
            is_isolate[nodes[0]] = True
            component_scales.append({"component_id": comp_idx, "size": 1, "is_isolate": True, "riebler_scale": 0.0})
            continue
        sub_w = w[np.ix_(nodes, nodes)]
        deg = np.sum(sub_w, axis=1)
        lap = np.diag(deg) - sub_w
        eigvals, eigvecs = np.linalg.eigh(lap)
        pos_mask = eigvals > 1e-9
        pos_vals = eigvals[pos_mask]
        pos_vecs = eigvecs[:, pos_mask]
        q_plus = pos_vecs @ np.diag(1.0 / pos_vals) @ pos_vecs.T
        diag_q_plus = np.maximum(np.diag(q_plus), 1e-12)
        geom_mean_var = float(np.exp(np.mean(np.log(diag_q_plus))))
        col_block = pos_vecs @ np.diag(1.0 / np.sqrt(pos_vals * geom_mean_var))
        for k in range(col_block.shape[1]):
            full_col = np.zeros(n, dtype=float)
            full_col[nodes] = col_block[:, k]
            basis_cols.append(full_col)
        component_scales.append(
            {
                "component_id": comp_idx,
                "size": m,
                "is_isolate": False,
                "riebler_scale": round(geom_mean_var, 6),
            }
        )

    l_star = np.column_stack(basis_cols) if basis_cols else np.zeros((n, 0), dtype=float)
    return {
        "l_star": l_star,
        "is_isolate": is_isolate,
        "component_count": len(components),
        "isolate_count": int(np.sum(is_isolate)),
        "components": component_scales,
    }


def build_segment_adjacency_matrix(segment_rows: list[dict[str, Any] | sqlite3.Row]) -> np.ndarray:
    """Construct genuine topological segment adjacency via shared network endpoints."""
    n = len(segment_rows)
    adj = np.zeros((n, n), dtype=float)
    node_to_segs: dict[int, list[int]] = {}
    for idx, row in enumerate(segment_rows):
        u_id = int(row["u_node_id"])
        v_id = int(row["v_node_id"])
        node_to_segs.setdefault(u_id, []).append(idx)
        if v_id != u_id:
            node_to_segs.setdefault(v_id, []).append(idx)
    for seg_list in node_to_segs.values():
        for i_pos in range(len(seg_list)):
            for j_pos in range(i_pos + 1, len(seg_list)):
                a, b = seg_list[i_pos], seg_list[j_pos]
                adj[a, b] = 1.0
                adj[b, a] = 1.0
    return adj


def fit_bym2_spatial_counts(
    counts: np.ndarray,
    exposure_offset: np.ndarray,
    covariate_centered: np.ndarray,
    adj_matrix: np.ndarray,
    *,
    chains: int = 4,
    draws_per_chain: int = 220,
    warmup: int = 70,
    random_seed: int = 42,
) -> dict[str, Any]:
    """Fit a Riebler-scaled BYM2 Poisson-lognormal spatial model via multi-chain
    Laplace-Preconditioned Elliptical Slice Sampling with Gelman-Rubin diagnostics.
    """
    t0 = time.perf_counter()
    y = np.asarray(counts, dtype=float)
    offset = np.asarray(exposure_offset, dtype=float)
    x_cov = np.asarray(covariate_centered, dtype=float)
    n = len(y)
    if n < 3 or offset.shape != (n,) or x_cov.shape != (n,):
        raise ValueError("Aligned counts, exposure_offset, and covariate_centered of length >= 3 required.")
    if (y < 0).any() or not np.all(np.isfinite(y)) or not np.all(np.isfinite(offset)):
        raise ValueError("Non-negative finite counts and finite offsets required.")

    basis = build_riebler_scaled_icar_basis(adj_matrix)
    l_star = basis["l_star"]
    is_isolate = basis["is_isolate"]
    has_spatial = l_star.shape[1] > 0

    total_y = float(np.sum(y))
    base_b0 = math.log(max(total_y, 0.5) / max(float(np.sum(np.exp(offset))), 1e-9))

    if total_y == 0 or not has_spatial:
        sigma_hat = 0.25 if total_y > 0 else 0.15
        rho_hat = 0.0 if not has_spatial else 0.35
        b0_init, b1_init = base_b0, 0.0
    else:
        def fixed_obj(p: np.ndarray) -> float:
            eta = np.clip(offset + p[0] + p[1] * x_cov, -20.0, 15.0)
            mu = np.exp(eta)
            return float(np.sum(mu - y * eta) + 0.05 * (p[0] - base_b0) ** 2 + 0.25 * p[1] ** 2)

        opt_fe = minimize(fixed_obj, np.array([base_b0, 0.7]), method="BFGS")
        b0_init, b1_init = float(opt_fe.x[0]), float(opt_fe.x[1])
        mu0 = np.exp(np.clip(offset + b0_init + b1_init * x_cov, -18.0, 14.0))
        pearson = (y - mu0) / np.sqrt(np.maximum(mu0, 0.25))
        excess_var = max(0.04, float(np.mean((y - mu0) ** 2 - mu0) / max(float(np.mean(mu0)) ** 2, 0.1)))
        sigma_hat = float(np.clip(math.sqrt(excess_var), 0.15, 1.35))

        deg = np.sum(adj_matrix, axis=1)
        if np.sum(deg) > 0:
            z_std = pearson - np.mean(pearson)
            denom = float(np.sum(z_std**2))
            moran_num = float(z_std @ adj_matrix @ z_std)
            raw_corr = moran_num / max(float(np.sum(deg)) * denom / n, 1e-9) if denom > 1e-9 else 0.0
            rho_hat = float(np.clip(0.35 + 0.55 * np.tanh(raw_corr), 0.08, 0.92))
        else:
            rho_hat = 0.0

    rho_vec = np.where(is_isolate, 0.0, rho_hat)
    unstruct_scale = sigma_hat * np.sqrt(1.0 - rho_vec)
    struct_scale = sigma_hat * math.sqrt(rho_hat)

    # Linear predictor: eta = (offset + b0_init + b1_init * x_cov) + A_bym2 @ z
    base_eta = offset + b0_init + b1_init * x_cov
    cols = [np.full((n, 1), 1.5), (1.0 * x_cov)[:, None], np.diag(unstruct_scale)]
    if l_star.shape[1] > 0:
        cols.append(struct_scale * l_star)
    design_a = np.hstack(cols)

    z_draws = sample_poisson_glmm_preconditioned_ess(
        design_a,
        base_eta,
        y,
        chains=chains,
        draws_per_chain=draws_per_chain,
        warmup=warmup,
        random_seed=random_seed,
    )

    eta_draws = np.clip(base_eta[None, None, :] + np.einsum("csd,nd->csn", z_draws, design_a), -20.0, 15.0)
    kept_mu = np.exp(eta_draws)
    b0_draws = b0_init + 1.5 * z_draws[:, :, 0]
    b1_draws = b1_init + 1.0 * z_draws[:, :, 1]
    kept_par = np.stack([b0_draws, b1_draws], axis=-1)

    rhat_mu, ess_mu = split_rhat_and_ess(kept_mu)
    rhat_par, ess_par = split_rhat_and_ess(kept_par)

    flat_mu = kept_mu.reshape(-1, n)
    flat_b0 = b0_draws.reshape(-1)
    flat_b1 = b1_draws.reshape(-1)
    post_mean = np.mean(flat_mu, axis=0)
    post_sd = np.std(flat_mu, axis=0, ddof=1)
    ci_low = np.quantile(flat_mu, 0.025, axis=0)
    ci_high = np.quantile(flat_mu, 0.975, axis=0)

    max_rhat = float(max(np.max(rhat_mu), np.max(rhat_par)))
    min_ess = float(min(np.min(ess_mu), np.min(ess_par)))
    converged = bool(max_rhat <= 1.10 and min_ess >= 40.0)
    runtime_ms = round((time.perf_counter() - t0) * 1000.0, 2)

    return {
        "status": "ok" if converged else "convergence_warning",
        "model_version": "bym2-ess-mcmc/1",
        "inference_method": "laplace_preconditioned_elliptical_slice_sampling",
        "converged": converged,
        "chains": chains,
        "draws_per_chain": draws_per_chain,
        "total_posterior_draws": int(chains * draws_per_chain),
        "beta_0_mean": round(float(np.mean(flat_b0)), 5),
        "beta_0_sd": round(float(np.std(flat_b0, ddof=1)), 5),
        "beta_1_mean": round(float(np.mean(flat_b1)), 5),
        "beta_1_sd": round(float(np.std(flat_b1, ddof=1)), 5),
        "sigma_total": round(sigma_hat, 5),
        "rho_spatial_mixing": round(rho_hat, 5),
        "diagnostics": {
            "max_split_rhat": round(max_rhat, 4),
            "min_bulk_ess": round(min_ess, 1),
            "component_count": basis["component_count"],
            "isolate_count": basis["isolate_count"],
            "components": basis["components"],
            "runtime_ms": runtime_ms,
        },
        "posterior_mean": np.round(post_mean, 5).tolist(),
        "posterior_sd": np.round(post_sd, 5).tolist(),
        "ci95_low": np.round(ci_low, 5).tolist(),
        "ci95_high": np.round(ci_high, 5).tolist(),
        "posterior_draws_preview": np.round(flat_mu[:32, :], 5).tolist(),
    }


def run_dataset_bym2_and_vgi_imputation(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    include_unverified_vgi: bool = True,
    imputations_m: int = 12,
    chains: int = 4,
    draws_per_chain: int = 200,
    random_seed: int = 42,
) -> dict[str, Any]:
    """Fit BYM2 on the active dataset and propagate VGI snap-allocation uncertainty
    via Rubin's Multiple Imputation (M discrete integer count realizations).
    """
    if not 2 <= imputations_m <= 50:
        raise ValueError("imputations_m must be in [2, 50].")

    ds = conn.execute(
        "SELECT id, study_period_years, is_synthetic FROM dataset_sources WHERE id=?",
        (dataset_id,),
    ).fetchone()
    if not ds:
        raise ValueError(f"Dataset #{dataset_id} not found.")
    period_yr = float(ds["study_period_years"] or 1.0)

    seg_rows = conn.execute(
        """SELECT s.id, s.name, s.u_node_id, s.v_node_id, s.length_m, s.aadt,
                  t.aadt_vehicles_per_day AS obs_aadt, t.is_imputed
           FROM road_segments s
           LEFT JOIN traffic_observations t ON t.segment_id = s.id AND t.dataset_id = s.dataset_id
           WHERE s.dataset_id = ?
           ORDER BY s.id""",
        (dataset_id,),
    ).fetchall()
    if len(seg_rows) < 3:
        raise ValueError("At least 3 road segments required for BYM2.")

    seg_ids = [int(r["id"]) for r in seg_rows]
    seg_to_idx = {sid: i for i, sid in enumerate(seg_ids)}
    lixel_rows = conn.execute(
        "SELECT id, parent_segment_id FROM road_lixels WHERE dataset_id = ?",
        (dataset_id,),
    ).fetchall()
    lixel_to_seg_idx = {
        int(r["id"]): seg_to_idx[int(r["parent_segment_id"])]
        for r in lixel_rows
        if int(r["parent_segment_id"]) in seg_to_idx
    }

    lengths_km = np.array([float(r["length_m"]) / 1000.0 for r in seg_rows], dtype=float)
    aadt = np.array([float(r["obs_aadt"] or r["aadt"] or 8000.0) for r in seg_rows], dtype=float)
    imputed_mask = np.array([bool(r["is_imputed"]) or not (r["obs_aadt"] or r["aadt"]) for r in seg_rows], dtype=bool)
    offset = np.log(lengths_km * period_yr)
    x_log = np.log(aadt / 1000.0)
    x_centered = x_log - float(np.mean(x_log))
    adj = build_segment_adjacency_matrix(seg_rows)

    statuses = (
        ("verified_canonical", "corroborated_pending", "unverified_raw_vgi")
        if include_unverified_vgi
        else ("verified_canonical",)
    )
    placeholders = ",".join("?" for _ in statuses)
    inc_rows = conn.execute(
        f"""SELECT id, snapped_segment_id, snapped_lixel_id, snap_candidates_json, verification_status
            FROM accidents
            WHERE dataset_id = ? AND verification_status IN ({placeholders})""",
        (dataset_id, *statuses),
    ).fetchall()

    hard_counts = np.zeros(len(seg_ids), dtype=float)
    inc_seg_dists: list[tuple[list[int], np.ndarray]] = []
    ambiguous_incidents = 0

    for inc in inc_rows:
        sid = inc["snapped_segment_id"]
        if sid is not None and int(sid) in seg_to_idx:
            hard_counts[seg_to_idx[int(sid)]] += 1.0
        dist = incident_distribution(conn, int(inc["id"]))
        seg_probs: dict[int, float] = {}
        for item in dist.get("allocations", []):
            lx_id = int(item["lixel_id"])
            prob = float(item["probability"])
            if lx_id in lixel_to_seg_idx and prob > 0:
                s_i = lixel_to_seg_idx[lx_id]
                seg_probs[s_i] = seg_probs.get(s_i, 0.0) + prob
        if not seg_probs and sid is not None and int(sid) in seg_to_idx:
            seg_probs[seg_to_idx[int(sid)]] = 1.0
        if seg_probs:
            s_keys = sorted(seg_probs.keys())
            p_arr = np.array([seg_probs[k] for k in s_keys], dtype=float)
            p_arr /= float(np.sum(p_arr))
            if len(s_keys) > 1:
                ambiguous_incidents += 1
            inc_seg_dists.append((s_keys, p_arr))

    bym2_fit = fit_bym2_spatial_counts(
        hard_counts,
        offset,
        x_centered,
        adj,
        chains=chains,
        draws_per_chain=draws_per_chain,
        random_seed=random_seed,
    )

    rng = np.random.default_rng(random_seed)
    mi_means = np.zeros((imputations_m, len(seg_ids)), dtype=float)
    mi_vars = np.zeros((imputations_m, len(seg_ids)), dtype=float)
    for m_idx in range(imputations_m):
        y_imp = np.zeros(len(seg_ids), dtype=float)
        for s_keys, p_arr in inc_seg_dists:
            chosen = s_keys[0] if len(s_keys) == 1 else int(rng.choice(s_keys, p=p_arr))
            y_imp[chosen] += 1.0
        nb_m = fit_length_scaled_nb_spf(y_imp, aadt, lengths_km, period_yr, imputed_mask)
        mi_means[m_idx, :] = np.asarray(nb_m["eb_expected"], dtype=float)
        mi_vars[m_idx, :] = np.asarray(nb_m["eb_posterior_sd"], dtype=float) ** 2

    q_bar = np.mean(mi_means, axis=0)
    u_bar = np.mean(mi_vars, axis=0)
    b_var = np.var(mi_means, axis=0, ddof=1) if imputations_m > 1 else np.zeros(len(seg_ids))
    t_var = u_bar + (1.0 + 1.0 / imputations_m) * b_var
    fmi = np.where(t_var > 1e-12, ((1.0 + 1.0 / imputations_m) * b_var) / np.maximum(t_var, 1e-12), 0.0)

    corridor_summaries = []
    for idx, r in enumerate(seg_rows):
        corridor_summaries.append(
            {
                "segment_id": int(r["id"]),
                "name": str(r["name"]),
                "hard_count": int(hard_counts[idx]),
                "bym2_mean": round(float(bym2_fit["posterior_mean"][idx]), 4),
                "bym2_sd": round(float(bym2_fit["posterior_sd"][idx]), 4),
                "bym2_ci95": [
                    round(float(bym2_fit["ci95_low"][idx]), 4),
                    round(float(bym2_fit["ci95_high"][idx]), 4),
                ],
                "mi_eb_mean": round(float(q_bar[idx]), 4),
                "mi_total_sd": round(float(math.sqrt(max(0.0, t_var[idx]))), 4),
                "mi_between_var": round(float(b_var[idx]), 6),
                "mi_fmi": round(float(fmi[idx]), 4),
            }
        )
    corridor_summaries.sort(key=lambda item: item["bym2_mean"], reverse=True)

    return {
        "dataset_id": dataset_id,
        "bym2": bym2_fit,
        "vgi_multiple_imputation": {
            "method": "rubin_multiple_imputation_discrete_nb_eb",
            "imputations_m": imputations_m,
            "random_seed": random_seed,
            "include_unverified_vgi": include_unverified_vgi,
            "total_incidents_sampled": len(inc_seg_dists),
            "multi_segment_ambiguous_incidents": ambiguous_incidents,
            "mean_within_variance": round(float(np.mean(u_bar)), 6),
            "mean_between_variance": round(float(np.mean(b_var)), 6),
            "mean_total_variance": round(float(np.mean(t_var)), 6),
            "mean_fmi": round(float(np.mean(fmi)), 4),
            "max_fmi": round(float(np.max(fmi)), 4),
        },
        "top_corridors": corridor_summaries[:15],
        "limitations": (
            "BYM2 spatial random effects borrow strength across topologically adjacent road segments "
            "scaled per connected component (Riebler 2016); isolates receive unstructured prior variance only. "
            "Multiple imputation propagates discrete VGI snap ambiguity without fractional-count likelihood misuse."
        ),
    }


def fit_joint_link_node_research_model(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    junction_buffer_m: float = 22.0,
    chains: int = 4,
    draws_per_chain: int = 180,
    random_seed: int = 42,
) -> dict[str, Any]:
    """Fit a coupled Joint Link-Node spatial model on the bipartite segment-junction
    incidence graph and benchmark log-predictive score vs segment-only BYM2.
    """
    if not 5.0 <= junction_buffer_m <= 80.0:
        raise ValueError("junction_buffer_m must be in [5, 80].")

    seg_rows = conn.execute(
        """SELECT s.id, s.name, s.u_node_id, s.v_node_id, s.length_m, s.aadt,
                  t.aadt_vehicles_per_day AS obs_aadt
           FROM road_segments s
           LEFT JOIN traffic_observations t ON t.segment_id = s.id AND t.dataset_id = s.dataset_id
           WHERE s.dataset_id = ?
           ORDER BY s.id""",
        (dataset_id,),
    ).fetchall()
    node_rows = conn.execute(
        "SELECT id, node_code, degree FROM road_nodes WHERE dataset_id = ? ORDER BY id",
        (dataset_id,),
    ).fetchall()
    if len(seg_rows) < 3 or len(node_rows) < 2:
        raise ValueError("Dataset requires both road segments and road nodes.")

    n_seg = len(seg_rows)
    n_node = len(node_rows)
    seg_to_idx = {int(r["id"]): i for i, r in enumerate(seg_rows)}
    node_to_idx = {int(r["id"]): i for i, r in enumerate(node_rows)}

    n_tot = n_seg + n_node
    inc_adj = np.zeros((n_tot, n_tot), dtype=float)
    node_entering_aadt = np.zeros(n_node, dtype=float)
    seg_lengths_m = np.array([float(r["length_m"]) for r in seg_rows], dtype=float)
    seg_aadt = np.array([float(r["obs_aadt"] or r["aadt"] or 8000.0) for r in seg_rows], dtype=float)

    for s_i, r in enumerate(seg_rows):
        for nid in (int(r["u_node_id"]), int(r["v_node_id"])):
            if nid in node_to_idx:
                n_i = node_to_idx[nid]
                inc_adj[s_i, n_seg + n_i] = 1.0
                inc_adj[n_seg + n_i, s_i] = 1.0
                node_entering_aadt[n_i] += 0.5 * seg_aadt[s_i]

    node_entering_aadt = np.maximum(node_entering_aadt, 1500.0)

    inc_rows = conn.execute(
        """SELECT snapped_segment_id, linear_offset_m
           FROM accidents
           WHERE dataset_id = ? AND verification_status = 'verified_canonical'
             AND snapped_segment_id IS NOT NULL""",
        (dataset_id,),
    ).fetchall()

    link_counts = np.zeros(n_seg, dtype=float)
    node_counts = np.zeros(n_node, dtype=float)
    seg_only_counts = np.zeros(n_seg, dtype=float)

    for inc in inc_rows:
        sid = int(inc["snapped_segment_id"])
        if sid not in seg_to_idx:
            continue
        s_i = seg_to_idx[sid]
        seg_only_counts[s_i] += 1.0
        s_len = seg_lengths_m[s_i]
        m_off = float(inc["linear_offset_m"] or (0.5 * s_len))
        u_id = int(seg_rows[s_i]["u_node_id"])
        v_id = int(seg_rows[s_i]["v_node_id"])
        if m_off <= min(junction_buffer_m, 0.35 * s_len) and u_id in node_to_idx:
            node_counts[node_to_idx[u_id]] += 1.0
        elif (s_len - m_off) <= min(junction_buffer_m, 0.35 * s_len) and v_id in node_to_idx:
            node_counts[node_to_idx[v_id]] += 1.0
        else:
            link_counts[s_i] += 1.0

    eff_link_km = np.maximum(seg_lengths_m - 2.0 * np.minimum(junction_buffer_m, 0.35 * seg_lengths_m), 20.0) / 1000.0
    joint_counts = np.concatenate([link_counts, node_counts])
    joint_offset = np.concatenate([np.log(eff_link_km), np.full(n_node, math.log(0.05))])
    joint_log_exp = np.concatenate([np.log(seg_aadt / 1000.0), np.log(node_entering_aadt / 1000.0)])
    joint_cov = joint_log_exp - float(np.mean(joint_log_exp))

    joint_fit = fit_bym2_spatial_counts(
        joint_counts,
        joint_offset,
        joint_cov,
        inc_adj,
        chains=chains,
        draws_per_chain=draws_per_chain,
        random_seed=random_seed,
    )

    joint_means = np.asarray(joint_fit["posterior_mean"], dtype=float)
    joint_seg_equiv = joint_means[:n_seg].copy()
    node_degree_incident = np.maximum(np.sum(inc_adj[n_seg:, :n_seg], axis=1), 1.0)
    for s_i in range(n_seg):
        for n_i in range(n_node):
            if inc_adj[s_i, n_seg + n_i] > 0:
                joint_seg_equiv[s_i] += joint_means[n_seg + n_i] / node_degree_incident[n_i]

    seg_adj = build_segment_adjacency_matrix(seg_rows)
    seg_cov = np.log(seg_aadt / 1000.0) - float(np.mean(np.log(seg_aadt / 1000.0)))
    seg_fit = fit_bym2_spatial_counts(
        seg_only_counts,
        np.log(seg_lengths_m / 1000.0),
        seg_cov,
        seg_adj,
        chains=chains,
        draws_per_chain=draws_per_chain,
        random_seed=random_seed + 7,
    )
    seg_means = np.asarray(seg_fit["posterior_mean"], dtype=float)

    def poisson_log_score(obs: np.ndarray, mu: np.ndarray) -> float:
        m = np.maximum(mu, 1e-9)
        return float(np.mean(obs * np.log(m) - m - gammaln(obs + 1.0)))

    ll_joint = poisson_log_score(seg_only_counts, joint_seg_equiv)
    ll_seg = poisson_log_score(seg_only_counts, seg_means)

    top_junctions = sorted(
        [
            {
                "node_id": int(node_rows[i]["id"]),
                "node_code": str(node_rows[i]["node_code"]),
                "degree": int(node_rows[i]["degree"]),
                "observed_junction_crashes": int(node_counts[i]),
                "posterior_expected": round(float(joint_means[n_seg + i]), 4),
                "posterior_sd": round(float(joint_fit["posterior_sd"][n_seg + i]), 4),
            }
            for i in range(n_node)
        ],
        key=lambda item: item["posterior_expected"],
        reverse=True,
    )[:8]

    return {
        "status": joint_fit["status"],
        "model_version": "joint-link-node-bym2/1",
        "junction_buffer_m": junction_buffer_m,
        "link_count": n_seg,
        "node_count": n_node,
        "total_link_crashes": int(np.sum(link_counts)),
        "total_junction_crashes": int(np.sum(node_counts)),
        "diagnostics": joint_fit["diagnostics"],
        "comparison_vs_segment_bym2": {
            "joint_segment_equiv_mean_log_score": round(ll_joint, 5),
            "segment_only_bym2_mean_log_score": round(ll_seg, 5),
            "delta_log_score": round(ll_joint - ll_seg, 5),
            "node_exposure_source": "approximated_half_entering_segment_aadt",
        },
        "top_junction_hotspots": top_junctions,
        "limitations": (
            "Node turning-movement volumes are approximated from incident segment AADT; "
            "empirically metered intersection approach counts are required before operational junction ranking."
        ),
    }
