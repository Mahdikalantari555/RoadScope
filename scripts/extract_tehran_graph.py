#!/usr/bin/env python3
"""Extract a reproducible node-bounded GraphML subgraph from a Tehran OSMnx graph.

The bounds select nodes, not clipped road geometry: edges with both endpoints
inside are retained whole, and may cross the boundary. Boundary-crossing edges
with an endpoint outside are excluded. This is not a database import.
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path

import networkx as nx


def extract(graph: nx.MultiDiGraph, west: float, south: float, east: float, north: float) -> nx.MultiDiGraph:
    if not all(math.isfinite(v) for v in (west, south, east, north)) or not (50 <= west < east <= 53 and 34 <= south < north <= 37):
        raise ValueError('Expected a nonempty bounding box within the Tehran region')
    if str(graph.graph.get('crs', '')).lower() not in ('epsg:4326', '4326'):
        raise ValueError('GraphML must declare EPSG:4326')
    selected = []
    for node, attrs in graph.nodes(data=True):
        try:
            x, y = float(attrs['x']), float(attrs['y'])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f'Invalid coordinates for node {node}') from exc
        if not math.isfinite(x) or not math.isfinite(y) or not (-180 <= x <= 180 and -90 <= y <= 90):
            raise ValueError(f'Invalid coordinates for node {node}')
        if west <= x <= east and south <= y <= north:
            selected.append(node)
    result = graph.subgraph(selected).copy()
    if result.number_of_edges() == 0:
        raise ValueError('No road edges in selected bounds')
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('graphml', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--bounds', type=float, nargs=4, required=True, metavar=('WEST', 'SOUTH', 'EAST', 'NORTH'))
    args = parser.parse_args()
    if args.graphml.resolve() == args.output.resolve():
        parser.error('output must not overwrite the input')
    graph = nx.read_graphml(args.graphml, force_multigraph=True)
    result = extract(graph, *args.bounds)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    nx.write_graphml(result, args.output)
    print(f'{result.number_of_nodes()} nodes; {result.number_of_edges()} directed edges')


if __name__ == '__main__':
    main()
