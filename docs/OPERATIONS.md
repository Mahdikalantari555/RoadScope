# RoadScope Operations & Security Runbook

## 1. Storage Engine & Honest Architecture

RoadScope uses **SQLite with R*Tree spatial indexing** as its active persistence engine, storing all metric coordinates and Linear Referencing System (LRS) offsets in **the active dataset's canonical CRS** (`dataset_sources.crs_epsg`, published as `canonical_crs`; `EPSG:3857` for the Tehran demo) and transforming to **`EPSG:4326` (WGS84)** strictly at the GeoJSON boundary. Ingestion is worldwide: any globally valid coordinate is accepted, and network imports declare their own `epsg_in`. See `openspec/changes/tehran-citizen-reporting/`.

Docker Compose runs two honest services (`backend` + `frontend`) backed by a persistent `uai_sqlite_data` volume; unused PostGIS containers have been removed so deployment manifests match runtime behavior.

---

## 2. Environment Configuration (`ROADSCOPE_*` & `UAI_*` Compatibility)

Every setting supports both the canonical `ROADSCOPE_*` variable and the legacy `UAI_*` alias (`ROADSCOPE_*` takes precedence when both are set):

| Canonical Variable | Legacy Alias | Default | Purpose |
|---|---|---|---|
| `ROADSCOPE_DB_PATH` | `UAI_DB_PATH` | `data/uai.sqlite` | Active SQLite database path |
| `ROADSCOPE_MIGRATIONS_DIR` | `UAI_MIGRATIONS_DIR` | `migrations` | Ordered SQL migration directory (`001`..`004`) |
| `ROADSCOPE_AUTH_MODE` | `UAI_AUTH_MODE` | `demo` | `demo` (synthetic-only sandbox) or `token` (server-enforced bearer RBAC) |
| `ROADSCOPE_API_TOKENS_JSON` | `UAI_API_TOKENS_JSON` | `{}` | JSON map of bearer tokens to `{sub, role}` or role strings |
| `ROADSCOPE_CORS_ORIGINS` | `UAI_CORS_ORIGINS` | `http://localhost:5173,http://localhost:8080` | Explicit comma-separated origin allowlist |
| `ROADSCOPE_RATE_LIMIT_PER_MINUTE` | `UAI_RATE_LIMIT_PER_MINUTE` | `120` | Sliding-window mutating request cap per client/actor |
| `ROADSCOPE_MAX_REQUEST_BYTES` | `UAI_MAX_REQUEST_BYTES` | `1048576` | Maximum request payload size (413 when exceeded) |

---

## 3. Authentication, Authorization & Synthetic Demo Guard

- **Client-supplied `actor_role` fields are never trusted for authorization or audit attribution.**
- In `ROADSCOPE_AUTH_MODE=demo`:
  - The server refuses to boot or mutate if any dataset in the SQLite database has `is_synthetic = 0` (`403` / startup guard).
  - Audit rows record server-verified principal `synthetic-demo` rather than forged client roles.
- In `ROADSCOPE_AUTH_MODE=token`:
  - Mutating and stewardship/simulation/lab endpoints require `Authorization: Bearer <token>` matching `ROADSCOPE_API_TOKENS_JSON` with an authorized server role (`data_steward`, `gis_researcher`, `simulation_scientist`, `citizen_reporter`, etc.).
  - Users can paste an API token into the **Research availability & access** dialog in the top bar; tokens are held strictly in JavaScript memory (never persisted to `localStorage`).

---

## 4. Versioned Migrations, Backups & Recovery

Ordered SQL migrations in `migrations/` (`001_initial_schema.sql` through `004_research_contracts.sql`) are tracked in `schema_migrations` with SHA-256 checksums:
- Upgrading a legacy pre-tracking database automatically creates a timestamped SQLite backup before applying new migrations (`003_directed_network.sql`, `004_research_contracts.sql`).
- Modifying or deleting an already-applied migration raises a `MigrationError` rather than silently diverging schemas.

### Manual Backup & Restore CLI

```bash
# Create an atomic online SQLite backup (refuses to overwrite existing destination)
PYTHONPATH=backend python scripts/database.py backup --destination backups/roadscope-2026-11-12.sqlite

# Verify integrity and restore from backup
PYTHONPATH=backend python scripts/database.py restore --source backups/roadscope-2026-11-12.sqlite
```

---

## 5. Verification & Continuous Integration

```bash
# 1. Backend spatial, statistical, migration & security suite (63 tests)
PYTHONPATH=backend pytest -v backend/tests

# 2. Frontend localization, XSS & workspace component tests + production bundle
npm --prefix frontend test -- --run
npm --prefix frontend run build

# 3. Strict OpenSpec specification validation
openspec validate --all --strict --no-interactive
```
