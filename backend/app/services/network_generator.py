from __future__ import annotations

import json
import math
import sqlite3
from dataclasses import dataclass
from typing import Any

import networkx as nx
import numpy as np
from scipy.sparse import lil_matrix
from scipy.sparse.csgraph import dijkstra
from shapely.geometry import LineString, Polygon
from shapely.wkt import loads as wkt_loads

from ..config import CANONICAL_EPSG
from ..context import DatasetContext, dataset_context
from ..crs import (
    compute_sinuosity,
    extract_lixel_linestring,
    interpolate_lrs_point,
    linestring_to_geojson_str,
    polygon_to_geojson_dict,
    to_metric,
    to_wgs84,
)
from ..db import utc_now_iso


@dataclass
class LixelNetworkTopology:
    dataset_id: int
    lixel_ids: np.ndarray              # shape (M,)
    parent_segment_ids: np.ndarray     # shape (M,)
    lengths_m: np.ndarray              # shape (M,)
    mid_x_m: np.ndarray                # shape (M,)
    mid_y_m: np.ndarray                # shape (M,)
    m_start_m: np.ndarray              # shape (M,)
    m_end_m: np.ndarray                # shape (M,)
    true_lambda: np.ndarray            # shape (M,)
    dist_net_matrix: np.ndarray        # shape (M, M) shortest-path meters
    lixel_id_to_idx: dict[int, int]
    road_graph: nx.Graph               # Node-edge metric graph G=(V,E)
    node_dist_cache: dict[int, dict[int, float]]
    segment_meta: dict[int, dict[str, Any]]


_TOPOLOGY_CACHE: dict[tuple[int, int], LixelNetworkTopology] = {}


def invalidate_topology_cache(dataset_id: int | None = None) -> None:
    if dataset_id is None:
        _TOPOLOGY_CACHE.clear()
        return
    keys = [k for k in _TOPOLOGY_CACHE if k[0] == dataset_id]
    for k in keys:
        _TOPOLOGY_CACHE.pop(k, None)


def _curved_arc(
    p0: tuple[float, float],
    p1: tuple[float, float],
    bulge_m: float,
    steps: int = 8,
) -> list[tuple[float, float]]:
    """Create smooth multi-vertex metric LineString coordinates with controlled curvature."""
    if abs(bulge_m) < 0.5:
        return [p0, p1]
    dx = p1[0] - p0[0]
    dy = p1[1] - p0[1]
    chord = math.hypot(dx, dy)
    if chord < 1e-6:
        return [p0, p1]
    nx_u = -dy / chord
    ny_u = dx / chord
    pts: list[tuple[float, float]] = []
    for i in range(steps + 1):
        t = i / steps
        offset = bulge_m * math.sin(math.pi * t)
        x = round(p0[0] + t * dx + offset * nx_u, 3)
        y = round(p0[1] + t * dy + offset * ny_u, 3)
        pts.append((x, y))
    return pts


# ---------------------------------------------------------------------------------------------------
# Seeded demo network: Tehran (EPSG:3857 metric, world-valid CRS)
#
# The network is an explicitly labelled synthetic realization used for demonstration and for
# exercising the platform's geometry (river crossings, grade-separated expressway, one-way
# corridors, dense local grid). It is NOT a survey of the real Tehran street network.
# Any other city is supported by importing a GeoJSON road network (see services/ingest.py).
# ---------------------------------------------------------------------------------------------------

TEHRAN_DEMO_ORIGIN_3857 = (5719500.0, 4252000.0)  # metres, near Tehran city centre


