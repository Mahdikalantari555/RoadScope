from __future__ import annotations

import json
from functools import lru_cache
from typing import Any, Sequence, Tuple

import numpy as np
from pyproj import Transformer
from shapely import transform as shapely_transform
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, mapping
from shapely.ops import substring

from .config import CANONICAL_EPSG, WEB_EPSG

# ----------------------------------------------------------------------------------------------
# CRS contract (see docs/OPERATIONS.md §1)
#
#   * Metric storage and computation use each dataset's own canonical CRS
#     (`dataset_sources.crs_epsg`): central Tehran EPSG:32639, legacy Frankfurt EPSG:25832.
#   * Exchange and GeoJSON serialization are always EPSG:4326, longitude first (x = lon).
#   * A process-global EPSG is only a fallback for calls that genuinely have no dataset. Routes and
#     services must pass the dataset's EPSG explicitly through `dataset_context()`.
#   * The `*_25832_*` aliases below are retained for import compatibility with the pre-
#     generalization code base. They are *not* EPSG:25832-specific: they forward the caller's
#     canonical EPSG, and no new code should use them.
# ----------------------------------------------------------------------------------------------


@lru_cache(maxsize=64)
def _transformers(canonical_epsg: int) -> tuple[Transformer, Transformer]:
    to_web = Transformer.from_crs(f"EPSG:{canonical_epsg}", f"EPSG:{WEB_EPSG}", always_xy=True)
    to_metric = Transformer.from_crs(f"EPSG:{WEB_EPSG}", f"EPSG:{canonical_epsg}", always_xy=True)
    return to_web, to_metric


def _canonical(canonical_epsg: int | None) -> int:
    return int(canonical_epsg or CANONICAL_EPSG)


def transform_coords(
    coords: Sequence[Tuple[float, float]] | np.ndarray,
    *,
    src_epsg: int,
    dst_epsg: int,
) -> np.ndarray:
    """Transform a sequence of XY coordinates between two EPSG codes."""
    arr = np.asarray([[float(c[0]), float(c[1])] for c in coords], dtype=np.float64)
    return _xy_transform(arr, src_epsg, dst_epsg)


def _xy_transform(arr: np.ndarray, src_epsg: int, dst_epsg: int) -> np.ndarray:
    if src_epsg == dst_epsg:
        return arr
    transformer = Transformer.from_crs(f"EPSG:{src_epsg}", f"EPSG:{dst_epsg}", always_xy=True)
    xs, ys = transformer.transform(arr[:, 0], arr[:, 1])
    return np.column_stack([xs, ys])


def safe_to_metric(lon: float, lat: float, canonical_epsg: int | None = None) -> tuple[float, float] | None:
    """Project WGS84 to the canonical metric CRS; return None when the point is not representable."""
    _, to_metric = _transformers(_canonical(canonical_epsg))
    try:
        x_m, y_m = to_metric.transform(float(lon), float(lat))
    except Exception:
        return None
    if not (np.isfinite(x_m) and np.isfinite(y_m)):
        return None
    return round(float(x_m), 3), round(float(y_m), 3)


def to_wgs84(x_m: float, y_m: float, canonical_epsg: int | None = None) -> Tuple[float, float]:
    """Transform canonical metric (Easting, Northing) -> EPSG:4326 (lon, lat)."""
    to_web, _ = _transformers(_canonical(canonical_epsg))
    lon, lat = to_web.transform(float(x_m), float(y_m))
    return round(float(lon), 7), round(float(lat), 7)


def to_metric(lon: float, lat: float, canonical_epsg: int | None = None) -> Tuple[float, float]:
    """Transform geographic EPSG:4326 (lon, lat) -> canonical metric CRS meters."""
    _, to_metric_t = _transformers(_canonical(canonical_epsg))
    x_m, y_m = to_metric_t.transform(float(lon), float(lat))
    return round(float(x_m), 3), round(float(y_m), 3)


def geom_to_web(geom: Any, canonical_epsg: int | None = None) -> Any:
    """Transform any Shapely geometry from the canonical metric CRS to EPSG:4326 degrees."""
    epsg = _canonical(canonical_epsg)
    if epsg == WEB_EPSG:
        return geom

    def _proj(coords: np.ndarray) -> np.ndarray:
        return _xy_transform(coords, epsg, WEB_EPSG)

    return shapely_transform(geom, _proj)


