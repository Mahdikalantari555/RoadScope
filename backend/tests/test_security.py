import importlib
import json

from fastapi.testclient import TestClient
import pytest


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ROADSCOPE_SQLITE_PATH", str(tmp_path / "isolated.sqlite"))
    monkeypatch.setenv("ROADSCOPE_DEMO_MODE", "false")
    monkeypatch.setenv(
        "ROADSCOPE_API_TOKENS",
        json.dumps({"test-citizen-secret": "citizen_maya", "test-steward-secret": "steward_lead"}),
    )
    import app.config
    import app.db
    import app.main

    importlib.reload(app.config)
    importlib.reload(app.db)
    importlib.reload(app.main)
    with TestClient(app.main.app) as client:
        yield client


def test_forged_roles_no_mutation(client):
    request = {"accident_id": 1, "new_status": "verified_canonical", "actor_role": "data_steward"}
    assert client.post("/api/v1/steward/review", json=request).status_code == 401
    assert (
        client.post(
            "/api/v1/steward/review",
            json=request,
            headers={"Authorization": "Bearer test-citizen-secret"},
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/datasets/1/activate",
            headers={"Authorization": "Bearer test-citizen-secret"},
        ).status_code
        == 403
    )


def test_research_contract_validation_and_export(client):
    headers = {"Authorization": "Bearer test-steward-secret"}
    caps = client.get("/api/v1/research/capabilities").json()
    assert "bym2_spatial_mcmc_and_vgi_mi" in caps["available"]
    assert caps["unavailable"]["external_cloud_llm_narratives"]
    assert (
        client.post(
            "/api/v1/research/pai",
            json={"scores": [1], "lengths_m": [1], "counts": [0]},
            headers=headers,
        ).json()["curve"][1]["pai"]
        is None
    )
    from app.db import db_session

    with db_session() as conn:
        row = conn.execute("SELECT id,dataset_id FROM road_lixels LIMIT 1").fetchone()
        lid, ds = row["id"], row["dataset_id"]
    response = client.post(
        "/api/v1/research/diffusion",
        headers=headers,
        json={"dataset_id": ds, "initial": [{"lixel_id": lid, "mass": 1}], "duration_s": 1},
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert sum(state["mass"] for state in result["result"]["states"]) == pytest.approx(1)
    assert client.get(f"/api/v1/research/runs/{result['run_id']}").json() == result
    assert (
        client.post(
            "/api/v1/research/diffusion",
            headers=headers,
            json={"dataset_id": ds, "initial": [{"lixel_id": -1, "mass": 1}]},
        ).status_code
        == 422
    )


def test_allocation_invalidation(client):
    from app.db import db_session
    from app.services.allocations import incident_distribution

    with db_session() as conn:
        incident = conn.execute(
            "SELECT id FROM accidents WHERE verification_status NOT IN ('merged_duplicate','rejected_false_alarm') LIMIT 1"
        ).fetchone()[0]
        lids = [row[0] for row in conn.execute("SELECT id FROM road_lixels LIMIT 2")]
        conn.execute(
            "UPDATE accidents SET verification_status='unverified_raw_vgi',snap_candidates_json=? WHERE id=?",
            (
                json.dumps(
                    [
                        {"lixel_id": lids[0], "snap_probability": 0.52},
                        {"lixel_id": lids[1], "snap_probability": 0.48},
                    ]
                ),
                incident,
            ),
        )
        first = incident_distribution(conn, incident)
        assert first["mass"] == pytest.approx(1)
        assert [a["probability"] for a in first["allocations"]] == [0.52, 0.48]
        assert incident_distribution(conn, incident)["version"] == first["version"]
        conn.execute(
            "UPDATE accidents SET verification_status='verified_canonical',snapped_lixel_id=? WHERE id=?",
            (lids[1], incident),
        )
        second = incident_distribution(conn, incident)
        assert second["version"] > first["version"]
        assert second["allocations"][0]["probability"] == 1
        assert second["allocations"][0]["lixel_id"] == lids[1]


def test_demo_refuses_real_data_and_import(client, monkeypatch):
    monkeypatch.setenv("ROADSCOPE_DEMO_MODE", "true")
    from app.db import db_session

    assert client.post("/api/v1/ingest/network", json={}).status_code == 403
    assert client.post("/api/v1/study-areas/tehran/datasets", json={}).status_code == 403
    with db_session() as conn:
        conn.execute("UPDATE dataset_sources SET is_synthetic=0")
    for method, path in (("get", "/api/v1/meta"), ("post", "/api/v1/vgi/submit"),
                         ("post", "/api/v1/simulator/generate")):
        response = getattr(client, method)(path)
        assert response.status_code == 503
        assert "non-synthetic" in response.text


def test_network_administration_requires_steward(client):
    body = {"key": "test", "name_en": "Test", "center_4326": [0, 0]}
    assert client.post("/api/v1/study-areas", json=body).status_code == 401
    assert client.post("/api/v1/study-areas", json=body,
                       headers={"Authorization": "Bearer test-citizen-secret"}).status_code == 403


def test_topology_restriction_refresh_and_trusted_audit(client):
    from app.db import db_session
    from app.services.research import directed_lixel_graph

    with db_session() as conn:
        ds = conn.execute("SELECT id FROM dataset_sources LIMIT 1").fetchone()[0]
        graph, before = directed_lixel_graph(conn, ds)
        a, b = next((a, b) for a, b in graph.edges if graph.nodes[a]["segment_id"] != graph.nodes[b]["segment_id"])
        via_node = graph.edges[a, b]["via_node"]
        conn.execute(
            "INSERT INTO turn_restrictions(dataset_id, via_node_id, from_segment_id, to_segment_id, source) VALUES(?, ?, ?, ?, ?)",
            (ds, via_node, graph.nodes[a]["segment_id"], graph.nodes[b]["segment_id"], "imported"),
        )
        updated, after = directed_lixel_graph(conn, ds)
        assert not updated.has_edge(a, b)
        assert before != after
        accident = conn.execute("SELECT id FROM accidents LIMIT 1").fetchone()[0]
    response = client.post(
        "/api/v1/steward/review",
        headers={"Authorization": "Bearer test-steward-secret"},
        json={"accident_id": accident, "new_status": "flagged_review", "actor_role": "citizen_reporter"},
    )
    assert response.status_code == 200, response.text
    with db_session() as conn:
        user = conn.execute("SELECT id FROM users WHERE username='steward_lead'").fetchone()[0]
        audit = conn.execute("SELECT actor_user_id,actor_role FROM audit_logs ORDER BY id DESC LIMIT 1").fetchone()
        assert audit["actor_user_id"] == user
        assert audit["actor_role"] == "data_steward"


def test_built_spa_and_api_fallback(client):
    from app.config import FRONTEND_DIST_DIR

    if not (FRONTEND_DIST_DIR / "index.html").exists():
        pytest.skip("Build the frontend to exercise static serving.")
    response = client.get("/")
    assert response.status_code == 200
    assert 'id="root"' in response.text
    assert client.get("/api/v1/does-not-exist").status_code == 404
    asset = next((FRONTEND_DIST_DIR / "assets").glob("*.js"))
    assert client.get("/assets/" + asset.name).status_code == 200
