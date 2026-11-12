import math

import networkx as nx
import pytest

from app.services.directed_topology import DirectedTopology
from app.services.directed_transport import run_directed_transport


def make_topology(edges, extra=()):
    graph = nx.DiGraph()
    graph.add_nodes_from(extra)
    for source, target, distance in edges:
        graph.add_edge(source, target, weight_m=distance)
    return DirectedTopology(7, 12, graph, 2)


def values(result):
    return {(r["segment_id"], r["lixel_id"], r["direction"]): r["mass"] for r in result["states"]}


def test_single_step_line_matches_backward_euler_and_sink_retains_mass():
    a, b = (1, 1, 1), (2, 2, 1)
    topo = make_topology([(a, b, 10)])
    result = run_directed_transport(topo, a, mass=2, speed_m_s=5, duration_s=2, steps=1)
    m = values(result)
    assert m[a] == pytest.approx(1)
    assert m[b] == pytest.approx(1)
    assert result["final_mass"] == pytest.approx(2)
    assert result["topology_version"] == 12


def test_line_converges_to_analytic_continuous_time_solution():
    a, b = (1, 1, 1), (2, 2, 1)
    topo = make_topology([(a, b, 10)])
    result = run_directed_transport(topo, a, mass=1, speed_m_s=5, duration_s=2, steps=64)
    assert values(result)[a] == pytest.approx(math.exp(-1), abs=0.003)
    assert result["final_mass"] == pytest.approx(1)


def test_y_branch_different_distances_and_unreachable_upstream():
    a, b, c, upstream = (1, 1, 1), (2, 2, 1), (3, 3, 1), (4, 4, 1)
    topo = make_topology([(a, b, 10), (a, c, 20), (upstream, a, 10)])
    result = run_directed_transport(topo, a, mass=10, speed_m_s=5, duration_s=20, steps=8)
    m = values(result)
    assert m[upstream] == 0
    assert m[b] == pytest.approx(2 * m[c])
    assert all(mass >= 0 for mass in m.values())
    assert sum(m.values()) == pytest.approx(10)


def test_zero_mass_invalid_input_and_nonpositive_edge():
    a, b = (1, 1, 1), (2, 2, 1)
    topo = make_topology([(a, b, 10)])
    assert sum(values(run_directed_transport(topo, a, mass=0, speed_m_s=1, duration_s=1, steps=1)).values()) == 0
    for kwargs in ({"mass": -1}, {"speed_m_s": math.inf}, {"duration_s": 0}, {"steps": 1.5}, {"steps": True}):
        params = {"mass": 1, "speed_m_s": 1, "duration_s": 1, "steps": 1} | kwargs
        with pytest.raises(ValueError):
            run_directed_transport(topo, a, **params)
    with pytest.raises(ValueError, match="initial state"):
        run_directed_transport(topo, (1, 1, -1), mass=1, speed_m_s=1, duration_s=1, steps=1)
    with pytest.raises(ValueError, match="distances"):
        run_directed_transport(make_topology([(a, b, 0)]), a, mass=1, speed_m_s=1, duration_s=1, steps=1)
