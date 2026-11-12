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
from ..crs import (
    compute_sinuosity,
    extract_lixel_linestring,
    interpolate_lrs_point,
    linestring_25832_to_geojson_str,
    polygon_25832_to_geojson_dict,
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


def build_frankfurt_synthetic_network_spec() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Construct a topologically rigorous urban road network in EPSG:25832 (Frankfurt am Main core):
    - Surface urban grid + curved inner ring + parallel Main River quays + 3 river bridges (elevation 0)
    - Grade-separated elevated motorway viaduct crossing OVER surface streets without false nodes (elevation 1)
    """
    # Grid base: X (Easting) 476,600 .. 479,400 (7 columns), Y (Northing) 5,550,600 .. 5,553,100
    # Main River runs W->E between Y=5,551,250 and Y=5,551,430!
    xs = [476600.0, 477080.0, 477550.0, 478020.0, 478490.0, 478960.0, 479420.0]
    # Rows:
    # r0=5550650 (Sachsenhausen South Arterial)
    # r1=5551180 (Schaumainkai South Riverbank Quay)
    # --- MAIN RIVER CHANNEL (Y ~ 5551240 .. 5551430) ---
    # r2=5551500 (Mainkai North Riverbank Quay — parallel to r1 across river!)
    # r3=5551950 (Berliner Strasse / Central Core Arterial)
    # r4=5552450 (Zeil / Anlagenring Inner Ring Boulevard)
    # r5=5552980 (Alleenring North Arterial)
    ys = [5550650.0, 5551180.0, 5551500.0, 5551950.0, 5552450.0, 5552980.0]

    nodes: list[dict[str, Any]] = []
    node_lookup: dict[str, tuple[float, float, int]] = {}

    for r_idx, y in enumerate(ys):
        for c_idx, x in enumerate(xs):
            # Subtle organic urban perturbation (deterministic) so blocks aren't sterile squares
            jx = ((r_idx * 7 + c_idx * 13) % 9 - 4) * 14.0 if r_idx not in (1, 2) else 0.0
            jy = ((r_idx * 11 + c_idx * 5) % 9 - 4) * 12.0 if r_idx not in (1, 2) else 0.0
            nx_m = round(x + jx, 2)
            ny_m = round(y + jy, 2)
            code = f"N_{r_idx}_{c_idx}"
            if r_idx in (1, 2) and c_idx in (1, 3, 5):
                ntype = "bridge_abutment"
            elif r_idx in (0, 3, 5) and c_idx in (1, 3, 5):
                ntype = "signalized_junction"
            elif r_idx == 4 and c_idx in (2, 4):
                ntype = "roundabout"
            else:
                ntype = "uncontrolled_junction"
            nodes.append(
                {
                    "node_code": code,
                    "node_type": ntype,
                    "elevation_level": 0,
                    "x_m": nx_m,
                    "y_m": ny_m,
                }
            )
            node_lookup[code] = (nx_m, ny_m, 0)

    # Add Grade-Separated Elevated Viaduct Nodes (Elevation Level 1)
    # Connects via ramps to N_0_2 (South Interchange) and N_5_2 (North Interchange),
    # flying OVER r1, Main River, r2, r3, and r4 around X ~ 477,590 WITHOUT intersecting them!
    overpass_nodes = [
        ("N_OVP_S", "grade_separated_overpass", 1, 477585.0, 5550950.0),
        ("N_OVP_M", "grade_separated_overpass", 1, 477605.0, 5551970.0),
        ("N_OVP_N", "grade_separated_overpass", 1, 477580.0, 5552700.0),
    ]
    for code, ntype, elev, x_m, y_m in overpass_nodes:
        nodes.append(
            {
                "node_code": code,
                "node_type": ntype,
                "elevation_level": elev,
                "x_m": x_m,
                "y_m": y_m,
            }
        )
        node_lookup[code] = (x_m, y_m, elev)

    edges: list[dict[str, Any]] = []
    e_counter = 1

    def add_edge(
        u_code: str,
        v_code: str,
        name: str,
        road_class: str,
        speed_kmh: int,
        lanes: int,
        aadt: int,
        bulge_m: float = 0.0,
        elev: int = 0,
        slope_pct: float = 0.5,
    ) -> None:
        nonlocal e_counter
        ux, uy, _ = node_lookup[u_code]
        vx, vy, _ = node_lookup[v_code]
        coords = _curved_arc((ux, uy), (vx, vy), bulge_m=bulge_m)
        edges.append(
            {
                "edge_code": f"E_{e_counter:03d}",
                "name": name,
                "u_code": u_code,
                "v_code": v_code,
                "road_class": road_class,
                "speed_limit_kmh": speed_kmh,
                "lanes": lanes,
                "aadt": aadt,
                "elevation_level": elev,
                "slope_pct": slope_pct,
                "coords": coords,
            }
        )
        e_counter += 1

    ew_names = [
        ("Mörfelder Landstraße", "primary_arterial", 50, 4, 24500, 12.0),
        ("Schaumainkai (South Quay)", "secondary_corridor", 40, 2, 13800, -8.0),
        ("Mainkai (North Quay)", "secondary_corridor", 40, 2, 15200, 10.0),
        ("Berliner Straße / Mainzer Landstr.", "primary_arterial", 50, 4, 29400, 6.0),
        ("Anlagenring Boulevard", "secondary_corridor", 50, 3, 19800, 42.0),
        ("Alleenring Nord", "primary_arterial", 60, 4, 33500, -18.0),
    ]

    # East-West Corridors
    for r_idx, (rname, rclass, spd, lanes, base_aadt, bulge) in enumerate(ew_names):
        for c_idx in range(len(xs) - 1):
            u_c = f"N_{r_idx}_{c_idx}"
            v_c = f"N_{r_idx}_{c_idx + 1}"
            seg_bulge = bulge if (c_idx % 2 == 0) else -bulge * 0.7
            seg_aadt = int(base_aadt * (0.88 + 0.06 * min(c_idx, 5 - c_idx)))
            add_edge(
                u_c,
                v_c,
                f"{rname} [{c_idx + 1}]",
                rclass,
                spd,
                lanes,
                seg_aadt,
                bulge_m=seg_bulge,
            )

    # North-South Surface Connections (NOTE: Between r1 and r2 is the MAIN RIVER!
    # Only columns c=1 (Friedensbrücke), c=3 (Untermainbrücke), c=5 (Ignatz-Bubis-Brücke) cross the river!)
    bridge_names = {
        1: "Friedensbrücke",
        3: "Untermainbrücke",
        5: "Ignatz-Bubis-Brücke",
    }
    ns_names = [
        ("Hafenstraße / Gutleut", "collector", 40, 2, 9200),
        ("Stresemannallee / Messe-Achse", "primary_arterial", 50, 4, 26800),
        ("Neue Mainzer Straße", "local_street", 30, 2, 5400),
        ("Eschersheimer / Schweizer Str.", "primary_arterial", 50, 4, 28100),
        ("Fahrgasse / Alte Gasse", "local_street", 30, 1, 4600),
        ("Kurt-Schumacher / Konstabler", "secondary_corridor", 50, 3, 21200),
        ("Ostend / Ratsweg Süd", "collector", 40, 2, 10500),
    ]

    for c_idx, (cname, cclass, spd, lanes, base_aadt) in enumerate(ns_names):
        for r_idx in range(len(ys) - 1):
            # River barrier between r=1 and r=2
            if r_idx == 1 and c_idx not in bridge_names:
                continue
            u_c = f"N_{r_idx}_{c_idx}"
            v_c = f"N_{r_idx + 1}_{c_idx}"
            if r_idx == 1:
                bname = bridge_names[c_idx]
                add_edge(
                    u_c,
                    v_c,
                    bname,
                    "bridge_link",
                    50,
                    4 if c_idx == 1 else 3,
                    int(base_aadt * 1.25),
                    bulge_m=5.0,
                    slope_pct=2.8,
                )
            else:
                add_edge(
                    u_c,
                    v_c,
                    f"{cname} [{r_idx + 1}]",
                    cclass,
                    spd,
                    lanes,
                    int(base_aadt * (0.9 + 0.05 * (r_idx % 3))),
                    bulge_m=8.0 if cclass == "local_street" else 0.0,
                )

    # Diagonal Historic Boulevards (creating realistic 5-leg complex junctions!)
    add_edge("N_2_1", "N_3_2", " Kaiserstraße Diagonal", "secondary_corridor", 40, 2, 16400, bulge_m=15.0)
    add_edge("N_3_3", "N_4_4", "Zeil-Ost Diagonal", "collector", 30, 2, 11900, bulge_m=-20.0)
    add_edge("N_4_1", "N_5_2", "Bockenheimer Landstr.", "secondary_corridor", 50, 3, 18700, bulge_m=18.0)

    # Grade-Separated Elevated Viaduct (Westkreuz / City-Spange Overpass, elevation_level=1)
    # Ramps connect at N_0_2 and N_5_2; middle spans fly OVER surface corridors r1, r2, r3, r4!
    add_edge("N_0_2", "N_OVP_S", "City-Viadukt Ramp Süd", "motorway_overpass", 70, 2, 36200, elev=1, slope_pct=4.2)
    add_edge("N_OVP_S", "N_OVP_M", "City-Viadukt Elevated Span Süd", "motorway_overpass", 80, 4, 44800, bulge_m=22.0, elev=1, slope_pct=0.8)
    add_edge("N_OVP_M", "N_OVP_N", "City-Viadukt Elevated Span Nord", "motorway_overpass", 80, 4, 43900, bulge_m=-18.0, elev=1, slope_pct=0.8)
    add_edge("N_OVP_N", "N_5_2", "City-Viadukt Ramp Nord", "motorway_overpass", 70, 2, 35400, elev=1, slope_pct=-4.1)

    return nodes, edges


def get_study_area_context_geojson() -> dict[str, Any]:
    """
    Generate self-contained cartographic context features in EPSG:4326 (projected from EPSG:25832):
    - Main River hydrographic channel
    - Urban green belt parks (Wallanlagen, Hafenpark, Louisa Park)
    - Metric 500m ETRS89 / UTM 32N coordinate graticule lines
    """
    features: list[dict[str, Any]] = []

    # Main River Polygon (between r1=5551180 and r2=5551500)
    river_north = [
        (476350.0, 5551435.0),
        (477100.0, 5551445.0),
        (477850.0, 5551425.0),
        (478650.0, 5551448.0),
        (479650.0, 5551430.0),
    ]
    river_south = [
        (479650.0, 5551245.0),
        (478650.0, 5551265.0),
        (477850.0, 5551240.0),
        (477100.0, 5551260.0),
        (476350.0, 5551250.0),
    ]
    river_poly = Polygon(river_north + river_south + [river_north[0]])
    features.append(
        {
            "type": "Feature",
            "properties": {"feature_class": "river", "name": "Main River (Bundeswasserstraße)"},
            "geometry": polygon_25832_to_geojson_dict(river_poly),
        }
    )

    # Urban Parks
    parks = [
        (
            "Wallanlagen Inner Greenbelt",
            Polygon([(477350, 5552330), (478650, 5552330), (478650, 5552560), (477350, 5552560)]),
        ),
        (
            "Osthafenpark",
            Polygon([(479020, 5551530), (479520, 5551530), (479520, 5551890), (479020, 5551890)]),
        ),
        (
            "Metzlerpark Museumsufer",
            Polygon([(477620, 5551010), (478320, 5551010), (478320, 5551160), (477620, 5551160)]),
        ),
    ]
    for pname, ppoly in parks:
        features.append(
            {
                "type": "Feature",
                "properties": {"feature_class": "park", "name": pname},
                "geometry": polygon_25832_to_geojson_dict(ppoly),
            }
        )

    # Metric 500m ETRS89 / UTM 32N Graticule Lines
    for x in range(476500, 480000, 500):
        c0 = to_wgs84(x, 5550400)
        c1 = to_wgs84(x, 5553200)
        features.append(
            {
                "type": "Feature",
                "properties": {"feature_class": "graticule", "label": f"E {x:,}m"},
                "geometry": {"type": "LineString", "coordinates": [list(c0), list(c1)]},
            }
        )
    for y in range(5550500, 5553500, 500):
        c0 = to_wgs84(476400, y)
        c1 = to_wgs84(479600, y)
        features.append(
            {
                "type": "Feature",
                "properties": {"feature_class": "graticule", "label": f"N {y:,}m"},
                "geometry": {"type": "LineString", "coordinates": [list(c0), list(c1)]},
            }
        )

    return {"type": "FeatureCollection", "features": features}


def create_network_and_lixels(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    lixel_resolution_m: float = 25.0,
    rng_seed: int = 42,
) -> dict[str, Any]:
    """
    Populate road_nodes, road_segments, traffic_observations, and uniform LRS road_lixels
    for a dataset in canonical EPSG:25832 meters.
    """
    rng = np.random.default_rng(rng_seed)
    nodes_spec, edges_spec = build_frankfurt_synthetic_network_spec()

    # Compute node degrees from edges_spec
    deg_map: dict[str, int] = {n["node_code"]: 0 for n in nodes_spec}
    for e in edges_spec:
        deg_map[e["u_code"]] = deg_map.get(e["u_code"], 0) + 1
        deg_map[e["v_code"]] = deg_map.get(e["v_code"], 0) + 1

    node_code_to_id: dict[str, int] = {}
    for n in nodes_spec:
        lon, lat = to_wgs84(n["x_m"], n["y_m"])
        wkt = f"POINT ({n['x_m']:.3f} {n['y_m']:.3f})"
        cur = conn.execute(
            """
            INSERT INTO road_nodes
            (dataset_id, node_code, node_type, degree, elevation_level, srid, x_m, y_m, lon, lat, wkt_25832)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dataset_id,
                n["node_code"],
                n["node_type"],
                deg_map.get(n["node_code"], 0),
                n["elevation_level"],
                CANONICAL_EPSG,
                n["x_m"],
                n["y_m"],
                lon,
                lat,
                wkt,
            ),
        )
        node_code_to_id[n["node_code"]] = int(cur.lastrowid)

    # Build node graph to compute exact network distance to nearest true junction (degree >= 3)
    g_nodes = nx.Graph()
    segment_records: list[dict[str, Any]] = []
    now = utc_now_iso()

    for idx, e in enumerate(edges_spec):
        line = LineString(e["coords"])
        length_m = round(float(line.length), 3)
        sinuosity = compute_sinuosity(line)
        min_x, min_y, max_x, max_y = line.bounds
        geojson_str = linestring_25832_to_geojson_str(line)
        u_id = node_code_to_id[e["u_code"]]
        v_id = node_code_to_id[e["v_code"]]

        # Simulate realistic partial AADT sensor missingness / imputation on ~14% of local/collector edges
        # so Epic 5 Epistemic Uncertainty & Exposure Coverage layers have authentic empirical contrast!
        has_direct_sensor = not (e["road_class"] in ("local_street", "collector") and (idx % 5 == 0))
        aadt_val = int(e["aadt"] * rng.uniform(0.94, 1.06))
        stored_seg_aadt = aadt_val if has_direct_sensor else None

        cur = conn.execute(
            """
            INSERT INTO road_segments
            (dataset_id, edge_code, name, u_node_id, v_node_id, is_directed, road_class,
             speed_limit_kmh, lanes, length_m, sinuosity, slope_pct, elevation_level, aadt,
             srid, min_x, max_x, min_y, max_y, wkt_25832, geojson_4326)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dataset_id,
                e["edge_code"],
                e["name"],
                u_id,
                v_id,
                e["road_class"],
                e["speed_limit_kmh"],
                e["lanes"],
                length_m,
                sinuosity,
                e["slope_pct"],
                e["elevation_level"],
                stored_seg_aadt,
                CANONICAL_EPSG,
                round(min_x, 3),
                round(max_x, 3),
                round(min_y, 3),
                round(max_y, 3),
                line.wkt,
                geojson_str,
            ),
        )
        seg_id = int(cur.lastrowid)

        # Insert traffic_observations row (imputed with lower confidence when no permanent loop detector)
        mvkt_annual = round((aadt_val * 365.0 * (length_m / 1000.0)) / 1_000_000.0, 5)
        cov_conf = round(float(rng.uniform(0.88, 0.99)) if has_direct_sensor else float(rng.uniform(0.42, 0.58)), 3)
        conn.execute(
            """
            INSERT INTO traffic_observations
            (dataset_id, segment_id, observation_period, aadt_vehicles_per_day, peak_hour_volume,
             avg_speed_kmh, heavy_vehicle_pct, exposure_mvkt_annual, coverage_confidence, is_imputed, observed_at_utc)
            VALUES (?, ?, '2026-Annual', ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dataset_id,
                seg_id,
                aadt_val,
                int(aadt_val * 0.088),
                round(e["speed_limit_kmh"] * float(rng.uniform(0.76, 0.94)), 1),
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
                "elevation_level": e["elevation_level"],
            }
        )

    # Shortest network distance from every node to nearest true surface junction (degree >= 3 and elevation == 0)
    junction_node_ids = [
        node_code_to_id[n["node_code"]]
        for n in nodes_spec
        if deg_map.get(n["node_code"], 0) >= 3 and n["elevation_level"] == 0
    ]
    dist_node_to_junc: dict[int, float] = nx.multi_source_dijkstra_path_length(
        g_nodes, sources=junction_node_ids, weight="weight"
    )

    # Dynamic LRS Lixel Subdivision
    lixel_rows: list[tuple[Any, ...]] = []
    for seg in segment_records:
        L = seg["length_m"]
        n_lix = max(1, int(round(L / lixel_resolution_m)))
        step = L / n_lix
        d_u = dist_node_to_junc.get(seg["u_id"], 500.0)
        d_v = dist_node_to_junc.get(seg["v_id"], 500.0)

        for k in range(n_lix):
            m_start = round(k * step, 4)
            m_end = round(L if k == n_lix - 1 else (k + 1) * step, 4)
            lix_len = round(max(0.1, m_end - m_start), 4)
            m_mid = round(0.5 * (m_start + m_end), 4)

            lix_geom = extract_lixel_linestring(seg["line"], m_start, m_end)
            mid_x, mid_y = interpolate_lrs_point(seg["line"], m_mid)
            mid_lon, mid_lat = to_wgs84(mid_x, mid_y)
            lmin_x, lmin_y, lmax_x, lmax_y = lix_geom.bounds

            # Exact shortest-path network distance from lixel midpoint (e, m_mid) to nearest junction
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
                    CANONICAL_EPSG,
                    mid_x,
                    mid_y,
                    mid_lon,
                    mid_lat,
                    round(lmin_x, 3),
                    round(lmax_x, 3),
                    round(lmin_y, 3),
                    round(lmax_y, 3),
                    lix_geom.wkt,
                    linestring_25832_to_geojson_str(lix_geom),
                )
            )

    conn.executemany(
        """
        INSERT INTO road_lixels
        (dataset_id, parent_segment_id, lixel_index, m_start_m, m_end_m, length_m, midpoint_m,
         dist_to_nearest_junction_m, true_lambda_per_km_yr, srid, mid_x_m, mid_y_m, mid_lon, mid_lat,
         min_x, max_x, min_y, max_y, wkt_25832, geojson_4326)
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
    }


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
               s.elevation_level, s.aadt, s.wkt_25832,
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
            "geom_25832": wkt_loads(r["wkt_25832"]),
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
