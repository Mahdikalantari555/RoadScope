"""Directed upstream network Hawkes cascade simulation and probabilistic EM declustering.

Upstream convention:
If traffic moves along directed edge u -> v, a primary crash at state v creates
congestion/queueing upstream toward state u. Therefore secondary crashes triggered
by an event at v can occur only on states u that have a legal directed path u -> v
within cutoff distance and at time t_secondary > t_primary.
"""
from __future__ import annotations

import math
from typing import Any

import networkx as nx
import numpy as np


def _upstream_distance_map(graph: nx.DiGraph, cutoff_m: float = 1500.0) -> dict[Any, dict[Any, float]]:
    """Return upstream[target][source] = shortest directed distance from source -> target."""
    reverse = graph.reverse(copy=False)
    has_weights = all("weight_m" in attrs for _, _, attrs in graph.edges(data=True))
    result: dict[Any, dict[Any, float]] = {}
    for node in graph:
        if has_weights:
            dists = nx.single_source_dijkstra_path_length(reverse, node, cutoff=cutoff_m, weight="weight_m")
        else:
            raw = nx.single_source_shortest_path_length(reverse, node, cutoff=max(1, int(cutoff_m / 25.0)))
            dists = {k: float(v) * 25.0 for k, v in raw.items()}
        # Exclude distance 0 self-state only if no other upstream exists? Keep self-state at d=0 so
        # secondary pileup within the same lixel orientation is legally permitted!
        result[node] = {u: float(d) for u, d in dists.items()}
    return result


def simulate_upstream_hawkes(
    graph: nx.DiGraph,
    *,
    background_rate_per_hr: float,
    window_hr: float,
    branching_ratio: float,
    temporal_decay_min: float,
    spatial_decay_m: float,
    seed: int = 42,
    max_events: int = 3000,
) -> dict[str, Any]:
    """Simulate a subcritical distance-weighted upstream network Hawkes process."""
    if (
        not all(
            math.isfinite(x)
            for x in (background_rate_per_hr, window_hr, branching_ratio, temporal_decay_min, spatial_decay_m)
        )
        or background_rate_per_hr < 0
        or window_hr <= 0
        or not 0.0 <= branching_ratio < 1.0
        or temporal_decay_min <= 0
        or spatial_decay_m <= 0
    ):
        raise ValueError("Subcritical branching_ratio in [0, 1) and positive finite time/space scales required.")
    nodes = list(graph.nodes)
    if not nodes or len(nodes) > 5000 or not 1 <= max_events <= 5000 or background_rate_per_hr * window_hr > max_events:
        raise ValueError("Hawkes simulation workload exceeds limits.")

    window_s = window_hr * 3600.0
    tau_s = temporal_decay_min * 60.0
    lengths = {n: float(graph.nodes[n].get("length_m", 25.0)) for n in nodes}
    total_len = sum(lengths.values())
    node_probs = np.array([lengths[n] / total_len for n in nodes], dtype=float)
    upstream_map = _upstream_distance_map(graph, cutoff_m=max(500.0, 6.0 * spatial_decay_m))

    rng = np.random.default_rng(seed)
    n_bg = int(rng.poisson(background_rate_per_hr * window_hr))
    if n_bg > max_events:
        raise ValueError("Event cap reached; simulation rejected rather than silently truncated.")

    events: list[dict[str, Any]] = []
    chosen_bg = rng.choice(len(nodes), size=n_bg, p=node_probs) if n_bg else []
    for i, node_idx in enumerate(chosen_bg):
        state = nodes[int(node_idx)]
        events.append(
            {
                "id": i,
                "state": list(state) if isinstance(state, tuple) else state,
                "_state_key": state,
                "time_s": float(rng.uniform(0.0, window_s)),
                "parent_id": None,
                "root_id": i,
                "is_secondary_truth": False,
            }
        )

    idx = 0
    while idx < len(events):
        parent = events[idx]
        p_state = parent["_state_key"]
        up_dists = upstream_map.get(p_state, {p_state: 0.0})
        cand_states = sorted(up_dists.keys(), key=str)
        cand_weights = np.array([lengths[u] * math.exp(-up_dists[u] / spatial_decay_m) for u in cand_states], dtype=float)
        w_sum = float(np.sum(cand_weights))
        if w_sum > 0:
            cand_probs = cand_weights / w_sum
            n_off = int(rng.poisson(branching_ratio))
            for _ in range(n_off):
                dt = float(rng.exponential(tau_s))
                t_child = parent["time_s"] + dt
                if t_child >= window_s:
                    continue
                if len(events) >= max_events:
                    raise ValueError("Event cap reached; simulation rejected rather than silently truncated.")
                u_choice = cand_states[int(rng.choice(len(cand_states), p=cand_probs))]
                events.append(
                    {
                        "id": len(events),
                        "state": list(u_choice) if isinstance(u_choice, tuple) else u_choice,
                        "_state_key": u_choice,
                        "time_s": t_child,
                        "parent_id": int(parent["id"]),
                        "root_id": int(parent["root_id"]),
                        "upstream_dist_m": round(float(up_dists[u_choice]), 2),
                        "is_secondary_truth": True,
                    }
                )
        idx += 1

    events.sort(key=lambda e: (e["time_s"], e["id"]))
    clean_events = [{k: v for k, v in e.items() if k != "_state_key"} for e in events]
    sec_count = sum(1 for e in clean_events if e["is_secondary_truth"])
    return {
        "model": "upstream-distance-hawkes-sim/1",
        "synthetic_truth": True,
        "seed": seed,
        "window_hr": window_hr,
        "branching_ratio": branching_ratio,
        "temporal_decay_min": temporal_decay_min,
        "spatial_decay_m": spatial_decay_m,
        "total_events": len(clean_events),
        "background_events_truth": len(clean_events) - sec_count,
        "secondary_events_truth": sec_count,
        "boundary": "no pre-window history; right-censored offspring beyond window_hr",
        "events": clean_events,
    }