def _tehran_nodes_and_edges() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    ox, oy = TEHRAN_DEMO_ORIGIN_3857
    # 6 x 5 lattice of 700 m blocks => ~3.5 km x 2.8 km demo extent.
    xs = [ox + 700.0 * c for c in range(6)]
    ys = [oy + 700.0 * r for r in range(5)]

    nodes: list[dict[str, Any]] = []
    lookup: dict[str, tuple[float, float, int]] = {}

    for r_idx, y in enumerate(ys):
        for c_idx, x in enumerate(xs):
            # deterministic organic jitter so blocks are not sterile squares
            jx = ((r_idx * 7 + c_idx * 13) % 9 - 4) * 9.0
            jy = ((r_idx * 11 + c_idx * 5) % 9 - 4) * 8.0
            if r_idx == 2 and c_idx in (2, 3):   # river valley: keep the quays straight
                jx = jy = 0.0
            px, py = round(x + jx, 2), round(y + jy, 2)
            if r_idx in (2, 3) and c_idx in (1, 4):
                ntype = "bridge_abutment"
            elif r_idx in (0, 2, 4) and c_idx in (1, 3, 5):
                ntype = "signalized_junction"
            elif r_idx == 3 and c_idx in (2, 4):
                ntype = "roundabout"
            else:
                ntype = "uncontrolled_junction"
            code = f"T_{r_idx}_{c_idx}"
            nodes.append({"node_code": code, "node_type": ntype, "elevation_level": 0, "x_m": px, "y_m": py})
            lookup[code] = (px, py, 0)

    # Grade-separated expressway (elevation 1) crossing the surface grid and the river.
    elev_level1 = [
        ("T_EXP_S", "grade_separated_expressway_node", 1, ox + 1750.0, oy - 260.0),
        ("T_EXP_M", "grade_separated_expressway_node", 1, ox + 1780.0, oy + 1400.0),
        ("T_EXP_N", "grade_separated_expressway_node", 1, ox + 1740.0, oy + 3040.0),
    ]
    for code, ntype, elev, x_m, y_m in elev_level1:
        nodes.append({"node_code": code, "node_type": ntype, "elevation_level": elev, "x_m": x_m, "y_m": y_m})
        lookup[code] = (x_m, y_m, elev)

    edges: list[dict[str, Any]] = []
    counter = {"n": 0}

    def add_edge(
        u: str,
        v: str,
        name: str,
        road_class: str,
        speed_kmh: int,
        lanes: int,
        aadt: int,
        bulge_m: float = 0.0,
        elev: int = 0,
        slope_pct: float = 0.4,
        is_directed: int = 0,
    ) -> None:
        counter["n"] += 1
        ux, uy, _ = lookup[u]
        vx, vy, _ = lookup[v]
        coords = _curved_arc((ux, uy), (vx, vy), bulge_m=bulge_m)
        edges.append(
            {
                "edge_code": f"TE_{counter['n']:03d}",
                "name": name,
                "u_code": u,
                "v_code": v,
                "road_class": road_class,
                "speed_limit_kmh": speed_kmh,
                "lanes": lanes,
                "aadt": aadt,
                "elevation_level": elev,
                "slope_pct": slope_pct,
                "is_directed": is_directed,
                "coords": coords,
            }
        )

    # East-west corridors (north to south), named after real Tehran arterials for orientation.
    ew = [
        ("Hemmat Expressway Service Road", "primary_arterial", 60, 4, 31500, -14.0),
        ("Azadi Street", "primary_arterial", 50, 4, 27400, 9.0),
        ("Enghelab Street", "secondary_corridor", 40, 3, 18900, -11.0),
        ("Karimkhan Zand Street", "secondary_corridor", 40, 3, 17200, 13.0),
        ("Shariati Street", "collector", 30, 2, 9600, 0.0),
    ]
    for r_idx, (rname, rclass, spd, lanes, aadt, bulge) in enumerate(ew):
        for c_idx in range(len(xs) - 1):
            add_edge(
                f"T_{r_idx}_{c_idx}",
                f"T_{r_idx}_{c_idx + 1}",
                f"{rname} ({c_idx + 2})",
                rclass,
                spd,
                lanes,
                int(aadt * (0.92 + 0.05 * (c_idx % 3))),
                bulge_m=bulge,
            )

    # North-south corridors, plus a one-way pair to exercise directed topology.
    ns = [
        ("Valiasr Street", "primary_arterial", 50, 4, 28800, 8.0, 0),
        ("Keshavarz Boulevard", "secondary_corridor", 40, 2, 14100, -9.0, 1),
        ("Mofatteh Street", "secondary_corridor", 40, 2, 15300, 12.0, -1),
        ("Nezami Ganjavi Street", "primary_arterial", 50, 3, 19600, -6.0, 0),
        ("Imam Ali Highway Ramp Street", "collector", 30, 2, 8800, 7.0, 0),
        ("Baharestan Local Street", "local_street", 30, 1, 4200, 0.0, 0),
    ]
    for c_idx, (cname, rclass, spd, lanes, aadt, bulge, direction) in enumerate(ns):
        for r_idx in range(len(ys) - 1):
            add_edge(
                f"T_{r_idx}_{c_idx}",
                f"T_{r_idx + 1}_{c_idx}",
                f"{cname} ({r_idx + 2})",
                rclass,
                spd,
                lanes,
                int(aadt * (0.9 + 0.06 * (r_idx % 3))),
                bulge_m=bulge,
                is_directed=1 if direction else 0,
            )

    # River quays (south and north banks) around rows 2 and 3 with three bridges between them.
    for c_idx in range(len(xs) - 1):
        add_edge(
            f"T_2_{c_idx}", f"T_2_{c_idx + 1}",
            f"South Riverbank Quay ({c_idx + 2})", "secondary_corridor", 40, 2, 11200, bulge_m=-6.0,
        )
        add_edge(
            f"T_3_{c_idx}", f"T_3_{c_idx + 1}",
            f"North Riverbank Quay ({c_idx + 2})", "secondary_corridor", 40, 2, 12400, bulge_m=7.0,
        )
    for c_idx, bname in ((1, "Tabiat Crossing"), (2, "Pol-e Sefid Bridge"), (4, "Pol-e Char Bagh Bridge")):
        add_edge(
            f"T_2_{c_idx}", f"T_3_{c_idx}",
            bname, "bridge_link", 40, 2, 16800, bulge_m=4.0,
        )

    # Grade-separated urban expressway with ramps at the south and north ends.
    add_edge("T_0_2", "T_EXP_S", "Sadr Expressway Ramp South", "motorway_overpass", 70, 2, 35100, elev=1, slope_pct=4.0)
    add_edge("T_EXP_S", "T_EXP_M", "Sadr Expressway Elevated Span South", "motorway_overpass", 80, 4, 44200, bulge_m=18.0, elev=1, slope_pct=0.7)
    add_edge("T_EXP_M", "T_EXP_N", "Sadr Expressway Elevated Span North", "motorway_overpass", 80, 4, 43100, bulge_m=-14.0, elev=1, slope_pct=0.7)
    add_edge("T_EXP_N", "T_4_2", "Sadr Expressway Ramp North", "motorway_overpass", 70, 2, 33900, elev=1, slope_pct=-3.8)

    # Diagonal historic boulevards producing realistic 5-leg junctions.
    add_edge("T_0_1", "T_1_2", "Enghelab–Azadi Diagonal", "secondary_corridor", 40, 2, 15200, bulge_m=11.0)
    add_edge("T_1_3", "T_2_4", "Valiasr–Karimkhan Diagonal", "collector", 30, 2, 10400, bulge_m=-13.0)

    return nodes, edges


