# RoadScope Operations & Security Runbook

This runbook is written for the person who deploys and operates RoadScope. It records what the
system does, what it deliberately does **not** do yet, and how to recover.

> **Status:** the platform is a **research prototype on synthetic data**. Real citizen-report
> collection, public disclosure and a live pilot remain gated on institutional, privacy and legal
> approval that this document cannot grant. Passing tests and merging a pull request are not
> launch approval.

---

## 1. Storage Engine, CRS Contract & Honest Architecture

RoadScope uses **SQLite with R\*Tree spatial indexing**. It has no PostGIS dependency and needs no
external service.

### 1.1 Coordinate reference system (CRS) contract

| Layer | CRS | Notes |
|---|---|---|
| Analytical / storage | **`dataset_sources.crs_epsg`** per dataset — `EPSG:32639` for the Tehran demo, `EPSG:25832` for the legacy Frankfurt database | Metric metres. Every distance, length, buffer and uncertainty radius is in these units. |
| API boundary (GeoJSON) | **`EPSG:4326`** (WGS84 lon/lat) | Conversion happens only at the GeoJSON/HTTP edge. |
| Web map | `EPSG:4326` | The client projects for display only. |
| Network import input | declared by the caller (`epsg_in`) | Reprojected to the dataset CRS on import. |

Rules that must not be broken:

1. **Never assume a CRS.** Read `canonical_crs` / `canonical_epsg` from `/api/v1/meta` or
   `/api/v1/health`. A hard-coded `3857`, `25832` or `32639` is a defect.
2. **Never reinterpret existing data.** The legacy Frankfurt dataset keeps `EPSG:25832` and is never
   relabelled as Tehran. The Tehran demo keeps `EPSG:32639`.
3. **Never mix a metric value computed in one CRS with a dataset in another.** Use
   `safe_to_metric(lon, lat, ctx.canonical_epsg)` and fail closed (`None`) instead of guessing.
4. Route-level coverage is enforced by tests: `backend/tests/test_platform.py`,
   `test_study_areas_ingest.py`, `test_network_extract.py`.

### 1.2 Profiles (data isolation)

Three profiles keep datasets that must never contaminate one another apart:

| Profile | Purpose | Intake | Publication |
|---|---|---|---|
| `demo` | Synthetic demonstration; the default | never | never |
| `pilot` | Restricted, invite-only real reports | only with recorded approval + flag | separate approval + flag |
| `legacy` | Preserved `EPSG:25832` research database | never | never |

- `ROADSCOPE_PROFILE` selects the process profile; `ROADSCOPE_PROFILE_DB` can point a profile at a
  **different** SQLite file, which is the recommended separation for a pilot.
- The database refuses to mark a synthetic dataset publishable (`CHECK` constraint), and demo mode
  refuses to serve any deployment that contains a non-synthetic dataset (HTTP 503).
- Startup fails with an explicit error rather than silently generating another city's geometry
  when the configured default study area has no demo network generator.

### 1.3 Data provenance

Every dataset carries `profile_key`, `calibration_status` (`uncalibrated` → `research_only` →
`approved`), `network_provenance_json`, `incident_provenance_json`, `is_publishable` and
`user_disclosure_approved`. `/api/v1/meta` republishes these plus a `presentation` block that the
frontend must keep visible, including in screenshots.

Remote URL fetching during import is disabled. Network administration requires a steward and an
empty dataset.

---

## 2. Configuration (`ROADSCOPE_*`, with `UAI_*` legacy aliases)

`.env.example` is the authoritative list. Never commit real tokens.