def decluster_upstream_hawkes(
    graph: nx.DiGraph,
    events: list[dict[str, Any]],
    *,
    window_s: float,
    temporal_decay_s: float,
    spatial_decay_m: float,
    max_iter: int = 80,
    tol: float = 1e-6,
) -> dict[str, Any]:
    """Research-only probabilistic EM declustering separating background and upstream excitation.

    Conditional intensity at state x and time t:
        lambda(x, t) = mu / L_total + sum_{i: t_i < t} eta * g_t(t - t_i) * g_s(x | x_i)
    where g_t and g_s integrate to 1 over [0, inf) and upstream network length respectively,
    with finite-window temporal censoring correction C_i = 1 - exp(-(window_s - t_i) / tau)
    in the M-step for branching ratio eta.
    """
    if window_s <= 0 or temporal_decay_s <= 0 or spatial_decay_m <= 0 or not all(math.isfinite(x) for x in (window_s, temporal_decay_s, spatial_decay_m)):
        raise ValueError("Positive finite window_s, temporal_decay_s, and spatial_decay_m required.")
    if len(events) > 1500:
        raise ValueError("Declustering is capped at 1500 events.")

    nodes = list(graph.nodes)
    if not nodes:
        raise ValueError("Graph must be non-empty.")
    lengths = {n: float(graph.nodes[n].get("length_m", 25.0)) for n in nodes}
    total_len = sum(lengths.values())
    if len(events) == 0:
        return {
            "status": "empty_events",
            "converged": True,
            "iterations": 0,
            "estimated_background_rate_per_hr": 0.0,
            "estimated_branching_ratio": 0.0,
            "events": [],
            "disclaimer": "Probabilistic association under Hawkes assumptions; not causal proof of secondary crashes.",
        }

    ordered = sorted(events, key=lambda e: float(e["time_s"]))
    states = [tuple(e["state"]) if isinstance(e["state"], list) else e["state"] for e in ordered]
    times = np.array([float(e["time_s"]) for e in ordered], dtype=float)
    if any(s not in lengths for s in states) or (times < 0).any() or (times > window_s).any():
        raise ValueError("All events must lie on graph states and within [0, window_s].")

    upstream_map = _upstream_distance_map(graph, cutoff_m=max(500.0, 6.0 * spatial_decay_m))
    z_norm: dict[Any, float] = {}
    for s in set(states):
        up = upstream_map.get(s, {s: 0.0})
        z_norm[s] = sum(lengths[u] * math.exp(-d / spatial_decay_m) for u, d in up.items())

    n = len(ordered)
    # Precompute normalized space-time kernel matrix K[j, i] for i < j (parent i -> secondary j upstream of i)
    kernel_mat = np.zeros((n, n), dtype=float)
    for j in range(n):
        sj, tj = states[j], times[j]
        for i in range(j):
            si, ti = states[i], times[i]
            dt = tj - ti
            if dt <= 0:
                continue
            up_i = upstream_map.get(si, {})
            if sj not in up_i or z_norm[si] <= 0:
                continue
            gt = math.exp(-dt / temporal_decay_s) / temporal_decay_s
            gs = math.exp(-up_i[sj] / spatial_decay_m) / z_norm[si]
            kernel_mat[j, i] = gt * gs

    censor = np.maximum(1e-6, -np.expm1(-(window_s - times) / temporal_decay_s))
    mu_rate = max(1e-6, 0.7 * n / window_s)  # events / second across network
    eta = 0.25 if np.any(kernel_mat > 0) else 0.0

    loglik_history: list[float] = []
    converged = False
    p_bg = np.ones(n, dtype=float)
    p_trig = np.zeros((n, n), dtype=float)

    for it in range(1, max_iter + 1):
        bg_density = mu_rate / total_len
        trig_rates = eta * kernel_mat
        denom = bg_density + np.sum(trig_rates, axis=1)
        denom = np.maximum(denom, 1e-18)
        p_bg = bg_density / denom
        p_trig = trig_rates / denom[:, None]

        ll = float(np.sum(np.log(denom)) - mu_rate * window_s - eta * np.sum(censor))
        loglik_history.append(ll)
        if len(loglik_history) >= 2 and abs(loglik_history[-1] - loglik_history[-2]) < tol:
            converged = True
            break

        mu_rate = max(1e-8, float(np.sum(p_bg)) / window_s)
        denom_eta = float(np.sum(censor))
        raw_eta = float(np.sum(p_trig)) / denom_eta if denom_eta > 0 else 0.0
        eta = min(0.995, max(0.0, raw_eta))

    secondary_probs = np.clip(1.0 - p_bg, 0.0, 1.0)
    declustered_events = []
    brier_terms: list[float] = []
    parent_hits = 0
    secondary_truth_total = 0

    for j, ev in enumerate(ordered):
        best_parent_idx = int(np.argmax(p_trig[j])) if j > 0 and np.max(p_trig[j]) > 0 else None
        best_parent_id = ordered[best_parent_idx]["id"] if best_parent_idx is not None and secondary_probs[j] >= 0.5 else None
        rec = {
            "id": ev["id"],
            "state": ev["state"],
            "time_s": round(float(ev["time_s"]), 3),
            "p_background": round(float(p_bg[j]), 4),
            "p_secondary": round(float(secondary_probs[j]), 4),
            "most_likely_parent_id": best_parent_id,
        }
        if "is_secondary_truth" in ev:
            truth_sec = 1.0 if ev["is_secondary_truth"] else 0.0
            brier_terms.append((float(secondary_probs[j]) - truth_sec) ** 2)
            if ev["is_secondary_truth"]:
                secondary_truth_total += 1
                if best_parent_idx is not None and ordered[best_parent_idx]["id"] == ev.get("parent_id"):
                    parent_hits += 1
        declustered_events.append(rec)

    calibration = None
    if brier_terms:
        calibration = {
            "brier_score": round(float(np.mean(brier_terms)), 4),
            "secondary_truth_count": secondary_truth_total,
            "estimated_expected_secondary": round(float(np.sum(secondary_probs)), 3),
            "parent_recovery_rate": round(parent_hits / secondary_truth_total, 4) if secondary_truth_total > 0 else None,
        }

    return {
        "model": "upstream-hawkes-em-declustering/1",
        "status": "ok" if converged else "max_iter_reached",
        "converged": converged,
        "iterations": len(loglik_history),
        "log_likelihood": round(loglik_history[-1], 4) if loglik_history else 0.0,
        "monotonic_likelihood": all(
            loglik_history[k] >= loglik_history[k - 1] - 1e-6 for k in range(1, len(loglik_history))
        ),
        "estimated_background_rate_per_hr": round(mu_rate * 3600.0, 5),
        "estimated_branching_ratio": round(eta, 5),
        "subcritical_stable": eta < 1.0,
        "expected_background_count": round(float(np.sum(p_bg)), 3),
        "expected_secondary_count": round(float(np.sum(secondary_probs)), 3),
        "synthetic_calibration": calibration,
        "events": declustered_events,
        "disclaimer": (
            "Research-only probabilistic declustering assuming fixed decay scales and no unobserved "
            "pre-window history; secondary probabilities reflect statistical compatibility, not causal proof."
        ),
    }
