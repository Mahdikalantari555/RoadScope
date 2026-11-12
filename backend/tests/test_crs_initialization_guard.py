import os
import subprocess
import sys
from pathlib import Path


def test_tehran_crs_cannot_initialize_legacy_database(tmp_path):
    db = tmp_path / 'must-not-be-created.sqlite'
    root = Path(__file__).resolve().parents[2]
    env = {**os.environ, 'PYTHONPATH': str(root / 'backend'),
           'ROADSCOPE_CANONICAL_EPSG': '32639', 'ROADSCOPE_SQLITE_PATH': str(db)}
    result = subprocess.run(
        [sys.executable, '-c', 'from app.db import init_schema_and_reference_data; init_schema_and_reference_data()'],
        env=env, capture_output=True, text=True, check=False,
    )
    assert result.returncode != 0
    assert 'a Tehran EPSG:32639 analytical database is not yet supported' in result.stderr
    assert not db.exists()
