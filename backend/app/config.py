from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field


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

# Fallback metric CRS used only when a dataset row or a study area declares none. Each dataset
# stores its own `crs_epsg`; study areas declare their own (Tehran EPSG:32639, legacy Frankfurt
# EPSG:25832). EPSG:3857 is world-valid, so unrestricted ingestion always has a numeric fallback.
CANONICAL_EPSG = int(setting("CANONICAL_EPSG", "3857"))
WEB_EPSG = int(setting("WEB_EPSG", "4326"))
DEFAULT_SEED = int(setting("DEFAULT_SEED", "42"))

FALLBACK_CANONICAL_EPSG = CANONICAL_EPSG

# Demo study area used the first time an empty database is initialized.
# It can be replaced at runtime (see `GET/POST /api/v1/study-areas`).
DEFAULT_STUDY_AREA = setting("DEFAULT_STUDY_AREA", "tehran")

# ----------------------------------------------------------------------------------------------
# Profile isolation: a synthetic demonstration and a restricted real pilot must never share a
# database. `ROADSCOPE_PROFILE` selects which profile this process serves; `ROADSCOPE_PROFILE_DB`
# optionally pins the database per profile so a single checkout can run both without mixing data.
# ----------------------------------------------------------------------------------------------
PROFILE_KEY = setting("PROFILE", "demo").strip().lower()


def profile_database_path(profile_key: str = "") -> Path | None:
    """Explicit per-profile database override (``ROADSCOPE_PROFILE_DB`` JSON map)."""
    profile = (profile_key or PROFILE_KEY).strip().lower()
    raw = setting("PROFILE_DB", "").strip()
    if not raw:
        return None
    try:
        mapping = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(mapping, dict):
        return None
    value = mapping.get(profile)
    return Path(str(value)).expanduser() if value else None


# Extra study-area JSON files, either a directory or a comma separated list of *.json paths.
STUDY_AREA_PATHS = setting("STUDY_AREA_PATHS", str(PROJECT_ROOT / "backend" / "app" / "study_areas"))

# Upper bound for a single ingested/imported payload (kilobytes) to keep request bodies bounded.
MAX_IMPORT_BYTES = int(setting("MAX_IMPORT_BYTES", "8000000"))

# Optional tile provider configuration. Empty means the documented public OSM raster tiles are
# offered as an opt-in layer; any operator can point this at their own compliant tile service.
BASEMAP_TILE_URL = setting("BASEMAP_TILE_URL", "").strip()
BASEMAP_ATTRIBUTION = setting(
    "BASEMAP_ATTRIBUTION",
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
).strip()
BASEMAP_MAX_ZOOM = int(setting("BASEMAP_MAX_ZOOM", "19"))

# District (coarse cell) size for privacy-reviewed public aggregates. Small cells below
# PUBLIC_AGGREGATE_MIN_CELLS reports are suppressed by the publication service.
PUBLIC_CELL_DEGREES = float(setting("PUBLIC_CELL_DEGREES", "0.005"))
PUBLIC_AGGREGATE_MIN_CELLS = int(setting("PUBLIC_AGGREGATE_MIN_CELLS", "5"))

# Distributed-safe rate limits (database backed, therefore shared by every worker process).
RATE_LIMIT_REPORTS_PER_HOUR = int(setting("RATE_LIMIT_REPORTS_PER_HOUR", "10"))
RATE_LIMIT_TRACKING_PER_MINUTE = int(setting("RATE_LIMIT_TRACKING_PER_MINUTE", "20"))
RATE_LIMIT_MUTATIONS_PER_MINUTE = int(setting("RATE_LIMIT_MUTATIONS_PER_MINUTE", "30"))

# Asia/Tehran is the pilot timezone; naive local timestamps from the intake form are converted
# here. Offsets are resolved with IANA rules (Iran observes no DST since 2022).
PILOT_TIMEZONE = setting("PILOT_TIMEZONE", "Asia/Tehran")


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


class ProfileSettings(BaseModel):
    """Runtime view of the active profile, published by ``GET /api/v1/pilot/status``."""

    profile_key: str = PROFILE_KEY
    allows_real_reports: bool = False
    allows_publication: bool = False
    database_path: str = Field(default="")
    demo_mode: bool = os.getenv("ROADSCOPE_DEMO_MODE", "false").lower() == "true"