| Variable | Default | Purpose |
|---|---|---|
| `ROADSCOPE_SQLITE_PATH` | `data/uai.sqlite` | SQLite database path (`UAI_SQLITE_PATH` alias) |
| `ROADSCOPE_PROFILE` | `demo` | Process profile: `demo`, `pilot` or `legacy` |
| `ROADSCOPE_PROFILE_DB` | *(unset)* | Database file for an isolated profile |
| `ROADSCOPE_CANONICAL_EPSG` | `32639` | **Fallback only**; migrated datasets carry their own CRS |
| `ROADSCOPE_DEFAULT_STUDY_AREA` | `tehran` | First-run demo study area |
| `ROADSCOPE_STUDY_AREA_PATHS` | *(unset)* | Extra JSON study-area definitions |
| `ROADSCOPE_DEMO_MODE` | `false` | `true` only for an isolated synthetic sandbox |
| `ROADSCOPE_API_TOKENS` | `{}` | JSON map of bearer token → existing username; set out of band |
| `ROADSCOPE_MAX_IMPORT_BYTES` | `8388608` | Maximum network extract upload |
| `ROADSCOPE_BASEMAP_TILE_URL` | OSM raster URL | **Optional** basemap tiles; empty disables the basemap |
| `ROADSCOPE_BASEMAP_NAME` / `_POLICY_URL` | OSM | Provider name and policy link shown in the UI |
| `ROADSCOPE_PUBLIC_CELL_DEGREES` | `0.005` | Coarse disclosure cell size |
| `ROADSCOPE_PUBLIC_AGGREGATE_MIN_CELLS` | `5` | Below this a cell is suppressed, never rounded |
| `ROADSCOPE_RATE_LIMIT_REPORTS_PER_HOUR` | `10` | Pilot intake budget (DB-backed, shared by workers) |
| `ROADSCOPE_RATE_LIMIT_TRACKING_PER_MINUTE` | `20` | Credential lookup budget (anti-guessing) |
| `ROADSCOPE_RATE_LIMIT_MUTATIONS_PER_MINUTE` | `120` | General authenticated mutation budget |
| `ROADSCOPE_PILOT_TIMEZONE` | `Asia/Tehran` | Default civil time zone for intake timestamps |
| `ROADSCOPE_CREDENTIAL_PEPPER` | derived | **Set this in production.** Without it the pepper is derived from the database path |

### 2.1 Basemap policy

The basemap is **optional**, configured by the operator, and is not an SLA:

- `enabled: false` (no tile URL) → the map draws only offline vector layers, and the UI says so.
- Tiles failing at runtime → the client falls back to the vector layers **with a visible warning**.
- Attribution and the provider policy URL come from the server and are rendered as DOM text.
- Bulk tile downloading is not permitted. Respect the provider's tile policy.

---

## 3. Authentication, Authorization & the Synthetic Demo Guard

- **Server-side identity only.** Roles come from a bearer token mapped to a `users` row; the
  persona selector in the UI is a display hint and never grants a permission.
- **Demo mode** refuses to serve a deployment containing any non-synthetic dataset (503) and
  blocks network/study-area administration plus every pilot mutation (403).
- **Real-data gate.** Once any non-synthetic dataset exists, *all* API access — including GETs,
  exports and read-only POSTs — requires an authenticated steward, except a fixed allow-list of
  anonymous publication paths (`/health`, `/tehran-preview`, `/pilot/aggregates`,
  `/pilot/status`, `/pilot/bootstrap`, `/pilot/threat-model`). `/api/v1/meta` is deliberately **not**
  on that list.
- **Reporter paths.** A pilot participant may call `POST /pilot/reports` and `POST /pilot/tracking`
  without the steward role; ownership for tracking and withdrawal is proven by a high-entropy
  credential, not by a report id.
- **Rate limits are database-backed** (`rate_limit_windows`) so they hold across worker processes,
  not per process.
- **Restricted fields.** `/analytics/cmv` returns reporter narrative, raw coordinates, candidate
  lists and uncertainty radius **only** to a server-side steward. Everyone else receives the
  event-level fields with restricted keys absent.

Do not expose this prototype to real citizen data before the external approvals are recorded.

---

## 4. Versioned Migrations, Backups & Recovery

Ordered SQL in `migrations/` (`002` … `006`) is registered in `schema_migrations` with a SHA-256
checksum.

```bash
# Apply pending migrations (the runner takes a timestamped backup first)
PYTHONPATH=backend python -c "
from app.db import init_schema_and_reference_data
init_schema_and_reference_data()"
```

Rules:

- **Freeze a migration before applying it to a live database.** Editing an already-applied file
  raises a checksum error rather than silently diverging.
