import networkx as nx
import pytest

from app.migrations import apply_migrations
from app.config import MIGRATIONS_DIR
from app.services.directed_topology import build_directed_lixel_topology
from test_migrations import legacy_database


def insert_lixel(conn, lid, sid, index, start, end):
    conn.execute('''INSERT INTO road_lixels(id,dataset_id,parent_segment_id,lixel_index,m_start_m,m_end_m,length_m,midpoint_m,
        mid_x_m,mid_y_m,mid_lon,mid_lat,min_x,max_x,min_y,max_y,wkt_25832,geojson_4326)
        VALUES (?,1,?,?,?,?,?,?,0,0,0,0,0,1,0,1,'LINESTRING (0 0, 1 1)','{}')''',
        (lid, sid, index, start, end, end-start, (start+end)/2))


def test_direction_turns_and_version_are_respected(tmp_path):
    conn = legacy_database(tmp_path / 'graph.sqlite')
    apply_migrations(conn, MIGRATIONS_DIR)
    insert_lixel(conn, 11, 1, 0, 0, 50)
    insert_lixel(conn, 12, 1, 1, 50, 100)
    insert_lixel(conn, 21, 2, 0, 0, 100)
    insert_lixel(conn, 31, 3, 0, 0, 100)
    conn.execute("UPDATE road_segment_directions SET direction=1, source='observed' WHERE segment_id=1")
    before = build_directed_lixel_topology(conn, 1)
    graph = before.graph
    assert before.assumed_direction_segments == 2
    assert (1, 11, -1) not in graph
    assert graph.has_edge((1, 11, 1), (1, 12, 1))
    assert graph[(1, 11, 1)][(1, 12, 1)]['weight_m'] == pytest.approx(50)
    assert graph.has_edge((1, 12, 1), (2, 21, 1))
    assert nx.has_path(graph, (1, 11, 1), (3, 31, 1))
    conn.execute('INSERT INTO turn_restrictions(dataset_id,via_node_id,from_segment_id,to_segment_id) VALUES (1,2,1,2)')
    after = build_directed_lixel_topology(conn, 1)
    assert after.version > before.version
    assert not after.graph.has_edge((1, 12, 1), (2, 21, 1))
    assert not nx.has_path(after.graph, (1, 11, 1), (3, 31, 1))
    conn.close()


def test_invalid_lixels_are_not_silently_routed(tmp_path):
    conn = legacy_database(tmp_path / 'graph.sqlite')
    apply_migrations(conn, MIGRATIONS_DIR)
    insert_lixel(conn, 11, 1, 0, 0, 50)
    insert_lixel(conn, 12, 1, 1, 60, 100)
    insert_lixel(conn, 21, 2, 0, 0, 100)
    insert_lixel(conn, 31, 3, 0, 0, 100)
    with pytest.raises(ValueError, match='discontinuous lixels'):
        build_directed_lixel_topology(conn, 1)
    conn.close()


def test_geometric_crossing_without_shared_node_is_disconnected(tmp_path):
    conn = legacy_database(tmp_path / 'crossing.sqlite')
    apply_migrations(conn, MIGRATIONS_DIR)
    for node in (5, 6):
        conn.execute("INSERT INTO road_nodes(id,dataset_id,node_code,node_type,degree,x_m,y_m,lon,lat,wkt_25832) VALUES (?,1,?,'junction',1,0,0,0,0,'POINT (0 0)')", (node, str(node)))
    conn.execute("""INSERT INTO road_segments(id,dataset_id,edge_code,name,u_node_id,v_node_id,road_class,
        speed_limit_kmh,lanes,length_m,min_x,max_x,min_y,max_y,wkt_25832,geojson_4326)
        VALUES (4,1,'4','overpass',5,6,'local_street',30,1,100,0,1,0,1,'LINESTRING (0 0, 1 1)','{}')""")
    # Identical geometry does not imply a connection: only shared nodes do.
    for lid, sid in ((11, 1), (21, 2), (31, 3), (41, 4)):
        insert_lixel(conn, lid, sid, 0, 0, 100)
    topology = build_directed_lixel_topology(conn, 1)
    assert not nx.has_path(topology.graph, (1, 11, 1), (4, 41, 1))
    assert topology.assumed_direction_segments == 4
    conn.close()
