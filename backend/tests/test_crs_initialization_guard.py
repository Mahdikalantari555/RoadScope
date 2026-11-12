import os
import sqlite3
import subprocess
import sys
from pathlib import Path


def test_legacy_database_keeps_crs_and_geometry_with_tehran_fallback(tmp_path):
    root = Path(__file__).resolve().parents[2]
    db = tmp_path / 'legacy.sqlite'
    with sqlite3.connect(root / 'data/uai.sqlite') as source, sqlite3.connect(db) as target:
        source.backup(target)
    with sqlite3.connect(db) as conn:
        expected = conn.execute('SELECT id, wkt_25832 FROM road_segments ORDER BY id LIMIT 1').fetchone()
    env = {**os.environ, 'PYTHONPATH': str(root / 'backend'),
           'ROADSCOPE_CANONICAL_EPSG': '32639', 'ROADSCOPE_SQLITE_PATH': str(db)}
    subprocess.run([sys.executable, '-c', 'from app.db import init_schema_and_reference_data; init_schema_and_reference_data()'],
                   env=env, capture_output=True, text=True, check=True)
    with sqlite3.connect(db) as conn:
        assert conn.execute('SELECT id, wkt_m FROM road_segments ORDER BY id LIMIT 1').fetchone() == expected
        assert conn.execute('SELECT crs_epsg FROM dataset_sources ORDER BY id LIMIT 1').fetchone()[0] == 25832
        assert not conn.execute('PRAGMA foreign_key_check').fetchall()
