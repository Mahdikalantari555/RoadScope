"""Directed lixel edge-state topology; no cached results or model inference.

A state is (segment_id, lixel_id, travel_direction), where +1 follows the
segment's u→v orientation and -1 follows v→u. Moving between midpoint states
costs half of each lixel length in metres. Only shared endpoint nodes create
turns; geometric crossings without a common node remain disconnected.
"""
from __future__ import annotations

import math
import sqlite3
from dataclasses import dataclass

import networkx as nx

State = tuple[int, int, int]


@dataclass(frozen=True)
class DirectedTopology:
    dataset_id: int
    version: int
    graph: nx.DiGraph
    assumed_direction_segments: int


def build_directed_lixel_topology(conn: sqlite3.Connection, dataset_id: int) -> DirectedTopology:
    version_row = conn.execute('SELECT version FROM network_topology_versions WHERE dataset_id=?', (dataset_id,)).fetchone()
    if version_row is None:
        raise ValueError(f'Dataset {dataset_id} has no directed topology version')
    segments = conn.execute('''SELECT s.id, s.u_node_id, s.v_node_id, s.length_m, d.direction, d.source
        FROM road_segments s LEFT JOIN road_segment_directions d ON d.segment_id=s.id AND d.dataset_id=s.dataset_id
        WHERE s.dataset_id=? ORDER BY s.id''', (dataset_id,)).fetchall()
    lixels = conn.execute('''SELECT id, parent_segment_id, lixel_index, m_start_m, m_end_m, length_m
        FROM road_lixels WHERE dataset_id=? ORDER BY parent_segment_id, lixel_index''', (dataset_id,)).fetchall()
    restrictions = {(int(r['via_node_id']), int(r['from_segment_id']), int(r['to_segment_id']))
                    for r in conn.execute('SELECT via_node_id, from_segment_id, to_segment_id FROM turn_restrictions WHERE dataset_id=?', (dataset_id,))}
    segment_ids = {int(s['id']) for s in segments}
    by_segment: dict[int, list[sqlite3.Row]] = {sid: [] for sid in segment_ids}
    for row in lixels:
        sid = int(row['parent_segment_id'])
        if sid not in by_segment:
            raise ValueError('Lixel and parent segment belong to different datasets')
        by_segment[sid].append(row)

    graph = nx.DiGraph()
    arrivals: dict[int, list[tuple[int, State, float]]] = {}
    departures: dict[int, list[tuple[int, State, float]]] = {}
    assumed = 0
    for seg in segments:
        sid = int(seg['id'])
        direction = seg['direction']
        if direction is None or direction not in (-1, 0, 1):
            raise ValueError(f'Segment {sid} is missing a valid direction')
        if seg['source'] == 'assumed_bidirectional':
            assumed += 1
        rows = by_segment[sid]
        if not rows:
            raise ValueError(f'Segment {sid} has no lixels')
        previous_end = 0.0
        for idx, row in enumerate(rows):
            start, end, length = float(row['m_start_m']), float(row['m_end_m']), float(row['length_m'])
            if (not all(math.isfinite(v) for v in (start, end, length)) or length <= 0 or
                int(row['lixel_index']) != idx or abs(start - previous_end) > 1e-3 or abs((end - start) - length) > 1e-3):
                raise ValueError(f'Segment {sid} has invalid or discontinuous lixels')
            previous_end = end
        if not math.isfinite(float(seg['length_m'])) or abs(previous_end - float(seg['length_m'])) > 1e-3:
            raise ValueError(f'Segment {sid} lixels do not cover the segment length')
        for orientation in ((1, -1) if direction == 0 else (int(direction),)):
            ordered = rows if orientation == 1 else list(reversed(rows))
            states = [(sid, int(r['id']), orientation) for r in ordered]
            for state, row in zip(states, ordered):
                graph.add_node(state, segment_id=sid, lixel_id=int(row['id']), direction=orientation, length_m=float(row['length_m']))
            for index in range(len(states) - 1):
                weight = (float(ordered[index]['length_m']) + float(ordered[index + 1]['length_m'])) / 2
                graph.add_edge(states[index], states[index + 1], weight_m=weight, kind='along_segment')
            start_node = int(seg['u_node_id'] if orientation == 1 else seg['v_node_id'])
            end_node = int(seg['v_node_id'] if orientation == 1 else seg['u_node_id'])
            departures.setdefault(start_node, []).append((sid, states[0], float(ordered[0]['length_m']) / 2))
            arrivals.setdefault(end_node, []).append((sid, states[-1], float(ordered[-1]['length_m']) / 2))

    for node, incoming in arrivals.items():
        for from_id, from_state, from_half in incoming:
            for to_id, to_state, to_half in departures.get(node, []):
                if (node, from_id, to_id) not in restrictions:
                    graph.add_edge(from_state, to_state, weight_m=from_half + to_half, kind='turn', via_node=node)
    return DirectedTopology(dataset_id, int(version_row['version']), graph, assumed)
