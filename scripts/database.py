"""Offline operator tool: backup/restore to a NEW destination (never overwrite)."""
import argparse
from pathlib import Path
from app.migrations import backup_database

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('operation', choices=['backup', 'restore'])
parser.add_argument('source', type=Path)
parser.add_argument('destination', type=Path)
args = parser.parse_args()
backup_database(args.source, args.destination)
print(f'{args.operation}: copied to {args.destination}; run PRAGMA integrity_check before switching paths.')
