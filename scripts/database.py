"""Offline operator tool: backup or restore SQLite to a NEW destination (never overwrites)."""
from __future__ import annotations

import argparse
from pathlib import Path

from app.backup import copy_database


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["backup", "restore"])
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    copy_database(args.source, args.destination)
    print(f"{args.operation}: verified integrity and copied to {args.destination}")


if __name__ == "__main__":
    main()
