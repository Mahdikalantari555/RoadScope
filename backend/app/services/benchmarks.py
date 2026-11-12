"""Reproducible chronological holdout benchmarks, VGI diagnostics, and surrogate safety summaries."""
from __future__ import annotations

import json
import sqlite3
import time
from typing import Any

import numpy as np
from scipy.stats import spearmanr

from .allocations import incident_distribution
from .benchmark_curves import pai_curve
from .length_spf import fit_length_scaled_nb_spf
from .map_matching import parse_utc_iso
from .network_generator import get_lixel_network_topology


def run_chronological_holdout_benchmark(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    train_fraction: float = 0.7,
    nkde_bandwidth_m: float = 180.0,
) -> dict[str, Any]:
    """Compare segment-level safety & density baselines on an identical chronological split.

    Strictly fits/scores all methods using events with t < split_time and evaluates
    length-based PAI curves, AU-PAI, PAI@10%, and Spearman rank correlation on held-out
    events with t >= split_time (zero future leakage).
    """
    if not 0.3 <= train_fraction <= 0.9 or not 20.0 <= nkde_bandwidth_m <= 1500.0:
        raise ValueError("train_fraction in [0.3, 0.9] and nkde_bandwidth_m in [20, 1500] required.")

    ds = conn.execute(
        "SELECT id, name, is_synthetic, random_seed, lixel_resolution_m, study_period_years FROM dataset_sources WHERE id=?",
        (dataset_id,),
    ).fetchone()
    if not ds:
        raise ValueError(f"Dataset #{dataset_id} not found.")
    period_yr = float(ds["study_period_years"] or 1.0)

    seg_rows = conn.execute(
        """SELECT s.id, s.length_m, s.aadt, t.aadt_vehicles_per_day AS obs_aadt, t.is_imputed
           FROM road_segments s
           LEFT JOIN traffic_observations t ON t.segment_id = s.id AND t.dataset_id = s.dataset_id
           WHERE s.dataset_id = ?
           ORDER BY s.id""",
        (dataset_id,),
    ).fetchall()
    if len(seg_rows) < 3:
        raise ValueError("Dataset requires at least 3 road segments for benchmarking.")

    seg_ids = [int(r["id"]) for r in seg_rows]
    seg_to_idx = {sid: i for i, sid in enumerate(seg_ids)}
    lengths_m = np.array([float(r["length_m"]) for r in seg_rows], dtype=float)
    lengths_km = lengths_m / 1000.0
    aadt = np.array([float(r["obs_aadt"] or r["aadt"] or 8000) for r in seg_rows], dtype=float)
    imputed = np.array([bool(r["is_imputed"]) or not (r["obs_aadt"] or r["aadt"]) for r in seg_rows], dtype=bool)

    inc_rows = conn.execute(
        """SELECT id, snapped_segment_id, snapped_lixel_id, occurred_at_utc
           FROM accidents
           WHERE dataset_id = ? AND verification_status = 'verified_canonical' AND snapped_segment_id IS NOT NULL
           ORDER BY occurred_at_utc ASC, id ASC""",
        (dataset_id,),
    ).fetchall()
    if len(inc_rows) < 6:
        raise ValueError("At least 6 verified incidents are required for chronological train/holdout benchmarking.")

    timestamps = np.array([parse_utc_iso(str(r["occurred_at_utc"])).timestamp() for r in inc_rows], dtype=float)
    t_min, t_max = float(np.min(timestamps)), float(np.max(timestamps))
    if t_max <= t_min:
        raise ValueError("Incident timestamps have zero temporal span; chronological split unavailable.")

    split_epoch = t_min + train_fraction * (t_max - t_min)
    train_rows = [r for r, ts in zip(inc_rows, timestamps) if ts < split_epoch]
    test_rows = [r for r, ts in zip(inc_rows, timestamps) if ts >= split_epoch]
    if not train_rows or not test_rows:
        raise ValueError("Chronological split produced an empty train or holdout partition.")

    train_counts = np.zeros(len(seg_ids), dtype=float)
    test_counts = np.zeros(len(seg_ids), dtype=float)
    for r in train_rows:
        sid = int(r["snapped_segment_id"])
        if sid in seg_to_idx:
            train_counts[seg_to_idx[sid]] += 1.0
    for r in test_rows:
        sid = int(r["snapped_segment_id"])
        if sid in seg_to_idx:
            test_counts[seg_to_idx[sid]] += 1.0

    grid = np.array([0.0, 0.05, 0.10, 0.20, 0.30, 0.50, 1.0], dtype=float)

    def eval_scores(name: str, scores_per_km: np.ndarray, runtime_ms: float, notes: str) -> dict[str, Any]:
        curve = pai_curve(scores_per_km, lengths_m, test_counts, grid)
        pai_10 = next((pt["pai"] for pt in curve["points"] if abs(pt["coverage"] - 0.10) < 1e-6), None)
        test_rate_per_km = test_counts / np.maximum(lengths_km * max(1e-6, (1.0 - train_fraction) * period_yr), 1e-9)
        rho, _ = spearmanr(scores_per_km, test_rate_per_km)
        return {
            "method": name,
            "au_pai": round(float(curve["au_pai"]), 4) if curve["au_pai"] is not None else None,
            "pai_at_10pct": round(float(pai_10), 4) if pai_10 is not None else None,
            "spearman_rho": round(float(0.0 if np.isnan(rho) else rho), 4),
            "runtime_ms": round(runtime_ms, 3),
            "notes": notes,
            "pai_curve": curve,
        }

    methods: list[dict[str, Any]] = []

    # 1. Historical raw count ranking
    t0 = time.perf_counter()
    hist_scores = train_counts.copy()
    methods.append(
        eval_scores(
            "historical_count",
            hist_scores,
            (time.perf_counter() - t0) * 1000.0,
            "Ranked by raw training crash count N_train (ignores segment length and exposure).",
        )
    )

    # 2. Linear crash density N_train / L_km
    t0 = time.perf_counter()
    lin_scores = train_counts / lengths_km
    methods.append(
        eval_scores(
            "linear_density",
            lin_scores,
            (time.perf_counter() - t0) * 1000.0,
            "Ranked by training linear crash density N_train / L_km.",
        )
    )

    # 3. Train-only Mass-Conserving Lixel NKDE aggregated to segment intensity per km
    t0 = time.perf_counter()
    topo = get_lixel_network_topology(conn, dataset_id)
    ev_lix_idx = [
        topo.lixel_id_to_idx[int(r["snapped_lixel_id"])]
        for r in train_rows
        if r["snapped_lixel_id"] is not None and int(r["snapped_lixel_id"]) in topo.lixel_id_to_idx
    ]
    lix_len_km = topo.lengths_m / 1000.0
    if ev_lix_idx:
        d_sub = topo.dist_net_matrix[:, np.asarray(ev_lix_idx, dtype=np.int64)] / nkde_bandwidth_m
        k_q = np.where(d_sub <= 1.0, (15.0 / 16.0) * ((1.0 - d_sub**2) ** 2), 0.0)
        z_q = np.maximum(np.sum(k_q * lix_len_km[:, None], axis=0), 1e-9)
        lix_mass = np.sum(k_q / z_q[None, :], axis=1) * lix_len_km
        nkde_seg_mass = np.zeros(len(seg_ids), dtype=float)
        for l_i, parent_sid in enumerate(topo.parent_segment_ids):
            if int(parent_sid) in seg_to_idx:
                nkde_seg_mass[seg_to_idx[int(parent_sid)]] += float(lix_mass[l_i])
        nkde_scores = nkde_seg_mass / lengths_km
    else:
        nkde_scores = np.zeros(len(seg_ids), dtype=float)
    methods.append(
        eval_scores(
            "nkde_legacy",
            nkde_scores,
            (time.perf_counter() - t0) * 1000.0,
            f"Undirected quartic mass-conserving NKDE (h={nkde_bandwidth_m}m) fitted on training split only.",
        )
    )

    # 4. Exposure-aware Length-Scaled NB-SPF Empirical Bayes rate per km
    t0 = time.perf_counter()
    eb_fit = fit_length_scaled_nb_spf(
        train_counts,
        aadt,
        lengths_km,
        study_period_years=max(1e-3, train_fraction * period_yr),
        imputed_mask=imputed,
    )
    eb_scores = np.asarray(eb_fit["eb_expected"], dtype=float) / lengths_km
    methods.append(
        eval_scores(
            "exposure_length_eb",
            eb_scores,
            (time.perf_counter() - t0) * 1000.0,
            "Length-scaled NB-SPF Empirical Bayes expected crashes per km fitted on training split only.",
        )
    )

    return {
        "dataset_id": dataset_id,
        "dataset_name": ds["name"],
        "is_synthetic": bool(ds["is_synthetic"]),
        "seed": int(ds["random_seed"]),
        "lixel_resolution_m": float(ds["lixel_resolution_m"]),
        "split_policy": "strict_chronological_holdout",
        "train_fraction": train_fraction,
        "train_events": len(train_rows),
        "holdout_events": len(test_rows),
        "leakage_check": "verified: all holdout timestamps >= split_epoch > all train timestamps",
        "methods": methods,
    }


