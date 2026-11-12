"""Region-agnostic ingestion: any road network, any metric CRS, any place on Earth.

Two ingestion paths are supported:

``import_network_geojson``
    Accepts a GeoJSON ``FeatureCollection`` of ``LineString`` road features expressed either in
    WGS84 (``EPSG:4326``, the default) or in any EPSG code supplied by the caller. Coordinates are
    projected into the dataset's own canonical metric CRS, so the rest of the platform (lixels,
    NKDE, map matching, Empirical Bayes) works unchanged for a newly added city.

``register_study_area_dataset``
    Creates an empty dataset bound to a study area; reports can then be ingested for that area
    even before a road network exists (they are stored as out-of-network points).
"""
from __future__ import annotations

import json
import math
import sqlite3
from typing import Any

from pyproj import CRS

from ..context import dataset_context
from ..crs import safe_to_metric, transform_coords
from ..db import log_audit_event, utc_now_iso
from .network_generator import invalidate_topology_cache, persist_network_spec
from .study_area_service import resolve_study_area

ROAD_CLASS_ALIASES = {
    "motorway": "motorway_overpass",
    "motorway_link": "motorway_overpass",
    "trunk": "primary_arterial",
    "trunk_link": "primary_arterial",
    "primary": "primary_arterial",
    "primary_link": "primary_arterial",
    "secondary": "secondary_corridor",
    "secondary_link": "secondary_corridor",
    "tertiary": "secondary_corridor",
    "tertiary_link": "secondary_corridor",
    "residential": "local_street",
    "living_street": "local_street",
    "unclassified": "local_street",
    "service": "local_street",
    "pedestrian": "local_street",
    "footway": "local_street",
    "cycleway": "collector",
    "path": "local_street",
    "track": "local_street",
    "busway": "collector",
    "bridge": "bridge_link",
}

DEFAULT_SPEED_BY_CLASS = {
    "motorway_overpass": 80,
    "primary_arterial": 50,
    "bridge_link": 40,
    "secondary_corridor": 40,
    "collector": 30,
    "local_street": 25,
}

DEFAULT_LANES_BY_CLASS = {
    "motorway_overpass": 3,
    "primary_arterial": 3,
    "bridge_link": 2,
    "secondary_corridor": 2,
    "collector": 2,
    "local_street": 1,
}


def normalize_road_class(raw: str | None, *, tags: dict[str, Any] | None = None) -> str:
    text = str(raw or "").strip().lower()
    if text in {
        "motorway_overpass",
        "primary_arterial",
        "secondary_corridor",
        "bridge_link",
        "collector",
        "local_street",
    }:
        return text
    if tags and str(tags.get("bridge", "")).lower() in {"yes", "viaduct", "true", "1"}:
        return "bridge_link"
    return ROAD_CLASS_ALIASES.get(text, "local_street")


def _clean_coords(coords: Any) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for item in coords or []:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        try:
            x, y = float(item[0]), float(item[1])
        except (TypeError, ValueError):
            continue
        if math.isfinite(x) and math.isfinite(y):
            pts.append((x, y))
    return pts


def _resolve_roundtrip(
    pts: list[tuple[float, float]], epsg_in: int, epsg_out: int
) -> list[tuple[float, float]]:
    if epsg_in == epsg_out:
        return pts
    return [tuple(row) for row in transform_coords(pts, src_epsg=epsg_in, dst_epsg=epsg_out)]


