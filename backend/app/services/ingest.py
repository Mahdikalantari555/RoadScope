"""Versioned, idempotent, provenance-preserving street-network extraction imports.

Two entry points exist and both route through :func:`import_network_extract`:

``import_network_geojson``
    Experimental, documented inline GeoJSON import. Kept for backwards compatibility and used by
    ``POST /api/v1/ingest/network``.

``import_network_extract``
    The controlled OSM import required by ``tehran-synthetic-demo``. It accepts a versioned
    *document* (inline GeoJSON or a local GraphML/GeoJSON path that the operator obtained and
    verified out of band), verifies a SHA-256 checksum, clips to the study-area boundary with an
    explicit buffer, retains source node/way identifiers, oneway direction, bridge/tunnel/layer
    (grade) and records coverage plus ambiguous crossings. It is idempotent: re-importing the same
    checksum into the same dataset returns the previous result and writes nothing.

Remote URLs are never fetched: operators must download, verify and submit the file inline, or
place it on the server filesystem and pass a path that is resolved inside the configured import
directory. Nothing here invents a junction where OSM topology or the grade indicates that roads
merely cross.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
from pathlib import Path
from typing import Any, Iterable

from pyproj import CRS

from ..context import dataset_context
from ..crs import safe_to_metric, transform_coords
from ..db import log_audit_event, utc_now_iso
from .network_generator import (
    detect_topology_ambiguities,
    invalidate_topology_cache,
    persist_network_spec,
)
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

# A lane capacity assumption is *not* a measurement. Imported geometry therefore never receives
# simulated AADT/exposure: `persist_network_spec` only synthesizes traffic for `seeded_demo`.
IMPORT_SOURCE_LABEL = "geojson_import"

_OSM_ONE_WAY_VALUES = {"yes", "true", "1", "y", "-1", "reverse"}


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


def _grade_from_tags(tags: dict[str, Any], road_class: str) -> tuple[int, str]:
    """Derive the analytic elevation level *without* joining at-grade crossings.

    ``bridge``/``tunnel``/``layer`` are the OSM tags that actually describe grade separation. The
    returned ``grade_source`` documents whether the level was observed or assumed.
    """
    bridge = str(tags.get("bridge", "")).strip().lower()
    tunnel = str(tags.get("tunnel", "")).strip().lower()
    layer = tags.get("layer")
    try:
        layer_num = int(float(layer)) if layer not in (None, "") else 0
    except (TypeError, ValueError):
        layer_num = 0
    if tunnel and tunnel not in {"no", "false", "0"}:
        return -1, "osm_tunnel"
    if bridge and bridge not in {"no", "false", "0"}:
        return 1, "osm_bridge"
    if layer_num != 0:
        return (1 if layer_num > 0 else -1), "osm_layer"
    if road_class == "motorway_overpass":
        return 1, "road_class_assumption"
    return 0, "osm_no_grade_tag" if tags else "unknown"


def _hash_document(document: Any) -> str:
    """Canonical checksum over the *content*, independent of dict insertion order."""
    payload = json.dumps(document, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _point_in_boundary(box: dict[str, float] | None, lon: float, lat: float, buffer_m: float = 0.0) -> bool:
    if not box:
        return True
    # A metric buffer is converted to a conservative degree delta at the box latitude.
    pad_lat = buffer_m / 111_320.0 if buffer_m else 0.0
    mid_lat = 0.5 * (box["min_lat"] + box["max_lat"])
    pad_lon = (buffer_m / (111_320.0 * max(0.05, math.cos(math.radians(mid_lat))))) if buffer_m else 0.0
    return (
        (box["min_lon"] - pad_lon) <= lon <= (box["max_lon"] + pad_lon)
        and (box["min_lat"] - pad_lat) <= lat <= (box["max_lat"] + pad_lat)
    )


def _split_at_boundary(
    metric_pts: list[tuple[float, float]],
    epsg: int,
    box: dict[str, float] | None,
    buffer_m: float,
) -> list[list[tuple[float, float]]]:
    """Split a metric polyline into in-boundary pieces instead of dropping whole roads.

    Splitting keeps roads that cross the boundary partially inside the study area, which a
    node-bounded subgraph cannot do. Pieces wholly outside are dropped and counted as excluded.
    """
    if not box:
        return [metric_pts] if len(metric_pts) >= 2 else []
    pieces: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = []
    for x, y in metric_pts:
        lon, lat = _resolve_roundtrip([(x, y)], epsg, 4326)[0]
        inside = _point_in_boundary(box, lon, lat, buffer_m)
        if inside:
            current.append((x, y))
        elif current:
            if len(current) >= 2:
                pieces.append(current)
            current = []
    if len(current) >= 2:
        pieces.append(current)
    return pieces


def _iter_geojson_features(document: dict[str, Any]) -> Iterable[dict[str, Any]]:
    if document.get("type") == "FeatureCollection":
        for feature in document.get("features") or []:
            if isinstance(feature, dict):
                yield feature
    elif document.get("type") == "Feature":
        yield document
    elif document.get("type") in {"LineString", "MultiLineString"}:
        yield {"type": "Feature", "geometry": document, "properties": {}}


def graphml_to_geojson(document: str | dict[str, Any]) -> dict[str, Any]:
    """Convert a GraphML ``key``/``graph`` document into a road GeoJSON FeatureCollection.

    Only the elements needed for a road network are read (``x``/``y`` node attributes and edge
    ``geometry``/``name``/``highway``/``oneway``/``bridge``/``tunnel``/``layer``/``osmid``). Any
    WKT ``LINESTRING`` geometry is used; otherwise the straight node-to-node line is used. The
    declared GraphML CRS must be EPSG:4326 because that is what OSMnx writes.
    """
    import xml.etree.ElementTree as ET

    if isinstance(document, str):
        raw_text = document
    else:  # pragma: no cover - defensive, callers pass text
        raw_text = json.dumps(document)
    root = ET.fromstring(raw_text)
    ns = {"g": "http://graphml.graphdrawing.org/xmlns"}
    keys: dict[str, str] = {}
    for key in root.findall("g:key", ns):
        keys[str(key.get("id"))] = str(key.get("attr.name") or key.get("for") or "")
    graph = root.find("g:graph", ns)
    if graph is None:
        raise ValueError("GraphML payload has no <graph> element")
    nodes: dict[str, tuple[float, float]] = {}
    for node in graph.findall("g:node", ns):
        attrs = {keys.get(str(d.get("key"))): (d.text or "") for d in node.findall("g:data", ns)}
        try:
            nodes[str(node.get("id"))] = (float(attrs["x"]), float(attrs["y"]))
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"GraphML node {node.get('id')!r} has no valid x/y coordinate") from exc
    features: list[dict[str, Any]] = []
    for edge in graph.findall("g:edge", ns):
        data = {keys.get(str(d.get("key"))): (d.text or "") for d in edge.findall("g:data", ns)}
        u, v = str(edge.get("source")), str(edge.get("target"))
        if u not in nodes or v not in nodes:
            continue
        geometry: dict[str, Any] | None = None
        wkt = (data.get("geometry") or "").strip()
        match = re.match(r"^\s*LINESTRING\s*\((.*)\)\s*$", wkt, flags=re.IGNORECASE | re.DOTALL)
        if match:
            coords = []
            for pair in match.group(1).split(","):
                parts = pair.split()
                if len(parts) >= 2:
                    coords.append([float(parts[0]), float(parts[1])])
            if len(coords) >= 2:
                geometry = {"type": "LineString", "coordinates": coords}
        if geometry is None:
            geometry = {"type": "LineString", "coordinates": [list(nodes[u]), list(nodes[v])]}
        properties = {
            "name": data.get("name", ""),
            "name:fa": data.get("name:fa", ""),
            "highway": data.get("highway", ""),
            "oneway": data.get("oneway", ""),
            "bridge": data.get("bridge", ""),
            "tunnel": data.get("tunnel", ""),
            "layer": data.get("layer", ""),
            "lanes": data.get("lanes", ""),
            "maxspeed": data.get("maxspeed", ""),
            "osmid": data.get("osmid", edge.get("id", "")),
            "source_node": u,
            "target_node": v,
        }
        features.append({"type": "Feature", "geometry": geometry, "properties": properties})
    if not features:
        raise ValueError("GraphML payload contains no usable road edges")
    return {
        "type": "FeatureCollection",
        "features": features,
        "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
    }


def _existing_extract(conn: sqlite3.Connection, dataset_id: int, checksum: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM network_extracts WHERE dataset_id = ? AND checksum_sha256 = ?",
        (dataset_id, checksum),
    ).fetchone()


def import_network_extract(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    document: dict[str, Any] | str,
    epsg_in: int = 4326,
    extract_version: str = "",
    source_url: str = "",
    source_attribution: str = "",
    license_text: str = "",
    snapshot_date: str = "",
    boundary_4326: dict[str, float] | None = None,
    buffer_m: float = 0.0,
    lixel_resolution_m: float = 25.0,
    activate: bool = False,
    actor_role: str = "data_steward",
    immutable_checksum: bool = False,
    study_area_key: str | None = None,
) -> dict[str, Any]:
    """Import a versioned street-network extract into an *empty* dataset.

    Returns a report with the extract checksum, counts, coverage diagnostics and ambiguous
    crossings. Re-importing the same checksum is a no-op that returns the stored report (task
    3.1: idempotence). An existing network is never replaced or overwritten (task 1.5/2.1).
    """
    if isinstance(document, str) and document.lstrip().startswith("<"):
        geojson = graphml_to_geojson(document)
        declared_checksum = hashlib.sha256(document.encode("utf-8")).hexdigest()
        extract_format = "graphml"
    elif isinstance(document, str):
        geojson = json.loads(document)
        declared_checksum = _hash_document(geojson)
        extract_format = "geojson"
    else:
        geojson = document
        declared_checksum = _hash_document(geojson)
        extract_format = "geojson"

    if not isinstance(geojson, dict):
        raise ValueError("Extract must be a GeoJSON object or a GraphML document")
    try:
        CRS.from_epsg(int(epsg_in))
    except Exception as exc:  # pragma: no cover - invalid user input
        raise ValueError(f"Unknown input EPSG code {epsg_in}: {exc}") from exc

    target_dataset_id = _idempotent_target(
        conn,
        dataset_id=dataset_id,
        study_area_key=study_area_key,
        checksum=declared_checksum,
    )
    requested_dataset_id = dataset_id
    existing = _existing_extract(conn, target_dataset_id, declared_checksum)
    if existing is not None:
        dataset_id = target_dataset_id
        stored = {
            "dataset_id": dataset_id,
            "status": "unchanged",
            "reused_existing_dataset": target_dataset_id != requested_dataset_id,
            "idempotent": True,
            "extract_format": existing["format"],
            "extract_version": existing["extract_version"],
            "extract_checksum_sha256": declared_checksum,
            "epsg_in": int(existing["epsg_in"]),
            "epsg_out": int(existing["epsg_out"]),
            "feature_count": int(existing["segment_count"]),
            "node_count": int(existing["node_count"]),
            "segment_count": int(existing["segment_count"]),
            "lixel_count": int(existing["lixel_count"]),
            "rejected_count": int(existing["rejected_count"]),
            "ambiguous_crossing_count": int(existing["ambiguous_crossing_count"]),
            "missing_attribute_count": int(existing["missing_attribute_count"]),
            "coverage": json.loads(existing["coverage_json"] or "{}"),
            "provenance": json.loads(existing["provenance_json"] or "{}"),
            "message": "Identical extract already imported; no rows were written.",
        }
        return stored

    has_network = conn.execute(
        "SELECT 1 FROM road_segments WHERE dataset_id = ? LIMIT 1", (dataset_id,)
    ).fetchone()
    has_incidents = conn.execute(
        "SELECT 1 FROM accidents WHERE dataset_id = ? LIMIT 1", (dataset_id,)
    ).fetchone()
    if has_network or has_incidents:
        raise ValueError(
            "Import requires an empty dataset; existing network or incidents are never replaced."
        )

    ctx = dataset_context(conn, dataset_id)
    epsg_out = ctx.canonical_epsg

    features = list(_iter_geojson_features(geojson))
    if not features:
        raise ValueError("GeoJSON must contain a non-empty list of LineString features.")

    nodes_spec: list[dict[str, Any]] = []
    edges_spec: list[dict[str, Any]] = []
    node_index: dict[tuple[float, float, int], str] = {}
    rejected = 0
    outside_boundary = 0
    excluded_edges = 0
    features_without_name = 0
    total_length_m = 0.0
    source_ids: list[str] = []

    def node_for(
        pt: tuple[float, float], elevation_level: int, source_node_id: str = ""
    ) -> str:
        key = (round(pt[0], 3), round(pt[1], 3), elevation_level)
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
                    "source_node_id": source_node_id or code,
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
        if str(props.get("bridge", "")).lower() in {"yes", "viaduct", "true", "1"}:
            road_class = "bridge_link"
        elevation_level, grade_source = _grade_from_tags(tags, road_class)
        name = str(
            props.get("name")
            or props.get("name:fa")
            or props.get("name:en")
            or props.get("road_name")
            or ""
        )[:180]
        if not name:
            features_without_name += 1
            name = f"Imported road {idx + 1}"
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
        oneway_raw = str(props.get("oneway", "")).strip().lower()
        if oneway_raw in _OSM_ONE_WAY_VALUES:
            is_directed = 1
            direction_source = "osm_oneway_reverse" if oneway_raw in {"-1", "reverse"} else "osm_oneway"
        elif oneway_raw in {"no", "false", "0"}:
            is_directed = 0
            direction_source = "osm_bidirectional"
        else:
            is_directed = 0
            direction_source = "assumed_bidirectional"
        source_feature_id = str(props.get("osmid") or props.get("id") or f"FEAT-{idx + 1}")
        source_ids.append(source_feature_id)

        for part in raw_parts:
            pts = _clean_coords(part)
            if len(pts) < 2:
                rejected += 1
                continue
            metric_pts = _resolve_roundtrip(pts, int(epsg_in), epsg_out)
            if any(not (math.isfinite(x) and math.isfinite(y)) for x, y in metric_pts):
                rejected += 1
                continue

            pieces = _split_at_boundary(metric_pts, epsg_out, boundary_4326, buffer_m)
            if not pieces:
                excluded_edges += 1
                outside_boundary += 1
                continue
            if len(pieces) < len(_split_at_boundary(metric_pts, epsg_out, None, 0.0)):
                outside_boundary += 1

            piece_index = 0
            for piece in pieces:
                for start in range(len(piece) - 1):
                    a, b = piece[start], piece[start + 1]
                    seg_len = math.hypot(b[0] - a[0], b[1] - a[1])
                    if seg_len < 0.5:
                        continue
                    u = node_for(a, elevation_level, f"{source_feature_id}:s{start}")
                    v = node_for(b, elevation_level, f"{source_feature_id}:e{start}")
                    total_length_m += seg_len
                    piece_index += 1
                    edges_spec.append(
                        {
                            "edge_code": f"IMP_E{len(edges_spec) + 1}",
                            "name": name,
                            "u_code": u,
                            "v_code": v,
                            "road_class": road_class,
                            "speed_limit_kmh": speed,
                            "lanes": lanes,
                            "aadt": None,
                            "elevation_level": elevation_level,
                            "slope_pct": 0.0,
                            "is_directed": is_directed,
                            "coords": [a, b],
                            "grade_source": grade_source,
                            "direction_source": direction_source,
                            "source_feature_id": f"{source_feature_id}:{piece_index}",
                            "topology_ambiguous": 0,
                        }
                    )

    if not edges_spec:
        raise ValueError("No usable LineString geometry found in the extract after boundary clipping.")

    invalidate_topology_cache(dataset_id)
    stats = persist_network_spec(
        conn,
        dataset_id=dataset_id,
        nodes_spec=nodes_spec,
        edges_spec=edges_spec,
        lixel_resolution_m=lixel_resolution_m,
        rng_seed=42,
        source=IMPORT_SOURCE_LABEL,
        source_version=extract_version or f"extract:{declared_checksum[:12]}",
        attribution=source_attribution,
        license_text=license_text,
        # A road with no name or no observed speed/lane tag is a coverage gap in the source, not
        # an assumption this importer may silently paper over.
        missing_attribute_count=features_without_name,
    )

    now = utc_now_iso()
    if activate:
        conn.execute("UPDATE dataset_sources SET is_active = 0")
    provenance = {
        "extract_version": extract_version or declared_checksum[:12],
        "checksum_sha256": declared_checksum,
        "format": extract_format,
        "source_url": source_url,
        "source_attribution": source_attribution,
        "license": license_text,
        "snapshot_date": snapshot_date,
        "epsg_in": int(epsg_in),
        "epsg_out": epsg_out,
        "buffer_m": float(buffer_m),
        "imported_at_utc": now,
        "incident_provenance": "none (network-only import)",
    }
    conn.execute(
        """
        INSERT INTO network_extracts
        (dataset_id, extract_key, extract_version, format, source_url, source_attribution, license,
         snapshot_date, checksum_sha256, boundary_json, buffer_m, epsg_in, epsg_out, node_count,
         segment_count, lixel_count, rejected_count, ambiguous_crossing_count, missing_attribute_count,
         coverage_json, provenance_json, imported_at_utc)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            dataset_id,
            extract_version or declared_checksum[:12],
            extract_version or declared_checksum[:12],
            extract_format,
            source_url,
            source_attribution,
            license_text,
            snapshot_date,
            declared_checksum,
            json.dumps(boundary_4326 or {}, sort_keys=True),
            float(buffer_m),
            int(epsg_in),
            epsg_out,
            stats["node_count"],
            stats["segment_count"],
            stats["lixel_count"],
            rejected + excluded_edges,
            stats["ambiguous_crossing_count"],
            stats["missing_attribute_count"],
            json.dumps(stats["coverage"], sort_keys=True),
            json.dumps(provenance, sort_keys=True),
            now,
        ),
    )
    conn.execute(
        """
        UPDATE dataset_sources
        SET is_active = ?, lixel_resolution_m = ?, crs_epsg = ?, epsg_definition = ?,
            network_provenance_json = ?, incident_provenance_json = ?, calibration_status = 'uncalibrated'
        WHERE id = ?
        """,
        (
            1 if activate else 0,
            float(lixel_resolution_m),
            epsg_out,
            f"EPSG:{epsg_out}",
            json.dumps(provenance, sort_keys=True),
            json.dumps({"incident_provenance": "none", "synthetic_incidents": False}, sort_keys=True),
            dataset_id,
        ),
    )

    report = {
        "dataset_id": dataset_id,
        "status": "imported",
        "idempotent": False,
        "extract_format": extract_format,
        "extract_version": provenance["extract_version"],
        "extract_checksum_sha256": declared_checksum,
        "epsg_in": int(epsg_in),
        "epsg_out": epsg_out,
        "feature_count": len(features),
        "node_count": stats["node_count"],
        "segment_count": stats["segment_count"],
        "lixel_count": stats["lixel_count"],
        "total_length_km": round(total_length_m / 1000.0, 3),
        "rejected_count": rejected,
        "excluded_outside_boundary": excluded_edges,
        "outside_boundary_vertices": outside_boundary,
        "ambiguous_crossing_count": stats["ambiguous_crossing_count"],
        "ambiguous_crossings": stats["coverage"]["ambiguous_crossings"][:50],
        "missing_attribute_count": stats["missing_attribute_count"],
        "coverage": stats["coverage"],
        "source_feature_ids_sample": source_ids[:20],
        "activated": bool(activate),
        "provenance": provenance,
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
            ctx.study_area_key,
            int(epsg_in),
            len(features),
            rejected + excluded_edges,
            outside_boundary,
            json.dumps(report),
            now,
        ),
    )
    log_audit_event(
        conn,
        actor_user_id=None,
        actor_role=actor_role,
        action_type="IMPORT_NETWORK_EXTRACT",
        entity_type="dataset_sources",
        entity_id=dataset_id,
        after_state={
            "checksum_sha256": declared_checksum,
            "extract_version": provenance["extract_version"],
            "segment_count": stats["segment_count"],
            "ambiguous_crossing_count": stats["ambiguous_crossing_count"],
        },
    )
    return report


