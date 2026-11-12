"""Restricted pilot API: intake, secure tracking, moderation, disclosure and flags.

Every mutating route here is either *disabled by default* (feature flag / profile guard) or
requires a server-side steward role. The API never enables a real pilot implicitly.
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query, Request

from ..runtime import app_config
from ..db import dataset_profile, db_session, feature_enabled, load_feature_flag
from ..schemas import (
    PilotCorrectionRequest,
    PilotFeatureFlagRequest,
    PilotModerationRequest,
    PilotPublishRequest,
    PilotReportSubmitRequest,
    PilotTrackingRequest,
    PilotWithdrawalRequest,
)
from ..security import identity
from ..services.pilot import (
    CONSENT_VERSION,
    apply_retention_policy,
    moderate_report,
    public_aggregates,
    publish_public_aggregates,
    resolve_tracking_credential,
    set_feature_flag,
    submit_pilot_report,
    withdraw_consent,
)
from ..services.study_area_service import resolve_study_area

router = APIRouter(prefix="/api/v1/pilot")


def _principal() -> Any:
    return identity.get()


def _require_role(*roles: str) -> str:
    """Enforce a server-side role. A client-supplied persona is never authority."""
    principal = _principal()
    if principal is None or principal.user_id is None:
        raise HTTPException(status_code=401, detail="Authenticated server-side identity required.")
    if roles and principal.role not in roles:
        raise HTTPException(status_code=403, detail="Insufficient server-side role.")
    return principal.role


def _resolve_pilot_dataset(conn: sqlite3.Connection, dataset_id: int | None) -> int:
    if dataset_id is not None:
        row = conn.execute("SELECT id FROM dataset_sources WHERE id = ?", (int(dataset_id),)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Dataset #{dataset_id} not found.")
        return int(row["id"])
    row = conn.execute(
        "SELECT id FROM dataset_sources WHERE is_active = 1 ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No dataset initialized.")
    return int(row["id"])


@router.get("/status")
def pilot_status() -> dict[str, Any]:
    """Machine-readable statement of which pilot capabilities are enabled, and why."""
    with db_session() as conn:
        active = conn.execute(
            "SELECT id FROM dataset_sources WHERE is_active = 1 ORDER BY id DESC LIMIT 1"
        ).fetchone()
        dataset_id = int(active["id"]) if active else None
        profile = dataset_profile(conn, dataset_id)
        flags = {
            key: load_feature_flag(conn, key)
            for key in (
                "pilot_intake",
                "pilot_publication",
                "pilot_tracking",
                "pilot_corrections",
            )
        }
        config = (
            conn.execute(
                "SELECT * FROM pilot_configuration WHERE dataset_id = ?", (dataset_id,)
            ).fetchone()
            if dataset_id is not None
            else None
        )
    return {
        "process_profile": app_config().PROFILE_KEY,
        "process_profile_database": str(app_config().profile_database_path() or ""),
        "dataset": profile,
        "flags": flags,
        "consent_version": CONSENT_VERSION,
        "pilot_configuration": dict(config) if config else None,
        "release_gates": {
            "owner_and_hosting_approved": bool(config) if config else False,
            "legal_privacy_review_recorded": bool(config and config["approval_reference"]),
            "identity_model_recorded": bool(config and config["identity_model"]),
            "intake_enabled": bool(flags["pilot_intake"]["enabled"]),
            "publication_enabled": bool(flags["pilot_publication"]["enabled"]),
        },
        "note": (
            "Every capability is off by default. Enabling one requires a recorded owner and "
            "approval reference; enabling intake never enables publication."
        ),
    }


@router.get("/bootstrap")
def pilot_bootstrap() -> dict[str, Any]:
    """Sanitized, non-sensitive framing for an anonymous pilot participant.

    This exists so ``/api/v1/meta`` (which exposes dataset rows and personas) can stay
    authenticated as soon as a real dataset is present. It returns only map framing, the
    bilingual labels, the taxonomy needed by the intake form and the published aggregate status.
    """
    from ..services.pilot import _coarse_cell  # local import: one shared cell definition

    with db_session() as conn:
        row = conn.execute(
            "SELECT id, study_area_key, is_synthetic, profile_key, calibration_status "
            "FROM dataset_sources WHERE is_active = 1 ORDER BY id DESC LIMIT 1"
        ).fetchone()
        dataset_id = int(row["id"]) if row else None
        categories = [
            {"code": r["code"], "label": r["label"]}
            for r in conn.execute(
                "SELECT code, label FROM accident_categories ORDER BY id"
            ).fetchall()
        ]
        severities = [
            {"code": r["code"], "rank": int(r["rank"]), "label": r["label"]}
            for r in conn.execute(
                "SELECT code, rank, label FROM severity_levels ORDER BY rank"
            ).fetchall()
        ]
        aggregates = public_aggregates(conn, dataset_id=dataset_id)
        extract = (
            conn.execute(
                "SELECT extract_version, license, snapshot_date, source_attribution "
                "FROM network_extracts WHERE dataset_id = ? ORDER BY id DESC LIMIT 1",
                (dataset_id,),
            ).fetchone()
            if dataset_id is not None
            else None
        )
        study_area = None
        if row:
            try:
                study_area = resolve_study_area(str(row["study_area_key"]), conn).to_json()
            except ValueError:
                study_area = None
        intake_enabled = feature_enabled(conn, "pilot_intake") if dataset_id else False
        tracking_enabled = feature_enabled(conn, "pilot_tracking") if dataset_id else False
    return {
        "dataset_id": dataset_id,
        "intake_enabled": intake_enabled,
        "tracking_enabled": tracking_enabled,
        "publication": {
            "enabled": aggregates.get("enabled", False),
            "status": aggregates.get("status"),
            "minimum_cell_size": aggregates.get("minimum_cell_size"),
        },
        "study_area": study_area,
        "categories": categories,
        "severities": severities,
        "network_extract": dict(extract) if extract else None,
        "consent_version": CONSENT_VERSION,
        "privacy": {
            "free_text": "not accepted",
            "photos": "not accepted",
            "identity_documents": "not accepted",
            "public_output": "coarse district aggregates only, small cells suppressed",
            "exact_coordinates": "stored for review, never returned by this endpoint",
        },
        "timezone": "Asia/Tehran",
    }


@router.get("/configuration")
def pilot_configuration(dataset_id: int | None = Query(default=None)) -> dict[str, Any]:
    """Operator-facing pilot configuration (never includes credentials or secrets)."""
    _require_role("data_steward")
    with db_session() as conn:
        ds = _resolve_pilot_dataset(conn, dataset_id)
        row = conn.execute("SELECT * FROM pilot_configuration WHERE dataset_id = ?", (ds,)).fetchone()
        extracts = [
            {
                "extract_version": r["extract_version"],
                "checksum_sha256": r["checksum_sha256"],
                "license": r["license"],
                "attribution": r["source_attribution"],
                "snapshot_date": r["snapshot_date"],
                "segment_count": int(r["segment_count"]),
                "ambiguous_crossing_count": int(r["ambiguous_crossing_count"]),
                "imported_at_utc": r["imported_at_utc"],
            }
            for r in conn.execute(
                "SELECT * FROM network_extracts WHERE dataset_id = ? ORDER BY id DESC", (ds,)
            ).fetchall()
        ]
    return {
        "dataset_id": ds,
        "configuration": dict(row) if row else None,
        "network_extracts": extracts,
    }


@router.get("/aggregates")
def pilot_public_aggregates(dataset_id: int | None = Query(default=None)) -> dict[str, Any]:
    """Privacy-reviewed public aggregates. Returns nothing unless publication is approved."""
    with db_session() as conn:
        ds = dataset_id
        if ds is None:
            row = conn.execute(
                "SELECT id FROM dataset_sources WHERE is_active = 1 ORDER BY id DESC LIMIT 1"
            ).fetchone()
            ds = int(row["id"]) if row else None
        return public_aggregates(conn, dataset_id=ds)


@router.post("/reports")
def submit_pilot_report_endpoint(
    req: PilotReportSubmitRequest,
    request: Request,
    idempotency_key: str = Header(default="", alias="Idempotency-Key"),
) -> dict[str, Any]:
    """Bounded structured intake. Disabled unless the ``pilot_intake`` flag is on."""
    identity_hint = req.reporter_identity_hint or (request.client.host if request.client else "anonymous")
    import hashlib

    identity_hash = hashlib.sha256(identity_hint.encode("utf-8")).hexdigest()[:32]
    try:
        with db_session() as conn:
            ds = _resolve_pilot_dataset(conn, req.dataset_id)
            return submit_pilot_report(
                conn,
                dataset_id=ds,
                occurred_at_local=req.occurred_at_local,
                category_code=req.category_code,
                severity_code=req.severity_code,
                location_uncertainty_m=req.location_uncertainty_m,
                lon=req.lon,
                lat=req.lat,
                x_m=req.x_m,
                y_m=req.y_m,
                selected_segment_id=req.selected_segment_id,
                consent_given=req.consent_given,
                consent_locale=req.consent_locale,
                reporter_user_id=_principal().user_id if _principal() else None,
                transport_mode=req.transport_mode,
                involved_vehicles=req.involved_vehicles,
                involved_pedestrians=req.involved_pedestrians,
                involved_cyclists=req.involved_cyclists,
                reporter_identity_hash=identity_hash,
                idempotency_key=idempotency_key,
                timezone_name=req.timezone,
                allow_outside_study_area=req.allow_outside_study_area,
            )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/tracking")
def pilot_tracking_endpoint(req: PilotTrackingRequest) -> dict[str, Any]:
    """Verify a tracking credential sent in the *body* (never a URL) and return status only."""
    try:
        with db_session() as conn:
            ds = _resolve_pilot_dataset(conn, req.dataset_id)
            return resolve_tracking_credential(conn, dataset_id=ds, credential=req.credential)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _report_accident_id(conn, dataset_id: int, report_ref: str) -> int:
    """Resolve ``42``, ``RS-000042`` (or a zero-padded variant) to an accident id in this dataset."""
    raw = str(report_ref).strip()
    digits = raw.split("-")[-1] if raw.upper().startswith("RS-") else raw
    if not digits.isdigit():
        raise ValueError("Report reference must be a numeric id or a public id such as RS-000042.")
    accident_id = int(digits)
    row = conn.execute(
        "SELECT id FROM accidents WHERE id = ? AND dataset_id = ?", (accident_id, dataset_id)
    ).fetchone()
    if not row:
        raise ValueError("Report not found in this dataset.")
    return accident_id


@router.post("/reports/{report_id}/withdraw-consent")
def withdraw_consent_endpoint(report_id: str, req: PilotWithdrawalRequest) -> dict[str, Any]:
    """Withdraw consent for one report.

    The path segment accepts either the numeric id or the public id (``RS-000123``) the reporter
    was actually shown: a person cannot be expected to translate one into the other, and failing
    here would silently deny the withdrawal right.
    """
    try:
        with db_session() as conn:
            ds = _resolve_pilot_dataset(conn, req.dataset_id)
            try:
                accident_id = _report_accident_id(conn, ds, report_id)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
            if req.credential:
                # A reporter may prove ownership with the tracking credential; otherwise a
                # steward must perform the withdrawal on their behalf.
                resolve_tracking_credential(conn, dataset_id=ds, credential=req.credential)
            else:
                _require_role("data_steward")
            return withdraw_consent(conn, dataset_id=ds, accident_id=accident_id, reason=req.reason)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/moderation")
def moderation_endpoint(req: PilotModerationRequest) -> dict[str, Any]:
    role = _require_role("data_steward")
    try:
        with db_session() as conn:
            ds = _resolve_pilot_dataset(conn, req.dataset_id)
            return moderate_report(
                conn,
                dataset_id=ds,
                accident_id=req.accident_id,
                action=req.action,
                actor_role=role,
                actor_user_id=_principal().user_id if _principal() else None,
                reason=req.reason,
                canonical_accident_id=req.canonical_accident_id,
            )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/corrections")
def correction_endpoint(req: PilotCorrectionRequest) -> dict[str, Any]:
    role = _require_role("data_steward")
    try:
        with db_session() as conn:
            ds = _resolve_pilot_dataset(conn, req.dataset_id)
            if not feature_enabled(conn, "pilot_corrections"):
                raise PermissionError("Correction workflow is disabled (pilot_corrections flag).")
            cur = conn.execute(
                """
                INSERT INTO report_corrections
                (accident_id, requested_by, field_name, previous_value_json, new_value_json,
                 status, reason, created_at_utc, applied_at_utc)
                VALUES (?, 'steward', ?, ?, ?, 'applied', ?, ?, ?)
                """,
                (
                    req.accident_id,
                    req.field_name,
                    json.dumps(req.previous_value),
                    json.dumps(req.new_value),
                    req.reason,
                    _now(),
                    _now(),
                ),
            )
            return {
                "correction_id": int(cur.lastrowid),
                "accident_id": req.accident_id,
                "status": "applied",
                "actor_role": role,
            }
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/publication/rebuild")
def publication_endpoint(req: PilotPublishRequest) -> dict[str, Any]:
    _require_role("data_steward")
    try:
        with db_session() as conn:
            ds = _resolve_pilot_dataset(conn, req.dataset_id)
            return publish_public_aggregates(
                conn,
                dataset_id=ds,
                disclosure_policy_reference=req.disclosure_policy_reference,
            )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/retention/apply")
def retention_endpoint(dataset_id: int | None = Query(default=None)) -> dict[str, Any]:
    _require_role("data_steward")
    with db_session() as conn:
        ds = _resolve_pilot_dataset(conn, dataset_id)
        return apply_retention_policy(conn, dataset_id=ds)


@router.post("/flags")
def feature_flag_endpoint(req: PilotFeatureFlagRequest) -> dict[str, Any]:
    role = _require_role("data_steward")
    if req.key not in {"pilot_intake", "pilot_publication", "pilot_tracking", "pilot_corrections"}:
        raise HTTPException(status_code=422, detail=f"Unknown pilot feature flag {req.key!r}.")
    try:
        with db_session() as conn:
            if req.enabled:
                # Enabling intake additionally requires an isolated pilot profile dataset.
                ds = _resolve_pilot_dataset(conn, req.dataset_id)
                profile = dataset_profile(conn, ds)
                if req.key in {"pilot_intake", "pilot_publication"} and profile["profile_key"] != "pilot":
                    raise ValueError(
                        "Intake and publication flags can only be enabled for a dataset in the 'pilot' profile."
                    )
            return set_feature_flag(
                conn,
                key=req.key,
                enabled=req.enabled,
                owner=req.owner,
                approval_reference=req.approval_reference,
                actor_role=role,
                notes=req.notes,
            )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/threat-model")
def threat_model() -> dict[str, Any]:
    """Published threat model summary so operators and reviewers see the same controls."""
    return {
        "scope": "restricted, invite-only citizen reporting pilot",
        "assets": [
            "reporter location history",
            "report identity and tracking credentials",
            "report occurrence times",
            "aggregate disclosure outputs",
        ],
        "threats": [
            {
                "id": "T1",
                "threat": "Re-identification from exact coordinates or small cells",
                "control": "coarse district cells, minimum cell size suppression, no raw coordinates in any public read",
            },
            {
                "id": "T2",
                "threat": "Credential theft or guessing",
                "control": "24-character high-entropy credential, HMAC lookup + PBKDF2 verifier, rotation and revocation tables, body-only transport, rate limiting",
            },
            {
                "id": "T3",
                "threat": "Credential leakage via URL, logs or referrer",
                "control": "tracking uses POST bodies only; credential never appears in a path, query string or audit payload",
            },
            {
                "id": "T4",
                "threat": "Report flooding / abuse",
                "control": "database-backed per-identity fixed-window limits, bounded enum inputs, no free text or attachments",
            },
            {
                "id": "T5",
                "threat": "Unauthorized moderation or disclosure",
                "control": "server-side role enforcement on every restricted read/write, auditable moderation events, independent publication flag",
            },
            {
                "id": "T6",
                "threat": "Irreversible or unattributable deletions",
                "control": "deletion requests, moderation events and reversible restore; retention job is auditable",
            },
            {
                "id": "T7",
                "threat": "Mixing synthetic demo and real pilot data",
                "control": "separate profiles/databases, synthetic guard, intake refuses synthetic datasets",
            },
        ],
        "launch_gates": [
            "named owner and operator recorded in pilot_configuration",
            "hosting and data-residency reviewed",
            "identity and anti-abuse method approved",
            "consent text and retention period approved",
            "disclosure granularity and legal basis reviewed",
            "credential pepper and rotation procedure documented",
            "backup, monitoring and disablement runbook rehearsed",
        ],
    }


def _now() -> str:
    from ..db import utc_now_iso

    return utc_now_iso()
