"""Restricted citizen-reporting pilot: intake, credentials, moderation and disclosure.

Every function in this module is *guarded*. Nothing here enables a real pilot by itself:

* ``submit_pilot_report`` refuses to run unless the ``pilot_intake`` feature flag is enabled, the
  dataset belongs to the ``pilot`` profile, the dataset is non-synthetic and an untouched
  synthetic-only demo guard is not violated.
* ``resolve_tracking_credential`` is gated by ``pilot_tracking`` and always returns a coarse,
  privacy-reviewed view — never raw coordinates, candidate lists or internal scores.
* ``publish_public_aggregates`` is gated by ``pilot_publication`` *independently* of intake, and
  suppresses small cells.

The plaintext tracking credential is generated once, returned to the caller exactly once and
never persisted: only an HMAC lookup token plus a salted verifier are stored. Credentials are
never accepted in a URL path/query — they are sent in a POST body so they cannot leak into
access logs or referrers.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import json
import math
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from ..runtime import app_config
from ..context import dataset_context
from ..crs import to_metric, to_wgs84
from ..db import feature_enabled, log_audit_event, utc_now_iso
from .map_matching import compute_topological_snap_candidates, parse_utc_iso

# Consent text versions are explicit and stored with every report so a later policy change cannot
# retroactively claim consent that was never given.
CONSENT_VERSION = "pilot-consent-v1"
CONSENT_SCOPE = "restricted_pilot_aggregate"
_MIN_REPORT_RETENTION_DAYS = 30

_CREDENTIAL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _coarse_cell(lon: float, lat: float) -> tuple[str, float, float]:
    """Snap a coordinate to a coarse district cell; the exact point is never published."""
    step = max(0.001, float(app_config().PUBLIC_CELL_DEGREES))
    cell_lon = math.floor(lon / step) * step + step / 2.0
    cell_lat = math.floor(lat / step) * step + step / 2.0
    return f"{cell_lon:.4f}_{cell_lat:.4f}", round(cell_lon, 4), round(cell_lat, 4)


def local_to_utc(value: str, *, timezone_name: str | None = None) -> str:
    """Convert a pilot-local timestamp to UTC ISO-8601.

    Accepts either an ISO timestamp with an explicit offset (used as-is) or a naive local
    timestamp (interpreted in ``timezone_name`` through IANA rules, including historical DST).
    """
    text = (value or "").strip()
    if not text:
        raise ValueError("occurred_at_local is required")
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        timezone_name = timezone_name or app_config().PILOT_TIMEZONE
        try:
            tz = ZoneInfo(timezone_name)
        except Exception as exc:  # pragma: no cover - tzdata always ships with Python
            raise ValueError(f"Unknown pilot timezone {timezone_name}") from exc
        parsed = parsed.replace(tzinfo=tz)
    return parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def consume_rate_limit(
    conn: sqlite3.Connection,
    *,
    bucket: str,
    limit: int,
    window_seconds: int = 60,
    identity_hint: str = "anonymous",
) -> dict[str, Any]:
    """Database-backed fixed-window limiter shared by every worker process.

    Unlike an in-process deque this is correct with multiple Uvicorn workers or containers, and
    it survives a restart. The bucket key is an HMAC of a coarse identity hint, so no raw IP or
    credential is stored.
    """
    now = int(datetime.now(timezone.utc).timestamp())
    window_start = now - (now % max(1, int(window_seconds)))
    digest = hashlib.sha256(f"{bucket}:{identity_hint}".encode("utf-8")).hexdigest()[:32]
    key = f"{bucket}:{digest}"
    conn.execute(
        """
        INSERT INTO rate_limit_windows (bucket, window_start_epoch, counter) VALUES (?, ?, 1)
        ON CONFLICT(bucket, window_start_epoch) DO UPDATE SET counter = counter + 1
        """,
        (key, window_start),
    )
    row = conn.execute(
        "SELECT counter FROM rate_limit_windows WHERE bucket = ? AND window_start_epoch = ?",
        (key, window_start),
    ).fetchone()
    used = int(row["counter"]) if row else 0
    # Opportunistic cleanup keeps the table bounded without a scheduler.
    conn.execute(
        "DELETE FROM rate_limit_windows WHERE window_start_epoch < ?", (window_start - 86400,)
    )
    return {
        "allowed": used <= int(limit),
        "used": used,
        "limit": int(limit),
        "window_seconds": int(window_seconds),
        "retry_after_seconds": max(0, window_start + int(window_seconds) - now),
    }


def _idempotent_response(
    conn: sqlite3.Connection, *, scope: str, key: str, request_hash: str
) -> dict[str, Any] | None:
    if not key:
        return None
    row = conn.execute(
        "SELECT request_hash, response_json FROM request_idempotency WHERE scope = ? AND idempotency_key = ?",
        (scope, key),
    ).fetchone()
    if not row:
        return None
    if not hmac.compare_digest(str(row["request_hash"]), request_hash):
        raise ValueError("Idempotency key was already used for a different request payload.")
    return json.loads(row["response_json"])


def _store_idempotent_response(
    conn: sqlite3.Connection, *, scope: str, key: str, request_hash: str, response: dict[str, Any]
) -> None:
    if not key:
        return
    conn.execute(
        """
        INSERT INTO request_idempotency (scope, idempotency_key, request_hash, response_json, created_at_utc)
        VALUES (?, ?, ?, ?, ?)
        """,
        (scope, key, request_hash, json.dumps(response, sort_keys=True), utc_now_iso()),
    )


def request_fingerprint(payload: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()


def _generate_credential() -> str:
    return "-".join(
        "".join(secrets.choice(_CREDENTIAL_ALPHABET) for _ in range(4)) for _ in range(3)
    )


def _credential_material(credential: str, *, pepper: str) -> tuple[str, str, str]:
    """Return (lookup_hmac, verifier, salt) without ever storing the plaintext credential.

    ``lookup_hmac`` is an HMAC of the credential with a server pepper, used for an indexed lookup.
    ``verifier`` is a salted PBKDF2 hash, checked in constant time to confirm the presented
    credential.
    """
    normalized = credential.replace("-", "").strip().upper()
    lookup = hmac.new(
        pepper.encode("utf-8"), normalized.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    salt = secrets.token_hex(16)
    verifier = hashlib.pbkdf2_hmac(
        "sha256", normalized.encode("utf-8"), salt.encode("utf-8"), 120_000
    ).hex()
    return lookup, verifier, salt


def _pepper(conn: sqlite3.Connection) -> str:
    """Server-side credential pepper.

    Preferred source is ``ROADSCOPE_CREDENTIAL_PEPPER`` (set out of band, rotated by an operator).
    If it is absent a deterministic installation-scale derivation keeps the HMAC stable across
    restarts; that fallback is documented as *not* a substitute for a managed secret.
    """
    configured = os.getenv("ROADSCOPE_CREDENTIAL_PEPPER", "")
    if configured.strip():
        return configured.strip()
    path = os.getenv("ROADSCOPE_SQLITE_PATH", os.getenv("UAI_SQLITE_PATH", "roadscope"))
    return hashlib.sha256(f"roadscope-pilot-pepper::{path}".encode("utf-8")).hexdigest()


def _pilot_dataset_or_error(conn: sqlite3.Connection, dataset_id: int) -> dict[str, Any]:
    row = conn.execute(
        "SELECT id, profile_key, is_synthetic, study_area_key, calibration_status FROM dataset_sources WHERE id = ?",
        (int(dataset_id),),
    ).fetchone()
    if not row:
        raise ValueError(f"Dataset #{dataset_id} not found.")
    # These are *policy* refusals (403), not malformed requests (422): a synthetic dataset or a
    # non-pilot profile is never writable by the pilot, however well-formed the payload is.
    if bool(row["is_synthetic"]):
        raise PermissionError(
            "Pilot intake refuses synthetic datasets. Synthetic observation sets are never rewritten."
        )
    if str(row["profile_key"]) != "pilot":
        raise PermissionError(
            "Pilot intake requires a dataset created under the isolated 'pilot' profile."
        )
    return dict(row)


def _assert_flag(conn: sqlite3.Connection, key: str) -> dict[str, Any]:
    flag = conn.execute(
        "SELECT enabled, owner, approval_reference FROM feature_flags WHERE key = ?", (key,)
    ).fetchone()
    if not flag or not int(flag["enabled"]):
        raise PermissionError(
            f"Feature '{key}' is disabled. Activation requires a recorded owner and approval reference."
        )
    return {"key": key, "owner": str(flag["owner"]), "approval_reference": str(flag["approval_reference"])}


def submit_pilot_report(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    occurred_at_local: str,
    category_code: str,
    severity_code: str,
    location_uncertainty_m: float,
    lon: float | None = None,
    lat: float | None = None,
    x_m: float | None = None,
    y_m: float | None = None,
    selected_segment_id: int | None = None,
    consent_given: bool = False,
    consent_locale: str = "fa",
    reporter_user_id: int | None = None,
    transport_mode: str = "vehicle_occupant",
    involved_vehicles: int = 1,
    involved_pedestrians: int = 0,
    involved_cyclists: int = 0,
    reporter_identity_hash: str = "",
    idempotency_key: str = "",
    timezone_name: str | None = None,
    allow_outside_study_area: bool = True,
) -> dict[str, Any]:
    """Bounded structured intake for a consenting pilot participant.

    Deliberately excluded: free text, photos, licence plates, identity documents, victim details.
    The endpoint accepts only enumerated categories/severities, a time, an uncertainty radius and
    a location. Raw coordinates are stored but never exposed by an unauthenticated read.
    """
    timezone_name = timezone_name or app_config().PILOT_TIMEZONE
    flag = _assert_flag(conn, "pilot_intake")
    dataset = _pilot_dataset_or_error(conn, dataset_id)
    if not consent_given:
        raise ValueError("Explicit informed consent is required before a report can be stored.")
    if not (3.0 <= float(location_uncertainty_m) <= 500.0):
        raise ValueError("location_uncertainty_m must be between 3 and 500 metres.")

    fingerprint = request_fingerprint(
        {
            "dataset_id": dataset_id,
            "occurred_at_local": occurred_at_local,
            "category_code": category_code,
            "severity_code": severity_code,
            "lon": lon,
            "lat": lat,
            "x_m": x_m,
            "y_m": y_m,
            "uncertainty": location_uncertainty_m,
            "transport_mode": transport_mode,
        }
    )
    cached = _idempotent_response(
        conn, scope=f"pilot_submit:{dataset_id}", key=idempotency_key, request_hash=fingerprint
    )
    if cached is not None:
        return {**cached, "idempotent_replay": True}

    limit = consume_rate_limit(
        conn,
        bucket="pilot_report_hour",
        limit=app_config().RATE_LIMIT_REPORTS_PER_HOUR,
        window_seconds=3600,
        identity_hint=reporter_identity_hash or "anonymous",
    )
    if not limit["allowed"]:
        raise TimeoutError(
            f"Reporting rate limit reached ({limit['used']}/{limit['limit']} per hour)."
        )

    ctx = dataset_context(conn, dataset_id)
    epsg = ctx.canonical_epsg
    if x_m is not None and y_m is not None:
        rx_m, ry_m = float(x_m), float(y_m)
        rlon, rlat = to_wgs84(rx_m, ry_m, epsg)
    elif lon is not None and lat is not None:
        rlon, rlat = float(lon), float(lat)
        rx_m, ry_m = to_metric(rlon, rlat, epsg)
    else:
        raise ValueError("A report needs a location: either lon/lat or x_m/y_m.")

    occurred_utc = local_to_utc(occurred_at_local, timezone_name=timezone_name)
    occurred_dt = parse_utc_iso(occurred_utc)
    now_dt = datetime.now(timezone.utc)
    if occurred_dt > now_dt + timedelta(minutes=5):
        raise ValueError("Occurrence time cannot be in the future.")
    if (now_dt - occurred_dt).days > 30:
        raise ValueError("Occurrence time exceeds the 30-day pilot reporting horizon.")

    cat_row = conn.execute("SELECT id, code FROM accident_categories WHERE code = ?", (category_code,)).fetchone()
    sev_row = conn.execute("SELECT id, code FROM severity_levels WHERE code = ?", (severity_code,)).fetchone()
    if not cat_row:
        raise ValueError(f"Unknown accident category: {category_code}")
    if not sev_row:
        raise ValueError(f"Unknown severity level: {severity_code}")

    cands = compute_topological_snap_candidates(
        conn,
        dataset_id=dataset_id,
        raw_x_m=rx_m,
        raw_y_m=ry_m,
        observational_radius_m=float(location_uncertainty_m),
        category_code=category_code,
    )
    chosen = None
    unmatched = 1
    confidence = "unmatched"
    if cands:
        if selected_segment_id is not None:
            chosen = next((c for c in cands if c["segment_id"] == selected_segment_id), cands[0])
        else:
            chosen = cands[0]
        unmatched = 0
        top_probability = float(chosen.get("snap_probability") or 0.0)
        if top_probability < 0.55 or (len(cands) > 1 and top_probability - float(cands[1].get("snap_probability") or 0.0) < 0.12):
            confidence = "uncertain"
        else:
            confidence = "confident"

    cell_key, cell_lon, cell_lat = _coarse_cell(rlon, rlat)
    credential_plain = _generate_credential()
    lookup, verifier, salt = _credential_material(credential_plain, pepper=_pepper(conn))
    now = utc_now_iso()

    retention_row = conn.execute(
        "SELECT retention_days FROM pilot_configuration WHERE dataset_id = ?", (dataset_id,)
    ).fetchone()
    retention_days = max(
        _MIN_REPORT_RETENTION_DAYS,
        int(retention_row["retention_days"]) if retention_row else 365,
    )
    retention_until = (now_dt + timedelta(days=retention_days)).strftime("%Y-%m-%dT%H:%M:%SZ")

    provenance = {
        "profile_key": "pilot",
        "intake_feature_flag": "pilot_intake",
        "approval_reference": flag["approval_reference"],
        "consent_version": CONSENT_VERSION,
        "timezone": timezone_name,
        "recorded_occurred_at_utc": occurred_utc,
        "snap_confidence": confidence,
        "synthetic": False,
        "demo_guard": "pilot profile isolated from synthetic datasets",
    }
    cur = conn.execute(
        """
        INSERT INTO accidents
        (dataset_id, source_type, verification_status, reporter_user_id, category_id, severity_id,
         occurred_at_utc, reported_at_utc, reporting_lag_min, involved_vehicles, involved_pedestrians,
         involved_cyclists, emergency_response_present, narrative, observational_radius_m, srid,
         raw_x_m, raw_y_m, raw_lon, raw_lat,
         snapped_x_m, snapped_y_m, snapped_lon, snapped_lat,
         snapped_segment_id, snapped_lixel_id, linear_offset_m, orthogonal_snap_dist_m,
         snap_probability, snap_candidates_json, vgi_credibility_score, witness_count,
         is_false_alarm_gt, created_at_utc, provenance_json, retention_until_utc, unmatched, coarse_cell_key,
         reporter_identity_hash)
        VALUES (?, 'citizen_vgi', 'unverified_raw_vgi', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.5, 1, 0, ?, ?, ?, ?, ?, ?)
        """,
        (
            dataset_id,
            reporter_user_id,
            int(cat_row["id"]),
            int(sev_row["id"]),
            occurred_utc,
            now,
            round(max(0.0, (now_dt - occurred_dt).total_seconds() / 60.0), 2),
            max(0, int(involved_vehicles)),
            max(0, int(involved_pedestrians)),
            max(0, int(involved_cyclists)),
            float(location_uncertainty_m),
            epsg,
            rx_m,
            ry_m,
            rlon,
            rlat,
            chosen["snapped_x_m"] if chosen else None,
            chosen["snapped_y_m"] if chosen else None,
            chosen["snapped_lon"] if chosen else None,
            chosen["snapped_lat"] if chosen else None,
            chosen["segment_id"] if chosen else None,
            chosen["lixel_id"] if chosen else None,
            chosen["linear_offset_m"] if chosen else None,
            chosen["orthogonal_dist_m"] if chosen else None,
            chosen["snap_probability"] if chosen else None,
            json.dumps(cands[:5]),
            now,
            json.dumps(provenance, sort_keys=True),
            retention_until,
            1 if unmatched else 0,
            cell_key,
            reporter_identity_hash,
        ),
    )
    accident_id = int(cur.lastrowid)
    conn.execute(
        """
        INSERT INTO report_consents (accident_id, consent_version, consent_scope, locale, consented_at_utc)
        VALUES (?, ?, ?, ?, ?)
        """,
        (accident_id, CONSENT_VERSION, CONSENT_SCOPE, consent_locale, now),
    )
    conn.execute(
        """
        INSERT INTO report_access_credentials
        (accident_id, credential_hmac, credential_verifier, verifier_salt, issued_at_utc)
        VALUES (?, ?, ?, ?, ?)
        """,
        (accident_id, lookup, verifier, salt, now),
    )

    duplicate_hint = _duplicate_hint(conn, dataset_id=dataset_id, rx_m=rx_m, ry_m=ry_m, occurred_dt=occurred_dt)
    conn.execute(
        """
        INSERT INTO report_moderation_events
        (dataset_id, accident_id, actor_user_id, actor_role, action, previous_state_json,
         new_state_json, reason, reversible, created_at_utc)
        VALUES (?, ?, ?, 'citizen_reporter', 'submit', '{}', ?, 'pilot intake', 0, ?)
        """,
        (
            dataset_id,
            accident_id,
            reporter_user_id,
            json.dumps({"verification_status": "unverified_raw_vgi", "snap_confidence": confidence}),
            now,
        ),
    )
    if duplicate_hint:
        conn.execute(
            """
            INSERT OR IGNORE INTO report_duplicate_links
            (dataset_id, canonical_accident_id, duplicate_accident_id, decision, created_at_utc)
            VALUES (?, ?, ?, 'suggested', ?)
            """,
            (dataset_id, int(duplicate_hint["accident_id"]), accident_id, now),
        )

    log_audit_event(
        conn,
        actor_user_id=reporter_user_id,
        actor_role="citizen_reporter",
        action_type="SUBMIT_PILOT_REPORT",
        entity_type="accidents",
        entity_id=accident_id,
        after_state={
            "snap_confidence": confidence,
            "unmatched": bool(unmatched),
            "coarse_cell_key": cell_key,
            "consent_version": CONSENT_VERSION,
        },
    )

    response = {
        "report_public_id": f"RS-{accident_id:06d}",
        "dataset_id": dataset_id,
        "occurred_at_utc": occurred_utc,
        "occurred_at_local_input": occurred_at_local,
        "timezone": timezone_name,
        "verification_status": "unverified_raw_vgi",
        "snap_confidence": confidence,
        "unmatched": bool(unmatched),
        "uncertainty_radius_m": float(location_uncertainty_m),
        "candidate_count": len(cands),
        "duplicate_suggestion": duplicate_hint,
        "coarse_location": {"lon": cell_lon, "lat": cell_lat, "cell_key": cell_key},
        "tracking_credential": credential_plain,
        "tracking_credential_note": (
            "Shown once. Store it privately; it is never written to URLs, logs or responses again."
        ),
        "retention_until_utc": retention_until,
        "consent_version": CONSENT_VERSION,
        "synthetic": False,
        "idempotent_replay": False,
    }
    _store_idempotent_response(
        conn,
        scope=f"pilot_submit:{dataset_id}",
        key=idempotency_key,
        request_hash=fingerprint,
        response=response,
    )
    return response


def _duplicate_hint(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    rx_m: float,
    ry_m: float,
    occurred_dt: datetime,
) -> dict[str, Any] | None:
    """Suggest *possible* duplicates without ever auto-merging them."""
    rows = conn.execute(
        """
        SELECT id, snapped_x_m, snapped_y_m, occurred_at_utc FROM accidents
        WHERE dataset_id = ? AND deleted_at_utc IS NULL AND id != 0
          AND occurred_at_utc BETWEEN ? AND ?
        ORDER BY occurred_at_utc DESC LIMIT 25
        """,
        (
            dataset_id,
            (occurred_dt - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            (occurred_dt + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        ),
    ).fetchall()
    best = None
    best_distance = float("inf")
    for row in rows:
        sx = row["snapped_x_m"]
        sy = row["snapped_y_m"]
        if sx is None or sy is None:
            continue
        distance = math.hypot(float(sx) - rx_m, float(sy) - ry_m)
        if distance <= 120.0 and distance < best_distance:
            best_distance = distance
            best = {
                "accident_id": int(row["id"]),
                "distance_m": round(distance, 1),
                "occurred_at_utc": row["occurred_at_utc"],
                "action": "review_suggestion_only",
            }
    return best


def resolve_tracking_credential(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    credential: str,
) -> dict[str, Any]:
    """Return the reporter's own, coarse status view after verifying the credential.

    Gated by the ``pilot_tracking`` flag. The response deliberately omits raw coordinates,
    candidate snap lists, internal credibility scores and any other reporter's data.
    """
    _assert_flag(conn, "pilot_tracking")
    limit = consume_rate_limit(
        conn,
        bucket="pilot_tracking_minute",
        limit=app_config().RATE_LIMIT_TRACKING_PER_MINUTE,
        window_seconds=60,
        identity_hint=hashlib.sha256((credential or "none").encode()).hexdigest()[:12],
    )
    if not limit["allowed"]:
        raise TimeoutError("Tracking rate limit reached; try again shortly.")

    pepper = _pepper(conn)
    lookup, _verifier, _salt = _credential_material(credential, pepper=pepper)
    row = conn.execute(
        """
        SELECT c.id AS credential_id, c.accident_id, c.credential_verifier, c.verifier_salt,
               c.revoked_at_utc, a.dataset_id, a.verification_status, a.occurred_at_utc,
               a.coarse_cell_key, a.retention_until_utc, a.deleted_at_utc, a.duplicate_of_id
        FROM report_access_credentials c
        JOIN accidents a ON a.id = c.accident_id
        WHERE c.credential_hmac = ? AND a.dataset_id = ?
        """,
        (lookup, int(dataset_id)),
    ).fetchone()
    if not row or row["revoked_at_utc"] or row["deleted_at_utc"]:
        raise LookupError("Unknown or revoked tracking credential.")
    normalized = credential.replace("-", "").strip().upper()
    candidate = hashlib.pbkdf2_hmac(
        "sha256", normalized.encode("utf-8"), str(row["verifier_salt"]).encode("utf-8"), 120_000
    ).hex()
    if not hmac.compare_digest(candidate, str(row["credential_verifier"])):
        raise LookupError("Unknown or revoked tracking credential.")

    conn.execute(
        "UPDATE report_access_credentials SET last_used_at_utc = ? WHERE id = ?",
        (utc_now_iso(), int(row["credential_id"])),
    )
    status = str(row["verification_status"])
    # Report whether this report is actually inside a published aggregate. The check reads the
    # public table, so the answer cannot claim publication that has not happened.
    published = False
    if row["coarse_cell_key"]:
        cell = conn.execute(
            "SELECT suppressed, report_count FROM public_report_aggregates "
            "WHERE dataset_id = ? AND cell_key = ?",
            (int(dataset_id), str(row["coarse_cell_key"])),
        ).fetchone()
        published = bool(cell) and not int(cell["suppressed"]) and int(cell["report_count"]) > 0
    return {
        "report_public_id": f"RS-{int(row['accident_id']):06d}",
        "status": status,
        "status_label": _status_label(status),
        "status_label_fa": _status_label_fa(status),
        "occurred_at_utc": row["occurred_at_utc"],
        "coarse_cell_key": row["coarse_cell_key"],
        "merged_into": f"RS-{int(row['duplicate_of_id']):06d}" if row["duplicate_of_id"] else None,
        "retention_until_utc": row["retention_until_utc"],
        "can_request_correction": feature_enabled(conn, "pilot_corrections"),
        # Withdrawal needs only the credential the reporter already holds, so it is always offered
        # while the report still exists. It is not gated behind an approval flag by design.
        "can_withdraw_consent": True,
        "publication_note": "published" if published else "not_published",
        "note": "Status only. Exact coordinates and other reporters' details are never returned.",
    }


_STATUS_LABELS = {
    "unverified_raw_vgi": ("submitted_unverified", "ثبت‌شدهٔ تأییدنشده"),
    "corroborated_pending": ("in_review", "در حال بررسی"),
    "verified_canonical": ("reviewed", "بررسی‌شده"),
    "flagged_review": ("in_review", "در حال بررسی"),
    "rejected_false_alarm": ("rejected", "رد‌شده"),
    "merged_duplicate": ("merged_duplicate", "ادغام‌شده با گزارش دیگر"),
}


def _status_label(status: str) -> str:
    """Machine-stable English status token (Persian is in ``status_label_fa``)."""
    return _STATUS_LABELS.get(status, (status, status))[0]


def _status_label_fa(status: str) -> str:
    return _STATUS_LABELS.get(status, (status, status))[1]


def moderate_report(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    accident_id: int,
    action: str,
    actor_role: str,
    actor_user_id: int | None = None,
    reason: str = "",
    canonical_accident_id: int | None = None,
) -> dict[str, Any]:
    """Auditable, reversible moderation. Every transition writes a moderation event."""
    row = conn.execute(
        "SELECT * FROM accidents WHERE id = ? AND dataset_id = ?", (int(accident_id), int(dataset_id))
    ).fetchone()
    if not row:
        raise ValueError(f"Report #{accident_id} not found in dataset #{dataset_id}.")
    previous_status = str(row["verification_status"])
    previous_duplicate = row["duplicate_of_id"]
    new_status = previous_status
    target_duplicate = previous_duplicate
    reversible = 1

    if action == "verify":
        new_status = "verified_canonical"
    elif action == "reject":
        new_status = "rejected_false_alarm"
    elif action == "flag_review":
        new_status = "flagged_review"
    elif action == "merge":
        if canonical_accident_id is None or int(canonical_accident_id) == int(accident_id):
            raise ValueError("merge requires a different canonical_accident_id")
        canonical = conn.execute(
            "SELECT id FROM accidents WHERE id = ? AND dataset_id = ?",
            (int(canonical_accident_id), int(dataset_id)),
        ).fetchone()
        if not canonical:
            raise ValueError("Canonical report must exist in the same dataset.")
        new_status = "merged_duplicate"
        target_duplicate = int(canonical_accident_id)
    elif action == "unmerge":
        new_status = "unverified_raw_vgi"
        target_duplicate = None
    elif action == "restore":
        new_status = previous_status if previous_status != "merged_duplicate" else "unverified_raw_vgi"
        target_duplicate = None
        conn.execute(
            "UPDATE accidents SET deleted_at_utc = NULL, deleted_reason = '' WHERE id = ?", (int(accident_id),)
        )
    elif action == "delete":
        new_status = previous_status
        reversible = 1
        conn.execute(
            "UPDATE accidents SET deleted_at_utc = ?, deleted_reason = ? WHERE id = ?",
            (utc_now_iso(), (reason or "moderation delete")[:200], int(accident_id)),
        )
        conn.execute(
            """
            INSERT INTO report_deletion_requests
            (accident_id, requested_by, status, reason, requested_at_utc, executed_at_utc)
            VALUES (?, 'steward', 'executed', ?, ?, ?)
            """,
            (int(accident_id), (reason or "moderation delete")[:200], utc_now_iso(), utc_now_iso()),
        )
    else:
        raise ValueError(f"Unsupported moderation action {action!r}.")

    now = utc_now_iso()
    conn.execute(
        "UPDATE accidents SET verification_status = ?, duplicate_of_id = ? WHERE id = ?",
        (new_status, target_duplicate, int(accident_id)),
    )
    cur = conn.execute(
        """
        INSERT INTO report_moderation_events
        (dataset_id, accident_id, actor_user_id, actor_role, action, previous_state_json,
         new_state_json, reason, reversible, created_at_utc)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            int(dataset_id),
            int(accident_id),
            actor_user_id,
            actor_role,
            action,
            json.dumps({"verification_status": previous_status, "duplicate_of_id": previous_duplicate}),
            json.dumps({"verification_status": new_status, "duplicate_of_id": target_duplicate}),
            reason[:500],
            reversible,
            now,
        ),
    )
    event_id = int(cur.lastrowid)
    if action == "merge":
        conn.execute(
            """
            INSERT INTO report_duplicate_links
            (dataset_id, canonical_accident_id, duplicate_accident_id, decision, merge_event_id, created_at_utc)
            VALUES (?, ?, ?, 'merged', ?, ?)
            ON CONFLICT(canonical_accident_id, duplicate_accident_id) DO UPDATE SET
                decision = 'merged', merge_event_id = excluded.merge_event_id, reversed_at_utc = NULL
            """,
            (int(dataset_id), int(canonical_accident_id), int(accident_id), event_id, now),
        )
    elif action in {"unmerge", "restore"}:
        conn.execute(
            """
            UPDATE report_duplicate_links SET decision = 'rejected', reversed_at_utc = ?
            WHERE dataset_id = ? AND duplicate_accident_id = ? AND reversed_at_utc IS NULL
            """,
            (now, int(dataset_id), int(accident_id)),
        )

    log_audit_event(
        conn,
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        action_type=f"MODERATE_REPORT_{action.upper()}",
        entity_type="accidents",
        entity_id=int(accident_id),
        before_state={"verification_status": previous_status, "duplicate_of_id": previous_duplicate},
        after_state={"verification_status": new_status, "duplicate_of_id": target_duplicate},
    )
    return {
        "accident_id": int(accident_id),
        "action": action,
        "previous_status": previous_status,
        "new_status": new_status,
        "duplicate_of_id": target_duplicate,
        "moderation_event_id": event_id,
        "reversible": bool(reversible),
        "deleted": action == "delete",
    }


