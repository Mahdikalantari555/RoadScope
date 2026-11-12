"""Versioned street-network extract import: idempotence, topology, provenance, safety.

Fixtures are tiny, redistributable, OSM-*like* documents (no real OSM data is committed). They
exercise at-grade junctions, a grade-separated crossing, a disconnected segment, missing
attributes and invalid payloads.
"""
from __future__ import annotations

import importlib
import json
import math
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client() -> TestClient:
    with tempfile.TemporaryDirectory(prefix="roadscope_extract_test_") as tmp_dir:
        db_file = Path(tmp_dir) / "test.sqlite"
        env = pytest.MonkeyPatch()
        env.setenv("ROADSCOPE_DEMO_MODE", "false")
        env.setenv("ROADSCOPE_API_TOKENS", json.dumps({"test-steward": "steward_lead"}))
        env.setenv("ROADSCOPE_SQLITE_PATH", str(db_file))
        env.setenv("UAI_SQLITE_PATH", str(db_file))
        env.setenv("ROADSCOPE_DEFAULT_STUDY_AREA", "tehran")
        env.setenv("ROADSCOPE_DEFAULT_SEED", "42")

        import app.config as cfg
        import app.db as db_mod
        import app.main as main_mod

        try:
            importlib.reload(cfg)
            importlib.reload(db_mod)
            importlib.reload(main_mod)
            with TestClient(main_mod.app, headers={"Authorization": "Bearer test-steward"}) as c:
                yield c
        finally:
            env.undo()
            importlib.reload(cfg)
            importlib.reload(db_mod)
            importlib.reload(main_mod)


def _feature(coords, **props):
    return {
        "type": "Feature",
        "properties": props,
        "geometry": {"type": "LineString", "coordinates": coords},
    }


# A 3x3 lattice of tiny streets plus a bridge above one of them and an isolated segment.
# Coordinates are WGS84 (longitude, latitude) inside the recorded central-Tehran boundary.
def osm_like_extract() -> dict:
    base_lon, base_lat = 51.3950, 35.6950
    step = 0.0020
    features = []
    for row in range(3):
        features.append(
            _feature(
                [[base_lon + col * step, base_lat + row * step] for col in range(3)],
                **{"highway": "primary", "name": f"Avenue {row + 1}", "osmid": f"way-1{row}"},
            )
        )
    for col in range(3):
        features.append(
            _feature(
                [[base_lon + col * step, base_lat + row * step] for row in range(3)],
                **{"highway": "residential", "name": f"Street {col + 1}", "osmid": f"way-2{col}"},
            )
        )
    # Grade-separated crossing: a bridge whose geometry crosses "Avenue 2" at an interior point
    # but shares no node with it. The importer must not fabricate a junction.
    features.append(
        _feature(
            [
                [base_lon - 0.0010, base_lat + 0.0020],
                [base_lon + 0.0030, base_lat + 0.0020],
            ],
            **{
                "highway": "motorway",
                "name": "Elevated Crossing",
                "bridge": "yes",
                "layer": "1",
                "osmid": "way-90",
            },
        )
    )
    # A disconnected segment far to the east (no shared node with the lattice).
    features.append(
        _feature(
            [
                [base_lon + 0.0080, base_lat + 0.0080],
                [base_lon + 0.0090, base_lat + 0.0080],
            ],
            **{"highway": "service", "name": "", "osmid": "way-91"},
        )
    )
    # A one-way street to exercise direction preservation.
    features.append(
        _feature(
            [
                [base_lon + 0.0005, base_lat - 0.0010],
                [base_lon + 0.0005, base_lat + 0.0005],
            ],
            **{"highway": "secondary", "name": "One Way", "oneway": "yes", "osmid": "way-92"},
        )
    )
    return {
        "type": "FeatureCollection",
        "features": features,
        "attribution": "© OpenStreetMap contributors",
        "license": "ODbL 1.0",
    }


