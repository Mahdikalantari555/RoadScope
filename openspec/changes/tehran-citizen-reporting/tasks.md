# Tasks

## 1. Study-area foundation and schema

- [x] 1.1 Add a bilingual `StudyArea` model with key, country, `canonical_epsg`, centre, optional descriptive boundary, network provenance and demo flag (`backend/app/study_areas.py`).
- [x] 1.2 Add `005_generalize_study_areas.sql`: `wkt_25832` → `wkt_m`, per-dataset `crs_epsg`/`epsg_definition`, `study_area_key`, `study_areas`, `ingestion_events`, topology-version trigger for new datasets; rebuild children before parents.
- [x] 1.3 Harden the migration runner: set `PRAGMA foreign_keys=OFF` / `legacy_alter_table=ON` before `BEGIN IMMEDIATE`, run `foreign_key_check` before commit, restore caller pragmas in `finally`, keep checksum-guarded idempotency and pre-migration backups (`backend/app/migrations.py`).
- [x] 1.4 Seed built-in study areas and expose `sync_study_areas` / `resolve_study_area` so the demo (Tehran) exists on a fresh database and user registrations survive reseeding (`backend/app/services/study_area_service.py`, `backend/app/main.py`).

## 2. Region-agnostic ingestion

- [x] 2.1 Replace the hard-coded bbox validation with representability checks (`to_metric`/`safe_to_metric` with an explicit `epsg`) that return 422 only for impossible coordinates (`backend/app/crs.py`, `backend/app/geo_bbox.py`).
- [x] 2.2 Resolve the canonical metric CRS per dataset via `dataset_context()` and remove every `CANONICAL_EPSG`/`wkt_25832` literal from routes and spatial services.
- [x] 2.3 Accept citizen reports from anywhere: `(lon, lat)` or dataset-CRS `(x_m, y_m)`, `allow_outside_study_area`, `reported_from_country_code`, `geocode_source`, and an `outside_study_area` flag on the response.
- [x] 2.4 Implement real network import from inline GeoJSON or an `http(s)` URL with declared `epsg_in`, reprojection into the dataset CRS, lixelization, rejection accounting and an `ingestion_events` record (`backend/app/services/ingest.py`).
- [x] 2.5 Expose `GET/POST /api/v1/study-areas`, `POST /api/v1/study-areas/{key}/datasets`, `POST /api/v1/ingest/network`, `GET /api/v1/ingest/events`, `GET /api/v1/vgi/location-context`, and add `dataset_id` to `POST /api/v1/crs/project`.
- [x] 2.6 Publish `boundary_enforced: false`, `ingestion_scope: "worldwide"`, `study_area_key`, `study_areas`, `center_4326`, `network_bbox_4326` and `network_bbox_geometry` from `/api/v1/health` and `/api/v1/meta`.
- [x] 2.7 Scope demo-mode protection to dataset generation (`/simulator/`, `/datasets/`) so an imported real network does not lock the read UI, and document that behavioural change (`backend/app/security.py`).

## 3. Tehran demo network and reporting flow

- [x] 3.1 Replace the Frankfurt generator with a labelled synthetic Tehran network: river channel with three bridges, two grade-separated expressway spans with ramps, arterials, collectors and quays (`tehran_demo_v1`).
- [x] 3.2 Add a generator registry + `generate_synthetic_network(key)` so other cities can be synthesized without touching ingestion, and record the generator key on the dataset.
- [x] 3.3 Keep the citizen-reporting flow end to end on the Tehran network: snap preview, submit, corroborate, steward review, and out-of-area provenance.

## 4. Frontend

- [x] 4.1 Frame the map from `/meta` (`center_4326`, `network_bbox_4326`) with a world-scale zoom range; recentre on dataset change; remove the Frankfurt camera constants (`src/components/MapCanvas.tsx`).
- [x] 4.2 Replace the EPSG:25832-only forward projection with a CRS-aware readout and print the active EPSG inside `<bdi dir="ltr">` (`src/utils/colors.ts`, `MapCanvas.tsx`).
- [x] 4.3 Seed the citizen-report form and its "demo spot" control from the dataset extent instead of a Frankfurt constant (`src/components/CitizenReportWorkspace.tsx`, `src/App.tsx`).
- [x] 4.4 Extend the API types for study areas, network bbox and `study_areas[]`; remove EPSG:25832 from user-visible copy (`src/types/uai.ts`, `src/i18n.tsx`, `src/workspaceI18n.ts`).
- [x] 4.5 Verify `tsc --noEmit` and the existing RTL/localization test suite stay green.

## 5. Tests

- [x] 5.1 New `backend/tests/test_study_areas_ingest.py`: open bounds in `/meta` and `/health`, location context, runtime study-area + dataset creation, GeoJSON import in EPSG:4326 and EPSG:25832, ingestion events, worldwide VGI acceptance with outside-boundary flagging, generator reuse.
- [x] 5.2 Update `test_platform.py` for the Tehran demo: EPSG:3857 meta, data-driven framing, UTM-free CRS round-trip, bridge detour and overpass disambiguation on the new network, open-bounds VGI validation.
- [x] 5.3 Update `test_migrations.py`, `test_research.py`, `test_directed_topology.py`, `test_security.py` for `wkt_m`, the third migration and dataset-driven CRS.
- [x] 5.4 Document the demo-mode scope change and test it (`test_demo_refuses_real_data_tampering_but_keeps_open_ingestion`).

## 6. Documentation and localization

- [x] 6.1 Add this OpenSpec change (proposal/design/tasks/delta spec) and list it in `openspec/README.md`.
- [x] 6.2 Update `README.md` and `docs/OPERATIONS.md` for study areas, open ingestion, the new endpoints and the Tehran demo (remove Frankfurt/EPSG:25832 claims; there is no `docs/ARCHITECTURE.md` in this repo).
- [x] 6.3 Update `openspec/config.yaml` context so future changes do not assume EPSG:25832 or a single city.
- [x] 6.4 Add Persian and English copy for the study-area demo/import affordances and verify RTL rendering of numeric CRS readouts (`<bdi dir="ltr">` in `MapCanvas`/`HeaderBar`), covered by `src/utils/colors.test.ts`.

## 7. Verification and rollback

- [x] 7.1 Full backend suite green (`pytest -q backend/tests`), frontend `tsc` clean and `vitest` green.
- [x] 7.2 Validate legacy-database upgrade, `foreign_key_check`, and repeated migration application.
- [x] 7.3 Run `OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@2.0.0 validate --all --strict` (11 passed, 0 failed); archiving awaits review.
- [x] 7.4 Document rollback: restore the automatic pre-migration backup, remove `005` from `schema_migrations`, redeploy the previous revision (see `design.md` → Migration and verification).
