"""Restricted pilot: guards, intake, credentials, moderation, disclosure and timezone.

No real personal data is used: every fixture report is synthetic-looking test content and the
dataset lives in a temporary database. These tests assert that the *safety* behaviour is correct —
which is not the same as approving a pilot.
"""
from __future__ import annotations

import importlib
import json
import sqlite3
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

STEWARD_HEADERS = {"Authorization": "Bearer test-steward"}
CITIZEN_HEADERS = {"Authorization": "Bearer test-citizen"}


@pytest.fixture()
def client() -> TestClient:
    with tempfile.TemporaryDirectory(prefix="roadscope_pilot_test_") as tmp_dir:
        db_file = Path(tmp_dir) / "pilot.sqlite"
        env = pytest.MonkeyPatch()
        env.setenv("ROADSCOPE_DEMO_MODE", "false")
        env.setenv("ROADSCOPE_PROFILE", "pilot")
        env.setenv(
            "ROADSCOPE_API_TOKENS",
            json.dumps({"test-steward": "steward_lead", "test-citizen": "citizen_maya"}),
        )
        env.setenv("ROADSCOPE_SQLITE_PATH", str(db_file))
        env.setenv("UAI_SQLITE_PATH", str(db_file))
        env.setenv("ROADSCOPE_DEFAULT_STUDY_AREA", "tehran")
        env.setenv("ROADSCOPE_DEFAULT_SEED", "42")
        env.setenv("ROADSCOPE_RATE_LIMIT_REPORTS_PER_HOUR", "3")
        env.setenv("ROADSCOPE_RATE_LIMIT_TRACKING_PER_MINUTE", "50")

        import app.config as cfg
        import app.db as db_mod
        import app.main as main_mod

        try:
            importlib.reload(cfg)
            importlib.reload(db_mod)
            importlib.reload(main_mod)
            with TestClient(main_mod.app) as c:
                c.headers.update(STEWARD_HEADERS)
                yield c
        finally:
            env.undo()
            importlib.reload(cfg)
            importlib.reload(db_mod)
            importlib.reload(main_mod)


def _pilot_dataset(client: TestClient) -> int:
    """Create a pilot-profile dataset with a small imported network."""
    line = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "Pilot Street", "highway": "secondary"},
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [51.3900, 35.6900],
                        [51.3900, 35.6960],
                        [51.3950, 35.6960],
                    ],
                },
            }
        ],
    }
    imported = client.post(
        "/api/v1/ingest/network/extract",
        json={
            "study_area_key": "tehran",
            "dataset_name": "Pilot network",
            "geojson": line,
            "epsg_in": 4326,
            "extract_version": "pilot-fixture-v1",
            "boundary_4326": [51.380, 35.680, 51.410, 35.710],
            "buffer_m": 100.0,
            "activate": True,
        },
    )
    assert imported.status_code == 200, imported.text
    return int(imported.json()["dataset_id"])


