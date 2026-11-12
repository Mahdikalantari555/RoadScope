"""Geographic bounding-box helpers used to frame the map without hard-coding a city."""
from __future__ import annotations

import json
import math
import sqlite3
from typing import Any

from .context import dataset_context

WEB_MERCATOR_LIMIT = 85.05112878


def bbox_from_points(points: list[tuple[float, float]]) -> dict[str, float] | None:
    lons = [p[0] for p in points if p and math.isfinite(p[0])]
    lats = [p[1] for p in points if p and math.isfinite(p[1])]
    if not lons or not lats:
        return None
    return {
        "min_lon": round(min(lons), 6),
        "min_lat": round(max(min(lats), -WEB_MERCATOR_LIMIT), 6),
        "max_lon": round(max(lons), 6),
        "max_lat": round(min(max(lats), WEB_MERCATOR_LIMIT), 6),
    }


def bbox_geojson(box: dict[str, float]) -> dict[str, Any]:
    min_lon, min_lat = box["min_lon"], box["min_lat"]
    max_lon, max_lat = box["max_lon"], box["max_lat"]
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [min_lon, min_lat],
                [max_lon, min_lat],
                [max_lon, max_lat],
                [min_lon, max_lat],
                [min_lon, min_lat],
            ]
        ],
    }


def parse_stored_bbox(raw: str | None) -> dict[str, float] | None:
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if isinstance(payload, dict) and payload.get("type") == "bbox":
        box = payload.get("bbox")
        if isinstance(box, list) and len(box) == 4:
            return {
                "min_lon": float(box[0]),
                "min_lat": float(box[1]),
                "max_lon": float(box[2]),
                "max_lat": float(box[3]),
            }
    if isinstance(payload, dict) and {"min_lon", "min_lat", "max_lon", "max_lat"} <= set(payload):
        return {k: float(payload[k]) for k in ("min_lon", "min_lat", "max_lon", "max_lat")}
    return None


def dataset_bbox(conn: sqlite3.Connection, dataset_id: int) -> dict[str, float] | None:
    """Bounding box of the dataset's road network in WGS84 (None for an empty network)."""
    stored = conn.execute(
        "SELECT boundary_json FROM dataset_sources WHERE id = ?", (dataset_id,)
    ).fetchone()
    if stored and stored["boundary_json"]:
        box = parse_stored_bbox(stored["boundary_json"])
        if box:
            return box
    rows = conn.execute(
        "SELECT min(min_x) AS mnx, max(max_x) AS mxx, min(min_y) AS mny, max(max_y) AS mxy "
        "FROM road_segments WHERE dataset_id = ?",
        (dataset_id,),
    ).fetchone()
    if not rows or rows["mnx"] is None:
        return None
    ctx = dataset_context(conn, dataset_id)
    corners = [
        to_wgs84_safe(rows["mnx"], rows["mny"], ctx.canonical_epsg),
        to_wgs84_safe(rows["mxx"], rows["mny"], ctx.canonical_epsg),
        to_wgs84_safe(rows["mxx"], rows["mxy"], ctx.canonical_epsg),
        to_wgs84_safe(rows["mnx"], rows["mxy"], ctx.canonical_epsg),
    ]
    return bbox_from_points([c for c in corners if c is not None])


def to_wgs84_safe(x_m: float, y_m: float, epsg: int) -> tuple[float, float] | None:
    from .crs import to_wgs84

    try:
        lon, lat = to_wgs84(float(x_m), float(y_m), epsg)
    except Exception:
        return None
    if not (math.isfinite(lon) and math.isfinite(lat)):
        return None
    return (lon, lat)


__all__ = [
    "bbox_from_points",
    "bbox_geojson",
    "dataset_bbox",
    "parse_stored_bbox",
    "to_wgs84_safe",
]
