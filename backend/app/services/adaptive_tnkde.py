"""Spatiotemporal fixed and bounded pilot-adaptive TNKDE with event-level LOO-LCV.

Implements:
- Exact discrete network quadrature spatial kernel normalized over reachable lixels.
- Truncated symmetric Laplace (retrospective) or causal exponential temporal kernel
  normalized over the declared finite window [start_s, end_s].
- Bounded Abramson square-root law pilot adaptation with configurable clipping factor c >= 1.
- Event-level Leave-One-Out Log Cross-Validation (LOO-LCV) preventing self-contribution
  and, in causal mode, preventing any future-event leakage.
"""
from __future__ import annotations

from datetime import datetime, timezone
import math
import sqlite3
from typing import Any, Literal

import numpy as np

from ..crs import extract_lixel_linestring, linestring_25832_to_geojson_dict
from .allocations import incident_distribution
from .map_matching import parse_utc_iso
from .network_generator import get_lixel_network_topology


def _temporal_kernel_normalized(
    eval_times_s: np.ndarray,
    event_times_s: np.ndarray,
    bandwidths_t_s: np.ndarray,
    domain_s: tuple[float, float],
    causal: bool,
) -> np.ndarray:
    """Return matrix of shape (len(eval_times_s), len(event_times_s)) integrating to 1 on domain_s."""
    start_s, end_s = domain_s
    delta = eval_times_s[:, None] - event_times_s[None, :]
    ht = bandwidths_t_s[None, :]
    if causal:
        norm = -np.expm1(-(end_s - event_times_s) / bandwidths_t_s)
        raw = np.exp(-np.maximum(delta, 0.0) / ht) * (delta >= 0.0) / ht
    else:
        norm = 1.0 - 0.5 * (
            np.exp(-(event_times_s - start_s) / bandwidths_t_s)
            + np.exp(-(end_s - event_times_s) / bandwidths_t_s)
        )
        raw = 0.5 * np.exp(-np.abs(delta) / ht) / ht
    return np.divide(raw, norm[None, :], out=np.zeros_like(raw), where=norm[None, :] > 1e-12)


def _spatial_event_kernels(
    lixel_dist_matrix: np.ndarray,
    lengths_m: np.ndarray,
    event_allocations: list[list[tuple[int, float]]],
    bandwidths_s_m: np.ndarray,
) -> tuple[np.ndarray, list[int]]:
    """Compute per-event spatial kernel across M lixels (shape N_events x M).

    Each event's fractional candidate lixels are combined into one event kernel
    normalized so integral over supported lixels equals 1.
    """
    n_events = len(event_allocations)
    n_lixels = len(lengths_m)
    spatial = np.zeros((n_events, n_lixels), dtype=float)
    unsupported: list[int] = []
    for idx, alloc in enumerate(event_allocations):
        hs = float(bandwidths_s_m[idx])
        acc = np.zeros(n_lixels, dtype=float)
        for lix_idx, prob in alloc:
            d_vec = lixel_dist_matrix[:, lix_idx]
            k_vec = np.where(np.isfinite(d_vec), np.exp(-d_vec / hs), 0.0)
            z = float(k_vec @ lengths_m)
            if z > 0.0:
                acc += prob * (k_vec / z)
        total_int = float(acc @ lengths_m)
        if total_int <= 0.0:
            unsupported.append(idx)
        else:
            spatial[idx] = acc / total_int
    return spatial, unsupported


def evaluate_event_loo_intensities(
    lixel_dist_matrix: np.ndarray,
    lengths_m: np.ndarray,
    event_allocations: list[list[tuple[int, float]]],
    event_times_s: np.ndarray,
    event_weights: np.ndarray,
    bandwidths_s_m: np.ndarray,
    bandwidths_t_s: np.ndarray,
    domain_s: tuple[float, float],
    causal: bool,
    exclude_self: bool = True,
) -> tuple[np.ndarray, list[int]]:
    """Evaluate intensity at each event (location expectation over its allocation, event_time)."""
    n_events = len(event_times_s)
    if n_events == 0:
        return np.zeros(0, dtype=float), []
    spatial, unsupported = _spatial_event_kernels(
        lixel_dist_matrix, lengths_m, event_allocations, bandwidths_s_m
    )
    temporal = _temporal_kernel_normalized(
        event_times_s, event_times_s, bandwidths_t_s, domain_s, causal=causal
    )
    temporal = temporal * event_weights[None, :]
    if exclude_self:
        np.fill_diagonal(temporal, 0.0)
    if causal and exclude_self:
        # Strict causal holdout: disallow simultaneous timestamp ties from contributing to each other
        same_or_future = event_times_s[:, None] <= event_times_s[None, :]
        temporal = np.where(same_or_future, 0.0, temporal)

    # Spatial density at event i's allocation from every source event j: shape (N, N)
    event_spatial_at_i = np.zeros((n_events, n_events), dtype=float)
    for i, alloc in enumerate(event_allocations):
        for lix_idx, prob in alloc:
            event_spatial_at_i[i] += prob * spatial[:, lix_idx]
    vals = np.sum(temporal * event_spatial_at_i, axis=1)
    return vals, unsupported


