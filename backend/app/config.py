from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def setting(name: str, default: str) -> str:
    """RoadScope names take precedence; legacy UAI names remain supported."""
    return os.environ.get(f"ROADSCOPE_{name}", os.environ.get(f"UAI_{name}", default))


_setting = setting

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

SQLITE_DB_PATH = Path(setting("SQLITE_PATH", str(DATA_DIR / "uai.sqlite")))
MIGRATIONS_DIR = PROJECT_ROOT / "migrations"
FRONTEND_DIST_DIR = PROJECT_ROOT / "frontend" / "static_bundle"

CANONICAL_EPSG = int(setting("CANONICAL_EPSG", "3857"))
WEB_EPSG = int(setting("WEB_EPSG", "4326"))
DEFAULT_SEED = int(setting("DEFAULT_SEED", "42"))

# The platform is no longer bound to a single European city. Every dataset carries its own
# metric CRS and its own optional study-area boundary. The canonical projection is chosen per
# study area from `backend/app/study_areas/*.json`; this fallback is a world-wide metric CRS
# (Web Mercator) that is valid at any longitude/latitude, so unrestricted ingestion works even
# before a study area with a local metric CRS is selected.
FALLBACK_CANONICAL_EPSG = CANONICAL_EPSG

# Demo study area used the first time an empty database is initialized.
# It can be replaced at runtime (see `GET/POST /api/v1/study-areas`).
DEFAULT_STUDY_AREA = setting("DEFAULT_STUDY_AREA", "tehran")

# Extra study-area JSON files, either a directory or a comma separated list of *.json paths.
STUDY_AREA_PATHS = setting("STUDY_AREA_PATHS", str(PROJECT_ROOT / "backend" / "app" / "study_areas"))

# Upper bound for a single ingested/imported payload (kilobytes) to keep request bodies bounded.
MAX_IMPORT_BYTES = int(setting("MAX_IMPORT_BYTES", "8000000"))


def extra_study_area_files() -> list[Path]:
    """Resolve the configured study-area extension points (directory or .json list)."""
    raw = STUDY_AREA_PATHS.strip()
    if not raw:
        return []
    candidates: list[Path] = []
    for chunk in raw.split(","):
        entry = Path(chunk.strip()).expanduser()
        if entry.is_dir():
            candidates.extend(sorted(entry.glob("*.json")))
        elif entry.is_file():
            candidates.append(entry)
    return candidates


def dumps(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"))