- `006_pilot_provenance_lifecycle.sql` adds pilot tables, provenance columns and flags. It has been
  rehearsed on a copy and is **not** applied to the committed demo database; applying it is an
  explicit operator action.
- Upgrading a pre-`003` database creates `data/backups/*.sqlite` automatically.

```bash
# Atomic online backup (refuses to overwrite)
PYTHONPATH=backend python scripts/database.py backup data/uai.sqlite backups/roadscope-2026-11-12.sqlite

# Verify integrity and restore
PYTHONPATH=backend python scripts/database.py restore backups/roadscope-2026-11-12.sqlite data/restored.sqlite
```

Keep large datasets, backups and build artefacts out of Git (`.gitignore` already excludes them).

---

## 5. Network Extract Import (versioned, repeatable)

```bash
curl -X POST http://localhost:8000/api/v1/ingest/network/extract \
  -H "Authorization: Bearer $STEWARD_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "study_area_key": "tehran",
    "dataset_name": "Central Tehran OSM extract",
    "epsg_in": 4326,
    "extract_version": "tehran-osm-2026-06-12",
    "source_url": "https://www.openstreetmap.org/",
    "source_attribution": "© OpenStreetMap contributors",
    "license": "ODbL 1.0",
    "snapshot_date": "2026-06-12",
    "boundary_4326": [51.39, 35.69, 51.40, 35.70],
    "buffer_m": 250,
    "lixel_resolution_m": 25,
    "geojson": { "type": "FeatureCollection", "features": [ /* … */ ] }
  }'
```

- `geojson` (inline) or `graphml` (inline) or `extract_path` (a **server-side, absolute** file) is
  required. Remote URLs are refused.
- The response reports `segment_count`, `ambiguous_crossing_count` with each crossing's kind and
  `connection_created: false`, `missing_attribute_count`, and a `coverage` block including isolated
  nodes.
- Re-importing an **identical** document is idempotent (`status: "unchanged"`, no rows written).
  Importing a **different** document into a dataset that already holds a network is refused (422);
  import into a fresh dataset instead.
- Grade-separated crossings never become junctions. Direction comes from source tags, not from an
  assumption: `direction_source_detail` records which.
- `GET /api/v1/ingest/network/extracts?dataset_id=N` lists recorded extracts with licence,
  snapshot date and checksum.
- `GET /api/v1/ingest/boundary?study_area_key=tehran` publishes the provisional boundary, the buffer
  and the tile-provider policy. The boundary is a **provisional selection**, not a confirmed
  administrative boundary.

---

## 6. Restricted Pilot Runbook

Everything below is **off by default** and requires the owner, hosting and approval decisions listed
in `docs/COMPLETION_TASKS_FA.md` §2.1.

### 6.1 Before enabling anything

1. Record the owner, operator, hosting location and invited population.
2. Record the legal/privacy review reference for consent, retention, deletion and disclosure level.
3. Create a **separate** database for the pilot (`ROADSCOPE_PROFILE_DB`) and, **with
   `ROADSCOPE_PROFILE=pilot`**, import a real, non-synthetic network extract. The dataset inherits
   the import's process profile, so an import performed in a `demo`-profile deployment produces a
   `demo` dataset that pilot intake will refuse (by design — profiles are never rewritten).
   Full walkthrough: [`docs/HOWTO_NETWORK_EXTRACT.md`](HOWTO_NETWORK_EXTRACT.md).
4. Set `ROADSCOPE_CREDENTIAL_PEPPER` to a long random secret and store it outside the repository.
5. Run the threat model: `GET /api/v1/pilot/threat-model`.

### 6.2 Enabling intake

```bash
curl -X POST http://localhost:8000/api/v1/pilot/flags \
  -H "Authorization: Bearer $STEWARD_TOKEN" -H 'Content-Type: application/json' \
  -d '{"key":"pilot_intake","enabled":true,
       "owner":"Operations lead","approval_reference":"APPR-2026-001",
       "dataset_id":3}'
```

- `pilot_intake` and `pilot_publication` are refused unless the dataset is in the `pilot` profile
  and is not synthetic.
