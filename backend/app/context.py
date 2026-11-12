"""Per-dataset spatial context: which metric CRS a dataset uses and where it is.

RoadScope no longer assumes a single city or a single projection. Every function that needs
to transform coordinates resolves a :class:`DatasetContext` from the dataset row, so a
dataset in Tehran, a dataset imported for another country, and the legacy EPSG:25832
datasets can coexist in one database.
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from pyproj import CRS

from .config import CANONICAL_EPSG
from .study_areas import StudyArea, area_bounds, get_study_area


@dataclass(frozen=True)
class DatasetContext:
    dataset_id: int | None
    canonical_epsg: int
    study_area_key: str
    study_area: StudyArea | None = None
    boundary: dict[str, float] | None = None

    @property
    def crs_name(self) -> str:
        try:
            return CRS.from_epsg(self.canonical_epsg).name
        except Exception:  # pragma: no cover
            return f"EPSG:{self.canonical_epsg}"

    def to_json(self) -> dict[str, Any]:
        return {
            "dataset_id": self.dataset_id,
            "canonical_epsg": self.canonical_epsg,
            "canonical_crs": f"EPSG:{self.canonical_epsg}",
            "canonical_crs_name": self.crs_name,
            "study_area_key": self.study_area_key,
            "study_area": self.study_area.to_json() if self.study_area else None,
            "boundary_4326": self.boundary,
            "bounded": self.boundary is not None,
        }


DEFAULT_CONTEXT = DatasetContext(
    dataset_id=None,
    canonical_epsg=CANONICAL_EPSG,
    study_area_key="",
    study_area=None,
    boundary=None,
)


@lru_cache(maxsize=256)
def _context_from_row(dataset_id: int | None, crs_epsg: int, study_area_key: str) -> DatasetContext:
    area: StudyArea | None = None
    try:
        area = get_study_area(study_area_key) if study_area_key else None
    except KeyError:
        area = None
    boundary = area_bounds(area) if area else None
    return DatasetContext(
        dataset_id=dataset_id,
        canonical_epsg=int(crs_epsg),
        study_area_key=study_area_key,
        study_area=area,
        boundary=boundary,
    )


def clear_context_cache() -> None:
    _context_from_row.cache_clear()


def dataset_context(conn: sqlite3.Connection, dataset_id: int | None) -> DatasetContext:
    """Resolve the CRS/study-area context for a dataset (fallback: configured default)."""
    if dataset_id is None:
        row = conn.execute(
            "SELECT id, crs_epsg, study_area_key FROM dataset_sources "
            "WHERE is_active = 1 ORDER BY id DESC LIMIT 1"
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT id, crs_epsg, study_area_key FROM dataset_sources WHERE id = ?",
            (int(dataset_id),),
        ).fetchone()
    if not row:
        return DEFAULT_CONTEXT
    keys = row.keys() if hasattr(row, "keys") else []
    area_key = row["study_area_key"] if "study_area_key" in keys else ""
    return _context_from_row(int(row["id"]), int(row["crs_epsg"] or CANONICAL_EPSG), str(area_key or ""))


def _bbox_contains(box: dict[str, float], lon: float, lat: float) -> bool:
    return (
        box["min_lon"] <= float(lon) <= box["max_lon"]
        and box["min_lat"] <= float(lat) <= box["max_lat"]
    )


def checked_ingest_point(
    ctx: DatasetContext,
    lon: float,
    lat: float,
    *,
    allow_outside_boundary: bool = True,
) -> dict[str, Any]:
    """Validate a geographic ingest point.

    There is no hard geographic rejection anymore: any finite WGS84 point that projects into
    the dataset's metric CRS is accepted. When the study area declares a boundary, a point
    outside it is *flagged* (never dropped) so provenance stays honest.
    """
    lon, lat = float(lon), float(lat)
    if not (-180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
        raise ValueError("Coordinates must be valid WGS84 longitude/latitude degrees.")
    from .crs import safe_to_metric  # local import keeps crs -> context cycle-free

    metric = safe_to_metric(lon, lat, ctx.canonical_epsg)
    if metric is None:
        raise ValueError(
            f"Point ({lon:.6f}, {lat:.6f}) cannot be projected into EPSG:{ctx.canonical_epsg}."
        )
    outside = bool(ctx.boundary) and not _bbox_contains(ctx.boundary, lon, lat)
    if outside and not allow_outside_boundary:
        raise ValueError(
            f"Point ({lon:.6f}, {lat:.6f}) lies outside study area '{ctx.study_area_key}'. "
            "Pass allow_outside_boundary=true to record it with an out-of-area flag."
        )
    return {
        "lon": round(lon, 7),
        "lat": round(lat, 7),
        "x_m": metric[0],
        "y_m": metric[1],
        "srid": ctx.canonical_epsg,
        "study_area_key": ctx.study_area_key,
        "outside_study_area": outside,
    }


def dumps(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"))