def compute_dataset_vgi_diagnostics(conn: sqlite3.Connection, dataset_id: int) -> dict[str, Any]:
    """Summarize incident-level VGI allocation ambiguity and witness vs incident counts."""
    rows = conn.execute(
        """SELECT id, verification_status, witness_count
           FROM accidents WHERE dataset_id=? ORDER BY id""",
        (dataset_id,),
    ).fetchall()
    active_incidents = 0
    excluded_incidents = 0
    unavailable_support = 0
    multi_candidate = 0
    total_witness_reports = 0
    entropies: list[float] = []

    for r in rows:
        dist = incident_distribution(conn, int(r["id"]))
        if dist["status"] == "excluded":
            excluded_incidents += 1
            continue
        if dist["status"] == "unavailable":
            unavailable_support += 1
            continue
        active_incidents += 1
        total_witness_reports += int(r["witness_count"] or 1)
        probs = np.array([float(a["probability"]) for a in dist["allocations"]], dtype=float)
        if len(probs) > 1:
            multi_candidate += 1
        pos = probs[probs > 0]
        entropies.append(float(-np.sum(pos * np.log(pos))))

    return {
        "dataset_id": dataset_id,
        "active_supported_incidents": active_incidents,
        "excluded_duplicate_or_rejected": excluded_incidents,
        "unavailable_support_incidents": unavailable_support,
        "multi_candidate_ambiguous_incidents": multi_candidate,
        "ambiguous_share_pct": round(100.0 * multi_candidate / active_incidents, 2) if active_incidents else 0.0,
        "total_witness_reports_across_active": total_witness_reports,
        "witness_inflation_ratio": round(total_witness_reports / active_incidents, 3) if active_incidents else 1.0,
        "mean_allocation_entropy_nats": round(float(np.mean(entropies)), 4) if entropies else 0.0,
        "policy": "Each active canonical/unmerged incident contributes unit mass=1.0; witnesses never double-count event mass.",
    }