def geom_to_metric(geom: Any, canonical_epsg: int | None = None) -> Any:
    """Transform any Shapely geometry from EPSG:4326 degrees to the canonical metric CRS."""
    epsg = _canonical(canonical_epsg)
    if epsg == WEB_EPSG:
        return geom

    def _proj(coords: np.ndarray) -> np.ndarray:
        return _xy_transform(coords, WEB_EPSG, epsg)

    return shapely_transform(geom, _proj)


# Backwards-compatible aliases (the platform no longer assumes a single EPSG).
def geom_25832_to_4326(geom: Any, canonical_epsg: int | None = None) -> Any:
    return geom_to_web(geom, canonical_epsg)


def geom_4326_to_25832(geom: Any, canonical_epsg: int | None = None) -> Any:
    return geom_to_metric(geom, canonical_epsg)


def linestring_to_geojson_dict(line: LineString, canonical_epsg: int | None = None) -> dict[str, Any]:
    """Serialize a metric LineString to a GeoJSON geometry dict in EPSG:4326."""
    epsg = _canonical(canonical_epsg)
    coords = np.asarray(line.coords, dtype=np.float64)
    web = _xy_transform(coords, epsg, WEB_EPSG) if epsg != WEB_EPSG else coords
    return {"type": "LineString", "coordinates": [[round(float(x), 7), round(float(y), 7)] for x, y in web]}


def linestring_25832_to_geojson_dict(line_25832: LineString, canonical_epsg: int | None = None) -> dict[str, Any]:
    return linestring_to_geojson_dict(line_25832, canonical_epsg)


def linestring_to_geojson_str(line: LineString, canonical_epsg: int | None = None) -> str:
    return json.dumps(linestring_to_geojson_dict(line, canonical_epsg), separators=(",", ":"))


def linestring_25832_to_geojson_str(line_25832: LineString, canonical_epsg: int | None = None) -> str:
    return linestring_to_geojson_str(line_25832, canonical_epsg)


def polygon_to_geojson_dict(poly: Polygon | MultiPolygon, canonical_epsg: int | None = None) -> dict[str, Any]:
    web = geom_to_web(poly, canonical_epsg)
    raw = mapping(web)
    return json.loads(json.dumps(raw))


def polygon_25832_to_geojson_dict(poly_25832: Polygon | MultiPolygon, canonical_epsg: int | None = None) -> dict[str, Any]:
    return polygon_to_geojson_dict(poly_25832, canonical_epsg)


def metric_circle_geojson_4326(
    x_m: float,
    y_m: float,
    radius_m: float,
    quad_segs: int = 16,
    canonical_epsg: int | None = None,
) -> dict[str, Any]:
    """Generate an exact metric circle in the canonical CRS and project it to EPSG:4326."""
    circle = Point(float(x_m), float(y_m)).buffer(max(1.0, float(radius_m)), quad_segs=quad_segs)
    return polygon_to_geojson_dict(circle, canonical_epsg)


def interpolate_lrs_point(line: LineString, m_offset: float) -> Tuple[float, float]:
    """Evaluate exact LRS point along a metric LineString at arc-length offset m in [0, L]."""
    clamped_m = max(0.0, min(float(m_offset), float(line.length)))
    pt = line.interpolate(clamped_m)
    return round(float(pt.x), 3), round(float(pt.y), 3)


def extract_lixel_linestring(line: LineString, m_start: float, m_end: float) -> LineString:
    """Extract a linearly referenced sub-segment [m_start, m_end] in metric meters."""
    sub = substring(line, float(m_start), float(m_end), normalized=False)
    if isinstance(sub, Point):
        return LineString([(sub.x, sub.y), (sub.x + 0.01, sub.y)])
    return sub


def compute_sinuosity(line: LineString) -> float:
    """Ratio of arc-length to straight-line chord distance (>= 1.0)."""
    coords: Sequence[Tuple[float, float]] = list(line.coords)
    if len(coords) < 2:
        return 1.0
    dx = coords[-1][0] - coords[0][0]
    dy = coords[-1][1] - coords[0][1]
    chord = (dx * dx + dy * dy) ** 0.5
    if chord < 1e-6:
        return 1.0
    return max(1.0, round(float(line.length / chord), 4))