def _idempotent_target(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    study_area_key: str | None,
    checksum: str,
) -> int | None:
    """Find the dataset that already holds this checksum.

    Extracts are deduplicated per *study area*, not only per dataset id: importing the same
    verified snapshot twice must not create a second copy of the same network. A caller that
    explicitly targets an existing dataset still gets a no-op report for that dataset.
    """
    if _existing_extract(conn, dataset_id, checksum) is not None:
        return dataset_id
    keys = {study_area_key} if study_area_key else set()
    if not keys:
        keys = {
            str(row["study_area_key"])
            for row in conn.execute(
                "SELECT study_area_key FROM dataset_sources WHERE id = ?", (dataset_id,)
            ).fetchall()
            if row["study_area_key"]
        }
        keys |= {
            str(row["study_area_key"])
            for row in conn.execute(
                "SELECT DISTINCT d.study_area_key FROM network_extracts e "
                "JOIN dataset_sources d ON d.id = e.dataset_id WHERE e.dataset_id = ?",
                (dataset_id,),
            ).fetchall()
            if row["study_area_key"]
        }
    for key in keys:
        row = conn.execute(
            """
            SELECT e.dataset_id FROM network_extracts e
            JOIN dataset_sources d ON d.id = e.dataset_id
            WHERE e.checksum_sha256 = ? AND d.study_area_key = ?
            ORDER BY e.id ASC LIMIT 1
            """,
            (checksum, key),
        ).fetchone()
        if row:
            return int(row["dataset_id"])
    return dataset_id


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
    """Backwards-compatible inline GeoJSON import (delegates to the versioned extract import)."""
    report = import_network_extract(
        conn,
        dataset_id=dataset_id,
        document=geojson,
        epsg_in=epsg_in,
        extract_version=f"inline_geojson:{_hash_document(geojson)[:12]}",
        source_url="inline",
        source_attribution=str(geojson.get("attribution") or ""),
        license_text=str(geojson.get("license") or ""),
        # A legacy inline import is not clipped by default: the caller supplies geometry for the
        # study area it names, and clipping is an explicit option of the versioned extract path.
        boundary_4326=None,
        buffer_m=0.0,
        lixel_resolution_m=lixel_resolution_m,
        activate=activate,
        actor_role=actor_role,
    )
    report["study_area_key"] = study_area_key or dataset_context(conn, dataset_id).study_area_key
    report["coverage"] = report.get("coverage", {})
    report["source_feature_ids_sample"] = report.get("source_feature_ids_sample", [])
    if dataset_name:
        conn.execute("UPDATE dataset_sources SET name = ? WHERE id = ?", (dataset_name, dataset_id))
    if study_area_key:
        conn.execute(
            "UPDATE dataset_sources SET study_area_key = ? WHERE id = ?", (study_area_key, dataset_id)
        )
    return report


