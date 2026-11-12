"""Create consistent SQLite copies without overwriting an existing database.

Both backup and restore are copies: stop writers before restoring and choose a
new destination, then explicitly configure the application to use that file.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
from contextlib import closing
from pathlib import Path


def copy_database(source: Path, destination: Path) -> None:
    source = source.resolve(strict=True)
    if not source.is_file():
        raise ValueError("source must be a database file")
    destination = destination.absolute()
    if source == destination.resolve():
        raise ValueError("source and destination must differ")

    # Reserve the destination exclusively, preventing accidental overwrite and
    # races between concurrent backup processes. SQLite creates its own journals.
    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    try:
        uri = source.as_uri() + "?mode=ro"
        with closing(sqlite3.connect(uri, uri=True)) as src, closing(sqlite3.connect(str(destination))) as dst:
            src.backup(dst)
            result = dst.execute("PRAGMA integrity_check").fetchone()
            if result is None or result[0] != "ok":
                raise ValueError(f"database integrity check failed: {result}")
    except BaseException:
        destination.unlink(missing_ok=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Safely copy a SQLite database for backup or restore; never overwrites the destination."
    )
    parser.add_argument("source", type=Path, help="Existing SQLite database")
    parser.add_argument("destination", type=Path, help="New database path; parent directory must exist")
    args = parser.parse_args()
    copy_database(args.source, args.destination)
    print(f"Verified SQLite copy created: {args.destination}")


if __name__ == "__main__":
    main()
