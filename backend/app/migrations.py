"""Ordered SQLite upgrades. Use SQLite backup API before running upgrades."""
from pathlib import Path
import sqlite3
from .config import MIGRATIONS_DIR


def apply_migrations(conn: sqlite3.Connection) -> None:
    conn.execute('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
    for path in sorted(MIGRATIONS_DIR.glob('[0-9][0-9][0-9]_*.sql')):
        if int(path.name[:3]) < 3:
            continue
        if conn.execute('SELECT 1 FROM schema_migrations WHERE version=?', (path.name,)).fetchone():
            continue
        # executescript normally commits first: explicit transaction makes DDL + marker atomic.
        escaped = path.name.replace("'", "''")
        try:
            conn.executescript("BEGIN IMMEDIATE;\n" + path.read_text() + f"\nINSERT INTO schema_migrations(version) VALUES ('{escaped}');\nCOMMIT;")
        except Exception:
            conn.rollback()
            raise


def backup_database(source: Path, destination: Path) -> None:
    if source.resolve() == destination.resolve() or destination.exists():
        raise ValueError('Backup destination must be a new, different file.')
    with sqlite3.connect(f'file:{source}?mode=ro', uri=True) as src, sqlite3.connect(destination) as dst:
        src.backup(dst)
