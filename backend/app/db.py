from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .config import MIGRATIONS_DIR, SQLITE_DB_PATH
from .migrations import apply_migrations

_SPATIALITE_LOADED_ONCE = False


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get_connection(db_path: Path | None = None) -> sqlite3.Connection:
    target = db_path or SQLITE_DB_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(target), timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA busy_timeout = 15000;")
    try:
        conn.enable_load_extension(True)
        conn.load_extension("mod_spatialite")
        conn.enable_load_extension(False)
    except Exception:
        # Built-in SQLite R*Tree + GEOS/PROJ via Shapely/PyProj remain fully active
        pass
    return conn


@contextmanager
def db_session(db_path: Path | None = None) -> Iterator[sqlite3.Connection]:
    conn = get_connection(db_path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def load_feature_flag(conn: sqlite3.Connection, key: str) -> dict[str, Any]:
    """Read a database feature flag. A missing row is treated as disabled (fail closed)."""
    row = conn.execute(
        "SELECT key, enabled, owner, approval_reference, updated_at_utc, notes FROM feature_flags WHERE key = ?",
        (key,),
    ).fetchone()
    if not row:
        return {"key": key, "enabled": False, "owner": "", "approval_reference": "", "notes": ""}
    return {
        "key": str(row["key"]),
        "enabled": bool(row["enabled"]),
        "owner": str(row["owner"]),
        "approval_reference": str(row["approval_reference"]),
        "updated_at_utc": str(row["updated_at_utc"]),
        "notes": str(row["notes"]),
    }


def feature_enabled(conn: sqlite3.Connection, key: str) -> bool:
    return bool(load_feature_flag(conn, key)["enabled"])


def dataset_profile(conn: sqlite3.Connection, dataset_id: int | None) -> dict[str, Any]:
    """Profile + provenance for a dataset (never inferred from a process-global setting)."""
    if dataset_id is None:
        row = conn.execute(
            "SELECT * FROM dataset_sources WHERE is_active = 1 ORDER BY id DESC LIMIT 1"
        ).fetchone()
    else:
        row = conn.execute("SELECT * FROM dataset_sources WHERE id = ?", (int(dataset_id),)).fetchone()
    if not row:
        return {"dataset_id": None, "profile_key": "", "is_synthetic": None, "purpose": ""}
    keys = row.keys()
    profile = str(row["profile_key"]) if "profile_key" in keys else "demo"
    purpose_row = conn.execute(
        "SELECT purpose, allows_real_reports, allows_publication FROM dataset_profiles WHERE profile_key = ?",
        (profile,),
    ).fetchone()
    return {
        "dataset_id": int(row["id"]),
        "profile_key": profile,
        "purpose": str(purpose_row["purpose"]) if purpose_row else "",
        "allows_real_reports": bool(purpose_row["allows_real_reports"]) if purpose_row else False,
        "allows_publication": bool(purpose_row["allows_publication"]) if purpose_row else False,
        "is_synthetic": bool(row["is_synthetic"]),
        "calibration_status": str(row["calibration_status"]) if "calibration_status" in keys else "uncalibrated",
        "is_publishable": bool(row["is_publishable"]) if "is_publishable" in keys else False,
        "user_disclosure_approved": bool(row["user_disclosure_approved"]) if "user_disclosure_approved" in keys else False,
        "study_area_key": str(row["study_area_key"]) if "study_area_key" in keys else "",
        "archived_at_utc": row["archived_at_utc"] if "archived_at_utc" in keys else None,
    }


def init_schema_and_reference_data(db_path: Path | None = None) -> None:
    schema_sql = (MIGRATIONS_DIR / "002_spatialite_schema.sql").read_text(encoding="utf-8")
    with db_session(db_path) as conn:
        conn.executescript(schema_sql)
        apply_migrations(conn, MIGRATIONS_DIR)
        now = utc_now_iso()

        # Seed the persona users
        # Location-neutral demo personas: they are not tied to any city so the platform can be
        # instantiated for any study area without rewriting seed data.
        users = [
            ("dr_sim", "Dr. Samira Rahmani (Simulation Lab)", "simulation_scientist", 0.98),
            ("citizen_maya", "Maya (VGI Contributor)", "citizen_reporter", 0.72),
            ("citizen_tariq", "Tariq (VGI Contributor)", "citizen_reporter", 0.81),
            ("steward_lead", "Ing. Hannah Krause (Lead Steward)", "data_steward", 0.99),
            ("prof_okabe_gis", "Prof. Elena Rostova (GIScience Lab)", "gis_researcher", 0.99),
            ("eng_safety", "Dipl.-Ing. Felix Bauer (Traffic Safety)", "safety_engineer", 0.97),
            ("analyst_chen", "Dr. Mei-Ling Chen (Urban Mobility)", "mobility_analyst", 0.96),
        ]
        for uname, fname, role, trust in users:
            conn.execute(
                """
                INSERT OR IGNORE INTO users (username, full_name, role, trust_weight, created_at_utc)
                VALUES (?, ?, ?, ?, ?)
                """,
                (uname, fname, role, trust, now),
            )

        # Seed Severity Levels (Highway Safety Manual / PIARC calibrated EPDO weights)
        severities = [
            ("PDO", 1, "Property Damage Only", 1.0, "#38bdf8", "Minor material damage, no physical injury"),
            ("MINOR_INJURY", 2, "Minor / Slight Injury", 3.5, "#facc15", "Non-incapacitating outpatient injury"),
            ("SERIOUS_INJURY", 3, "Serious / Severe Injury", 12.0, "#f97316", "Hospitalization / incapacitating trauma"),
            ("FATAL", 4, "Fatal Crash", 45.0, "#ef4444", "Fatal outcome within 30 days of collision"),
        ]
        for code, rank, label, epdo, color, desc in severities:
            conn.execute(
                """
                INSERT OR IGNORE INTO severity_levels (code, rank, label, epdo_weight, color_hex, description)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (code, rank, label, epdo, color, desc),
            )

        # Seed Accident Categories with topological road-class compatibility priors
        categories = [
            (
                "REAR_END",
                "Rear-End Queue Collision",
                {
                    "motorway_overpass": 1.0,
                    "primary_arterial": 1.0,
                    "secondary_corridor": 0.9,
                    "bridge_link": 0.95,
                    "collector": 0.75,
                    "local_street": 0.45,
                },
                30,
                "Longitudinal rear-end impact during braking or signalized queue formation.",
            ),
            (
                "ANGLE_INTERSECTION",
                "Turning / Angle Junction Conflict",
                {
                    "motorway_overpass": 0.08,
                    "primary_arterial": 1.0,
                    "secondary_corridor": 1.0,
                    "bridge_link": 0.55,
                    "collector": 0.95,
                    "local_street": 0.80,
                },
                20,
                "Right-angle or left-turn conflict at multi-leg intersection nodes.",
            ),
            (
                "PEDESTRIAN_CROSSING",
                "Pedestrian Crossing Impact",
                {
                    "motorway_overpass": 0.02,
                    "primary_arterial": 0.88,
                    "secondary_corridor": 1.0,
                    "bridge_link": 0.60,
                    "collector": 1.0,
                    "local_street": 1.0,
                },
                15,
                "Vehicle-pedestrian conflict on surface urban streets and crosswalks (prohibited on elevated motorways).",
            ),
            (
                "CYCLIST_CONFLICT",
                "Cyclist Lane / Dooring / Hook Conflict",
                {
                    "motorway_overpass": 0.02,
                    "primary_arterial": 0.82,
                    "secondary_corridor": 1.0,
                    "bridge_link": 0.85,
                    "collector": 1.0,
                    "local_street": 0.95,
                },
                15,
                "Right-hook, overtaking, or bike-lane conflict along surface corridors.",
            ),
            (
                "SIDESWIPE",
                "Lane-Change Sideswipe",
                {
                    "motorway_overpass": 1.0,
                    "primary_arterial": 0.95,
                    "secondary_corridor": 0.80,
                    "bridge_link": 0.90,
                    "collector": 0.50,
                    "local_street": 0.30,
                },
                40,
                "Lateral sideswipe during multi-lane weaving or merging.",
            ),
            (
                "RUN_OFF_ROAD",
                "Single-Vehicle Curve / Wet Skid",
                {
                    "motorway_overpass": 0.95,
                    "primary_arterial": 0.85,
                    "secondary_corridor": 0.80,
                    "bridge_link": 0.95,
                    "collector": 0.70,
                    "local_street": 0.55,
                },
                35,
                "Loss of control along curved geometry, bridge deck, or wet pavement.",
            ),
            (
                "MULTI_VEHICLE_PILEUP",
                "High-Speed Multi-Vehicle Chain Collision",
                {
                    "motorway_overpass": 1.0,
                    "primary_arterial": 0.85,
                    "secondary_corridor": 0.45,
                    "bridge_link": 0.80,
                    "collector": 0.20,
                    "local_street": 0.08,
                },
                50,
                "Three or more vehicles in high-energy corridor chain impact.",
            ),
        ]
        for code, label, priors, min_spd, desc in categories:
            conn.execute(
                """
                INSERT OR IGNORE INTO accident_categories
                (code, label, compatible_road_classes_json, typical_speed_min_kmh, description)
                VALUES (?, ?, ?, ?, ?)
                """,
                (code, label, json.dumps(priors), min_spd, desc),
            )


def log_audit_event(
    conn: sqlite3.Connection,
    *,
    actor_user_id: int | None,
    actor_role: str,
    action_type: str,
    entity_type: str,
    entity_id: int | None,
    before_state: dict[str, Any] | None = None,
    after_state: dict[str, Any] | None = None,
) -> None:
    from .security import demo_enabled, identity

    principal = identity.get()
    if principal is not None and not demo_enabled():
        actor_user_id, actor_role = principal.user_id, principal.role
    conn.execute(
        """
        INSERT INTO audit_logs
        (actor_user_id, actor_role, action_type, entity_type, entity_id, before_state_json, after_state_json, created_at_utc)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            actor_user_id,
            actor_role,
            action_type,
            entity_type,
            entity_id,
            json.dumps(before_state) if before_state is not None else None,
            json.dumps(after_state) if after_state is not None else None,
            utc_now_iso(),
        ),
    )
