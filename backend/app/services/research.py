"""Versioned numerical research primitives, not validated production safety models."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import platform
import subprocess
from typing import Any

import networkx as nx
import numpy as np
from scipy.sparse import csc_matrix
from scipy.sparse.linalg import expm_multiply

CONTRACT = "roadscope-research/1"


def directed_lixel_graph(conn, dataset_id: int) -> tuple[nx.DiGraph, str]:
    """Edge states (lixel, direction); transitions only via shared topological nodes.

    Reads canonical direction (-1/0/+1) from road_segment_directions and node-scoped
    restrictions from turn_restrictions. No geometry-based crossing inference and no
    implicit U-turn onto the same segment at segment ends.
    """
    segments = [
        dict(r)
        for r in conn.execute(
            """SELECT s.id, s.u_node_id, s.v_node_id,
                      COALESCE(d.direction, 0) AS seg_direction,
                      COALESCE(d.source, 'assumed_bidirectional') AS direction_source
               FROM road_segments s
               LEFT JOIN road_segment_directions d ON d.segment_id=s.id AND d.dataset_id=s.dataset_id
               WHERE s.dataset_id=? ORDER BY s.id""",
            (dataset_id,),
        )
    ]
    restrictions = {
        (int(r[0]), int(r[1]), int(r[2]))
        for r in conn.execute(
            "SELECT via_node_id, from_segment_id, to_segment_id FROM turn_restrictions WHERE dataset_id=?",
            (dataset_id,),
        )
    }
    graph = nx.DiGraph()
    starts: dict[int, list[tuple[int, tuple[int, int]]]] = {}
    ends: dict[int, list[tuple[int, tuple[int, int]]]] = {}
    for s in segments:
        rows = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM road_lixels WHERE parent_segment_id=? ORDER BY lixel_index",
                (s["id"],),
            )
        ]
        seg_dir = int(s["seg_direction"])
        for direction in (1, -1):
            if (direction == 1 and seg_dir == -1) or (direction == -1 and seg_dir == 1):
                continue
            ordered = rows if direction == 1 else rows[::-1]
            states = [(int(r["id"]), direction) for r in ordered]
            for state, row in zip(states, ordered):
                graph.add_node(state, length_m=float(row["length_m"]), segment_id=int(s["id"]))
            for a, b in zip(states, states[1:]):
                graph.add_edge(a, b)
            if states:
                u, v = (int(s["u_node_id"]), int(s["v_node_id"])) if direction == 1 else (int(s["v_node_id"]), int(s["u_node_id"]))
                starts.setdefault(u, []).append((int(s["id"]), states[0]))
                ends.setdefault(v, []).append((int(s["id"]), states[-1]))
    for node, incoming in ends.items():
        for sid, end in incoming:
            for tid, start in starts.get(node, []):
                if sid != tid and (node, sid, tid) not in restrictions:
                    graph.add_edge(end, start, via_node=node)
    topology = {
        "segments": [(int(s["id"]), int(s["seg_direction"]), s["direction_source"]) for s in segments],
        "states": sorted((list(n), attrs) for n, attrs in graph.nodes(data=True)),
        "edges": sorted((list(a), list(b)) for a, b in graph.edges),
    }
    fingerprint = hashlib.sha256(json.dumps(topology, sort_keys=True).encode()).hexdigest()
    return graph, fingerprint


def diffuse(graph: nx.DiGraph, initial: dict[Any, float], duration: float, rate: float = 1.0, symmetric: bool = False):
    """Finite-state conservative CTMC. rate is s^-1, duration seconds."""
    if duration < 0 or rate < 0 or not math.isfinite(duration + rate) or duration * rate > 10000:
        raise ValueError("Invalid or excessive solver duration/rate.")
    g = graph.to_undirected() if symmetric else graph
    nodes = list(g)
    if len(nodes) > 20000:
        raise ValueError("Graph exceeds 20000 states.")
    index = {n: i for i, n in enumerate(nodes)}
    mass = np.zeros(len(nodes))
    for n, value in initial.items():
        if n not in index or not math.isfinite(value) or value < 0:
            raise ValueError("Initial mass must be finite, nonnegative and on an existing state.")
        mass[index[n]] += value
    if not nodes:
        return {}, {"mass_error": 0.0, "minimum_mass": 0.0}
    rows, cols, values = [], [], []
    for n in nodes:
        neighbors = list(g.neighbors(n))
        if neighbors:
            for neighbor in neighbors:
                rows.append(index[neighbor])
                cols.append(index[n])
                values.append(rate if symmetric else rate / len(neighbors))
            rows.append(index[n])
            cols.append(index[n])
            values.append(-rate * len(neighbors) if symmetric else -rate)
    operator = csc_matrix((values, (rows, cols)), shape=(len(nodes), len(nodes)))
    result = expm_multiply(operator * duration, mass)
    error = abs(float(result.sum() - mass.sum()))
    if result.min() < -1e-10 or error > 1e-8 * max(1.0, float(mass.sum())):
        raise ValueError("Solver diagnostics failed.")
    return dict(zip(nodes, np.maximum(result, 0.0).tolist())), {
        "mass_error": error,
        "minimum_mass": float(result.min()),
        "solver": "scipy.expm_multiply",
        "boundary": "closed",
        "units": "event mass",
        "duration_s": duration,
        "rate_per_s": rate,
    }


def pai_curve(scores, lengths, counts, fractions=None):
    """Uniform partial capture inside score ties; linear interpolation inside lixels."""
    scores, lengths, counts = (np.asarray(x, dtype=float) for x in (scores, lengths, counts))
    if not (scores.shape == lengths.shape == counts.shape) or scores.ndim != 1 or not len(scores):
        raise ValueError("Aligned nonempty one-dimensional vectors required.")
    if not all(np.isfinite(x).all() for x in (scores, lengths, counts)) or (lengths <= 0).any() or (counts < 0).any():
        raise ValueError("Finite scores, positive lengths and nonnegative counts required.")
    grid = np.asarray(fractions if fractions is not None else np.linspace(0, 1, 21), dtype=float)
    if grid.ndim != 1 or not np.isfinite(grid).all() or (grid < 0).any() or (grid > 1).any():
        raise ValueError("Coverage fractions must be in [0,1].")
    order = np.argsort(-scores, kind="stable")
    groups: list[list[float]] = []
    for i in order:
        if not groups or groups[-1][0] != scores[i]:
            groups.append([float(scores[i]), float(lengths[i]), float(counts[i])])
        else:
            groups[-1][1] += float(lengths[i])
            groups[-1][2] += float(counts[i])
    x = np.r_[0.0, np.cumsum([g[1] for g in groups]) / lengths.sum()]
    total = float(counts.sum())
    y = np.r_[0.0, np.cumsum([g[2] for g in groups]) / total] if total else None
    capture = np.interp(grid, x, y) if total else None
    area = float(2 * (np.sum((y[1:] + y[:-1]) * np.diff(x) / 2) - 0.5)) if total else None
    return {
        "policy": "partial-uniform-within-ties",
        "normalized_area_definition": "2 integral(capture(a)-a) da",
        "normalized_excess_capture_area": area,
        "total_events": total,
        "curve": [
            {
                "coverage": float(a),
                "capture": float(capture[i]) if total else None,
                "pai": float(capture[i] / a) if total and a > 0 else None,
            }
            for i, a in enumerate(grid)
        ],
    }


def allocations(candidates):
    """Normalize one incident, never one witness; missing support is unavailable."""
    weights: dict[int, float] = {}
    for candidate in candidates:
        p = float(candidate["probability"])
        if not math.isfinite(p) or p < 0:
            raise ValueError("Invalid allocation probability.")
        key = int(candidate["lixel_id"])
        weights[key] = weights.get(key, 0.0) + p
    total = sum(weights.values())
    if total <= 0:
        raise ValueError("No candidate support; hard assignment must be explicitly requested.")
    return {key: value / total for key, value in weights.items()}


def stabilized_ipw(reported, reference, clip: float = 10.0):
    reported, reference = np.asarray(reported, float), np.asarray(reference, float)
    if (
        reported.shape != reference.shape
        or reported.ndim != 1
        or not len(reported)
        or not np.isfinite(reported).all()
        or not np.isfinite(reference).all()
    ):
        raise ValueError("Aligned linked-reference counts required.")
    if (reference <= 0).any() or (reported <= 0).any() or (reported > reference).any() or clip < 1 or not math.isfinite(clip):
        raise ValueError("Reference or positivity/support failure.")
    propensity = reported / reference
    if (propensity < 0.01).any():
        raise ValueError("Near-zero propensity: correction unavailable.")
    prevalence = reported.sum() / reference.sum()
    weights = np.minimum(prevalence / propensity, clip)
    ess = float((reported @ weights) ** 2 / (reported @ (weights**2)))
    return {
        "propensity": propensity.tolist(),
        "weights": weights.tolist(),
        "effective_sample_size": ess,
        "clip": clip,
        "assumption": "linked-reference strata; descriptive correction, not proof of unbiasedness",
    }


def length_eb(counts, predicted, length_km, alpha_1: float):
    n, mu, length = (np.asarray(x, float) for x in (counts, predicted, length_km))
    if n.shape != mu.shape or n.shape != length.shape or n.ndim != 1 or not len(n):
        raise ValueError("Aligned vectors required.")
    if (
        not all(np.isfinite(x).all() for x in (n, mu, length))
        or (n < 0).any()
        or (mu < 0).any()
        or (length <= 0).any()
        or alpha_1 <= 0
        or not math.isfinite(alpha_1)
    ):
        raise ValueError("Invalid count, prediction, length or dispersion.")
    alpha = alpha_1 / length
    weight = 1 / (1 + alpha * mu)
    expected = weight * mu + (1 - weight) * n
    variance = (n + 1 / alpha) * ((alpha * mu) / (1 + alpha * mu)) ** 2
    variance[mu == 0] = 0
    return {
        "model": "length-eb/1",
        "alpha": alpha.tolist(),
        "expected": expected.tolist(),
        "latent_rate_variance": variance.tolist(),
        "cure": np.cumsum((n - mu)[np.argsort(mu, kind="stable")]).tolist(),
        "limitations": "Fixed supplied SPF and alpha; not a fitted BYM2 model or CURE confidence envelope.",
    }


def evpi(losses):
    """Rows posterior draws, columns actions; losses include costs/horizon in declared units."""
    loss = np.asarray(losses, float)
    if loss.ndim != 2 or min(loss.shape) < 2 or not np.isfinite(loss).all():
        raise ValueError("At least two posterior draws and explicit action losses required.")
    current = float(loss.mean(axis=0).min())
    perfect = float(loss.min(axis=1).mean())
    best_action_idx = int(np.argmin(loss.mean(axis=0)))
    return {
        "evpi": max(0.0, current - perfect),
        "current_expected_loss": current,
        "perfect_information_loss": perfect,
        "optimal_action_index": best_action_idx,
        "action_expected_losses": loss.mean(axis=0).tolist(),
    }


def manifest(method: str, parameters: dict[str, Any], snapshot: dict[str, Any]) -> dict[str, Any]:
    try:
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        revision = "unavailable"
    return {
        "contract": CONTRACT,
        "method": method,
        "parameters": parameters,
        "snapshot_sha256": hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest(),
        "code_revision": revision,
        "python": platform.python_version(),
        "numpy": np.__version__,
        "implementation_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "networkx": nx.__version__,
        "research_only": True,
    }


def space_time_density(
    distances,
    lengths,
    event_times,
    slices,
    spatial_m: float,
    temporal_s: float,
    domain: tuple[float, float],
    causal: bool = False,
    exclude_event: int | None = None,
    event_weights=None,
):
    """Discrete network quadrature x truncated exponential time kernel."""
    d, lengths, times, slices = (np.asarray(x, float) for x in (distances, lengths, event_times, slices))
    start, end = domain
    if not all(math.isfinite(x) for x in (start, end, spatial_m, temporal_s)) or end <= start or spatial_m <= 0 or temporal_s <= 0:
        raise ValueError("Invalid domain or bandwidth.")
    if d.shape != (len(times), len(lengths)) or (lengths <= 0).any() or not np.isfinite(lengths).all() or np.isnan(d).any() or (d < 0).any():
        raise ValueError("Invalid network quadrature.")
    if not np.isfinite(times).all() or not np.isfinite(slices).all() or (times < start).any() or (times > end).any() or (slices < start).any() or (slices > end).any():
        raise ValueError("Events and slices must lie in the domain.")
    if len(times) * len(lengths) * max(1, len(slices)) > 5000000:
        raise ValueError("Space-time workload limit exceeded.")
    weights = np.ones(len(times), dtype=float) if event_weights is None else np.asarray(event_weights, dtype=float)
    if weights.shape != (len(times),) or not np.isfinite(weights).all() or (weights < 0).any():
        raise ValueError("Invalid event weights.")
    spatial = np.exp(-d / spatial_m)
    normalizer = spatial @ lengths
    spatial = np.divide(spatial, normalizer[:, None], out=np.zeros_like(spatial), where=normalizer[:, None] > 0)
    delta = slices[:, None] - times[None, :]
    if causal:
        norm = -np.expm1(-(end - times) / temporal_s)
        temporal = np.exp(-np.maximum(delta, 0) / temporal_s) * (delta >= 0) / temporal_s
    else:
        norm = 1 - 0.5 * (np.exp(-(times - start) / temporal_s) + np.exp(-(end - times) / temporal_s))
        temporal = 0.5 * np.exp(-abs(delta) / temporal_s) / temporal_s
    temporal = np.divide(temporal, norm, out=np.zeros_like(temporal), where=norm > 1e-12)
    temporal = temporal * weights[None, :]
    if exclude_event is not None:
        temporal[:, exclude_event] = 0
    return {
        "intensity": (temporal @ spatial).tolist(),
        "units": "events / metre / second",
        "spatial_kernel": "network exponential, discrete length renormalized",
        "temporal_kernel": "causal exponential" if causal else "symmetric Laplace",
        "domain": list(domain),
        "slices": slices.tolist(),
        "spatial_m": spatial_m,
        "temporal_s": temporal_s,
        "unsupported_events": np.where(normalizer == 0)[0].tolist(),
    }


def network_voronoi(graph, event_nodes):
    """Discrete length-weighted Voronoi intensity. Ties split cell length equally."""
    if len(graph) > 5000 or len(event_nodes) > 500:
        raise ValueError("Voronoi workload limit exceeded.")
    if any(n not in graph for n in event_nodes):
        raise ValueError("Event off network.")
    distances = [nx.single_source_dijkstra_path_length(graph, n, weight="distance_m") for n in event_nodes]
    cells = np.zeros(len(event_nodes))
    owners = {}
    for n in graph:
        ds = np.array([row.get(n, math.inf) for row in distances])
        winners = np.flatnonzero(ds == ds.min()) if len(ds) and np.isfinite(ds.min()) else []
        owners[n] = winners
        for i in winners:
            cells[i] += graph.nodes[n]["length_m"] / len(winners)
    return {n: (float(np.mean([1 / cells[i] for i in winners])) if len(winners) else None) for n, winners in owners.items()}


def trajectory_hmm(graph, emissions, transition_scale_m: float = 100.0):
    """Viterbi over ordered candidate emissions; transitions require legal reachability."""
    if len(emissions) < 2:
        raise ValueError("Trajectory HMM requires at least two fixes; use single-fix matching.")
    if len(emissions) > 1000 or any(not fix or len(fix) > 20 for fix in emissions) or transition_scale_m <= 0:
        raise ValueError("Invalid candidates or trajectory workload.")
    previous, paths = {}, {}
    for node, prob in emissions[0].items():
        if node not in graph or not 0 < prob <= 1:
            raise ValueError("Invalid emission probability or node.")
        previous[node], paths[node] = math.log(prob), [node]
    for fix in emissions[1:]:
        current, new_paths = {}, {}
        for target, probability in fix.items():
            if target not in graph or not 0 < probability <= 1:
                raise ValueError("Invalid emission probability or node.")
            candidates = []
            for source, score in previous.items():
                try:
                    distance = nx.shortest_path_length(graph, source, target, weight="distance_m")
                except nx.NetworkXNoPath:
                    continue
                candidates.append((score - distance / transition_scale_m + math.log(probability), source))
            if candidates:
                best, parent = max(candidates, key=lambda pair: pair[0])
                current[target], new_paths[target] = best, paths[parent] + [target]
        if not current:
            raise ValueError("No legal route between trajectory fixes.")
        previous, paths = current, new_paths
    best = max(previous, key=previous.get)
    return {
        "path": paths[best],
        "log_score": previous[best],
        "method": "route-penalty-viterbi/1",
        "limitation": "Research baseline; not a calibrated trajectory posterior.",
    }


def hawkes_cascade(
    graph,
    background_rate: float,
    window_s: float,
    branching: float,
    decay_s: float,
    seed: int,
    max_events: int = 5000,
):
    """Branching construction on reverse legal graph; conditional finite window."""
    if (
        not 0 <= branching < 1
        or background_rate < 0
        or window_s <= 0
        or decay_s <= 0
        or not all(math.isfinite(x) for x in (branching, background_rate, window_s, decay_s))
    ):
        raise ValueError("Stable branching < 1 and finite positive time parameters required.")
    if not len(graph) or len(graph) > 5000 or not 1 <= max_events <= 10000 or background_rate * window_s > max_events:
        raise ValueError("Hawkes workload limit exceeded.")
    rng = np.random.default_rng(seed)
    nodes = list(graph)
    n = int(rng.poisson(background_rate * window_s))
    if n > max_events:
        raise ValueError("Event cap reached; simulation failed rather than silently truncated.")
    events = [
        {"id": i, "node": nodes[int(rng.integers(len(nodes)))], "time_s": float(rng.uniform(0, window_s)), "parent": None, "root": i}
        for i in range(n)
    ]
    reverse = graph.reverse(copy=False)
    index = 0
    while index < len(events):
        parent = events[index]
        upstream = sorted(nx.descendants(reverse, parent["node"]), key=str)
        if upstream:
            for _ in range(int(rng.poisson(branching))):
                time_s = parent["time_s"] + float(rng.exponential(decay_s))
                if time_s >= window_s:
                    continue
                if len(events) >= max_events:
                    raise ValueError("Event cap reached; run rejected.")
                events.append(
                    {
                        "id": len(events),
                        "node": upstream[int(rng.integers(len(upstream)))],
                        "time_s": time_s,
                        "parent": parent["id"],
                        "root": parent["root"],
                    }
                )
        index += 1
    return {
        "events": sorted(events, key=lambda event: event["time_s"]),
        "seed": seed,
        "branching": branching,
        "window_s": window_s,
        "boundary": "no pre-window history; right-censored offspring",
        "synthetic_truth": True,
        "model": "uniform-upstream branching baseline/1",
    }