def publish_public_aggregates(
    conn: sqlite3.Connection,
    *,
    dataset_id: int,
    actor_role: str = "data_steward",
    disclosure_policy_reference: str = "",
) -> dict[str, Any]:
    """Recompute privacy-reviewed public aggregates for verified reports only.

    Publication requires *both* the independent ``pilot_publication`` feature flag and an explicit
    dataset-level publication decision (``is_publishable`` + ``user_disclosure_approved``). Small
    cells are suppressed, not rounded: a cell below ``PUBLIC_AGGREGATE_MIN_CELLS`` is stored with
    ``suppressed = 1`` and a zero count, so no small-cell value is ever recoverable from an
    aggregate read.
    """
    _assert_flag(conn, "pilot_publication")
    ds = conn.execute(
        "SELECT is_synthetic, is_publishable, user_disclosure_approved, profile_key FROM dataset_sources WHERE id = ?",
        (int(dataset_id),),
    ).fetchone()
    if not ds:
        raise ValueError(f"Dataset #{dataset_id} not found.")
    if bool(ds["is_synthetic"]):
        raise ValueError("Synthetic datasets are never published as observed citizen reports.")
    if str(ds["profile_key"]) != "pilot":
        raise ValueError("Public disclosure is restricted to datasets in the 'pilot' profile.")
    if not int(ds["is_publishable"]) or not int(ds["user_disclosure_approved"]):
        raise PermissionError(
            "Dataset publication is not approved (is_publishable and user_disclosure_approved must both be set)."
        )

    rows = conn.execute(
        """
        SELECT a.coarse_cell_key, a.verification_status, a.occurred_at_utc,
               c.code AS category_code, sv.rank AS severity_rank
        FROM accidents a
        JOIN accident_categories c ON c.id = a.category_id
        JOIN severity_levels sv ON sv.id = a.severity_id
        WHERE a.dataset_id = ?
          AND a.deleted_at_utc IS NULL
          AND a.canonical_parent_id IS NULL
          AND a.duplicate_of_id IS NULL
          AND a.consent_withdrawn = 0
          AND a.unmatched = 0
          AND a.verification_status IN ('verified_canonical', 'corroborated_pending')
        """,
        (int(dataset_id),),
    ).fetchall()

    buckets: dict[tuple[str, str, str, str], int] = {}
    for row in rows:
        occurred = parse_utc_iso(str(row["occurred_at_utc"]))
        period_start = occurred.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        period_end = period_start.replace(year=period_start.year + 1)
        rank = int(row["severity_rank"])
        band = "fatal" if rank >= 4 else ("injury" if rank >= 2 else "pdo")
        key = (
            str(row["coarse_cell_key"] or "unknown"),
            period_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            str(row["category_code"]),
            band,
        )
        buckets[key] = buckets.get(key, 0) + 1

    now = utc_now_iso()
    conn.execute("DELETE FROM public_report_aggregates WHERE dataset_id = ?", (int(dataset_id),))
    suppressed = 0
    published = 0
    for (cell_key, period_start, category_code, band), count in sorted(buckets.items()):
        period_dt = parse_utc_iso(period_start)
        period_end = period_dt.replace(year=period_dt.year + 1).strftime("%Y-%m-%dT%H:%M:%SZ")
        is_small = count < app_config().PUBLIC_AGGREGATE_MIN_CELLS
        if is_small:
            suppressed += 1
        else:
            published += 1
        conn.execute(
            """
            INSERT INTO public_report_aggregates
            (dataset_id, cell_key, period_start_utc, period_end_utc, category_code, severity_band,
             report_count, suppressed, suppression_reason, disclosure_policy_reference, computed_at_utc)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                int(dataset_id),
                cell_key,
                period_start,
                period_end,
                category_code,
                band,
                0 if is_small else int(count),
                1 if is_small else 0,
                "small_cell_suppression" if is_small else "",
                disclosure_policy_reference,
                now,
            ),
        )
    log_audit_event(
        conn,
        actor_user_id=None,
        actor_role=actor_role,
        action_type="PUBLISH_PUBLIC_AGGREGATES",
        entity_type="dataset_sources",
        entity_id=int(dataset_id),
        after_state={
            "published_cells": published,
            "suppressed_cells": suppressed,
            "min_cell": app_config().PUBLIC_AGGREGATE_MIN_CELLS,
            "policy_reference": disclosure_policy_reference,
        },
    )
    return {
        "dataset_id": int(dataset_id),
        "published_cells": published,
        "suppressed_cells": suppressed,
        "minimum_cell_size": app_config().PUBLIC_AGGREGATE_MIN_CELLS,
        "disclosure_policy_reference": disclosure_policy_reference,
        "computed_at_utc": now,
        "status": "published_aggregates_only",
    }


def public_aggregates(
    conn: sqlite3.Connection, *, dataset_id: int | None = None
) -> dict[str, Any]:
    """Read-only public aggregates. Withdraws everything unless publication is enabled."""
    if dataset_id is None:
        row = conn.execute(
            "SELECT id FROM dataset_sources WHERE is_active = 1 ORDER BY id DESC LIMIT 1"
        ).fetchone()
        dataset_id = int(row["id"]) if row else None
    enabled = feature_enabled(conn, "pilot_publication")
    if not enabled or dataset_id is None:
        return {
            "enabled": False,
            "status": "publication_disabled",
            "reason": "Public disclosure requires the independently approved pilot_publication flag.",
            "aggregates": [],
        }
    rows = conn.execute(
        """
        SELECT cell_key, period_start_utc, period_end_utc, category_code, severity_band,
               report_count, suppressed, suppression_reason, computed_at_utc
        FROM public_report_aggregates WHERE dataset_id = ? ORDER BY cell_key, category_code
        """,
        (dataset_id,),
    ).fetchall()
    return {
        "enabled": True,
        "status": "published_aggregates_only",
        "minimum_cell_size": app_config().PUBLIC_AGGREGATE_MIN_CELLS,
        "disclosure_note": (
            "Verified reports only, aggregated to coarse district cells and annual periods. "
            "Individual reports, exact coordinates and small cells are never disclosed."
        ),
        "aggregates": [
            {
                "cell_key": r["cell_key"],
                "period_start_utc": r["period_start_utc"],
                "period_end_utc": r["period_end_utc"],
                "category_code": r["category_code"],
                "severity_band": r["severity_band"],
                "report_count": int(r["report_count"]),
                "suppressed": bool(r["suppressed"]),
                "suppression_reason": r["suppression_reason"],
                "computed_at_utc": r["computed_at_utc"],
            }
            for r in rows
        ],
    }


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    try:
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    except sqlite3.Error:  # pragma: no cover
        return False
    return any(str(r[1]) == column for r in rows)


def set_feature_flag(
    conn: sqlite3.Connection,
    *,
    key: str,
    enabled: bool,
    owner: str,
    approval_reference: str,
    actor_role: str = "data_steward",
    notes: str = "",
) -> dict[str, Any]:
    """Flip a pilot flag. Enabling requires a non-empty owner **and** approval reference."""
    if enabled and (not owner.strip() or not approval_reference.strip()):
        raise ValueError("Enabling a pilot feature requires a recorded owner and approval_reference.")
    conn.execute(
        """
        INSERT INTO feature_flags (key, enabled, owner, approval_reference, updated_at_utc, notes)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            enabled = excluded.enabled, owner = excluded.owner,
            approval_reference = excluded.approval_reference,
            updated_at_utc = excluded.updated_at_utc, notes = excluded.notes
        """,
        (key, 1 if enabled else 0, owner, approval_reference, utc_now_iso(), notes[:500]),
    )
    log_audit_event(
        conn,
        actor_user_id=None,
        actor_role=actor_role,
        action_type="SET_FEATURE_FLAG",
        entity_type="feature_flags",
        entity_id=None,
        after_state={"key": key, "enabled": bool(enabled), "owner": owner, "approval_reference": approval_reference},
    )
    return {
        "key": key,
        "enabled": bool(enabled),
        "owner": owner,
        "approval_reference": approval_reference,
    }


def withdraw_consent(
    conn: sqlite3.Connection, *, dataset_id: int, accident_id: int, reason: str = ""
) -> dict[str, Any]:
    """Withdraw consent: hide the report from every read and schedule deletion."""
    row = conn.execute(
        "SELECT id FROM accidents WHERE id = ? AND dataset_id = ?", (int(accident_id), int(dataset_id))
    ).fetchone()
    if not row:
        raise ValueError(f"Report #{accident_id} not found in dataset #{dataset_id}.")
    now = utc_now_iso()
    conn.execute(
        "UPDATE accidents SET consent_withdrawn = 1 WHERE id = ?", (int(accident_id),)
    )
    conn.execute(
        "UPDATE report_consents SET withdrawn_at_utc = ? WHERE accident_id = ? AND withdrawn_at_utc IS NULL",
        (now, int(accident_id)),
    )
    conn.execute(
        "UPDATE accidents SET deleted_at_utc = COALESCE(deleted_at_utc, ?), deleted_reason = ? WHERE id = ?",
        (now, f"consent withdrawn: {reason}"[:200], int(accident_id)),
    )
    conn.execute(
        """
        INSERT INTO report_deletion_requests
        (accident_id, requested_by, status, reason, requested_at_utc)
        VALUES (?, 'reporter', 'requested', ?, ?)
        """,
        (int(accident_id), reason[:200], now),
    )
    conn.execute(
        """
        INSERT INTO report_moderation_events
        (dataset_id, accident_id, actor_role, action, previous_state_json, new_state_json, reason, reversible, created_at_utc)
        VALUES (?, ?, 'citizen_reporter', 'withdraw_consent', '{}', ?, ?, 0, ?)
        """,
        (
            int(dataset_id),
            int(accident_id),
            json.dumps({"consent_withdrawn_at_utc": now}),
            reason[:500],
            now,
        ),
    )
    return {"accident_id": int(accident_id), "consent_withdrawn_at_utc": now, "deletion_requested": True}


def apply_retention_policy(conn: sqlite3.Connection, *, dataset_id: int) -> dict[str, Any]:
    """Mark reports past their retention date as deleted (auditable, not silently purged)."""
    now = utc_now_iso()
    rows = conn.execute(
        """
        SELECT id FROM accidents
        WHERE dataset_id = ? AND deleted_at_utc IS NULL
          AND retention_until_utc IS NOT NULL AND retention_until_utc < ?
        """,
        (int(dataset_id), now),
    ).fetchall()
    for row in rows:
        accident_id = int(row["id"])
        conn.execute(
            "UPDATE accidents SET deleted_at_utc = ?, deleted_reason = 'retention_expired' WHERE id = ?",
            (now, accident_id),
        )
        conn.execute(
            """
            INSERT INTO report_deletion_requests
            (accident_id, requested_by, status, reason, requested_at_utc, executed_at_utc)
            VALUES (?, 'retention_job', 'executed', 'retention_expired', ?, ?)
            """,
            (accident_id, now, now),
        )
    return {"dataset_id": int(dataset_id), "expired_reports": len(rows), "applied_at_utc": now}
