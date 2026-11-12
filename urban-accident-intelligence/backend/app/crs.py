from __future__ import annotations

import json
from typing import Any, Sequence, Tuple

import numpy as np
from pyproj import Transformer
from shapely import transform as shapely_transform
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, mapping
from shapely.ops import substring

from .config import CANONICAL_EPSG, WEB_EPSG

_TO_WGS84 = Transformer.from_crs(f"EPSG:{CANONICAL_EPSG}", f"EPSG:{WEB_EPSG}", always_xy=True)
_TO_METRIC = Transformer.from_crs(f"EPSG:{WEB_EPSG}", f"EPSG:{CANONICAL_EPSG}", always_xy=True)


def to_wgs84(x_m: float, y_m: float) -> Tuple[float, float]:
    """Transform canonical EPSG:25832 metric (Easting, Northing) -> EPSG:4326 (lon, lat)."""
    lon, lat = _TO_WGS84.transform(float(x_m), float(y_m))
    return round(float(lon), 7), round(float(lat), 7)


def to_metric(lon: float, lat: float) -> Tuple[float, float]:
    """Transform geographic EPSG:4326 (lon, lat) -> canonical EPSG:25832 (Easting, Northing) meters."""
    x_m, y_m = _TO_METRIC.transform(float(lon), float(lat))
    return round(float(x_m), 3), round(float(y_m), 3)


def geom_25832_to_4326(geom: Any) -> Any:
    """Transform any Shapely geometry from EPSG:25832 meters to EPSG:4326 degrees."""
    def _proj(coords: np.ndarray) -> np.ndarray:
        lons, lats = _TO_WGS84.transform(coords[:, 0], coords[:, 1])
        return np.column_stack([lons, lats])
    return shapely_transform(geom, _proj)


def geom_4326_to_25832(geom: Any) -> Any:
    """Transform any Shapely geometry from EPSG:4326 degrees to EPSG:25832 meters."""
    def _proj(coords: np.ndarray) -> np.ndarray:
        xs, ys = _TO_METRIC.transform(coords[:, 0], coords[:, 1])
        return np.column_stack([xs, ys])
    return shapely_transform(geom, _proj)


def linestring_25832_to_geojson_dict(line_25832: LineString) -> dict[str, Any]:
    """Serialize metric LineString to GeoJSON geometry dict in EPSG:4326."""
    coords_4326 = [list(to_wgs84(x, y)) for x, y in line_25832.coords]
    return {"type": "LineString", "coordinates": coords_4326}


def linestring_25832_to_geojson_str(line_25832: LineString) -> str:
    return json.dumps(linestring_25832_to_geojson_dict(line_25832), separators=(",", ":"))


def polygon_25832_to_geojson_dict(poly_25832: Polygon | MultiPolygon) -> dict[str, Any]:
    poly_4326 = geom_25832_to_4326(poly_25832)
    raw = mapping(poly_4326)
    return json.loads(json.dumps(raw))


def metric_circle_geojson_4326(x_m: float, y_m: float, radius_m: float, quad_segs: int = 16) -> dict[str, Any]:
    """Generate an exact metric circle in EPSG:25832 and project to EPSG:4326 polygon."""
    circle_25832 = Point(float(x_m), float(y_m)).buffer(max(1.0, float(radius_m)), quad_segs=quad_segs)
    return polygon_25832_to_geojson_dict(circle_25832)


def interpolate_lrs_point(line_25832: LineString, m_offset: float) -> Tuple[float, float]:
    """Evaluate exact LRS point along metric LineString at arc-length offset m in [0, L]."""
    clamped_m = max(0.0, min(float(m_offset), float(line_25832.length)))
    pt = line_25832.interpolate(clamped_m)
    return round(float(pt.x), 3), round(float(pt.y), 3)


def extract_lixel_linestring(line_25832: LineString, m_start: float, m_end: float) -> LineString:
    """Extract linear referenced sub-segment [m_start, m_end] in EPSG:25832 meters."""
    sub = substring(line_25832, float(m_start), float(m_end), normalized=False)
    if isinstance(sub, Point):
        return LineString([(sub.x, sub.y), (sub.x + 0.01, sub.y)])
    return sub


def compute_sinuosity(line_25832: LineString) -> float:
    """Ratio of arc-length to straight-line chord distance (>= 1.0)."""
    coords: Sequence[Tuple[float, float]] = list(line_25832.coords)
    if len(coords) < 2:
        return 1.0
    dx = coords[-1][0] - coords[0][0]
    dy = coords[-1][1] - coords[0][1]
    chord = (dx * dx + dy * dy) ** 0.5
    if chord < 1e-6:
        return 1.0
    return max(1.0, round(float(line_25832.length / chord), 4))
