"""Transactional, checksum-verified SQLite migrations with pre-migration backups."""
from __future__ import annotations

import hashlib
import re
import sqlite3
import uuid
from pathlib import Path

from .backup import copy_database
from .config import MIGRATIONS_DIR

backup_database = copy_database

# Migrations that rebuild referenced tables (SQLite cannot drop CHECK constraints or rename
# columns in place) opt in with this header. They run with foreign keys deferred and
# `legacy_alter_table` ON so that `ALTER TABLE ... RENAME` does not rewrite the references of
# dependent tables, and the whole batch is verified with `PRAGMA foreign_key_check` before the
# transaction is committed.
FOREIGN_KEYS_OFF_HEADER = "-- @foreign-keys-off"


def _statements(script: str):
    buffer = ""
    for line in script.splitlines(keepends=True):
        buffer += line
        if sqlite3.complete_statement(buffer):
            yield buffer
            buffer = ""
    if buffer.strip():
        raise ValueError("Migration ends with an incomplete SQL statement")


def apply_migrations(conn: sqlite3.Connection, migrations_dir: Path | None = None) -> list[str]:
    """Apply numbered migrations >=003, atomically per batch with SHA-256 checksums.

    The legacy 002 schema is initialized separately. Existing databases are
    copied before upgrades. Scripts must not contain transaction control;
    deployments should stop other writers while upgrading and retain backups.
    """
    target_dir = migrations_dir or MIGRATIONS_DIR
    if conn.in_transaction:
        raise ValueError("Migrations require a connection without an active transaction")
    files = sorted(
        path
        for path in target_dir.glob("*.sql")
        if re.fullmatch(r"\d{3}_[a-zA-Z0-9_]+\.sql", path.name) and int(path.name[:3]) >= 3
    )
    versions = [int(path.name[:3]) for path in files]
    if len(set(versions)) != len(versions):
        raise RuntimeError("Duplicate migration version")
    checksums = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    registry_exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
    ).fetchone()
    applied = dict(conn.execute("SELECT name, sha256 FROM schema_migrations").fetchall()) if registry_exists else {}
    for name, digest in applied.items():
        if name not in checksums or checksums[name] != digest:
            raise RuntimeError(f"Migration history mismatch: {name}")
    pending = [path for path in files if path.name not in applied]
    if applied and pending and int(pending[0].name[:3]) < max(int(name[:3]) for name in applied):
        raise RuntimeError("Cannot apply an older migration after a newer migration")
    if not pending:
        return []

    db_file = next((row[2] for row in conn.execute("PRAGMA database_list") if row[1] == "main"), "")
    if db_file:
        source = Path(db_file)
        backup_dir = source.parent / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        copy_database(source, backup_dir / f"{source.stem}-pre-migration-{uuid.uuid4().hex}.sqlite")

    applied_now: list[str] = []
    # `PRAGMA foreign_keys` / `legacy_alter_table` are ignored inside a transaction, so the
    # table-rebuilding migrations need them set before BEGIN and restored afterwards.
    needs_rebuild = any(
        FOREIGN_KEYS_OFF_HEADER in path.read_text(encoding="utf-8") for path in pending
    )
    fk_was_on = bool(conn.execute("PRAGMA foreign_keys").fetchone()[0])
    try:
        if needs_rebuild:
            conn.execute("PRAGMA foreign_keys = OFF")
            conn.execute("PRAGMA legacy_alter_table = ON")
        conn.execute("BEGIN IMMEDIATE")
        if needs_rebuild:
            # With foreign keys disabled, deferred enforcement would be a no-op; instead the
            # batch is validated explicitly by PRAGMA foreign_key_check before COMMIT.
            conn.execute("PRAGMA defer_foreign_keys = ON")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "name TEXT PRIMARY KEY, "
            "sha256 TEXT NOT NULL, "
            "applied_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        )
        current = dict(conn.execute("SELECT name, sha256 FROM schema_migrations").fetchall())
        for name, digest in current.items():
            if name not in checksums or checksums[name] != digest:
                raise RuntimeError(f"Migration history mismatch: {name}")
        for path in files:
            if path.name in current:
                continue
            script = path.read_text(encoding="utf-8")
            rebuilds = FOREIGN_KEYS_OFF_HEADER in script
            for statement in _statements(script):
                without_comments = re.sub(r"--[^\n]*", "", statement).strip().upper()
                if re.match(r"^(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|PRAGMA)\b", without_comments):
                    raise ValueError(f"Transaction control is not allowed in {path.name}")
                conn.execute(statement)
            if rebuilds:
                violations = conn.execute("PRAGMA foreign_key_check").fetchall()
                if violations:
                    raise RuntimeError(
                        f"{path.name} left {len(violations)} dangling foreign key reference(s); rolled back"
                    )
            conn.execute("INSERT INTO schema_migrations (name, sha256) VALUES (?, ?)", (path.name, checksums[path.name]))
            applied_now.append(path.name)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        if needs_rebuild:
            conn.execute("PRAGMA legacy_alter_table = OFF")
            conn.execute(f"PRAGMA foreign_keys = {'ON' if fk_was_on else 'OFF'}")
        else:
            conn.execute(f"PRAGMA foreign_keys = {'ON' if fk_was_on else 'OFF'}")
    return applied_now
