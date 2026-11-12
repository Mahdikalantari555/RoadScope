from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import networkx as nx
import pytest
from shapely.geometry import shape
from shapely.ops import transform

spec = spec_from_file_location('tehran_sample', Path(__file__).resolve().parents[2] / 'scripts/prepare_tehran_sample.py')
module = module_from_spec(spec)
spec.loader.exec_module(module)


def fixture_graph(tmp_path, crs='epsg:4326'):
    graph = nx.MultiDiGraph(crs=crs, created_date='2025-01-01')
    graph.add_node('1', x=51.42, y=35.70)
    graph.add_node('2', x=51.43, y=35.70)
    graph.add_node('3', x=51.425, y=35.695)
    graph.add_node('4', x=51.425, y=35.705)
    graph.add_edge('1', '2', osmid='100', highway='primary', oneway='False')
    graph.add_edge('2', '1', osmid='100', highway='primary', oneway='False')
    graph.add_edge('3', '4', osmid='200', highway='primary', bridge='yes', layer='1')
    file = tmp_path / 'graph.graphml'
    nx.write_graphml(graph, file)
    return file


def test_deterministic_points_lie_on_the_source_street(tmp_path):
    path = fixture_graph(tmp_path)
    a = module.prepare(path, 42, 20, 'fixture')
    assert a == module.prepare(path, 42, 20, 'fixture')
    assert a['manifest']['incident_provenance'].startswith('synthetic')
    assert a['manifest']['street_count'] == 2
    roads = {f['properties']['id']: shape(f['geometry']) for f in a['streets']['features']}
    for feature in a['incidents']['features']:
        road = roads[feature['properties']['street_id']]
        assert transform(module.TO_METRIC, shape(feature['geometry'])).distance(transform(module.TO_METRIC, road)) < 0.001
    assert a['streets']['features'][1]['properties']['bridge'] == 'yes'


def test_invalid_crs_and_count_are_rejected(tmp_path):
    with pytest.raises(ValueError, match='EPSG:4326'):
        module.prepare(fixture_graph(tmp_path, 'epsg:25832'), 1, 1, 'fixture')
    with pytest.raises(ValueError, match='count'):
        module.prepare(fixture_graph(tmp_path), 1, 10001, 'fixture')
