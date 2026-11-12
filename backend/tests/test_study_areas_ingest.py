"""Region-agnostic study areas, network ingestion and worldwide VGI acceptance.

These tests pin the central promise of the `tehran-citizen-reporting` change: Tehran is a
demo, not a limit. A new study area anywhere on Earth can be registered, its network imported
from GeoJSON in any EPSG, and citizen reports can be submitted from anywhere.
"""
from __future__ import annotations

import importlib
import json
import inspect
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client() -> TestClient:
    """Fresh database + freshly reloaded app module for every test in this module."""
    with tempfile.TemporaryDirectory(prefix="roadscope_area_test_") as tmp_dir:
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
            with TestClient(main_mod.app, headers={"Authorization": "Bearer test-steward"}) as test_client:
                yield test_client
        finally:
            env.undo()
            importlib.reload(cfg)
            importlib.reload(db_mod)
            importlib.reload(main_mod)


AMSTERDAM_LINE = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"name": "Damrak", "road_class": "arterial", "highway": "secondary"},
            "geometry": {
                "type": "LineString",
                "coordinates": [[4.8950, 52.3700], [4.8954, 52.3720], [4.8960, 52.3740]],
            },
        },
        {
            "type": "Feature",
            "properties": {"name": "Rokin", "road_class": "collector", "highway": "residential"},
            "geometry": {
                "type": "LineString",
                "coordinates": [[4.8960, 52.3740], [4.8950, 52.3760], [4.8930, 52.3780]],
            },
        },
    ],
}


def test_meta_declares_worldwide_open_bounds(client: TestClient) -> None:
    meta = client.get("/api/v1/meta").json()
    assert meta["boundary_enforced"] is False
    assert meta["ingestion_scope"] == "worldwide"
    assert meta["study_area_key"] == "tehran"
    keys = {a["key"] for a in meta["study_areas"]}
    assert "tehran" in keys
    # A study area may *describe* a boundary, but that description never filters ingestion.
    tehran = next(a for a in meta["study_areas"] if a["key"] == "tehran")
    assert tehran["boundary_4326"] is not None
    assert meta["boundary_enforced"] is False

    health = client.get("/api/v1/health").json()
    assert health["boundary_enforced"] is False
    assert health["ingestion_scope"] == "worldwide"


def test_location_context_reports_open_ingestion(client: TestClient) -> None:
    body = client.get("/api/v1/vgi/location-context").json()
    assert body["ingestion_scope"] == "worldwide"
    assert body["rejects_outside_boundary"] is False
    assert body["records_outside_boundary_flag"] is True
    assert body["canonical_epsg"] == 3857
    assert body["network_bbox_4326"] is not None


def test_create_study_area_and_dataset_in_a_new_city(client: TestClient) -> None:
    created = client.post(
        "/api/v1/study-areas",
        json={
            "key": "amsterdam",
            "name_en": "Amsterdam",
            "name_fa": "آمستردام",
            "country_code": "NL",
            "canonical_epsg": 3857,
            "center_4326": [4.8952, 52.3702],
            "bounded": False,
        },
    )
    assert created.status_code == 200, created.text
    area = created.json()
    assert area["key"] == "amsterdam"
    assert area["bounded"] is False

    listing = client.get("/api/v1/study-areas").json()
    assert "amsterdam" in {a["key"] for a in listing["study_areas"]}

    dataset = client.post(
        "/api/v1/study-areas/amsterdam/datasets",
        json={"name": "Amsterdam demo", "lixel_resolution_m": 40.0, "is_synthetic": False},
    )
    assert dataset.status_code == 200, dataset.text
    payload = dataset.json()
    assert payload["study_area_key"] == "amsterdam"
    assert payload["crs_epsg"] == 3857


def test_import_network_from_geojson_for_a_new_study_area(client: TestClient) -> None:
    client.post(
        "/api/v1/study-areas",
        json={"key": "amsterdam", "name_en": "Amsterdam", "country_code": "NL", "center_4326": [4.8952, 52.3702]},
    )
    imported = client.post(
        "/api/v1/ingest/network",
        json={
            "study_area_key": "amsterdam",
            "dataset_name": "Amsterdam imported network",
            "epsg_in": 4326,
            "lixel_resolution_m": 35.0,
            "geojson": AMSTERDAM_LINE,
            "activate": True,
        },
    )
    assert imported.status_code == 200, imported.text
    result = imported.json()
    assert result["study_area_key"] == "amsterdam"
    assert result["segment_count"] >= 2
    assert result["epsg_in"] == 4326
    assert result["activated"] is True

    meta = client.get("/api/v1/meta").json()
    assert meta["active_dataset"]["id"] == result["dataset_id"]
    # The map framing now follows the imported data, not the previous demo city.
    bbox = meta["network_bbox_4326"]
    assert bbox is not None
    assert 4.8 < bbox["min_lon"] < bbox["max_lon"] < 5.0
    assert 52.3 < bbox["min_lat"] < bbox["max_lat"] < 52.5

    layers = client.get(f"/api/v1/network/layers?include_lixels=false&dataset_id={result['dataset_id']}").json()
    names = {f["properties"]["name"] for f in layers["segments_geojson"]["features"]}
    assert {"Damrak", "Rokin"} <= names

    events = client.get("/api/v1/ingest/events").json()["events"]
    assert events and events[0]["study_area_key"] == "amsterdam"
    assert events[0]["rejected_count"] == 0