def load_extract_document(path: str, *, allowed_dir: Path | None = None, max_bytes: int = 8_000_000) -> str:
    """Read a local extract file for import, refusing traversal outside ``allowed_dir``."""
    candidate = Path(path).expanduser()
    if not candidate.is_absolute() or not candidate.is_file():
        raise ValueError("Extract path must be an existing absolute file path")
    if allowed_dir is not None:
        base = allowed_dir.resolve()
        resolved = candidate.resolve()
        if base != resolved and base not in resolved.parents:
            raise ValueError(f"Extract path must stay inside {base}")
    size = candidate.stat().st_size
    if size <= 0 or size > max_bytes:
        raise ValueError(f"Extract file size {size} bytes is outside the supported range")
    return candidate.read_text(encoding="utf-8")


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
    profile_key: str = "",
) -> dict[str, Any]:
    """Create an empty dataset for any study area (region-agnostic, no seeded network).

    ``profile_key`` defaults to the *process* profile. An imported real network therefore lands in
    the same isolated profile as the running deployment (e.g. ``pilot``), instead of being silently
    stamped ``demo`` and then refused by the pilot's own dataset guard. Synthetic datasets are
    always ``demo``: a synthetic network can never be promoted into a real profile.
    """
    from ..runtime import app_config

    area = resolve_study_area(study_area_key, conn)
    epsg = int(area.canonical_epsg)
    now = utc_now_iso()
    if activate:
        conn.execute("UPDATE dataset_sources SET is_active = 0")
    resolved = (profile_key or ("" if is_synthetic else app_config().PROFILE_KEY) or "demo").strip().lower()
    if is_synthetic:
        resolved = "demo"
    if resolved not in {"demo", "pilot", "legacy"}:
        raise ValueError(f"Unknown profile_key {profile_key!r}")
    profile_key = resolved
    cur = conn.execute(
        """
        INSERT INTO dataset_sources
        (name, scenario_key, is_synthetic, crs_epsg, lixel_resolution_m, study_period_years,
         random_seed, generator_params_json, description, study_area_key, epsg_definition,
         is_active, created_at_utc, profile_key, network_provenance_json, incident_provenance_json,
         calibration_status)
        VALUES (?, ?, ?, ?, ?, 1.0, 42, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uncalibrated')
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
            profile_key,
            json.dumps({"network_source": "not_imported_yet"}),
            json.dumps({"incident_provenance": "none"}),
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
        after_state={"study_area_key": area.key, "crs_epsg": epsg, "profile_key": profile_key},
    )
    return {
        "dataset_id": dataset_id,
        "study_area_key": area.key,
        "crs_epsg": epsg,
        "name": name or f"{area.name_en} (imported)",
        "is_synthetic": is_synthetic,
        "profile_key": profile_key,
    }


def point_is_ingestible(lon: float, lat: float, epsg: int) -> bool:
    return safe_to_metric(lon, lat, epsg) is not None
