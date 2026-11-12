import math
import sqlite3

import networkx as nx
import numpy as np
import pytest

from app.services import research as r


def test_directed_conservation_and_heat():
    g = nx.DiGraph([(0, 1), (1, 2)])
    g.add_node(3)
    mass, diag = r.diffuse(g, {1: 2.0}, 3)
    assert mass[0] == 0 and mass[3] == 0
    assert sum(mass.values()) == pytest.approx(2)
    assert diag["minimum_mass"] >= -1e-10
    symmetric, _ = r.diffuse(g, {1: 2.0}, 3, symmetric=True)
    assert symmetric[0] > 0
    assert sum(symmetric.values()) == pytest.approx(2)
    assert all(value == 0 for value in r.diffuse(g, {}, 1)[0].values())
    with pytest.raises(ValueError):
        r.diffuse(g, {0: -1}, 1)
    with pytest.raises(ValueError):
        r.diffuse(g, {0: 1}, math.inf)


def test_pai_ties_unequal_length_and_empty():
    result = r.pai_curve([1, 1], [1, 3], [4, 0], [0, 0.25, 1])
    assert result["curve"][1]["capture"] == pytest.approx(0.25)
    assert result["curve"][1]["pai"] == pytest.approx(1)
    assert result["normalized_excess_capture_area"] == pytest.approx(0)
    assert r.pai_curve([2, 1], [1, 3], [0, 0])["curve"][1]["pai"] is None
    assert r.pai_curve([2, 1], [1, 3], [4, 0], [0.125])["curve"][0]["capture"] == pytest.approx(0.5)
    with pytest.raises(ValueError):
        r.pai_curve([1], [0], [1])


def test_allocation_and_ipw():
    assert r.allocations([{"lixel_id": 1, "probability": 0.52}, {"lixel_id": 2, "probability": 0.48}]) == {1: 0.52, 2: 0.48}
    with pytest.raises(ValueError):
        r.allocations([])
    with pytest.raises(ValueError):
        r.stabilized_ipw([0], [100])
    with pytest.raises(ValueError):
        r.stabilized_ipw([1], [1000])
    result = r.stabilized_ipw([50, 20], [100, 100])
    assert 0 < result["effective_sample_size"] <= 70


def test_eb_and_decision():
    result = r.length_eb([4, 4], [2, 2], [1, 2], 0.5)
    assert result["alpha"] == [0.5, 0.25]
    assert result["expected"][0] == pytest.approx(3)
    assert result["expected"][1] == pytest.approx(8 / 3)
    assert r.evpi([[1, 2], [3, 4]])["evpi"] == 0
    assert r.evpi([[0, 10], [10, 0]])["evpi"] == 5
    with pytest.raises(ValueError):
        r.evpi([])


def test_space_time_mass_boundary_and_causality():
    slices = np.linspace(0, 20, 4001)
    result = r.space_time_density([[0, 1]], [2, 3], [10], slices, 5, 2, (0, 20))
    intensity = np.asarray(result["intensity"])
    assert np.trapezoid(intensity @ np.array([2, 3]), slices) == pytest.approx(1, abs=1e-5)
    causal = r.space_time_density([[0, math.inf]], [2, 3], [10], [5, 15], 5, 2, (0, 20), causal=True)
    assert causal["intensity"][0] == [0, 0]
    assert causal["intensity"][1][1] == 0
    excluded = r.space_time_density([[0, 1]], [2, 3], [10], [10], 5, 2, (0, 20), exclude_event=0)
    assert excluded["intensity"] == [[0, 0]]
    empty = r.space_time_density(np.empty((0, 2)), [2, 3], [], [10], 5, 2, (0, 20))
    assert empty["intensity"] == [[0, 0]]


def test_hmm_and_voronoi_components():
    g = nx.DiGraph()
    g.add_edge(0, 1, distance_m=10)
    g.add_node(2)
    for n in g:
        g.nodes[n]["length_m"] = 10
    assert r.trajectory_hmm(g, [{0: 1}, {1: 1}])["path"] == [0, 1]
    with pytest.raises(ValueError):
        r.trajectory_hmm(g, [{1: 1}, {0: 1}])
    with pytest.raises(ValueError):
        r.trajectory_hmm(g, [{0: 1}])
    intensity = r.network_voronoi(g.to_undirected(), [0])
    assert intensity[2] is None
    assert intensity[0] == pytest.approx(0.05)


def test_hawkes_reproducible_bounded_and_upstream():
    g = nx.DiGraph([(0, 1), (1, 2)])
    a = r.hawkes_cascade(g, 0.2, 100, 0.5, 2, 42)
    b = r.hawkes_cascade(g, 0.2, 100, 0.5, 2, 42)
    assert a == b
    lookup = {event["id"]: event for event in a["events"]}
    for event in a["events"]:
        if event["parent"] is not None:
            parent = lookup[event["parent"]]
            assert nx.has_path(g, event["node"], parent["node"])
            assert event["time_s"] > parent["time_s"]
    assert all(event["parent"] is None for event in r.hawkes_cascade(g, 0.2, 100, 0, 2, 42)["events"])
    with pytest.raises(ValueError):
        r.hawkes_cascade(g, 0.2, 100, 1.0, 2, 42)


def test_upgrade_replay_and_backup(tmp_path):
    from app.db import get_connection, init_schema_and_reference_data
    from app.migrations import backup_database

    path = tmp_path / "db.sqlite"
    init_schema_and_reference_data(path)
    init_schema_and_reference_data(path)
    with get_connection(path) as conn:
        # 003 (directed network), 004 (research contracts) and 005 (study areas / CRS-agnostic schema)
        assert conn.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0] == 4
    copy = tmp_path / "backup.sqlite"
    backup_database(path, copy)
    with sqlite3.connect(copy) as conn:
        assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] >= 6
    with pytest.raises((FileExistsError, ValueError)):
        backup_database(path, copy)


def test_legacy_database_upgrade_preserves_rows(tmp_path):
    from app.config import PROJECT_ROOT
    from app.db import init_schema_and_reference_data
    from app.migrations import backup_database

    path = tmp_path / "legacy.sqlite"
    backup_database(PROJECT_ROOT / "data" / "uai.sqlite", path)
    with sqlite3.connect(path) as conn:
        before = conn.execute("SELECT COUNT(*) FROM accidents").fetchone()[0]
        audits = conn.execute("SELECT COUNT(*) FROM audit_logs").fetchone()[0]
    init_schema_and_reference_data(path)
    with sqlite3.connect(path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM accidents").fetchone()[0] == before
        assert conn.execute("SELECT COUNT(*) FROM audit_logs").fetchone()[0] == audits
        assert conn.execute("SELECT COUNT(*) FROM road_segment_directions WHERE source='assumed_bidirectional'").fetchone()[0] > 0
    assert list((tmp_path / "backups").glob("*.sqlite"))


def test_configuration_alias_precedence(monkeypatch):
    from app.config import setting

    monkeypatch.setenv("UAI_DEFAULT_SEED", "31")
    monkeypatch.delenv("ROADSCOPE_DEFAULT_SEED", raising=False)
    assert setting("DEFAULT_SEED", "42") == "31"
    monkeypatch.setenv("ROADSCOPE_DEFAULT_SEED", "32")
    assert setting("DEFAULT_SEED", "42") == "32"