def _import(client: TestClient, payload: dict, **overrides):
    body = {
        "study_area_key": "tehran",
        "dataset_name": "Central Tehran extract",
        "epsg_in": 4326,
        "extract_version": "tehran-test-v1",
        "source_url": "https://example.invalid/fixture",
        "source_attribution": "© OpenStreetMap contributors",
        "license": "ODbL 1.0",
        "snapshot_date": "2026-06-12",
        "boundary_4326": [51.390, 35.690, 51.400, 35.700],
        "buffer_m": 250.0,
        "lixel_resolution_m": 25.0,
        "geojson": payload,
    }
    body.update(overrides)
    return client.post("/api/v1/ingest/network/extract", json=body)


def test_extract_import_records_provenance_and_is_idempotent(client: TestClient) -> None:
    first = _import(client, osm_like_extract())
    assert first.status_code == 200, first.text
    report = first.json()
    assert report["status"] == "imported"
    assert report["idempotent"] is False
    assert report["epsg_out"] == 32639
    assert report["segment_count"] > 0
    checksum = report["extract_checksum_sha256"]
    assert len(checksum) == 64

    # Re-importing the identical document writes nothing and reports idempotence.
    second = _import(client, osm_like_extract())
    assert second.status_code == 200
    assert second.json()["status"] == "unchanged"
    assert second.json()["idempotent"] is True
    assert second.json()["extract_checksum_sha256"] == checksum

    extracts = client.get(f"/api/v1/ingest/network/extracts?dataset_id={report['dataset_id']}").json()
    assert len(extracts["extracts"]) == 1
    record = extracts["extracts"][0]
    assert record["license"] == "ODbL 1.0"
    assert record["snapshot_date"] == "2026-06-12"
    assert record["checksum_sha256"] == checksum
    assert record["epsg_in"] == 4326 and record["epsg_out"] == 32639


def test_extract_import_preserves_topology_grades_and_source_ids(client: TestClient) -> None:
    report = _import(client, osm_like_extract()).json()
    dataset_id = report["dataset_id"]

    layers = client.get(f"/api/v1/network/layers?include_lixels=false&dataset_id={dataset_id}").json()
    features = layers["segments_geojson"]["features"]
    by_name = {}
    for feature in features:
        by_name.setdefault(feature["properties"]["name"], []).append(feature["properties"])

    # The bridge is recorded at elevation 1 with an explicit observed grade source.
    bridge = by_name["Elevated Crossing"][0]
    assert bridge["elevation_level"] == 1
    # The one-way street keeps its direction rather than being assumed bidirectional.
    one_way = by_name["One Way"][0]
    assert one_way["oneway_direction"] == 1
    assert one_way["direction_source"] in {"osm_oneway", "legacy_is_directed"}

    # The geometric crossing is reported, and no junction was created there.
    assert report["ambiguous_crossing_count"] >= 1
    kinds = {item["kind"] for item in report["ambiguous_crossings"]}
    assert "grade_separated_crossing" in kinds
    assert all(item["connection_created"] is False for item in report["ambiguous_crossings"])

    # Missing attributes are counted instead of invented.
    assert report["missing_attribute_count"] >= 1
    coverage = report["coverage"]
    assert coverage["segments_total"] == report["segment_count"]
    assert "isolated_nodes" in coverage


def test_extract_import_matches_metric_reference_distances(client: TestClient) -> None:
    """Metric lengths in EPSG:32639 must match independent reference distances."""
    from pyproj import Geod

    report = _import(client, osm_like_extract()).json()
    dataset_id = report["dataset_id"]
    layers = client.get(f"/api/v1/network/layers?include_lixels=false&dataset_id={dataset_id}").json()

    geod = Geod(ellps="WGS84")
    checked = 0
    for feature in layers["segments_geojson"]["features"]:
        coords = feature["geometry"]["coordinates"]
        if len(coords) != 2:
            continue
        lons = [coords[0][0], coords[1][0]]
        lats = [coords[0][1], coords[1][1]]
        _, _, reference_m = geod.inv(lons[0], lats[0], lons[1], lats[1])
        stored_m = float(feature["properties"]["length_m"])
        # Sub-metre agreement is expected between UTM 39N and the WGS84 geodesic over a street
        # block; a 1 m tolerance documents the accepted round-trip error.
        assert abs(stored_m - reference_m) < 1.0, (stored_m, reference_m)
        checked += 1
    assert checked >= 5


