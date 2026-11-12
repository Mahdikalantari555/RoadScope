# RoadScope Operations & Security Runbook

## 1. Storage Engine & Honest Architecture

RoadScope uses **SQLite with R*Tree spatial indexing** as its active persistence engine, storing all metric coordinates and Linear Referencing System (LRS) offsets in **the active dataset's canonical CRS** (`dataset_sources.crs_epsg`, published as `canonical_crs`; `EPSG:3857` for the Tehran demo) and transforming to **`EPSG:4326` (WGS84)** strictly at the GeoJSON boundary. Ingestion is worldwide: any globally valid coordinate is accepted, and network imports declare their own `epsg_in`. See `openspec/changes/generalized-study-areas/`. Remote URL fetching and network administration in demo mode are disabled; imports require a steward and an empty dataset. The fictional default Tehran network and synthetic observations are not validated real-world evidence. Imported GeoJSON does not create traffic observations; exposure-dependent risk evaluation is unavailable for missing exposure or real datasets pending model and data validation. Real reporting remains disabled pending the separate privacy and operational gates.

Docker Compose runs two honest services (`backend` + `frontend`) backed by a persistent `uai_sqlite_data` volume; unused PostGIS containers have been removed so deployment manifests match runtime behavior.

---

## 2. Environment Configuration (`ROADSCOPE_*` & `UAI_*` Compatibility)

The sample `.env.example` lists supported settings. Configuration values are deployment-specific; never commit real tokens.

| Variable | Default | Purpose |
|---|---|---|
| `ROADSCOPE_SQLITE_PATH` | `data/uai.sqlite` | SQLite database path (`UAI_SQLITE_PATH` is a legacy alias) |
| `ROADSCOPE_CANONICAL_EPSG` | `3857` | Fallback CRS; each migrated dataset carries its own CRS |
| `ROADSCOPE_DEFAULT_STUDY_AREA` | `tehran` | First-run fictional demo study area |
| `ROADSCOPE_DEMO_MODE` | `false` | `true` only for an isolated synthetic sandbox |
| `ROADSCOPE_API_TOKENS` | `{}` | JSON map of bearer tokens to existing usernames, set out of band |

## 3. Authentication, Authorization & Synthetic Demo Guard

- The demo mode refuses API access when any dataset is marked non-synthetic and disables network/study-area administration. It is not a public authentication mechanism.
- With demo mode off, mutating endpoints require a bearer token mapped to a server-side user; network/study-area administration requires a steward. The current GET routes, process-local rate limit and demo VGI workflow are **not** suitable for sensitive real reports.
- Real reporting, public disclosure, secure tracking, retention/deletion and production authorization remain open requirements; do not expose this prototype to real citizen data.

---

## 4. Versioned Migrations, Backups & Recovery

Ordered SQL migrations in `migrations/` (`002_spatialite_schema.sql` and upgrades `003`–`005`) are tracked in `schema_migrations` with SHA-256 checksums:
- Upgrading a legacy pre-tracking database automatically creates a timestamped SQLite backup before applying new migrations (`003_directed_network.sql` through `005_generalize_study_areas.sql`).
- Modifying or deleting an already-applied migration raises an error rather than silently diverging schemas.

### Manual Backup & Restore CLI

```bash
# Create an atomic online SQLite backup (refuses to overwrite existing destination)
PYTHONPATH=backend python scripts/database.py backup data/uai.sqlite backups/roadscope-2026-11-12.sqlite

# Verify integrity and restore from backup
PYTHONPATH=backend python scripts/database.py restore backups/roadscope-2026-11-12.sqlite data/restored.sqlite
```

---

## 5. Verification & Continuous Integration

```bash
# 1. Backend spatial, statistical, migration & security suite
PYTHONPATH=backend pytest -v backend/tests

# 2. Frontend localization, XSS & workspace component tests + production bundle
npm --prefix frontend test -- --run
npm --prefix frontend run build

# 3. Strict OpenSpec specification validation
openspec validate --all --strict --no-interactive
```