def build_tehran_demo_network_spec() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Seeded, explicitly synthetic Tehran demo network (metric EPSG:3857)."""
    return _tehran_nodes_and_edges()


NETWORK_GENERATORS = {
    "tehran_demo_v1": build_tehran_demo_network_spec,
}


def generate_synthetic_network(generator_key: str = "tehran_demo_v1"):
    """Return a `(nodes, edges)` spec for a named synthetic network generator.

    The registry keeps synthetic demo networks pluggable: Tehran ships as `tehran_demo_v1`,
    and any other city can be added without touching the ingestion pipeline.
    """
    try:
        factory = NETWORK_GENERATORS[generator_key]
    except KeyError as exc:
        raise ValueError(
            f"Unknown synthetic network generator '{generator_key}'. "
            f"Available: {', '.join(sorted(NETWORK_GENERATORS))}"
        ) from exc
    return factory()


def get_study_area_context_geojson(
    context: DatasetContext | None = None,
    *,
    demo_network: str | None = "tehran_demo_v1",
) -> dict[str, Any]:
    """Self-contained cartographic context: river, parks, and metric graticule.

    The context is derived from the dataset CRS + study-area metadata rather than from a
    hard-coded city, so any study area renders without new code.
    """
    epsg = context.canonical_epsg if context else CANONICAL_EPSG
    area = context.study_area if context else None
    center = area.center_4326 if area else (51.3890, 35.6892)
    cx, cy = to_metric(center[0], center[1], epsg)

    features: list[dict[str, Any]] = []

    if demo_network in NETWORK_GENERATORS:
        ox, oy = TEHRAN_DEMO_ORIGIN_3857
        # River polygon between the demo quay rows (y = oy + 1400 .. oy + 2100).
        river_north = [(ox + 150, oy + 2070), (ox + 1100, oy + 2085), (ox + 2100, oy + 2065), (ox + 3450, oy + 2080)]
        river_south = [(ox + 3450, oy + 1900), (ox + 2100, oy + 1915), (ox + 1100, oy + 1895), (ox + 150, oy + 1905)]
        river_poly = Polygon(river_north + river_south + [river_north[0]])
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "feature_class": "river",
                    "name": "Demo river channel (synthetic geometry)",
                    "is_synthetic": True,
                },
                "geometry": polygon_to_geojson_dict(river_poly, epsg),
            }
        )
        parks = [
            (
                "Demo riverside park (north bank)",
                Polygon([(ox + 700, oy + 2200), (ox + 1700, oy + 2200), (ox + 1700, oy + 2650), (ox + 700, oy + 2650)]),
            ),
            (
                "Demo urban park (south bank)",
                Polygon([(ox + 2300, oy + 980), (ox + 3050, oy + 980), (ox + 3050, oy + 1500), (ox + 2300, oy + 1500)]),
            ),
        ]
        for pname, poly in parks:
            features.append(
                {
                    "type": "Feature",
                    "properties": {"feature_class": "park", "name": pname, "is_synthetic": True},
                    "geometry": polygon_to_geojson_dict(poly, epsg),
                }
            )

    # 500 m metric graticule around the study-area centre (works in any projected CRS).
    gx0 = math.floor((cx - 4000.0) / 500.0) * 500.0
    gy0 = math.floor((cy - 4000.0) / 500.0) * 500.0
    for i in range(17):
        x = gx0 + 500.0 * i
        c0 = to_wgs84(x, gy0, epsg)
        c1 = to_wgs84(x, gy0 + 8000.0, epsg)
        features.append(
            {
                "type": "Feature",
                "properties": {"feature_class": "graticule", "label": f"E {x:,.0f} m"},
                "geometry": {"type": "LineString", "coordinates": [list(c0), list(c1)]},
            }
        )
    for j in range(17):
        y = gy0 + 500.0 * j
        c0 = to_wgs84(gx0, y, epsg)
        c1 = to_wgs84(gx0 + 8000.0, y, epsg)
        features.append(
            {
                "type": "Feature",
                "properties": {"feature_class": "graticule", "label": f"N {y:,.0f} m"},
                "geometry": {"type": "LineString", "coordinates": [list(c0), list(c1)]},
            }
        )

    return {"type": "FeatureCollection", "features": features}


def _dataset_epsg(conn: sqlite3.Connection, dataset_id: int) -> int:
    return dataset_context(conn, dataset_id).canonical_epsg


def persist_network_spec(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    nodes_spec: list[dict[str, Any]],
    edges_spec: list[dict[str, Any]],
    lixel_resolution_m: float = 25.0,
    rng_seed: int = 42,
    source: str = "seeded_demo",
) -> dict[str, Any]:
    """Persist an arbitrary road network (any city, any metric CRS) plus uniform LRS lixels.

    ``nodes_spec``/``edges_spec`` are CRS-neutral: coordinates are metric in the dataset's own
    canonical EPSG, so the same writer serves the seeded demo network, imports from GeoJSON and
    any future data source.
    """
    rng = np.random.default_rng(rng_seed)
    epsg = _dataset_epsg(conn, dataset_id)

    deg_map: dict[str, int] = {n["node_code"]: 0 for n in nodes_spec}
    for e in edges_spec:
        deg_map[e["u_code"]] = deg_map.get(e["u_code"], 0) + 1
        deg_map[e["v_code"]] = deg_map.get(e["v_code"], 0) + 1

    node_code_to_id: dict[str, int] = {}
    for n in nodes_spec:
        lon, lat = to_wgs84(n["x_m"], n["y_m"], epsg)
        wkt = f"POINT ({float(n['x_m']):.3f} {float(n['y_m']):.3f})"
        cur = conn.execute(
            """
            INSERT INTO road_nodes
            (dataset_id, node_code, node_type, degree, elevation_level, srid, x_m, y_m, lon, lat, wkt_m)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dataset_id,
                n["node_code"],
                n["node_type"],
                deg_map.get(n["node_code"], 0),
                int(n.get("elevation_level", 0)),
                epsg,
                float(n["x_m"]),
                float(n["y_m"]),
                lon,
                lat,
                wkt,
            ),
        )
        node_code_to_id[n["node_code"]] = int(cur.lastrowid)

    g_nodes = nx.Graph()
    segment_records: list[dict[str, Any]] = []
    now = utc_now_iso()

    for idx, e in enumerate(edges_spec):
        coords = [(float(x), float(y)) for x, y in e["coords"]]
        if len(coords) < 2:
            continue
        line = LineString(coords)
        length_m = round(float(line.length), 3)
        if length_m <= 0:
            continue
        sinuosity = compute_sinuosity(line)
        min_x, min_y, max_x, max_y = line.bounds
        geojson_str = linestring_to_geojson_str(line, epsg)
        u_id = node_code_to_id[e["u_code"]]
        v_id = node_code_to_id[e["v_code"]]

        # Partial AADT sensor missingness/imputation keeps the epistemic-uncertainty layers
        # empirically contrasted instead of assuming complete exposure coverage.
        has_direct_sensor = not (e["road_class"] in ("local_street", "collector") and (idx % 5 == 0))
        aadt_val = int(float(e.get("aadt") or 8000) * rng.uniform(0.94, 1.06))
        stored_seg_aadt = aadt_val if has_direct_sensor else None

        cur = conn.execute(
            """
            INSERT INTO road_segments
            (dataset_id, edge_code, name, u_node_id, v_node_id, is_directed, road_class,
             speed_limit_kmh, lanes, length_m, sinuosity, slope_pct, elevation_level, aadt,
             srid, min_x, max_x, min_y, max_y, wkt_m, geojson_4326, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dataset_id,
                e["edge_code"],
                e["name"],
                u_id,
                v_id,
                1 if int(e.get("is_directed", 0)) else 0,
                e["road_class"],
                int(e["speed_limit_kmh"]),
                int(e["lanes"]),
                length_m,
                sinuosity,
                float(e.get("slope_pct", 0.0)),
                int(e.get("elevation_level", 0)),
                stored_seg_aadt,
                epsg,
                round(min_x, 3),
                round(max_x, 3),
                round(min_y, 3),
                round(max_y, 3),
                line.wkt,
                geojson_str,
                source,
            ),
        )
        seg_id = int(cur.lastrowid)

        mvkt_annual = round((aadt_val * 365.0 * (length_m / 1000.0)) / 1_000_000.0, 5)
        cov_conf = round(float(rng.uniform(0.88, 0.99)) if has_direct_sensor else float(rng.uniform(0.42, 0.58)), 3)
        conn.execute(
            """
            INSERT INTO traffic_observations
            (dataset_id, segment_id, observation_period, aadt_vehicles_per_day, peak_hour_volume,
             avg_speed_kmh, heavy_vehicle_pct, exposure_mvkt_annual, coverage_confidence, is_imputed, observed_at_utc)
            VALUES (?, ?, 'Annual', ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dataset_id,
                seg_id,
                aadt_val,
                int(aadt_val * 0.088),
                round(float(e["speed_limit_kmh"]) * float(rng.uniform(0.76, 0.94)), 1),
                round(float(rng.uniform(3.0, 14.5)) if e["road_class"] != "local_street" else 1.8, 1),
                mvkt_annual,
                cov_conf,
                0 if has_direct_sensor else 1,
                now,
            ),
        )

        g_nodes.add_edge(u_id, v_id, weight=length_m, segment_id=seg_id)
        segment_records.append(
            {
                "id": seg_id,
                "u_id": u_id,
                "v_id": v_id,
                "line": line,
                "length_m": length_m,
                "elevation_level": int(e.get("elevation_level", 0)),
            }
        )

    junction_node_ids = [
        node_code_to_id[n["node_code"]]
        for n in nodes_spec
        if deg_map.get(n["node_code"], 0) >= 3 and int(n.get("elevation_level", 0)) == 0
    ]
    dist_node_to_junc: dict[int, float] = (
        nx.multi_source_dijkstra_path_length(g_nodes, sources=junction_node_ids, weight="weight")
        if junction_node_ids
        else {}
    )

    lixel_rows: list[tuple[Any, ...]] = []
    for seg in segment_records:
        L = seg["length_m"]
        n_lix = max(1, int(round(L / lixel_resolution_m)))
        step = L / n_lix
        d_u = dist_node_to_junc.get(seg["u_id"], min(500.0, L))
        d_v = dist_node_to_junc.get(seg["v_id"], min(500.0, L))

        for k in range(n_lix):
            m_start = round(k * step, 4)
            m_end = round(L if k == n_lix - 1 else (k + 1) * step, 4)
            lix_len = round(max(0.1, m_end - m_start), 4)
            m_mid = round(0.5 * (m_start + m_end), 4)

            lix_geom = extract_lixel_linestring(seg["line"], m_start, m_end)
            mid_x, mid_y = interpolate_lrs_point(seg["line"], m_mid)
            mid_lon, mid_lat = to_wgs84(mid_x, mid_y, epsg)
            lmin_x, lmin_y, lmax_x, lmax_y = lix_geom.bounds
            d_junc = min(d_u + m_mid, d_v + (L - m_mid))

            lixel_rows.append(
                (
                    dataset_id,
                    seg["id"],
                    k,
                    m_start,
                    m_end,
                    lix_len,
                    m_mid,
                    round(float(d_junc), 3),
                    0.0,
                    epsg,
                    mid_x,
                    mid_y,
                    mid_lon,
                    mid_lat,
                    round(lmin_x, 3),
                    round(lmax_x, 3),
                    round(lmin_y, 3),
                    round(lmax_y, 3),
                    lix_geom.wkt,
                    linestring_to_geojson_str(lix_geom, epsg),
                )
            )

    conn.executemany(
        """
        INSERT INTO road_lixels
        (dataset_id, parent_segment_id, lixel_index, m_start_m, m_end_m, length_m, midpoint_m,
         dist_to_nearest_junction_m, true_lambda_per_km_yr, srid, mid_x_m, mid_y_m, mid_lon, mid_lat,
         min_x, max_x, min_y, max_y, wkt_m, geojson_4326)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        lixel_rows,
    )

    invalidate_topology_cache(dataset_id)
    return {
        "node_count": len(nodes_spec),
        "segment_count": len(segment_records),
        "lixel_count": len(lixel_rows),
        "total_network_length_km": round(sum(s["length_m"] for s in segment_records) / 1000.0, 3),
        "crs_epsg": epsg,
    }


def create_network_and_lixels(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    lixel_resolution_m: float = 25.0,
    rng_seed: int = 42,
    network_generator: str = "tehran_demo_v1",
) -> dict[str, Any]:
    """Populate a dataset's road network from a named seeded generator."""
    builder = NETWORK_GENERATORS.get(network_generator, build_tehran_demo_network_spec)
    nodes_spec, edges_spec = builder()
    return persist_network_spec(
        conn,
        dataset_id=dataset_id,
        nodes_spec=nodes_spec,
        edges_spec=edges_spec,
        lixel_resolution_m=lixel_resolution_m,
        rng_seed=rng_seed,
        source="seeded_demo",
    )


def get_lixel_network_topology(conn: sqlite3.Connection, dataset_id: int) -> LixelNetworkTopology:
    """
    Build (or fetch from cache) the exact metric Lixel Dual Graph G_L and all-pairs
    shortest-path network distance matrix D_net in EPSG:25832 meters.
    """
    lix_count_row = conn.execute(
        "SELECT COUNT(*) AS cnt FROM road_lixels WHERE dataset_id = ?", (dataset_id,)
    ).fetchone()
    lix_cnt = int(lix_count_row["cnt"]) if lix_count_row else 0
    cache_key = (dataset_id, lix_cnt)
    if cache_key in _TOPOLOGY_CACHE:
        return _TOPOLOGY_CACHE[cache_key]

    seg_rows = conn.execute(
        """
        SELECT s.id, s.edge_code, s.name, s.u_node_id, s.v_node_id, s.road_class,
               s.speed_limit_kmh, s.lanes, s.length_m, s.sinuosity, s.slope_pct,
               s.elevation_level, s.aadt, s.wkt_m,
               t.aadt_vehicles_per_day AS obs_aadt, t.exposure_mvkt_annual,
               t.coverage_confidence, t.is_imputed
        FROM road_segments s
        LEFT JOIN traffic_observations t ON t.segment_id = s.id AND t.dataset_id = s.dataset_id
        WHERE s.dataset_id = ?
        ORDER BY s.id
        """,
        (dataset_id,),
    ).fetchall()

    road_graph = nx.Graph()
    segment_meta: dict[int, dict[str, Any]] = {}
    for r in seg_rows:
        sid = int(r["id"])
        u_id = int(r["u_node_id"])
        v_id = int(r["v_node_id"])
        length_m = float(r["length_m"])
        road_graph.add_edge(u_id, v_id, weight=length_m, segment_id=sid)
        segment_meta[sid] = {
            "id": sid,
            "edge_code": r["edge_code"],
            "name": r["name"],
            "u_node_id": u_id,
            "v_node_id": v_id,
            "road_class": r["road_class"],
            "speed_limit_kmh": int(r["speed_limit_kmh"]),
            "lanes": int(r["lanes"]),
            "length_m": length_m,
            "sinuosity": float(r["sinuosity"]),
            "slope_pct": float(r["slope_pct"]),
            "elevation_level": int(r["elevation_level"]),
            "aadt": int(r["aadt"]) if r["aadt"] is not None else None,
            "effective_aadt": int(r["obs_aadt"] or r["aadt"] or 8000),
            "exposure_mvkt_annual": float(r["exposure_mvkt_annual"] or 1.0),
            "coverage_confidence": float(r["coverage_confidence"] or 0.7),
            "is_imputed": bool(r["is_imputed"]),
            "geom_m": wkt_loads(r["wkt_m"]),
        }

    node_dist_cache = dict(nx.all_pairs_dijkstra_path_length(road_graph, weight="weight"))

    lix_rows = conn.execute(
        """
        SELECT id, parent_segment_id, lixel_index, m_start_m, m_end_m, length_m,
               mid_x_m, mid_y_m, true_lambda_per_km_yr
        FROM road_lixels
        WHERE dataset_id = ?
        ORDER BY parent_segment_id, lixel_index
        """,
        (dataset_id,),
    ).fetchall()

    M = len(lix_rows)
    lixel_ids = np.zeros(M, dtype=np.int64)
    parent_segment_ids = np.zeros(M, dtype=np.int64)
    lengths_m = np.zeros(M, dtype=np.float64)
    mid_x_m = np.zeros(M, dtype=np.float64)
    mid_y_m = np.zeros(M, dtype=np.float64)
    m_start_m = np.zeros(M, dtype=np.float64)
    m_end_m = np.zeros(M, dtype=np.float64)
    true_lambda = np.zeros(M, dtype=np.float64)
    lixel_id_to_idx: dict[int, int] = {}

    seg_to_lixel_indices: dict[int, list[int]] = {}
    for idx, r in enumerate(lix_rows):
        lid = int(r["id"])
        sid = int(r["parent_segment_id"])
        lixel_ids[idx] = lid
        parent_segment_ids[idx] = sid
        lengths_m[idx] = float(r["length_m"])
        mid_x_m[idx] = float(r["mid_x_m"])
        mid_y_m[idx] = float(r["mid_y_m"])
        m_start_m[idx] = float(r["m_start_m"])
        m_end_m[idx] = float(r["m_end_m"])
        true_lambda[idx] = float(r["true_lambda_per_km_yr"])
        lixel_id_to_idx[lid] = idx
        seg_to_lixel_indices.setdefault(sid, []).append(idx)

    # Build Lixel Dual Graph adjacency matrix
    adj = lil_matrix((M, M), dtype=np.float64)
    node_incident_lixels: dict[int, list[int]] = {}

    for sid, idxs in seg_to_lixel_indices.items():
        # Connect consecutive lixels along same parent edge
        for k in range(len(idxs) - 1):
            i_a = idxs[k]
            i_b = idxs[k + 1]
            w = 0.5 * (lengths_m[i_a] + lengths_m[i_b])
            adj[i_a, i_b] = w
            adj[i_b, i_a] = w
        # Register boundary lixels at topological endpoint nodes u_node_id and v_node_id
        smeta = segment_meta[sid]
        node_incident_lixels.setdefault(smeta["u_node_id"], []).append(idxs[0])
        node_incident_lixels.setdefault(smeta["v_node_id"], []).append(idxs[-1])

    # Connect boundary lixels that meet at a true shared topological node v in V
    # (Grade-separated crossings DO NOT share a node and therefore never short-circuit!)
    for _nid, inc_idxs in node_incident_lixels.items():
        n_inc = len(inc_idxs)
        for a in range(n_inc):
            for b in range(a + 1, n_inc):
                i_a = inc_idxs[a]
                i_b = inc_idxs[b]
                w = 0.5 * (lengths_m[i_a] + lengths_m[i_b])
                if adj[i_a, i_b] == 0 or w < adj[i_a, i_b]:
                    adj[i_a, i_b] = w
                    adj[i_b, i_a] = w

    dist_net_matrix = dijkstra(adj.tocsr(), directed=False)

    topo = LixelNetworkTopology(
        dataset_id=dataset_id,
        lixel_ids=lixel_ids,
        parent_segment_ids=parent_segment_ids,
        lengths_m=lengths_m,
        mid_x_m=mid_x_m,
        mid_y_m=mid_y_m,
        m_start_m=m_start_m,
        m_end_m=m_end_m,
        true_lambda=true_lambda,
        dist_net_matrix=dist_net_matrix,
        lixel_id_to_idx=lixel_id_to_idx,
        road_graph=road_graph,
        node_dist_cache=node_dist_cache,
        segment_meta=segment_meta,
    )
    _TOPOLOGY_CACHE[cache_key] = topo
    return topo


def exact_network_distance_between_snapped_points(
    topo: LixelNetworkTopology,
    seg_a: int,
    m_a: float,
    seg_b: int,
    m_b: float,
) -> float:
    """
    Compute exact shortest-path network distance in meters between two linear-referenced
    points (seg_a, m_a) and (seg_b, m_b) on G=(V,E).
    """
    meta_a = topo.segment_meta[seg_a]
    meta_b = topo.segment_meta[seg_b]
    L_a = meta_a["length_m"]
    L_b = meta_b["length_m"]
    ua, va = meta_a["u_node_id"], meta_a["v_node_id"]
    ub, vb = meta_b["u_node_id"], meta_b["v_node_id"]

    best = abs(m_a - m_b) if seg_a == seg_b else float("inf")

    candidates = [
        (ua, m_a, ub, m_b),
        (ua, m_a, vb, L_b - m_b),
        (va, L_a - m_a, ub, m_b),
        (va, L_a - m_a, vb, L_b - m_b),
    ]
    for n1, d1, n2, d2 in candidates:
        nd = topo.node_dist_cache.get(n1, {}).get(n2, float("inf"))
        total = d1 + nd + d2
        if total < best:
            best = total
    return float(best)