def test_import_rejects_invalid_payloads_but_accepts_any_epsg(client: TestClient) -> None:
    empty = client.post("/api/v1/ingest/network", json={"study_area_key": "tehran", "geojson": {"type": "FeatureCollection", "features": []}})
    assert empty.status_code == 422

    bad_scheme = client.post(
        "/api/v1/ingest/network",
        json={"study_area_key": "tehran", "geojson_url": "file:///etc/passwd"},
    )
    assert bad_scheme.status_code == 422

    # A projected payload in EPSG:25832 (a European grid) is equally importable: the platform
    # is not tied to one part of the world, only to a declared input CRS.
    utm = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "Berliner Allee"},
                "geometry": {"type": "LineString", "coordinates": [[477600.0, 5551900.0], [477900.0, 5551951.0]]},
            }
        ],
    }
    imported = client.post(
        "/api/v1/ingest/network",
        json={"study_area_key": "tehran", "epsg_in": 25832, "geojson": utm, "lixel_resolution_m": 30.0},
    )
    assert imported.status_code == 200, imported.text
    assert imported.json()["segment_count"] >= 1


def test_vgi_accepts_reports_anywhere_and_flags_outside_boundary(client: TestClient) -> None:
    inside = client.post(
        "/api/v1/vgi/submit",
        json={
            "lon": 51.3891,
            "lat": 35.6892,
            "observational_radius_m": 15.0,
            "occurred_at_utc": "2026-11-09T10:00:00Z",
            "reported_at_utc": "2026-11-09T10:05:00Z",
            "category_code": "REAR_END",
            "severity_code": "PDO",
        },
    )
    assert inside.status_code == 200, inside.text
    assert inside.json()["outside_study_area"] is False

    outside = client.post(
        "/api/v1/vgi/submit",
        json={
            "lon": 4.8952,
            "lat": 52.3702,
            "observational_radius_m": 15.0,
            "occurred_at_utc": "2026-11-09T10:00:00Z",
            "reported_at_utc": "2026-11-09T10:05:00Z",
            "category_code": "REAR_END",
            "severity_code": "PDO",
            "reported_from_country_code": "NL",
        },
    )
    assert outside.status_code == 200, outside.text
    body = outside.json()
    assert body["outside_study_area"] is True
    assert body["study_area_key"] == "tehran"
    assert body["verification_status"] == "unverified_raw_vgi"

    # Metric input from raw device coordinates is accepted too (they are projected back).
    metric = client.post(
        "/api/v1/vgi/submit",
        json={
            "x_m": 5719700.0,
            "y_m": 4252600.0,
            "observational_radius_m": 12.0,
            "occurred_at_utc": "2026-11-09T11:00:00Z",
            "category_code": "REAR_END",
            "severity_code": "PDO",
        },
    )
    assert metric.status_code == 200, metric.text


def test_synthetic_network_generator_is_named_and_reusable_for_other_cities(client: TestClient) -> None:
    meta = client.get("/api/v1/meta").json()
    tehran = next(a for a in meta["study_areas"] if a["key"] == "tehran")
    assert tehran["network_source"] == "seeded_demo"
    assert tehran["network_generator"] == "tehran_demo_v1"
    assert tehran["demo"] is True

    # A second synthetic city can be generated: the generator is parameterised, not Tehra-only.
    from app.services.network_generator import generate_synthetic_network

    nodes, edges = generate_synthetic_network("tehran_demo_v1")
    assert len(nodes) > 10 and len(edges) > 20
    with pytest.raises(ValueError):
        generate_synthetic_network("atlantis_v1")
    assert "tehran_demo_v1" in inspect.signature(generate_synthetic_network).parameters["generator_key"].default


