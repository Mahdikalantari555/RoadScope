# RoadScope operations

## Reproducible local installation

Requires Python 3.11+ and Node 22. Run from the repository root:

```sh
python -m venv .venv
.venv/bin/pip install -r backend/requirements.lock
npm ci --prefix frontend
npm run build --prefix frontend
PYTHONPATH=backend .venv/bin/python -m pytest -q backend/tests
PYTHONPATH=backend .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

FastAPI serves the built SPA and `/api/v1`. Without a frontend build use Vite
(`npm run dev --prefix frontend`) and the backend together. Vite proxies relative
`/api` requests; browser code must not point at localhost backend URLs.

SQLite/R*Tree, Shapely and PyProj are the supported database/geometry stack.
SpatiaLite is optional. `001_postgis_schema.sql` is historical, not a PostGIS
adapter. Compose no longer starts an unused PostGIS service. Container builds use
locked dependencies; Docker runtime has not been verified in this sandbox.

## Compatibility and data preservation

`ROADSCOPE_SQLITE_PATH`, `ROADSCOPE_CANONICAL_EPSG`, `ROADSCOPE_WEB_EPSG` and
`ROADSCOPE_DEFAULT_SEED` override equivalent `UAI_*` variables. Old names continue
to work. Computations assume EPSG:25832; do not change CRS settings to reinterpret
stored coordinates. Canonical schema constraints still enforce 25832.

Before upgrading, stop writers and make an independent backup:

```sh
PYTHONPATH=backend .venv/bin/python scripts/database.py backup data/uai.sqlite /safe/new-backup.sqlite
```

The SQLite backup API includes committed WAL contents. Both backup and restore
refuse an existing destination; do not copy only the main SQLite file while writers
are active. Startup also creates a `.pre-<migration>.bak` beside an existing DB
before pending research migrations. Protect backup permissions like the source.
Upgrades are ordered and transactionally recorded in `schema_migrations`.

For rollback: stop all server processes, restore to a **new** database, run
`PRAGMA integrity_check`, select it with `ROADSCOPE_SQLITE_PATH`, and deploy the
matching previous code version. There are no destructive down-migrations. Never
restore over a running database. An operator must verify backups before upgrade.

For Compose upgrades, find the actual old SQLite volume with `docker volume ls`
and set `ROADSCOPE_DATA_VOLUME` to that exact name. The previous Compose default
was usually `<project>_uai_sqlite_data`; project names vary. Never assume a newly
created empty volume is a successful data migration. Preserve the unused historical
Postgres volume until its contents have been independently inspected/backed up.

## Identity and demo policy

Mutations default to requiring bearer authentication. Provide a secret JSON object
in `ROADSCOPE_API_TOKENS` mapping random high-entropy tokens to existing DB
usernames. Generate and distribute tokens out of band; never put real secrets in
Git or chat. Role changes come from the server-side `users` table. Persona controls
are presentation only. Submitted `actor_role` cannot grant permissions. Tokens can
be entered in the UI's Research availability & access dialog; they stay in memory
and are cleared on reload. Use HTTPS and a trusted reverse proxy.

Steward operations require `data_steward`; generation/activation require steward
or simulation scientist; lab/research mutations require steward, researcher or
safety engineer. Audit identity comes from the authenticated request context, not
the payload. Mutation rate is limited to 30/minute per server identity per process.
For multiple workers add distributed limits at the gateway; current limits are not
a complete internet-facing abuse defense.

`ROADSCOPE_DEMO_MODE=true` intentionally bypasses authentication only for an
isolated synthetic installation. API responses carry `X-RoadScope-Mode`; the
capability response also declares demo state. Any non-synthetic dataset makes
API requests fail closed in demo mode. Do not put sensitive data in a demo DB.

**Not production-ready for personal data:** legacy read APIs remain public and may
include raw observations/narratives. This increment does not add per-dataset read
ACLs, retention automation, enterprise account provisioning or a privacy-reviewed
public export policy. Keep deployment private with synthetic data until these are
implemented. Attachment APIs store names/metadata, not a verified upload/EXIF
sanitization pipeline.

## Assets, provenance and licensing inventory

- `frontend/src`: React application; `FrontExamples/`: design reference artifacts,
  not runtime dependencies. Source/reuse rights need verification before reuse.
- `data/uai.sqlite`: tracked legacy research database, retained unchanged for
  compatibility and upgrade testing. Do not infer real-world provenance from it.
- Runtime simulator output is synthetic. Label it as such in any publication.
- Generated `frontend/static_bundle`, tsbuildinfo, local DBs, WALs and backups are
  ignored. Container Nginx builds from source using `npm ci`.
- There is no declared repository-wide license in the baseline checkout. This
  implementation does not invent one or assert permissions for cited papers,
  map assets or external code. Complete the source/license review before release.

See `IMPLEMENTATION_STATUS.md` for limitations, exact numerical policies and
outstanding acceptance work across all ten OpenSpec changes.
