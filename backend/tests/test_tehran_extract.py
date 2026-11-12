from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import networkx as nx
import pytest

spec = spec_from_file_location('tehran_extract', Path(__file__).resolve().parents[2] / 'scripts/extract_tehran_graph.py')
module = module_from_spec(spec)
spec.loader.exec_module(module)


def test_node_bounded_extract_keeps_topology_and_excludes_crossing_edge():
    graph = nx.MultiDiGraph(crs='epsg:4326')
    graph.add_node('a', x=51.41, y=35.70)
    graph.add_node('b', x=51.42, y=35.70)
    graph.add_node('c', x=51.45, y=35.70)
    graph.add_edge('a', 'b', osmid='123', oneway='yes')
    graph.add_edge('b', 'c', osmid='456')
    result = module.extract(graph, 51.40, 35.68, 51.44, 35.72)
    assert set(result.nodes) == {'a', 'b'}
    assert result.number_of_edges() == 1
    assert result['a']['b'][0]['osmid'] == '123'
    assert graph.number_of_edges() == 2


def test_bad_bounds_crs_and_empty_selection():
    graph = nx.MultiDiGraph(crs='epsg:4326')
    graph.add_node('a', x=51.41, y=35.70)
    with pytest.raises(ValueError, match='bounding box'):
        module.extract(graph, 51.5, 35.68, 51.4, 35.72)
    with pytest.raises(ValueError, match='No road edges'):
        module.extract(graph, 51.4, 35.68, 51.44, 35.72)
    graph.graph['crs'] = 'epsg:25832'
    with pytest.raises(ValueError, match='EPSG:4326'):
        module.extract(graph, 51.4, 35.68, 51.44, 35.72)