def test_network_import_rejects_remote_urls_and_existing_graph(client: TestClient) -> None:
    from app.db import db_session

    for url in ('http://127.0.0.1/private', 'https://example.org/network.json'):
        response = client.post('/api/v1/ingest/network', json={'geojson_url': url})
        assert response.status_code == 422
        assert 'disabled' in response.text
    dataset_id = client.get('/api/v1/meta').json()['active_dataset']['id']
    with db_session() as conn:
        before = conn.execute('SELECT COUNT(*) FROM road_segments WHERE dataset_id=?', (dataset_id,)).fetchone()[0]
        accidents = conn.execute('SELECT COUNT(*) FROM accidents WHERE dataset_id=?', (dataset_id,)).fetchone()[0]
    result = client.post('/api/v1/ingest/network', json={'dataset_id': dataset_id, 'geojson': AMSTERDAM_LINE})
    assert result.status_code == 422
    assert 'empty dataset' in result.text
    with db_session() as conn:
        assert conn.execute('SELECT COUNT(*) FROM road_segments WHERE dataset_id=?', (dataset_id,)).fetchone()[0] == before
        assert conn.execute('SELECT COUNT(*) FROM accidents WHERE dataset_id=?', (dataset_id,)).fetchone()[0] == accidents


def test_grade_separated_endpoints_do_not_share_a_node(client: TestClient) -> None:
    from app.db import db_session
    roads = {'type': 'FeatureCollection', 'features': [
        {'type': 'Feature', 'properties': {'highway': 'motorway'},
         'geometry': {'type': 'LineString', 'coordinates': [[51.38, 35.69], [51.39, 35.69]]}},
        {'type': 'Feature', 'properties': {'highway': 'residential'},
         'geometry': {'type': 'LineString', 'coordinates': [[51.39, 35.69], [51.39, 35.70]]}},
    ]}
    result = client.post('/api/v1/ingest/network', json={'geojson': roads, 'activate': False})
    assert result.status_code == 200, result.text
    with db_session() as conn:
        rows = conn.execute('SELECT u_node_id, v_node_id FROM road_segments WHERE dataset_id=? ORDER BY id',
                            (result.json()['dataset_id'],)).fetchall()
        assert len(rows) == 2
        assert rows[0]['v_node_id'] != rows[1]['u_node_id']


def test_real_dataset_rejects_citizen_submissions(client: TestClient) -> None:
    from app.db import db_session
    with db_session() as conn:
        dataset_id = conn.execute('SELECT id FROM dataset_sources WHERE is_active=1').fetchone()[0]
        conn.execute('UPDATE dataset_sources SET is_synthetic=0 WHERE id=?', (dataset_id,))
        before = conn.execute('SELECT COUNT(*) FROM accidents').fetchone()[0]
    response = client.post('/api/v1/vgi/submit', json={
        'dataset_id': dataset_id, 'lon': 51.3891, 'lat': 35.6892,
        'occurred_at_utc': '2026-11-09T10:00:00Z', 'category_code': 'REAR_END', 'severity_code': 'PDO',
    })
    assert response.status_code == 403
    with db_session() as conn:
        assert conn.execute('SELECT COUNT(*) FROM accidents').fetchone()[0] == before


def test_import_does_not_invent_traffic_and_risk_is_gated(client: TestClient) -> None:
    from app.db import db_session
    imported = client.post('/api/v1/ingest/network', json={'geojson': AMSTERDAM_LINE, 'activate': False})
    assert imported.status_code == 200, imported.text
    ds = imported.json()['dataset_id']
    with db_session() as conn:
        assert conn.execute('SELECT COUNT(*) FROM traffic_observations WHERE dataset_id=?', (ds,)).fetchone()[0] == 0
        assert conn.execute('SELECT COUNT(*) FROM road_segments WHERE dataset_id=? AND aadt IS NOT NULL', (ds,)).fetchone()[0] == 0
    layers = client.get(f'/api/v1/network/layers?dataset_id={ds}&include_lixels=false').json()
    assert all(f['properties']['aadt'] is None and f['properties']['coverage_confidence'] is None
               for f in layers['segments_geojson']['features'])
    response = client.post('/api/v1/risk/evaluate', json={'dataset_id': ds})
    assert response.status_code == 422
    assert 'unavailable' in response.text


def test_missing_exposure_gates_synthetic_risk(client: TestClient) -> None:
    from app.db import db_session
    ds = client.get('/api/v1/meta').json()['active_dataset']['id']
    with db_session() as conn:
        conn.execute('DELETE FROM traffic_observations WHERE segment_id=(SELECT id FROM road_segments WHERE dataset_id=? LIMIT 1)', (ds,))
    response = client.post('/api/v1/risk/evaluate', json={'dataset_id': ds})
    assert response.status_code == 422
    assert 'exposure' in response.text
