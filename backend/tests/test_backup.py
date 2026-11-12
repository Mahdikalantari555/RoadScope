import sqlite3
from pathlib import Path

import pytest

from app.backup import copy_database


def test_backup_and_restore_preserve_data(tmp_path: Path):
    original, backup, restored = (tmp_path / name for name in ('live.sqlite', 'backup.sqlite', 'restored.sqlite'))
    with sqlite3.connect(original) as conn:
        conn.execute('CREATE TABLE records (value TEXT)')
        conn.execute('INSERT INTO records VALUES (?)', ('safety data',))
    copy_database(original, backup)
    copy_database(backup, restored)
    with sqlite3.connect(restored) as conn:
        assert conn.execute('SELECT value FROM records').fetchone() == ('safety data',)
        assert conn.execute('PRAGMA integrity_check').fetchone() == ('ok',)


def test_backup_refuses_to_overwrite_and_same_path(tmp_path: Path):
    source, target = tmp_path / 'source.sqlite', tmp_path / 'target.sqlite'
    with sqlite3.connect(source) as conn:
        conn.execute('CREATE TABLE t (x INT)')
    target.write_bytes(b'existing data')
    with pytest.raises(FileExistsError):
        copy_database(source, target)
    assert target.read_bytes() == b'existing data'
    with pytest.raises(ValueError):
        copy_database(source, source)


def test_failed_copy_leaves_no_destination(tmp_path: Path):
    source, target = tmp_path / 'not.sqlite', tmp_path / 'copy.sqlite'
    source.write_bytes(b'not a database')
    with pytest.raises(sqlite3.DatabaseError):
        copy_database(source, target)
    assert not target.exists()
    with pytest.raises(FileNotFoundError):
        copy_database(tmp_path / 'missing.sqlite', target)
    assert not target.exists()