def import_network_geojson(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    geojson: dict[str, Any],
    epsg_in: int = 4326,
    lixel_resolution_m: float = 25.0,
    dataset_name: str | None = None,
    study_area_key: str | None = None,
    activate: bool = True,
    actor_role: str = "data_steward",
) -> dict[str, Any]:
    """Import a road network from GeoJSON in any EPSG into the dataset's metric CRS."""
    try:
        CRS.from_epsg(int(epsg_in))
    except Exception as exc:  # pragma: no cover - invalid user input
        raise ValueError(f"Unknown input EPSG code {epsg_in}: {exc}") from exc

    ctx = dataset_context(conn, dataset_id)
    epsg_out = ctx.canonical_epsg

    features = geojson.get("features")
    if features is None and geojson.get("type") == "Feature":
        features = [geojson]
    if not isinstance(features, list) or not features:
        raise ValueError("GeoJSON must contain a non-empty list of LineString features.")

    nodes_spec: list[dict[str, Any]] = []
    edges_spec: list[dict[str, Any]] = []
    node_index: dict[tuple[float, float], str] = {}
    rejected = 0
    outside_boundary = 0
    length_m_total = 0.0

    def node_for(pt: tuple[float, float], elevation_level: int) -> str:
        key = (round(pt[0], 3), round(pt[1], 3))
        code = node_index.get(key)
        if code is None:
            code = f"IMP_{len(nodes_spec) + 1}"
            node_index[key] = code
            nodes_spec.append(
                {
                    "node_code": code,
                    "node_type": "imported_junction",
                    "elevation_level": elevation_level,
                    "x_m": key[0],
                    "y_m": key[1],
                }
            )
        return code

    for idx, feature in enumerate(features):
        if not isinstance(feature, dict):
            rejected += 1
            continue
        geom = feature.get("geometry") or {}
        props = feature.get("properties") or {}
        gtype = geom.get("type")
        if gtype == "MultiLineString":
            raw_parts = geom.get("coordinates") or []
        elif gtype == "LineString":
            raw_parts = [geom.get("coordinates") or []]
        else:
            rejected += 1
            continue

        tags = props.get("tags") if isinstance(props.get("tags"), dict) else props
        road_class = normalize_road_class(props.get("road_class") or props.get("highway"), tags=tags)
        elevation_level = 1 if road_class == "motorway_overpass" else 0
        name = str(
            props.get("name")
            or props.get("name:fa")
            or props.get("name:en")
            or props.get("road_name")
            or f"Imported road {idx + 1}"
        )[:180]
        is_bridge = str(props.get("bridge", "")).lower() in {"yes", "viaduct", "true", "1"}
        if is_bridge and road_class != "bridge_link":
            road_class = "bridge_link"
        try:
            speed = int(props.get("speed_limit_kmh") or DEFAULT_SPEED_BY_CLASS.get(road_class, 40))
        except (TypeError, ValueError):
            speed = DEFAULT_SPEED_BY_CLASS.get(road_class, 40)
        speed = max(10, min(160, speed))
        try:
            lanes = int(props.get("lanes") or DEFAULT_LANES_BY_CLASS.get(road_class, 2))
        except (TypeError, ValueError):
            lanes = DEFAULT_LANES_BY_CLASS.get(road_class, 2)
        lanes = max(1, min(8, lanes))
        aadt = props.get("aadt")
        try:
            aadt = int(aadt) if aadt is not None else int(6000 + (idx % 7) * 2600)
        except (TypeError, ValueError):
            aadt = 9000
        is_directed = 1 if str(props.get("oneway", "")).lower() in {"yes", "true", "1", "-1"} else 0

        for part in raw_parts:
            pts = _clean_coords(part)
            if len(pts) < 2:
                rejected += 1
                continue
            metric_pts = _resolve_roundtrip(pts, int(epsg_in), epsg_out)
            if epsg_out != 4326:
                # Track out-of-boundary ingestion for provenance (never rejects).
                if ctx.boundary:
                    for x, y in metric_pts[:: max(1, len(metric_pts) // 4)]:
                        lonlat = _resolve_roundtrip([(x, y)], epsg_out, 4326)[0]
                        if not (
                            ctx.boundary["min_lon"] <= lonlat[0] <= ctx.boundary["max_lon"]
                            and ctx.boundary["min_lat"] <= lonlat[1] <= ctx.boundary["max_lat"]
                        ):
                            outside_boundary += 1
            if any(not (math.isfinite(x) and math.isfinite(y)) for x, y in metric_pts):
                rejected += 1
                continue

            for start in range(len(metric_pts) - 1):
                a, b = metric_pts[start], metric_pts[start + 1]
                seg_len = math.hypot(b[0] - a[0], b[1] - a[1])
                if seg_len < 0.5:
                    continue
                u = node_for(a, elevation_level)
                v = node_for(b, elevation_level)
                length_m_total += seg_len
                edges_spec.append(
                    {
                        "edge_code": f"IMP_E{len(edges_spec) + 1}",
                        "name": name,
                        "u_code": u,
                        "v_code": v,
                        "road_class": road_class,
                        "speed_limit_kmh": speed,
                        "lanes": lanes,
                        "aadt": aadt,
                        "elevation_level": elevation_level,
                        "slope_pct": 0.0,
                        "is_directed": is_directed,
                        "coords": [a, b],
                    }
                )

    if not edges_spec:
        raise ValueError("No usable LineString geometry found in the GeoJSON payload.")

    # Remove any previously generated network for this dataset before (re-)importing.
    conn.execute("DELETE FROM road_segments WHERE dataset_id = ?", (dataset_id,))
    conn.execute("DELETE FROM road_nodes WHERE dataset_id = ?", (dataset_id,))
    invalidate_topology_cache(dataset_id)

    stats = persist_network_spec(
        conn,
        dataset_id=dataset_id,
        nodes_spec=nodes_spec,
        edges_spec=edges_spec,
        lixel_resolution_m=lixel_resolution_m,
        rng_seed=42,
        source="geojson_import",
    )

    now = utc_now_iso()
    if activate:
        conn.execute("UPDATE dataset_sources SET is_active = 0")
    conn.execute(
        """
        UPDATE dataset_sources
        SET is_active = ?, lixel_resolution_m = ?, name = COALESCE(?, name),
            study_area_key = COALESCE(?, study_area_key), crs_epsg = ?, epsg_definition = ?
        WHERE id = ?
        """,
        (
            1 if activate else 0,
            float(lixel_resolution_m),
            dataset_name,
            study_area_key,
            epsg_out,
            f"EPSG:{epsg_out}",
            dataset_id,
        ),
    )
    report = {
        "epsg_in": int(epsg_in),
        "epsg_out": epsg_out,
        "feature_count": len(features),
        "segment_count": stats["segment_count"],
        "node_count": stats["node_count"],
        "lixel_count": stats["lixel_count"],
        "total_length_km": round(length_m_total / 1000.0, 3),
        "rejected_count": rejected,
        "outside_boundary_vertices": outside_boundary,
        "study_area_key": study_area_key or ctx.study_area_key,
        "activated": bool(activate),
        "status": "imported",
    }
    conn.execute(
        """
        INSERT INTO ingestion_events
        (dataset_id, source_type, study_area_key, epsg_in, feature_count, rejected_count,
         outside_boundary_count, report_json, created_at_utc)
        VALUES (?, 'geojson_network', ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            dataset_id,
            report["study_area_key"],
            int(epsg_in),
            len(features),
            rejected,
            outside_boundary,
            json.dumps(report),
            now,
        ),
    )
    log_audit_event(
        conn,
        actor_user_id=None,
        actor_role=actor_role,
        action_type="IMPORT_NETWORK_GEOJSON",
        entity_type="dataset_sources",
        entity_id=dataset_id,
        after_state=report,
    )
    return {"dataset_id": dataset_id, **report}


def create_dataset_for_study_area(
    conn: sqlite3.Connection,
    *,
    study_area_key: str,
    name: str | None = None,
    description: str = "",
    lixel_resolution_m: float = 25.0,
    is_synthetic: bool = False,
    scenario_key: str = "IMPORTED_NETWORK",
    activate: bool = True,
    actor_role: str = "data_steward",
) -> dict[str, Any]:
    """Create an empty dataset for any study area (region-agnostic, no seeded network)."""
    area = resolve_study_area(study_area_key, conn)
    epsg = int(area.canonical_epsg)
    now = utc_now_iso()
    if activate:
        conn.execute("UPDATE dataset_sources SET is_active = 0")
    cur = conn.execute(
        """
        INSERT INTO dataset_sources
        (name, scenario_key, is_synthetic, crs_epsg, lixel_resolution_m, study_period_years,
         random_seed, generator_params_json, description, study_area_key, epsg_definition,
         is_active, created_at_utc)
        VALUES (?, ?, ?, ?, ?, 1.0, 42, ?, ?, ?, ?, ?, ?)
        """,
        (
            name or f"{area.name_en} (imported)",
            scenario_key,
            1 if is_synthetic else 0,
            epsg,
            float(lixel_resolution_m),
            json.dumps({"study_area_key": area.key, "source": "import"}),
            description or f"Dataset for study area {area.name_en}",
            area.key,
            f"EPSG:{epsg}",
            1 if activate else 0,
            now,
        ),
    )
    dataset_id = int(cur.lastrowid)
    log_audit_event(
        conn,
        actor_user_id=None,
        actor_role=actor_role,
        action_type="CREATE_STUDY_AREA_DATASET",
        entity_type="dataset_sources",
        entity_id=dataset_id,
        after_state={"study_area_key": area.key, "crs_epsg": epsg},
    )
    return {
        "dataset_id": dataset_id,
        "study_area_key": area.key,
        "crs_epsg": epsg,
        "name": name or f"{area.name_en} (imported)",
        "is_synthetic": is_synthetic,
    }


def point_is_ingestible(lon: float, lat: float, epsg: int) -> bool:
    return safe_to_metric(lon, lat, epsg) is not None