- Enabling intake **never** enables tracking, corrections or publication. Each is a separate flag.
- Every change is audited with the server-side identity.
- Only a `data_steward` bearer token may call `/pilot/flags`.

### 6.3 Intake behaviour

- Bounded structured input only: category, severity, occurrence time (with a time zone), a point and
  an uncertainty radius of **3–500 m**. Free text, photos, plates and identity documents are
  unrepresentable.
- Occurrence time must not be in the future (5 min tolerance) and must be within 30 days.
- Explicit consent is required; `consent_version` is stored with the report.
- Duplicates within 120 m / ±2 h are **suggestions only** — nothing is merged automatically.
- The response returns a `XXXX-XXXX-XXXX` tracking credential **once**. It is stored as an HMAC
  lookup plus a PBKDF2 verifier; the plaintext is never persisted, logged or placed in a URL.
- `Idempotency-Key` makes a retried submission safe; a conflicting reuse is rejected (422).

### 6.4 Moderation, corrections, retention

| Action | Endpoint | Notes |
|---|---|---|
| Verify / reject / flag | `POST /pilot/moderation` | Appends to `report_moderation_events` |
| Merge / unmerge duplicates | `POST /pilot/moderation` (`merge`/`unmerge`) | Reversible; the link row records `reversed_at_utc` |
| Correct a report | `POST /pilot/corrections` | Requires `pilot_corrections` |
| Apply retention | `POST /pilot/retention/apply` | Deletes only outside the approved window |
| Withdraw consent | `POST /pilot/reports/{ref}/withdraw-consent` | `{ref}` accepts the numeric id **or** the public id the reporter was given (`RS-000042`); the reporter's credential is verified, otherwise a steward may act on their behalf |
| Rebuild public aggregates | `POST /pilot/publication/rebuild` | Requires `pilot_publication` + dataset approval |

### 6.5 Publication

Publication is a **separate decision** from intake:

1. Set `is_publishable = 1` **and** `user_disclosure_approved = 1` on the dataset (both are required).
2. Enable the `pilot_publication` flag with its own approval reference.
3. Call `POST /pilot/publication/rebuild` with a `disclosure_policy_reference`.

Only verified reports are aggregated, into coarse cells; cells below
`ROADSCOPE_PUBLIC_AGGREGATE_MIN_CELLS` are stored as `suppressed = 1, report_count = 0`.

### 6.6 Emergency disable

Set every pilot flag to `enabled: false` (same endpoint), or stop the process. Disabling intake does
not delete existing reports; deletion is a separate, audited retention or withdrawal action.

---

## 7. Frontend Deployment & Rollback

The frontend is a static bundle (Vite) that talks to the same origin under `/api`.

- **Presentation mode** renders dataset name, synthetic/real status, network source and version,
  licence, attribution, legend note, active filter summary and the research caveat as **DOM text**,
  so a browser screenshot always contains them. Do not replace them with canvas-rendered text.
- The map falls back to a **plain SVG vector view** when WebGL is unavailable, with a visible
  warning; the analytical workspaces remain usable either way.
- Filters persist in `localStorage`, scoped to the active dataset id, and are validated on load.
  They are cleared on an explicit dataset switch.
- **Rollback needs no database migration.** Re-deploy the previous bundle:
  ```bash
  npm --prefix frontend ci && npm --prefix frontend run build   # previous commit
  ```
  A UI rollback never changes the schema, so the backend may stay on the newer version.

---

## 8. Verification & Continuous Integration

```bash
# 1. Backend: spatial, statistical, migration, extract-import, pilot & security suites
PYTHONPATH=backend .venv/bin/python -m pytest -q backend/tests

# 2. Frontend: localization, accessibility, presentation contract, pilot surfaces + bundle
npm --prefix frontend ci
npm --prefix frontend test -- --run
npm --prefix frontend run build

# 3. Strict OpenSpec validation
openspec validate --all --strict --no-interactive
```

A green suite is evidence that the implementation matches its tests. It is **not** evidence that the
model is calibrated, that the data are real, or that a pilot is approved.
