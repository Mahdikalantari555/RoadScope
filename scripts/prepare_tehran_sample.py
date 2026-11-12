#!/usr/bin/env python3
"""Prepare an isolated, reproducible OSMnx GraphML demonstration extract.

This produces an intermediate exchange bundle, NOT a RoadScope database import.
It does not contact OSM, alter a database or claim that observations are real.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
from pathlib import Path

import networkx as nx
from pyproj import Transformer
from shapely.geometry import LineString, mapping
from shapely import wkt
from shapely.ops import transform

TO_METRIC = Transformer.from_crs(4326, 32639, always_xy=True).transform
TO_WGS84 = Transformer.from_crs(32639, 4326, always_xy=True).transform


def prepare(path: Path, seed: int, count: int, source: str) -> dict:
    if count < 0 or count > 10000:
        raise ValueError('count must be between 0 and 10000')
    raw = path.read_bytes()
    graph = nx.read_graphml(path, force_multigraph=True)
    if str(graph.graph.get('crs', '')).lower() not in ('epsg:4326', '4326'):
        raise ValueError('GraphML must declare EPSG:4326')
    streets = []
    seen = set()
    for u, v, key, data in graph.edges(keys=True, data=True):
        try:
            a = graph.nodes[u]; b = graph.nodes[v]
            line = wkt.loads(data['geometry']) if data.get('geometry') else LineString([(float(a['x']), float(a['y'])), (float(b['x']), float(b['y']))])
            if not isinstance(line, LineString) or line.is_empty or len(line.coords) < 2:
                raise ValueError('not a line')
            coords = list(line.coords)
            if any(not math.isfinite(x) or not math.isfinite(y) or not (50 <= x <= 53 and 34 <= y <= 37) for x, y, *_ in coords):
                raise ValueError('coordinates outside the Tehran region')
            # Keep the OSM graph's explicit topology; never infer nodes from line intersections.
            # Reverse copies of the same street should not receive twice the sample weight.
            canonical = tuple((round(c[0], 7), round(c[1], 7)) for c in coords)
            canonical = min(canonical, canonical[::-1])
            signature = (tuple(sorted((str(u), str(v)))), str(data.get('osmid', '')), canonical)
            if signature in seen:
                continue
            metric = transform(TO_METRIC, line)
            if metric.length <= 0:
                raise ValueError('zero length')
            seen.add(signature)
            streets.append({'id': f'{u}:{v}:{key}', 'u': str(u), 'v': str(v), 'osmid': str(data.get('osmid', '')), 'name': str(data.get('name', '')), 'highway': str(data.get('highway', '')), 'oneway': str(data.get('oneway', '')), 'bridge': str(data.get('bridge', '')), 'tunnel': str(data.get('tunnel', '')), 'layer': str(data.get('layer', '')), 'line': line, 'metric': metric})
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f'Invalid graph edge {u}:{v}:{key}: {exc}') from exc
    streets.sort(key=lambda s: s['id'])
    if not streets:
        raise ValueError('Graph has no usable streets')
    rng = random.Random(seed)
    selected = rng.choices(streets, weights=[s['metric'].length for s in streets], k=count)
    incidents = []
    for index, street in enumerate(selected):
        point = transform(TO_WGS84, street['metric'].interpolate(rng.random(), normalized=True))
        incidents.append({'type': 'Feature', 'geometry': mapping(point), 'properties': {'id': index + 1, 'street_id': street['id'], 'synthetic': True, 'severity': rng.choice(['PDO', 'MINOR_INJURY', 'SERIOUS_INJURY'])}})
    features = [{'type': 'Feature', 'geometry': mapping(s['line']), 'properties': {k: v for k, v in s.items() if k not in ('line', 'metric')}} for s in streets]
    return {'manifest': {'network_source': source, 'network_attribution': '© OpenStreetMap contributors, ODbL', 'graph_created_date': graph.graph.get('created_date'), 'graph_sha256': hashlib.sha256(raw).hexdigest(), 'network_crs': 'EPSG:4326', 'metric_crs': 'EPSG:32639', 'incident_provenance': 'synthetic, not real crash data', 'generator': 'roadscope-graphml-sample-v1', 'seed': seed, 'incident_count': count, 'street_count': len(streets)}, 'streets': {'type': 'FeatureCollection', 'features': features}, 'incidents': {'type': 'FeatureCollection', 'features': incidents}}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('graphml', type=Path)
    parser.add_argument('--output', type=Path, required=True, help='Output JSON outside the repository')
    parser.add_argument('--source', required=True, help='Recorded source and version of the input graph')
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--count', type=int, default=200)
    args = parser.parse_args()
    bundle = prepare(args.graphml, args.seed, args.count, args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(bundle, ensure_ascii=False, sort_keys=True), encoding='utf-8')
    print(json.dumps(bundle['manifest'], ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