def _configure_pilot(client: TestClient, dataset_id: int) -> None:
    from app.db import db_session

    with db_session() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO pilot_configuration
            (dataset_id, pilot_key, owner, operator, hosting, identity_model, approval_reference,
             approved_at_utc, retention_days, disclosure_json, updated_at_utc)
            VALUES (?, 'tehran-pilot-2026', 'RoadScope research group', 'Operations lead',
                    'single-region container', 'bearer + high-entropy credential', 'APPR-TEST-001',
                    ?, 90, '{}', ?)
            """,
            (dataset_id, "2026-11-12T00:00:00Z", "2026-11-12T00:00:00Z"),
        )


def _enable(client: TestClient, key: str, dataset_id: int) -> None:
    response = client.post(
        "/api/v1/pilot/flags",
        json={
            "key": key,
            "enabled": True,
            "owner": "Operations lead",
            "approval_reference": "APPR-TEST-001",
            "dataset_id": dataset_id,
        },
    )
    assert response.status_code == 200, response.text


def _report_body(dataset_id: int, **overrides):
    body = {
        "dataset_id": dataset_id,
        "occurred_at_local": "2026-11-10T18:20:00",
        "timezone": "Asia/Tehran",
        "category_code": "REAR_END",
        "severity_code": "MINOR_INJURY",
        "location_uncertainty_m": 25.0,
        "lon": 51.3900,
        "lat": 35.6930,
        "consent_given": True,
        "consent_locale": "fa",
        "transport_mode": "vehicle_occupant",
        "reporter_identity_hint": "test-participant-1",
    }
    body.update(overrides)
    return body


def test_every_pilot_capability_is_disabled_by_default(client: TestClient) -> None:
    status = client.get("/api/v1/pilot/status").json()
    assert status["process_profile"] == "pilot"
    assert all(flag["enabled"] is False for flag in status["flags"].values())
    assert status["release_gates"]["intake_enabled"] is False
    assert status["release_gates"]["publication_enabled"] is False

    aggregates = client.get("/api/v1/pilot/aggregates").json()
    assert aggregates["enabled"] is False
    assert aggregates["aggregates"] == []
    assert aggregates["status"] == "publication_disabled"


def test_an_imported_extract_lands_in_the_isolated_pilot_profile(client: TestClient) -> None:
    """A real network import must not be stamped `demo` while the process serves `pilot`.

    Otherwise the dataset is unreachable for the pilot forever: the intake guard refuses a
    non-pilot profile, and an operator following the runbook cannot enable intake on it.
    """
    line = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "Profile Street", "highway": "secondary"},
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[51.3900, 35.6900], [51.3950, 35.6960]],
                },
            }
        ],
    }
    imported = client.post(
        "/api/v1/ingest/network/extract",
        json={
            "study_area_key": "tehran",
            "dataset_name": "Profile probe",
            "geojson": line,
            "epsg_in": 4326,
            "extract_version": "profile-probe-v1",
            "activate": True,
        },
    )
    assert imported.status_code == 200, imported.text
    dataset_id = int(imported.json()["dataset_id"])

    status = client.get("/api/v1/pilot/status", params={"dataset_id": dataset_id}).json()
    assert status["dataset"]["profile_key"] == "pilot"
    assert status["dataset"]["is_synthetic"] is False

    enabled = client.post(
        "/api/v1/pilot/flags",
        json={
            "key": "pilot_intake",
            "enabled": True,
            "owner": "Operations lead",
            "approval_reference": "APPR-TEST-001",
            "dataset_id": dataset_id,
        },
    )
    assert enabled.status_code == 200, enabled.text
    assert client.get("/api/v1/pilot/bootstrap").json()["intake_enabled"] is True


def test_a_synthetic_dataset_can_never_be_created_in_a_real_profile(client: TestClient) -> None:
    """Synthetic geometry is always `demo`, whatever the process profile says."""
    created = client.post(
        "/api/v1/study-areas/tehran/datasets",
        json={"name": "Synthetic probe", "is_synthetic": True, "activate": False},
    )
    assert created.status_code == 200, created.text
    assert created.json()["profile_key"] == "demo"

    real = client.post(
        "/api/v1/study-areas/tehran/datasets",
        json={"name": "Real probe", "is_synthetic": False, "activate": False},
    )
    assert real.status_code == 200, real.text
    assert real.json()["profile_key"] == "pilot"


def test_intake_is_refused_for_synthetic_demo_datasets(client: TestClient) -> None:
    meta = client.get("/api/v1/meta").json()
    demo_dataset = meta["active_dataset"]["id"]
    response = client.post("/api/v1/pilot/reports", json=_report_body(demo_dataset))
    assert response.status_code == 403
    assert "disabled" in response.json()["detail"].lower()


def test_intake_requires_the_flag_and_refuses_synthetic_data(client: TestClient) -> None:
    dataset_id = _pilot_dataset(client)
    _configure_pilot(client, dataset_id)

    # Flag still off: refused.
    off = client.post("/api/v1/pilot/reports", json=_report_body(dataset_id))
    assert off.status_code == 403
    assert "Feature 'pilot_intake' is disabled" in off.json()["detail"]

    _enable(client, "pilot_intake", dataset_id)

    # A synthetic dataset is never rewritten, even with the flag on.
    synthetic = client.post(
        "/api/v1/study-areas/tehran/datasets",
        json={"name": "Synthetic import", "is_synthetic": True, "activate": False},
    ).json()
    refused = client.post("/api/v1/pilot/reports", json=_report_body(synthetic["dataset_id"]))
    assert refused.status_code == 403
    assert "synthetic" in refused.json()["detail"].lower()


def test_flag_activation_requires_owner_and_approval_reference(client: TestClient) -> None:
    dataset_id = _pilot_dataset(client)
    _configure_pilot(client, dataset_id)
    response = client.post(
        "/api/v1/pilot/flags",
        json={"key": "pilot_intake", "enabled": True, "owner": "", "approval_reference": ""},
    )
    assert response.status_code == 422
    unknown = client.post(
        "/api/v1/pilot/flags",
        json={"key": "not_a_flag", "enabled": True, "owner": "x", "approval_reference": "y"},
    )
    assert unknown.status_code == 422


def test_intake_converts_local_time_to_utc_and_never_returns_credentials_twice(client: TestClient) -> None:
    dataset_id = _pilot_dataset(client)
    _configure_pilot(client, dataset_id)
    _enable(client, "pilot_intake", dataset_id)

    response = client.post("/api/v1/pilot/reports", json=_report_body(dataset_id))
    assert response.status_code == 200, response.text
    body = response.json()
    # 18:20 Asia/Tehran (UTC+03:30) is 14:50 UTC.
    assert body["occurred_at_utc"] == "2026-11-10T14:50:00Z"
    assert len(body["tracking_credential"]) >= 14
    assert body["snap_confidence"] in {"confident", "uncertain", "unmatched"}
    # Only a coarse district cell is exposed, never the exact coordinate.
    assert "lon" not in body and "lat" not in body
    assert body["coarse_location"]["cell_key"]

    # The credential is stored as a verifier only: never in plaintext.
    from app.db import db_session

    with db_session() as conn:
        row = conn.execute(
            "SELECT credential_hmac, credential_verifier, verifier_salt FROM report_access_credentials"
        ).fetchone()
        assert body["tracking_credential"] not in _dump_all_rows(conn)
        assert len(str(row["credential_hmac"])) == 64
        assert len(str(row["credential_verifier"])) == 64

    # Consent is recorded explicitly with its policy version.
    with db_session() as conn:
        consent = conn.execute(
            "SELECT consent_version, consent_scope, locale FROM report_consents"
        ).fetchone()
        assert consent["consent_version"].startswith("pilot-consent")
        assert consent["locale"] == "fa"


def _dump_all_rows(conn) -> str:
    blob = []
    for table in (
        "accidents",
        "report_access_credentials",
        "report_moderation_events",
        "audit_logs",
        "report_consents",
    ):
        for row in conn.execute(f"SELECT * FROM {table}").fetchall():
            blob.append(json.dumps({k: row[k] for k in row.keys()}, default=str))
    return "\n".join(blob)


def test_intake_requires_explicit_consent_and_rejects_implausible_input(client: TestClient) -> None:
    dataset_id = _pilot_dataset(client)
    _configure_pilot(client, dataset_id)
    _enable(client, "pilot_intake", dataset_id)

    no_consent = client.post("/api/v1/pilot/reports", json=_report_body(dataset_id, consent_given=False))
    assert no_consent.status_code == 422
    assert "consent" in no_consent.json()["detail"].lower()

    future = client.post(
        "/api/v1/pilot/reports", json=_report_body(dataset_id, occurred_at_local="2099-01-01T10:00:00")
    )
    assert future.status_code == 422

    huge_radius = client.post(
        "/api/v1/pilot/reports", json=_report_body(dataset_id, location_uncertainty_m=900.0)
    )
    assert huge_radius.status_code == 422

    # Free text and attachments cannot even be expressed by the intake schema.
    # A smuggled free-text/attachment key is not representable: Pydantic drops unknown fields and
    # nothing in the stored row can carry it.
    with_photo = client.post(
        "/api/v1/pilot/reports", json={**_report_body(dataset_id), "photo": "s3cret.jpg"}
    )
    assert with_photo.status_code == 200
    from app.db import db_session

    with db_session() as conn:
        assert conn.execute("SELECT COUNT(*) FROM report_attachments").fetchone()[0] == 0
        assert "s3cret" not in _dump_all_rows(conn)


def test_a_smuggled_attachment_or_free_text_field_is_never_stored(client: TestClient) -> None:
    """The intake schema has no field for a photo or free text, so an extra key must vanish.

    Pydantic drops unknown fields, but that is only safe if nothing else in the write path reads
    ``request.__dict__`` or a raw body. This asserts the *stored* row, not just the response.
    """
    dataset_id = _pilot_dataset(client)
    _configure_pilot(client, dataset_id)
    _enable(client, "pilot_intake", dataset_id)

    submitted = client.post(
        "/api/v1/pilot/reports",
        json={
            **_report_body(dataset_id),
            "photo": "s3cret-photo.jpg",
            "narrative": "s3cret narrative",
            "reporter_name": "s3cret name",
            "attachment_filenames": ["s3cret-photo.jpg"],
        },
    )
    assert submitted.status_code == 200, submitted.text

    from app.db import db_session

    with db_session() as conn:
        assert "s3cret" not in _dump_all_rows(conn)
        assert conn.execute("SELECT COUNT(*) FROM report_attachments").fetchone()[0] == 0


def test_idempotency_key_replays_the_same_response(client: TestClient) -> None:
    dataset_id = _pilot_dataset(client)
    _configure_pilot(client, dataset_id)
    _enable(client, "pilot_intake", dataset_id)

    first = client.post(
        "/api/v1/pilot/reports", json=_report_body(dataset_id), headers={"Idempotency-Key": "abc-123"}
    )
    assert first.status_code == 200, first.text
    second = client.post(
        "/api/v1/pilot/reports", json=_report_body(dataset_id), headers={"Idempotency-Key": "abc-123"}
    )
    assert second.status_code == 200
    assert second.json()["idempotent_replay"] is True
    assert second.json()["report_public_id"] == first.json()["report_public_id"]

    conflicting = client.post(
        "/api/v1/pilot/reports",
        json=_report_body(dataset_id, category_code="SIDESWIPE"),
        headers={"Idempotency-Key": "abc-123"},
    )
    assert conflicting.status_code == 422
    assert "idempotency" in conflicting.json()["detail"].lower()

    from app.db import db_session

    with db_session() as conn:
        count = conn.execute("SELECT COUNT(*) FROM accidents WHERE dataset_id = ?", (dataset_id,)).fetchone()[0]
    assert count == 1


def test_distributed_rate_limit_is_shared_and_enforced(client: TestClient) -> None:
    dataset_id = _pilot_dataset(client)
    _configure_pilot(client, dataset_id)
    _enable(client, "pilot_intake", dataset_id)

    statuses = []
    for index in range(5):
        response = client.post(
            "/api/v1/pilot/reports",
            json=_report_body(dataset_id, occurred_at_local=f"2026-11-10T1{index}:00:00"),
        )
        statuses.append(response.status_code)
    # The configured budget is 3 per hour and it is enforced from the database.
    assert statuses.count(200) == 3
    assert 429 in statuses

    from app.db import db_session

    with db_session() as conn:
        rows = conn.execute("SELECT counter FROM rate_limit_windows").fetchall()
        assert rows and max(int(r[0]) for r in rows) >= 3


def test_tracking_returns_status_only_and_rejects_bad_credentials(client: TestClient) -> None:
    dataset_id = _pilot_dataset(client)
    _configure_pilot(client, dataset_id)
    _enable(client, "pilot_intake", dataset_id)

    created = client.post("/api/v1/pilot/reports", json=_report_body(dataset_id)).json()
    credential = created["tracking_credential"]

    # Tracking is a separate flag: it stays closed until approved.
    blocked = client.post("/api/v1/pilot/tracking", json={"dataset_id": dataset_id, "credential": credential})
    assert blocked.status_code == 403

    _enable(client, "pilot_tracking", dataset_id)
    tracked = client.post("/api/v1/pilot/tracking", json={"dataset_id": dataset_id, "credential": credential})
    assert tracked.status_code == 200, tracked.text
    payload = tracked.json()
    assert payload["status"] == "unverified_raw_vgi"
    assert payload["status_label"] == "submitted_unverified"
    # No raw coordinates, candidate lists or internal scores.
    for forbidden in ("lon", "lat", "raw_lon", "snap_candidates_json", "vgi_credibility_score"):
        assert forbidden not in payload

    bad = client.post("/api/v1/pilot/tracking", json={"dataset_id": dataset_id, "credential": "AAAA-BBBB-CCCC"})
    assert bad.status_code == 404

    # A credential is never accepted from a URL: no GET route exists for it.
    assert client.get(f"/api/v1/pilot/tracking?credential={credential}").status_code in {404, 405}


def test_moderation_is_auditable_and_reversible(client: TestClient) -> None:
    dataset_id = _pilot_dataset(client)
    _configure_pilot(client, dataset_id)
    _enable(client, "pilot_intake", dataset_id)
    created = client.post("/api/v1/pilot/reports", json=_report_body(dataset_id)).json()
    report_id = int(created["report_public_id"].split("-")[1])

    verified = client.post(
        "/api/v1/pilot/moderation",
        json={"dataset_id": dataset_id, "accident_id": report_id, "action": "verify", "reason": "two witnesses"},
    )
    assert verified.status_code == 200, verified.text
    assert verified.json()["new_status"] == "verified_canonical"

    # Merge into another report and then unmerge: history is preserved.
    second = client.post(
        "/api/v1/pilot/reports", json=_report_body(dataset_id, occurred_at_local="2026-11-10T19:00:00")
    )
    assert second.status_code == 200, second.text
    duplicate_id = int(second.json()["report_public_id"].split("-")[1])
    merged = client.post(
        "/api/v1/pilot/moderation",
        json={
            "dataset_id": dataset_id,
            "accident_id": duplicate_id,
            "action": "merge",
            "canonical_accident_id": report_id,
            "reason": "same event",
        },
    )
    assert merged.status_code == 200
    assert merged.json()["new_status"] == "merged_duplicate"

    unmerged = client.post(
        "/api/v1/pilot/moderation",
        json={"dataset_id": dataset_id, "accident_id": duplicate_id, "action": "unmerge", "reason": "distinct"},
    )
    assert unmerged.status_code == 200
    assert unmerged.json()["new_status"] == "unverified_raw_vgi"

    from app.db import db_session

    with db_session() as conn:
        events = conn.execute(
            "SELECT action FROM report_moderation_events WHERE accident_id = ? ORDER BY id", (duplicate_id,)
        ).fetchall()
        actions = [str(e[0]) for e in events]
        assert actions[0] == "submit"
        assert "merge" in actions and "unmerge" in actions
        links = conn.execute(
            "SELECT decision, reversed_at_utc FROM report_duplicate_links WHERE duplicate_accident_id = ?",
            (duplicate_id,),
        ).fetchall()
        assert links and links[0]["reversed_at_utc"] is not None


def test_deletion_and_consent_withdrawal_hide_the_report(client: TestClient) -> None:
    dataset_id = _pilot_dataset(client)
    _configure_pilot(client, dataset_id)
    _enable(client, "pilot_intake", dataset_id)
    created = client.post("/api/v1/pilot/reports", json=_report_body(dataset_id)).json()
    report_id = int(created["report_public_id"].split("-")[1])
    credential = created["tracking_credential"]
    _enable(client, "pilot_tracking", dataset_id)

    withdrawn = client.post(
        f"/api/v1/pilot/reports/{report_id}/withdraw-consent",
        json={"dataset_id": dataset_id, "credential": credential, "reason": "changed my mind"},
    )
    assert withdrawn.status_code == 200, withdrawn.text
    assert withdrawn.json()["consent_withdrawn_at_utc"]

    # The tracked report is now invisible and a deletion request exists.
    tracked = client.post("/api/v1/pilot/tracking", json={"dataset_id": dataset_id, "credential": credential})
    assert tracked.status_code == 404

    from app.db import db_session

    with db_session() as conn:
        row = conn.execute("SELECT deleted_at_utc, consent_withdrawn FROM accidents WHERE id = ?", (report_id,)).fetchone()
        assert row["deleted_at_utc"] and int(row["consent_withdrawn"]) == 1
        requests = conn.execute(
            "SELECT requested_by, status FROM report_deletion_requests WHERE accident_id = ?", (report_id,)
        ).fetchall()
        assert requests and requests[0]["requested_by"] == "reporter"


def test_a_reporter_can_withdraw_by_the_public_id_they_were_given(client: TestClient) -> None:
    """A participant holds `RS-000042` and a credential — never an internal row id."""
    dataset_id = _pilot_dataset(client)
    _configure_pilot(client, dataset_id)
    _enable(client, "pilot_intake", dataset_id)
    _enable(client, "pilot_tracking", dataset_id)
    created = client.post(
        "/api/v1/pilot/reports", json=_report_body(dataset_id), headers={"Idempotency-Key": "wd-1"}
    ).json()
    public_id = created["report_public_id"]
    credential = created["tracking_credential"]

    # A participant (not a steward) must reach the route at all; otherwise withdrawal is refused
    # with "Insufficient server-side role" before ownership is even checked.
    reporter = {**CITIZEN_HEADERS}
    wrong = client.post(
        f"/api/v1/pilot/reports/{public_id}/withdraw-consent",
        headers=reporter,
        json={"dataset_id": dataset_id, "credential": "ZZZZ-ZZZZ-ZZZZ", "reason": "probe"},
    )
    assert wrong.status_code == 404

    withdrawn = client.post(
        f"/api/v1/pilot/reports/{public_id}/withdraw-consent",
        headers=reporter,
        json={"dataset_id": dataset_id, "credential": credential, "reason": "changed my mind"},
    )
    assert withdrawn.status_code == 200, withdrawn.text
    assert withdrawn.json()["consent_withdrawn_at_utc"]

    tracked = client.post(
        "/api/v1/pilot/tracking",
        headers=reporter,
        json={"dataset_id": dataset_id, "credential": credential},
    )
    assert tracked.status_code == 404

    junk = client.post(
        f"/api/v1/pilot/reports/not-a-report/withdraw-consent",
        headers=reporter,
        json={"dataset_id": dataset_id, "credential": credential, "reason": "probe"},
    )
    assert junk.status_code == 422


def test_publication_requires_separate_approval_and_suppresses_small_cells(client: TestClient) -> None:
    dataset_id = _pilot_dataset(client)
    _configure_pilot(client, dataset_id)
    _enable(client, "pilot_intake", dataset_id)

    # Publication refused while the dataset-level decision is missing.
    refused = client.post("/api/v1/pilot/publication/rebuild", json={"dataset_id": dataset_id})
    assert refused.status_code == 403

    from app.db import db_session

    with db_session() as conn:
        conn.execute(
            "UPDATE dataset_sources SET is_publishable = 1, user_disclosure_approved = 1 WHERE id = ?",
            (dataset_id,),
        )
    # Flag still off: still refused.
    still_off = client.post("/api/v1/pilot/publication/rebuild", json={"dataset_id": dataset_id})
    assert still_off.status_code == 403

    _enable(client, "pilot_publication", dataset_id)

    # One verified report in one cell is below the minimum cell size and must be suppressed.
    created = client.post("/api/v1/pilot/reports", json=_report_body(dataset_id)).json()
    report_id = int(created["report_public_id"].split("-")[1])
    client.post(
        "/api/v1/pilot/moderation",
        json={"dataset_id": dataset_id, "accident_id": report_id, "action": "verify", "reason": "verified"},
    )
    published = client.post(
        "/api/v1/pilot/publication/rebuild",
        json={"dataset_id": dataset_id, "disclosure_policy_reference": "POLICY-TEST-1"},
    )
    assert published.status_code == 200, published.text
    assert published.json()["published_cells"] == 0
    assert published.json()["suppressed_cells"] == 1

    aggregates = client.get("/api/v1/pilot/aggregates").json()
    assert aggregates["enabled"] is True
    assert all(item["suppressed"] is True and item["report_count"] == 0 for item in aggregates["aggregates"])

    # Unverified reports are never in the public output.
    assert all(item["suppression_reason"] == "small_cell_suppression" for item in aggregates["aggregates"])


def test_synthetic_datasets_can_never_be_published(client: TestClient) -> None:
    """The *database* refuses to mark a synthetic dataset publishable, not only the API."""
    from app.db import db_session

    meta = client.get("/api/v1/meta").json()
    demo_dataset = int(meta["active_dataset"]["id"])
    with pytest.raises(sqlite3.IntegrityError):
        with db_session() as conn:
            conn.execute("UPDATE dataset_sources SET is_publishable = 1 WHERE id = ?", (demo_dataset,))


def test_bootstrap_is_sanitized_and_anonymous(client: TestClient) -> None:
    bootstrap = client.get("/api/v1/pilot/bootstrap")
    assert bootstrap.status_code == 200
    body = bootstrap.json()
    assert body["consent_version"].startswith("pilot-consent")
    assert body["privacy"]["free_text"] == "not accepted"
    assert body["intake_enabled"] is False
    assert "trajectory" not in json.dumps(body).lower()
    # No report content, coordinates or credentials.
    assert "credential" not in json.dumps(body).lower()
    assert "raw_lon" not in json.dumps(body)


def test_threat_model_is_published(client: TestClient) -> None:
    model = client.get("/api/v1/pilot/threat-model").json()
    assert model["threats"] and model["launch_gates"]
    ids = {threat["id"] for threat in model["threats"]}
    assert {"T1", "T2", "T4", "T7"} <= ids


def test_timezone_conversion_helper_handles_offsets_and_dst() -> None:
    from app.services.pilot import local_to_utc

    assert local_to_utc("2026-11-10T18:20:00") == "2026-11-10T14:50:00Z"
    # An explicit offset is honoured, not re-interpreted as local.
    assert local_to_utc("2026-11-10T18:20:00+00:00") == "2026-11-10T18:20:00Z"
    # Iran observed DST in 2021 (UTC+04:30 between March and September).
    assert local_to_utc("2021-06-01T12:00:00") == "2021-06-01T07:30:00Z"
    assert local_to_utc("2021-01-15T12:00:00") == "2021-01-15T08:30:00Z"
    with pytest.raises(ValueError):
        local_to_utc("not-a-timestamp")


def test_incident_payload_omits_reporter_material_for_non_stewards(client: TestClient) -> None:
    """Analysis workspaces get event fields; only a server-side steward gets reporter material.

    Runs against the synthetic dataset: once a *real* dataset exists the security policy restricts
    every analytical read to a steward, which is a separate and stricter rule.
    """
    dataset_id = int(client.get("/api/v1/meta").json()["active_dataset"]["id"])

    query = {
        "dataset_id": dataset_id,
        "verification_mode": "all_active",
        "severity_codes": None,
        "category_codes": None,
    }
    as_steward = client.post("/api/v1/analytics/cmv", json=query)
    assert as_steward.status_code == 200, as_steward.text
    steward_features = as_steward.json()["incidents_geojson"]["features"]
    assert steward_features
    steward_keys = set(steward_features[0]["properties"])
    assert "observational_radius_m" in steward_keys

    as_reporter = client.post(
        "/api/v1/analytics/cmv", json=query, headers=CITIZEN_HEADERS
    )
    assert as_reporter.status_code == 200, as_reporter.text
    reporter_features = as_reporter.json()["incidents_geojson"]["features"]
    assert reporter_features
    reporter_keys = set(reporter_features[0]["properties"])

    # The event-level fields an analysis view needs are still present.
    assert {"category_code", "severity_code", "occurred_at_utc", "vgi_credibility_score"} <= reporter_keys
    # Reporter material is absent, not blanked, so it cannot be rendered or logged.
    forbidden = {"narrative", "raw_lon", "raw_lat", "snap_candidates", "observational_radius_m"}
    assert not (forbidden & reporter_keys)
    assert "Free text" not in json.dumps(reporter_features[0]["properties"])
