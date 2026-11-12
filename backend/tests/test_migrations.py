import sqlite3
from pathlib import Path

import pytest

from app.config import MIGRATIONS_DIR
from app.migrations import apply_migrations


def legacy_database(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript((MIGRATIONS_DIR / "002_spatialite_schema.sql").read_text())
    conn.execute("INSERT INTO dataset_sources(id, name, scenario_key, created_at_utc) VALUES (1, 'old', 'old', '2020-01-01')")
    for node in (1, 2, 3, 4):
        conn.execute(
            "INSERT INTO road_nodes(id,dataset_id,node_code,node_type,degree,x_m,y_m,lon,lat,wkt_25832) VALUES (?,1,?,'junction',1,0,0,0,0,'POINT (0 0)')",
            (node, str(node)),
        )
    for segment, start, end in ((1, 1, 2), (2, 2, 3), (3, 3, 4)):
        conn.execute(
            """INSERT INTO road_segments(id,dataset_id,edge_code,name,u_node_id,v_node_id,road_class,
            speed_limit_kmh,lanes,length_m,min_x,max_x,min_y,max_y,wkt_25832,geojson_4326)
            VALUES (?,1,?,?,?,?,'local_street',30,1,100,0,1,0,1,'LINESTRING (0 0, 1 1)','{}')""",
            (segment, str(segment), str(segment), start, end),
        )
    conn.commit()
    return conn


def test_legacy_upgrade_backups_and_repeated_application(tmp_path):
    path = tmp_path / "existing.sqlite"
    conn = legacy_database(path)
    assert apply_migrations(conn, MIGRATIONS_DIR) == [
        "003_directed_network.sql",
        "004_research_contracts.sql",
    ]
    directions = conn.execute("SELECT direction, source FROM road_segment_directions").fetchall()
    assert len(directions) == 3
    assert all(tuple(r) == (0, "assumed_bidirectional") for r in directions)
    assert conn.execute("SELECT name FROM dataset_sources").fetchone()[0] == "old"
    backups = list((tmp_path / "backups").glob("*.sqlite"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as backup:
        assert backup.execute("SELECT COUNT(*) FROM road_segments").fetchone()[0] == 3
        assert backup.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='road_segment_directions'").fetchone()[0] == 0
    assert apply_migrations(conn, MIGRATIONS_DIR) == []
    assert len(list((tmp_path / "backups").glob("*.sqlite"))) == 1
    conn.close()


def test_restriction_validation_and_topology_revisions(tmp_path):
    conn = legacy_database(tmp_path / "data.sqlite")
    apply_migrations(conn, MIGRATIONS_DIR)
    version = lambda: conn.execute("SELECT version FROM network_topology_versions WHERE dataset_id=1").fetchone()[0]
    initial = version()
    conn.execute("UPDATE road_segment_directions SET direction=1, source='observed' WHERE segment_id=1")
    assert version() > initial
    after_direction = version()
    conn.execute("INSERT INTO turn_restrictions(dataset_id,via_node_id,from_segment_id,to_segment_id) VALUES (1,2,1,2)")
    assert version() > after_direction
    with pytest.raises(sqlite3.IntegrityError, match="connected segments"):
        conn.execute("INSERT INTO turn_restrictions(dataset_id,via_node_id,from_segment_id,to_segment_id) VALUES (1,1,1,3)")
    with pytest.raises(sqlite3.IntegrityError, match="remove turn restrictions"):
        conn.execute("UPDATE road_segments SET v_node_id=3 WHERE id=1")
    conn.rollback()
    conn.close()


def test_failed_migration_rolls_back_and_retains_backup(tmp_path):
    db = tmp_path / "db.sqlite"
    with sqlite3.connect(db) as conn:
        conn.execute("CREATE TABLE old_data (value TEXT)")
        conn.execute("INSERT INTO old_data VALUES ('keep')")
    migration_dir = tmp_path / "migrations"
    migration_dir.mkdir()
    (migration_dir / "003_broken.sql").write_text("CREATE TABLE should_rollback (x INTEGER);\nTHIS IS NOT SQL;\n")
    with sqlite3.connect(db) as conn:
        with pytest.raises(sqlite3.OperationalError):
            apply_migrations(conn, migration_dir)
        assert conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='should_rollback'").fetchone()[0] == 0
        assert conn.execute("SELECT value FROM old_data").fetchone()[0] == "keep"
    assert len(list((tmp_path / "backups").glob("*.sqlite"))) == 1


def test_changed_or_removed_migration_is_rejected(tmp_path):
    db = tmp_path / "db.sqlite"
    migration_dir = tmp_path / "migrations"
    migration_dir.mkdir()
    path = migration_dir / "003_sample.sql"
    path.write_text("CREATE TABLE sample (x INTEGER);\n")
    with sqlite3.connect(db) as conn:
        apply_migrations(conn, migration_dir)
        path.write_text("CREATE TABLE sample (y INTEGER);\n")
        with pytest.raises(RuntimeError, match="history mismatch"):
            apply_migrations(conn, migration_dir)


def test_out_of_order_and_duplicate_versions_are_rejected(tmp_path):
    migration_dir = tmp_path / "migrations"
    migration_dir.mkdir()
    (migration_dir / "004_next.sql").write_text("CREATE TABLE sample (x INTEGER);\n")
    with sqlite3.connect(tmp_path / "db.sqlite") as conn:
        apply_migrations(conn, migration_dir)
        (migration_dir / "003_old.sql").write_text("CREATE TABLE older (x INTEGER);\n")
        with pytest.raises(RuntimeError, match="older migration"):
            apply_migrations(conn, migration_dir)
        (migration_dir / "003_duplicate.sql").write_text("CREATE TABLE duplicate (x INTEGER);\n")
        with pytest.raises(RuntimeError, match="Duplicate"):
            apply_migrations(conn, migration_dir)