ALLOWED_SURROGATE_DEFINITIONS = {
    "hard_braking",
    "ittc_conflict",
    "post_encroachment_time",
    "speed_variance_event",
}


def ingest_surrogate_observations(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    records: list[dict[str, Any]],
) -> dict[str, Any]:
    """Validate and store aggregate-only privacy-preserving surrogate safety observations."""
    if not records or len(records) > 1000:
        raise ValueError("Provide between 1 and 1000 aggregate surrogate records.")
    valid_segments = {
        int(r[0]) for r in conn.execute("SELECT id FROM road_segments WHERE dataset_id=?", (dataset_id,))
    }
    if not valid_segments:
        raise ValueError(f"Dataset #{dataset_id} not found or has no segments.")

    inserted = 0
    for rec in records:
        sid = int(rec["segment_id"])
        if sid not in valid_segments:
            raise ValueError(f"Segment #{sid} does not belong to dataset #{dataset_id}.")
        defn = str(rec["definition"])
        if defn not in ALLOWED_SURROGATE_DEFINITIONS:
            raise ValueError(f"Unsupported surrogate definition: {defn}")
        t_start = parse_utc_iso(str(rec["start_utc"]))
        t_end = parse_utc_iso(str(rec["end_utc"]))
        if t_end <= t_start:
            raise ValueError("end_utc must be strictly after start_utc.")
        conn.execute(
            """INSERT INTO surrogate_observations
               (dataset_id, segment_id, start_utc, end_utc, definition, count, exposure,
                exposure_unit, coverage_fraction, source, privacy_provenance)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                dataset_id,
                sid,
                t_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                t_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
                defn,
                int(rec["count"]),
                float(rec["exposure"]),
                str(rec["exposure_unit"]),
                float(rec.get("coverage_fraction", 1.0)),
                str(rec["source"]),
                str(rec["privacy_provenance"]),
            ),
        )
        inserted += 1
    return {"dataset_id": dataset_id, "inserted_records": inserted, "raw_trajectories_stored": False}


def summarize_surrogate_coverage(conn: sqlite3.Connection, dataset_id: int) -> dict[str, Any]:
    """Summarize segment surrogate rates while explicitly separating uncovered from zero-event segments."""
    rows = conn.execute(
        """SELECT s.id AS segment_id, s.name, s.road_class,
                  (SELECT COUNT(*) FROM accidents a
                   WHERE a.dataset_id = s.dataset_id AND a.snapped_segment_id = s.id
                     AND a.verification_status = 'verified_canonical') AS verified_crashes,
                  COUNT(so.id) AS obs_windows,
                  COALESCE(SUM(so.count), 0) AS surrogate_count,
                  COALESCE(SUM(so.exposure), 0.0) AS total_exposure,
                  AVG(so.coverage_fraction) AS mean_coverage
           FROM road_segments s
           LEFT JOIN surrogate_observations so ON so.segment_id = s.id AND so.dataset_id = s.dataset_id
           WHERE s.dataset_id = ?
           GROUP BY s.id
           ORDER BY s.id""",
        (dataset_id,),
    ).fetchall()
    if not rows:
        raise ValueError(f"Dataset #{dataset_id} not found.")

    segments = []
    uncovered = 0
    zero_conflict_covered = 0
    positive_conflict = 0
    for r in rows:
        windows = int(r["obs_windows"])
        scount = int(r["surrogate_count"])
        exp = float(r["total_exposure"])
        if windows == 0:
            state = "uncovered"
            uncovered += 1
            rate = None
        elif scount == 0:
            state = "covered_zero_conflicts"
            zero_conflict_covered += 1
            rate = 0.0
        else:
            state = "covered_positive_conflicts"
            positive_conflict += 1
            rate = round(scount / exp, 6) if exp > 0 else None
        segments.append(
            {
                "segment_id": int(r["segment_id"]),
                "name": r["name"],
                "road_class": r["road_class"],
                "verified_crashes": int(r["verified_crashes"]),
                "coverage_state": state,
                "observation_windows": windows,
                "surrogate_count": scount if windows > 0 else None,
                "total_exposure": round(exp, 3) if windows > 0 else None,
                "mean_coverage_fraction": round(float(r["mean_coverage"]), 3) if r["mean_coverage"] is not None else None,
                "surrogate_rate_per_exposure": rate,
            }
        )

    return {
        "dataset_id": dataset_id,
        "total_segments": len(segments),
        "uncovered_segments": uncovered,
        "covered_zero_conflict_segments": zero_conflict_covered,
        "covered_positive_conflict_segments": positive_conflict,
        "joint_posterior_status": "unavailable: bivariate Poisson-lognormal joint posterior remains gated",
        "epistemology_notice": "Descriptive exposure-normalized association only; surrogate conflicts do not establish causal crash effects.",
        "segments": segments,
    }