def test_extract_import_rejects_missing_and_invalid_payloads(client: TestClient) -> None:
    empty = _import(client, {"type": "FeatureCollection", "features": []})
    assert empty.status_code == 422

    no_geometry = _import(
        client, {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}}]}
    )
    assert no_geometry.status_code == 422

    bad_epsg = _import(client, osm_like_extract(), epsg_in=0)
    assert bad_epsg.status_code == 422

    remote = client.post(
        "/api/v1/ingest/network/extract",
        json={"study_area_key": "tehran", "extract_path": "/etc/passwd"},
    )
    assert remote.status_code == 422

    traversal = client.post(
        "/api/v1/ingest/network/extract",
        json={"study_area_key": "tehran", "extract_path": "relative/path.graphml"},
    )
    assert traversal.status_code == 422


def test_extract_import_never_overwrites_an_existing_network(client: TestClient) -> None:
    first = _import(client, osm_like_extract()).json()
    # A *different* document for the same dataset must be refused, not merged or replaced.
    different = osm_like_extract()
    different["features"].append(
        _feature(
            [[51.3990, 35.6990], [51.3995, 35.6995]],
            **{"highway": "primary", "name": "Extra", "osmid": "way-99"},
        )
    )
    second = _import(client, different, dataset_id=first["dataset_id"])
    assert second.status_code == 422
    assert "existing network" in second.json()["detail"].lower()


def test_graphml_extract_import_records_source_way_ids(client: TestClient) -> None:
    graphml = """<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="d0" for="node" attr.name="x" attr.type="double"/>
  <key id="d1" for="node" attr.name="y" attr.type="double"/>
  <key id="d2" for="edge" attr.name="name" attr.type="string"/>
  <key id="d3" for="edge" attr.name="highway" attr.type="string"/>
  <key id="d4" for="edge" attr.name="oneway" attr.type="string"/>
  <key id="d5" for="edge" attr.name="osmid" attr.type="string"/>
  <graph edgedefault="directed">
    <node id="n1"><data key="d0">51.3950</data><data key="d1">35.6950</data></node>
    <node id="n2"><data key="d0">51.3965</data><data key="d1">35.6950</data></node>
    <edge source="n1" target="n2">
      <data key="d2">GraphML Avenue</data><data key="d3">primary</data>
      <data key="d4">yes</data><data key="d5">way-graphml-1</data>
    </edge>
  </graph>
</graphml>"""
    response = client.post(
        "/api/v1/ingest/network/extract",
        json={
            "study_area_key": "tehran",
            "graphml": graphml,
            "extract_version": "graphml-fixture-v1",
            "epsg_in": 4326,
            "buffer_m": 500.0,
        },
    )
    assert response.status_code == 200, response.text
    report = response.json()
    assert report["extract_format"] == "graphml"
    assert report["segment_count"] >= 1
    assert "way-graphml-1" in " ".join(report["source_feature_ids_sample"])


def test_boundary_endpoint_publishes_provisional_selection_with_licence(client: TestClient) -> None:
    boundary = client.get("/api/v1/ingest/boundary?study_area_key=tehran").json()
    assert boundary["canonical_epsg"] == 32639
    assert boundary["buffer_m"] > 0
    assert boundary["status"] == "provisional_recorded_selection"
    assert boundary["license"]
    assert boundary["provider"]["policy_url"]
    unknown = client.get("/api/v1/ingest/boundary?study_area_key=nowhere")
    assert unknown.status_code == 404
