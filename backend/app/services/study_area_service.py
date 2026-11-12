"""Study-area registry service: file/env definitions persisted into the database."""
from __future__ import annotations

import json
import sqlite3
from typing import Any

from ..context import DatasetContext, clear_context_cache, dataset_context
from ..db import utc_now_iso
from ..geo_bbox import bbox_geojson, dataset_bbox
from ..study_areas import StudyArea, get_study_area, list_study_areas, register_study_area


def resolve_study_area(key: str | None, conn: sqlite3.Connection | None = None) -> StudyArea:
    """Resolve a study area by key from the registry, falling back to the database default.

    The JSON/env registry is the source of truth for CRS + generator metadata; rows in the
    ``study_areas`` table record which areas have been used for ingestion and keep the
    provenance of user-registered areas across restarts.
    """
    if key:
        try:
            return get_study_area(key)
        except KeyError:
            pass
        if conn is not None:
            row = conn.execute("SELECT * FROM study_areas WHERE key = ?", (key,)).fetchone()
            if row:
                return _area_from_row(row)
        raise ValueError(f"Unknown study area '{key}'.")
    if conn is not None:
        for area in list_study_areas():
            row = conn.execute(
                "SELECT 1 FROM dataset_sources WHERE study_area_key = ? LIMIT 1", (area.key,)
            ).fetchone()
            if row:
                return area
    return get_study_area(None)


def _area_from_row(row: sqlite3.Row) -> StudyArea:
    boundary = None
    if row["boundary_geometry_json"]:
        try:
            payload = json.loads(row["boundary_geometry_json"])
            bbox = payload.get("bbox") if isinstance(payload, dict) else None
            if bbox and len(bbox) == 4:
                boundary = {
                    "min_lon": float(bbox[0]),
                    "min_lat": float(bbox[1]),
                    "max_lon": float(bbox[2]),
                    "max_lat": float(bbox[3]),
                }
        except (json.JSONDecodeError, TypeError, ValueError):
            boundary = None
    return StudyArea(
        key=str(row["key"]),
        name_en=str(row["name_en"]),
        name_fa=str(row["name_fa"]),
        country_code=str(row["country_code"] or ""),
        canonical_epsg=int(row["canonical_epsg"]),
        center_4326=(float(row["center_lon"]), float(row["center_lat"])),
        boundary_4326=boundary,
        network_source=str(row["network_source"] or "imported"),
        demo=bool(row["is_demo"]),
    )


def upsert_study_area(conn: sqlite3.Connection, raw: dict[str, Any], *, provenance: str = "user") -> StudyArea:
    """Register a study area at runtime (validated, persisted, usable immediately)."""
    area = register_study_area(raw)
    boundary_json = None
    if area.boundary_4326:
        boundary_json = json.dumps(
            {
                "type": "bbox",
                "bbox": [
                    area.boundary_4326["min_lon"],
                    area.boundary_4326["min_lat"],
                    area.boundary_4326["max_lon"],
                    area.boundary_4326["max_lat"],
                ],
            }
        )
    conn.execute(
        """
        INSERT INTO study_areas
        (key, name_en, name_fa, country_code, canonical_epsg, center_lon, center_lat,
         boundary_geometry_json, network_source, is_demo, provenance, created_at_utc)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            name_en=excluded.name_en, name_fa=excluded.name_fa,
            country_code=excluded.country_code, canonical_epsg=excluded.canonical_epsg,
            center_lon=excluded.center_lon, center_lat=excluded.center_lat,
            boundary_geometry_json=excluded.boundary_geometry_json,
            network_source=excluded.network_source, is_demo=excluded.is_demo,
            provenance=excluded.provenance
        """,
        (
            area.key,
            area.name_en,
            area.name_fa,
            area.country_code,
            area.canonical_epsg,
            area.center_4326[0],
            area.center_4326[1],
            boundary_json,
            area.network_source,
            1 if area.demo else 0,
            provenance,
            utc_now_iso(),
        ),
    )
    clear_context_cache()
    return area


def sync_study_areas(conn: sqlite3.Connection) -> int:
    """Persist every file/env study area so the registry survives restarts and is queryable."""
    count = 0
    for area in list_study_areas():
        upsert_study_area(conn, area.to_json(), provenance="file")
        count += 1
    return count


def list_payload(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    usage = {
        row["study_area_key"]: int(row["c"])
        for row in conn.execute(
            "SELECT study_area_key, COUNT(*) AS c FROM dataset_sources GROUP BY study_area_key"
        ).fetchall()
    }
    payload = []
    for area in list_study_areas():
        item = area.to_json()
        item["dataset_count"] = usage.get(area.key, 0)
        payload.append(item)
    return payload


def platform_location_payload(conn: sqlite3.Connection, ctx: DatasetContext) -> dict[str, Any]:
    """Everything the UI needs to frame the map for the active dataset."""
    active_row = conn.execute(
        "SELECT id, study_area_key, boundary_json, name FROM dataset_sources WHERE is_active = 1 "
        "ORDER BY id DESC LIMIT 1"
    ).fetchone()
    ds_id = int(active_row["id"]) if active_row else None
    area = ctx.study_area or (get_study_area(None) if not ctx.study_area_key else None)
    bbox = dataset_bbox(conn, ds_id) if ds_id is not None else None
    if bbox is None and area is not None and area.boundary_4326:
        bbox = dict(area.boundary_4326)
    # Centre follows the data when the dataset has geometry: an imported extract may legitimately
    # sit far outside the study area's nominal centre, and the map must still frame it.
    center = area.center_4326 if area is not None else (51.3890, 35.6892)
    if bbox is not None:
        center = (
            (bbox["min_lon"] + bbox["max_lon"]) / 2.0,
            (bbox["min_lat"] + bbox["max_lat"]) / 2.0,
        )
    label_en = area.label_en if area else "Data-defined study area"
    label_fa = area.label_fa if area else "محدودهٔ تعریف‌شده با داده"
    return {
        "dataset_id": ds_id,
        "study_area_key": ctx.study_area_key or (area.key if area else ""),
        "study_area_name_en": area.name_en if area else "",
        "study_area_name_fa": area.name_fa if area else "",
        "study_area": label_en,
        "study_area_fa": label_fa,
        "center_4326": [center[0], center[1]],
        "network_bbox_4326": bbox,
        "network_bbox_geometry": bbox_geojson(bbox) if bbox else None,
        "canonical_epsg": ctx.canonical_epsg,
        "bounded": ctx.boundary is not None,
        "metadata_source": "dataset" if ds_id is not None else "registry",
    }


def dataset_context_payload(conn: sqlite3.Connection, dataset_id: int | None) -> DatasetContext:
    return dataset_context(conn, dataset_id)
