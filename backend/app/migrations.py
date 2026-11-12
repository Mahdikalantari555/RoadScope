"""Transactional, checksum-verified SQLite migrations with pre-migration backups."""
from __future__ import annotations

import hashlib
import re
import sqlite3
import uuid
from pathlib import Path

from .backup import copy_database


def _statements(script: str):
    buffer = ''
    for line in script.splitlines(keepends=True):
        buffer += line
        if sqlite3.complete_statement(buffer):
            yield buffer
            buffer = ''
    if buffer.strip():
        raise ValueError('Migration ends with an incomplete SQL statement')


def apply_migrations(conn: sqlite3.Connection, migrations_dir: Path) -> list[str]:
    """Apply numbered migrations >=003, atomically per batch.

    The legacy 002 schema is initialized separately. Existing databases are
    copied before upgrades. Scripts must not contain transaction control;
    deployments should stop other writers while upgrading and retain backups.
    """
    if conn.in_transaction:
        raise ValueError('Migrations require a connection without an active transaction')
    files = sorted(path for path in migrations_dir.glob('*.sql') if re.fullmatch(r'\d{3}_[a-zA-Z0-9_]+\.sql', path.name) and int(path.name[:3]) >= 3)
    versions = [int(path.name[:3]) for path in files]
    if len(set(versions)) != len(versions):
        raise RuntimeError('Duplicate migration version')
    checksums = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    registry_exists = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").fetchone()
    applied = dict(conn.execute('SELECT name, sha256 FROM schema_migrations').fetchall()) if registry_exists else {}
    for name, digest in applied.items():
        if name not in checksums or checksums[name] != digest:
            raise RuntimeError(f'Migration history mismatch: {name}')
    pending = [path for path in files if path.name not in applied]
    if applied and pending and int(pending[0].name[:3]) < max(int(name[:3]) for name in applied):
        raise RuntimeError('Cannot apply an older migration after a newer migration')
    if not pending:
        return []

    db_file = next((row[2] for row in conn.execute('PRAGMA database_list') if row[1] == 'main'), '')
    if db_file:
        source = Path(db_file)
        backup_dir = source.parent / 'backups'
        backup_dir.mkdir(parents=True, exist_ok=True)
        copy_database(source, backup_dir / f'{source.stem}-pre-migration-{uuid.uuid4().hex}.sqlite')

    applied_now: list[str] = []
    try:
        conn.execute('BEGIN IMMEDIATE')
        conn.execute('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
        # Recheck under the lock in case another process completed the upgrade.
        current = dict(conn.execute('SELECT name, sha256 FROM schema_migrations').fetchall())
        for name, digest in current.items():
            if name not in checksums or checksums[name] != digest:
                raise RuntimeError(f'Migration history mismatch: {name}')
        for path in files:
            if path.name in current:
                continue
            for statement in _statements(path.read_text(encoding='utf-8')):
                # SQLite prohibits nested BEGIN/COMMIT in this transaction. PRAGMA
                # journal_mode/foreign_keys are not permitted in migration scripts.
                without_comments = re.sub(r'--[^\n]*', '', statement).strip().upper()
                if re.match(r'^(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|PRAGMA)\b', without_comments):
                    raise ValueError(f'Transaction control is not allowed in {path.name}')
                conn.execute(statement)
            conn.execute('INSERT INTO schema_migrations (name, sha256) VALUES (?, ?)', (path.name, checksums[path.name]))
            applied_now.append(path.name)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return applied_now
