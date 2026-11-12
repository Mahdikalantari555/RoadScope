from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

def _setting(name: str, default: str) -> str:
    """RoadScope names take precedence; legacy UAI names remain supported."""
    return os.environ.get(f"ROADSCOPE_{name}", os.environ.get(f"UAI_{name}", default))


SQLITE_DB_PATH = Path(_setting("SQLITE_PATH", str(DATA_DIR / "uai.sqlite")))
MIGRATIONS_DIR = PROJECT_ROOT / "migrations"
FRONTEND_DIST_DIR = PROJECT_ROOT / "frontend" / "static_bundle"

CANONICAL_EPSG = int(_setting("CANONICAL_EPSG", "25832"))
WEB_EPSG = int(_setting("WEB_EPSG", "4326"))
DEFAULT_SEED = int(_setting("DEFAULT_SEED", "42"))

# Study Area: Frankfurt am Main Urban Core in EPSG:25832 (ETRS89 / UTM Zone 32N, meters)
# Core network spans ~ [476,400 .. 479,600] E, [5,550,400 .. 5,553,400] N
STUDY_MIN_X_M = 475500.0
STUDY_MAX_X_M = 480500.0
STUDY_MIN_Y_M = 5549500.0
STUDY_MAX_Y_M = 5554300.0
