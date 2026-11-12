"""Conservative directional jump transport on a directed lixel state graph.

This is a first-order continuous-time Markov transport approximation, not the
symmetric metric-graph heat kernel. Each legal transition has rate
speed / (outdegree * midpoint distance); branch probabilities are therefore
proportional to inverse distance, not necessarily equal. Sinks retain mass."""
from __future__ import annotations

import math
from typing import Any

import networkx as nx
import numpy as np
from scipy.sparse import csc_matrix, eye
from scipy.sparse.linalg import splu

from .directed_topology import DirectedTopology, State


def run_directed_transport(topo: DirectedTopology, initial: State, *, mass: float,
                           speed_m_s: float, duration_s: float, steps: int) -> dict[str, Any]:
    if (not all(math.isfinite(x) for x in (mass, speed_m_s, duration_s)) or not 0 <= mass <= 100000 or
        not 0 < speed_m_s <= 70 or not 0 < duration_s <= 3600 or isinstance(steps, bool) or
        not isinstance(steps, int) or not 1 <= steps <= 64):
        raise ValueError('mass, speed, duration and steps must be finite and within the documented limits')
    graph = topo.graph
    states = list(graph.nodes)
    # Sparse LU can fill in substantially; these limits are safeguards, not a
    # substitute for job quotas or authentication on an exposed deployment.
    if len(states) > 4000 or graph.number_of_edges() > 15000:
        raise ValueError('directed transport is limited to 4000 states and 15000 transitions')
    if initial not in graph:
        raise ValueError('initial state is not permitted in this directed topology')
    index = {state: i for i, state in enumerate(states)}
    source_indices: list[int] = []
    dest_indices: list[int] = []
    rates: list[float] = []
    outgoing = np.zeros(len(states), dtype=float)
    for state in states:
        edges = list(graph.out_edges(state, data=True))
        for _, target, attrs in edges:
            distance = float(attrs['weight_m'])
            if not math.isfinite(distance) or distance <= 0:
                raise ValueError('transition distances must be positive and finite')
            rate = speed_m_s / (distance * len(edges))
            src, dst = index[state], index[target]
            source_indices.append(src)
            dest_indices.append(dst)
            rates.append(rate)
            outgoing[src] += rate
    # Column generator: d mass / dt = Q mass. Every column sums to zero.
    generator = csc_matrix((rates, (dest_indices, source_indices)), shape=(len(states), len(states)))
    generator -= csc_matrix((outgoing, (np.arange(len(states)), np.arange(len(states)))), shape=generator.shape)
    dt = duration_s / steps
    solve = splu(eye(len(states), format='csc') - dt * generator)
    vector = np.zeros(len(states), dtype=float)
    vector[index[initial]] = mass
    for _ in range(steps):
        vector = solve.solve(vector)
    tolerance = 1e-9 * max(1.0, mass)
    if np.any(vector < -tolerance) or not np.all(np.isfinite(vector)) or abs(float(np.sum(vector)) - mass) > tolerance:
        raise ArithmeticError('transport solver failed conservation or non-negativity checks')
    vector = np.maximum(vector, 0)
    return {
        'dataset_id': topo.dataset_id, 'topology_version': topo.version,
        'method': 'directed continuous-time Markov jump transport, backward Euler',
        'status': 'experimental; not a metric-graph heat kernel or calibrated traffic model',
        'boundary': 'closed sinks retain mass',
        'junction_rule': 'transition rate = speed / (outdegree * midpoint distance); branch probabilities are inverse-distance weighted',
        'initial_mass': mass, 'final_mass': float(np.sum(vector)),
        'speed_m_s': speed_m_s, 'duration_s': duration_s, 'steps': steps,
        'assumed_bidirectional_segments': topo.assumed_direction_segments,
        'states': [{'segment_id': s[0], 'lixel_id': s[1], 'direction': s[2], 'mass': float(vector[i])}
                   for i, s in enumerate(states)],
    }