def compute_abramson_bandwidths(
    lixel_dist_matrix: np.ndarray,
    lengths_m: np.ndarray,
    event_allocations: list[list[tuple[int, float]]],
    event_times_s: np.ndarray,
    event_weights: np.ndarray,
    pilot_spatial_m: float,
    pilot_temporal_s: float,
    domain_s: tuple[float, float],
    causal: bool = False,
    clip_factor: float = 2.5,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Compute bounded Abramson inverse-square-root adaptive bandwidths per event."""
    if clip_factor < 1.0 or clip_factor > 10.0 or not math.isfinite(clip_factor):
        raise ValueError("Adaptive clip_factor must be finite and in [1.0, 10.0].")
    n_events = len(event_times_s)
    if n_events == 0:
        return np.zeros(0), np.zeros(0), np.zeros(0)
    hs0 = np.full(n_events, float(pilot_spatial_m), dtype=float)
    ht0 = np.full(n_events, float(pilot_temporal_s), dtype=float)
    pilot_vals, _ = evaluate_event_loo_intensities(
        lixel_dist_matrix,
        lengths_m,
        event_allocations,
        event_times_s,
        event_weights,
        hs0,
        ht0,
        domain_s,
        causal=causal,
        exclude_self=False,
    )
    positive = pilot_vals[pilot_vals > 1e-18]
    if positive.size == 0:
        factors = np.ones(n_events, dtype=float)
    else:
        geom_mean = float(np.exp(np.mean(np.log(positive))))
        safe_pilot = np.maximum(pilot_vals, geom_mean / (clip_factor**2))
        factors = np.clip((safe_pilot / geom_mean) ** (-0.5), 1.0 / clip_factor, clip_factor)
    return hs0 * factors, ht0 * factors, factors


def select_tnkde_bandwidths_lcv(
    lixel_dist_matrix: np.ndarray,
    lengths_m: np.ndarray,
    event_allocations: list[list[tuple[int, float]]],
    event_times_s: np.ndarray,
    event_weights: np.ndarray,
    spatial_grid_m: list[float],
    temporal_grid_s: list[float],
    domain_s: tuple[float, float],
    *,
    adaptive: bool = False,
    clip_factor: float = 2.5,
    causal: bool = False,
) -> dict[str, Any]:
    """Select (spatial_m, temporal_s) maximizing event-level Leave-One-Out Log-Likelihood CV."""
    if not spatial_grid_m or not temporal_grid_s:
        raise ValueError("Bandwidth search grids must be non-empty.")
    if len(spatial_grid_m) * len(temporal_grid_s) > 36:
        raise ValueError("LCV grid is capped at 36 candidate pairs.")
    n_events = len(event_times_s)
    if n_events < 3:
        hs_sel = float(spatial_grid_m[0])
        ht_sel = float(temporal_grid_s[0])
        return {
            "status": "fallback_low_sample",
            "selected_spatial_m": hs_sel,
            "selected_temporal_s": ht_sel,
            "grid": [],
            "warning": "Fewer than 3 events; LOO-LCV skipped in favor of initial bandwidth.",
        }

    floor_density = 1e-15
    grid_records: list[dict[str, Any]] = []
    best_pair = (float(spatial_grid_m[0]), float(temporal_grid_s[0]))
    best_score = -math.inf

    for hs in spatial_grid_m:
        for ht in temporal_grid_s:
            if hs <= 0 or ht <= 0 or not math.isfinite(hs + ht):
                raise ValueError("Grid bandwidths must be finite and positive.")
            if adaptive:
                hs_vec, ht_vec, _ = compute_abramson_bandwidths(
                    lixel_dist_matrix,
                    lengths_m,
                    event_allocations,
                    event_times_s,
                    event_weights,
                    float(hs),
                    float(ht),
                    domain_s,
                    causal=causal,
                    clip_factor=clip_factor,
                )
            else:
                hs_vec = np.full(n_events, float(hs), dtype=float)
                ht_vec = np.full(n_events, float(ht), dtype=float)

            loo_vals, unsupported = evaluate_event_loo_intensities(
                lixel_dist_matrix,
                lengths_m,
                event_allocations,
                event_times_s,
                event_weights,
                hs_vec,
                ht_vec,
                domain_s,
                causal=causal,
                exclude_self=True,
            )
            supported_mask = np.ones(n_events, dtype=bool)
            if unsupported:
                supported_mask[unsupported] = False
            if causal:
                # Events at or after right boundary or earliest event have zero causal predecessors
                earliest = float(np.min(event_times_s))
                eval_mask = supported_mask & (event_times_s > earliest)
            else:
                eval_mask = supported_mask

            total_mass_integral = float(np.sum(event_weights[supported_mask]))
            if not np.any(eval_mask):
                score = -math.inf
                zero_count = int(n_events)
            else:
                eval_vals = loo_vals[eval_mask]
                eval_w = event_weights[eval_mask]
                zero_count = int(np.sum(eval_vals <= floor_density))
                score = float(np.sum(eval_w * np.log(np.maximum(eval_vals, floor_density))) - total_mass_integral)

            grid_records.append(
                {
                    "spatial_m": float(hs),
                    "temporal_s": float(ht),
                    "lcv_score": round(score, 4) if math.isfinite(score) else None,
                    "zero_loo_events": zero_count,
                }
            )
            if score > best_score:
                best_score = score
                best_pair = (float(hs), float(ht))

    return {
        "status": "ok",
        "selected_spatial_m": best_pair[0],
        "selected_temporal_s": best_pair[1],
        "best_lcv_score": round(best_score, 4) if math.isfinite(best_score) else None,
        "grid": grid_records,
    }


def adaptive_space_time_density(
    lixel_dist_matrix: np.ndarray,
    lengths_m: np.ndarray,
    event_allocations: list[list[tuple[int, float]]],
    event_times_s: np.ndarray,
    slices_s: np.ndarray,
    spatial_m: float,
    temporal_s: float,
    domain_s: tuple[float, float],
    *,
    adaptive: bool = False,
    clip_factor: float = 2.5,
    causal: bool = False,
    event_weights: np.ndarray | None = None,
) -> dict[str, Any]:
    """Evaluate fixed or bounded pilot-adaptive TNKDE over requested time slices."""
    start_s, end_s = domain_s
    if not all(math.isfinite(x) for x in (start_s, end_s, spatial_m, temporal_s)) or end_s <= start_s or spatial_m <= 0 or temporal_s <= 0:
        raise ValueError("Invalid domain or bandwidth.")
    lengths_arr = np.asarray(lengths_m, dtype=float)
    times_arr = np.asarray(event_times_s, dtype=float)
    slices_arr = np.asarray(slices_s, dtype=float)
    if (lengths_arr <= 0).any() or not np.isfinite(lengths_arr).all():
        raise ValueError("Lixel lengths must be finite and positive.")
    if (times_arr < start_s).any() or (times_arr > end_s).any() or (slices_arr < start_s).any() or (slices_arr > end_s).any():
        raise ValueError("Event times and slices must lie within declared domain.")
    n_events = len(times_arr)
    n_lixels = len(lengths_arr)
    if max(1, n_events) * n_lixels * max(1, len(slices_arr)) > 5_000_000:
        raise ValueError("Space-time workload limit exceeded.")
    weights = np.ones(n_events, dtype=float) if event_weights is None else np.asarray(event_weights, dtype=float)
    if weights.shape != (n_events,) or not np.isfinite(weights).all() or (weights < 0).any():
        raise ValueError("Invalid event weights.")

    if n_events == 0:
        return {
            "intensity_m_s": np.zeros((len(slices_arr), n_lixels)).tolist(),
            "intensity_km_day": np.zeros((len(slices_arr), n_lixels)).tolist(),
            "units": "events / metre / second",
            "display_units": "events / km / day",
            "adaptive": adaptive,
            "clip_factor": clip_factor if adaptive else 1.0,
            "abramson_factors": [],
            "unsupported_events": [],
        }

    if adaptive:
        hs_vec, ht_vec, factors = compute_abramson_bandwidths(
            lixel_dist_matrix,
            lengths_arr,
            event_allocations,
            times_arr,
            weights,
            spatial_m,
            temporal_s,
            domain_s,
            causal=causal,
            clip_factor=clip_factor,
        )
    else:
        hs_vec = np.full(n_events, float(spatial_m), dtype=float)
        ht_vec = np.full(n_events, float(temporal_s), dtype=float)
        factors = np.ones(n_events, dtype=float)

    spatial, unsupported = _spatial_event_kernels(lixel_dist_matrix, lengths_arr, event_allocations, hs_vec)
    temporal = _temporal_kernel_normalized(slices_arr, times_arr, ht_vec, domain_s, causal=causal)
    temporal = temporal * weights[None, :]
    intensity_m_s = temporal @ spatial  # events / metre / second
    intensity_km_day = intensity_m_s * 1000.0 * 86400.0
    return {
        "intensity_m_s": intensity_m_s.tolist(),
        "intensity_km_day": np.round(intensity_km_day, 6).tolist(),
        "units": "events / metre / second",
        "display_units": "events / km / day",
        "adaptive": adaptive,
        "clip_factor": clip_factor if adaptive else 1.0,
        "abramson_factor_range": [float(np.min(factors)), float(np.max(factors))],
        "unsupported_events": unsupported,
    }


def run_dataset_tnkde(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    spatial_bandwidth_m: float = 180.0,
    temporal_bandwidth_days: float = 14.0,
    slice_count: int = 12,
    adaptive: bool = True,
    clip_factor: float = 2.5,
    causal: bool = False,
    select_via_lcv: bool = True,
    allocation_mode: Literal["hard", "fractional"] = "hard",
    include_unverified_vgi: bool = False,
) -> dict[str, Any]:
    """Run fixed or bounded adaptive TNKDE on a RoadScope SQLite dataset."""
    if not 4 <= slice_count <= 36:
        raise ValueError("slice_count must lie between 4 and 36.")
    if not 15.0 <= spatial_bandwidth_m <= 1500.0 or not 0.25 <= temporal_bandwidth_days <= 180.0:
        raise ValueError("Spatial bandwidth [15, 1500] m and temporal bandwidth [0.25, 180] days required.")

    topo = get_lixel_network_topology(conn, dataset_id)
    statuses = (
        ("verified_canonical", "corroborated_pending", "unverified_raw_vgi")
        if include_unverified_vgi
        else ("verified_canonical",)
    )
    ph = ",".join("?" for _ in statuses)
    rows = conn.execute(
        f"""SELECT id, snapped_lixel_id, occurred_at_utc
            FROM accidents
            WHERE dataset_id=? AND verification_status IN ({ph})
            ORDER BY occurred_at_utc ASC, id ASC""",
        (dataset_id, *statuses),
    ).fetchall()

    event_allocations: list[list[tuple[int, float]]] = []
    event_times_epoch: list[float] = []
    excluded_no_support = 0
    multi_candidate = 0

    for row in rows:
        ts = parse_utc_iso(str(row["occurred_at_utc"])).timestamp()
        if allocation_mode == "fractional":
            dist = incident_distribution(conn, int(row["id"]))
            if dist["status"] != "available":
                excluded_no_support += 1
                continue
            pairs = [
                (topo.lixel_id_to_idx[int(a["lixel_id"])], float(a["probability"]))
                for a in dist["allocations"]
                if int(a["lixel_id"]) in topo.lixel_id_to_idx
            ]
            if not pairs:
                excluded_no_support += 1
                continue
            if len(pairs) > 1:
                multi_candidate += 1
            event_allocations.append(pairs)
            event_times_epoch.append(ts)
        else:
            lid = row["snapped_lixel_id"]
            if lid is None or int(lid) not in topo.lixel_id_to_idx:
                excluded_no_support += 1
                continue
            event_allocations.append([(topo.lixel_id_to_idx[int(lid)], 1.0)])
            event_times_epoch.append(ts)

    if len(event_times_epoch) < 3:
        raise ValueError("At least 3 supported incidents are required for dataset TNKDE.")

    min_t = min(event_times_epoch)
    max_t = max(event_times_epoch)
    span = max(86400.0, max_t - min_t)
    domain_s = (0.0, span)
    rel_times_s = np.array([t - min_t for t in event_times_epoch], dtype=float)
    slices_s = np.linspace(0.0, span, slice_count)
    slice_labels_utc = [
        datetime.fromtimestamp(min_t + float(s), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        for s in slices_s
    ]
    weights = np.ones(len(rel_times_s), dtype=float)

    base_ht_s = temporal_bandwidth_days * 86400.0
    if select_via_lcv:
        s_grid = sorted({round(max(20.0, spatial_bandwidth_m * f), 2) for f in (0.6, 1.0, 1.5)})
        t_grid = sorted({round(max(3600.0, base_ht_s * f), 2) for f in (0.6, 1.0, 1.6)})
        lcv_info = select_tnkde_bandwidths_lcv(
            topo.dist_net_matrix,
            topo.lengths_m,
            event_allocations,
            rel_times_s,
            weights,
            s_grid,
            t_grid,
            domain_s,
            adaptive=adaptive,
            clip_factor=clip_factor,
            causal=causal,
        )
        chosen_hs = float(lcv_info["selected_spatial_m"])
        chosen_ht = float(lcv_info["selected_temporal_s"])
    else:
        chosen_hs = float(spatial_bandwidth_m)
        chosen_ht = float(base_ht_s)
        lcv_info = {"status": "manual_fixed", "selected_spatial_m": chosen_hs, "selected_temporal_s": chosen_ht, "grid": []}

    density = adaptive_space_time_density(
        topo.dist_net_matrix,
        topo.lengths_m,
        event_allocations,
        rel_times_s,
        slices_s,
        chosen_hs,
        chosen_ht,
        domain_s,
        adaptive=adaptive,
        clip_factor=clip_factor,
        causal=causal,
        event_weights=weights,
    )

    mat_km_day = np.asarray(density["intensity_km_day"], dtype=float)  # (S, M)
    slice_network_totals = (mat_km_day @ (topo.lengths_m / 1000.0)).round(4).tolist()
    peak_per_lixel = np.max(mat_km_day, axis=0)
    mean_per_lixel = np.mean(mat_km_day, axis=0)

    features = []
    for idx in range(len(topo.lixel_ids)):
        lid = int(topo.lixel_ids[idx])
        sid = int(topo.parent_segment_ids[idx])
        seg = topo.segment_meta[sid]
        sub_geom = extract_lixel_linestring(seg["geom_25832"], float(topo.m_start_m[idx]), float(topo.m_end_m[idx]))
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "lixel_id": lid,
                    "segment_id": sid,
                    "segment_name": seg["name"],
                    "road_class": seg["road_class"],
                    "elevation_level": seg["elevation_level"],
                    "length_m": round(float(topo.lengths_m[idx]), 2),
                    "tnkde_peak_km_day": round(float(peak_per_lixel[idx]), 5),
                    "tnkde_mean_km_day": round(float(mean_per_lixel[idx]), 5),
                    "tnkde_slice_0": round(float(mat_km_day[0, idx]), 5),
                },
                "geometry": linestring_25832_to_geojson_dict(sub_geom),
            }
        )

    return {
        "dataset_id": dataset_id,
        "sample_size": len(rel_times_s),
        "allocation_mode": allocation_mode,
        "multi_candidate_incidents": multi_candidate,
        "excluded_no_support": excluded_no_support,
        "adaptive": adaptive,
        "causal": causal,
        "clip_factor": clip_factor if adaptive else 1.0,
        "selected_spatial_m": chosen_hs,
        "selected_temporal_days": round(chosen_ht / 86400.0, 4),
        "lcv": lcv_info,
        "slices_utc": slice_labels_utc,
        "slice_network_rate_per_day": slice_network_totals,
        "lixel_ids": [int(x) for x in topo.lixel_ids],
        "slice_lixel_km_day": density["intensity_km_day"],
        "abramson_factor_range": density.get("abramson_factor_range", [1.0, 1.0]),
        "units": density["units"],
        "display_units": density["display_units"],
        "layer_geojson": {"type": "FeatureCollection", "features": features},
    }
