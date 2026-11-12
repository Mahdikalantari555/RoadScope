# tehran-citizen-reporting

## Why

The platform's demo study area was Frankfurt (Mainz-style quays, a German river, ETRS89/UTM 32N as
the only metric CRS). That made RoadScope read as a single-city German tool and, more importantly,
hid a real architectural limit: ingestion validated every coordinate against a hard-coded bbox and
the whole storage/computation layer assumed EPSG:25832. Citizen reports that arrived from the demo's
own Persian-language users outside that box were silently unreachable, and no other city could ever be
ingested without editing Python.

This change replaces the Frankfurt demo with a Tehran citizen-reporting (VGI) demo **and removes the
single-city restriction from ingestion entirely**: any globally valid WGS84 coordinate can be reported
or imported, in any declared input CRS, for any registered study area.

## What Changes

- **Study-area registry, not a hard-coded city.** `app/study_areas.py` + `app/services/study_area_service.py`
  provide a persisted registry of study areas (key, bilingual name, country, canonical metric EPSG,
  map centre, optional descriptive boundary, network provenance/demo flag). Tehran (`tehran`, `IR`,
  EPSG:3857) ships as a seeded demo; other areas can be registered at runtime.
- **Open-bounds ingestion.** `boundary_enforced: false` and `ingestion_scope: "worldwide"` are exposed by
  `GET /api/v1/health`, `/meta` and `/vgi/location-context`. Coordinates are validated for *representability*
  (finite, within Web Mercator latitude limits, convertible into the dataset CRS), never against a city box.
  Reports outside a study-area boundary are accepted and *flagged* (`outside_study_area`) instead of rejected.
- **CRS is data, not code.** Each dataset stores its own `crs_epsg`; `dataset_context()` resolves it and
  `/meta` publishes `canonical_crs`. The previous constant `CANONICAL_EPSG = 25832` is gone from routes,
  services and the frontend. Migration `005_generalize_study_areas.sql` generalizes the schema
  (`wkt_25832` → `wkt_m`, dataset CRS columns, study-area table, ingestion-event log).
- **Two ways to get a network.** (a) the seeded synthetic Tehran generator (`tehran_demo_v1`) with major
  expressways, a river with three bridges, grade-separated overpasses and collector streets, labelled as
  synthetic; (b) real import via `POST /api/v1/ingest/network` from inline GeoJSON or an `http(s)` URL, in
  any EPSG (`epsg_in`), reprojected to the dataset CRS with lixelization.
- **Tehran demo replaces Frankfurt.** German street/river names, the Frankfurt framing and the
  EPSG:25832 frontend readout are removed; the map now frames the active dataset from `/meta`
  (`center_4326`, `network_bbox_4326`, `network_bbox_geometry`), falls back to the study centre, and the
  citizen-report form defaults to the dataset's own extent. Persian/RTL and English/LTR both label the
  demo data as synthetic/research-only.
- **API additions (backwards compatible):** `GET/POST /api/v1/study-areas`,
  `POST /api/v1/study-areas/{key}/datasets`, `POST /api/v1/ingest/network`, `GET /api/v1/ingest/events`,
  `GET /api/v1/vgi/location-context`; `POST /api/v1/crs/project` accepts optional `dataset_id`;
  `SimulationRequest` accepts `study_area_key`/`network_generator`; citizen submission accepts
  `allow_outside_study_area`, `reported_from_country_code`, `geocode_source`.

## Capabilities

### New Capabilities

- `study-areas`: a persisted, bilingual, runtime-extensible registry of places the platform can ingest
  data for, each with its own canonical metric CRS and optional descriptive (non-enforcing) boundary.
- `region-agnostic-ingestion`: worldwide acceptance and validation of citizen reports and road-network
  imports in any declared CRS, with explicit outside-boundary flagging and provenance logging.
- `tehran-citizen-reporting-demo`: a labelled synthetic Tehran network plus the VGI demo flow
  (snap preview, submit, corroborate, steward review) framed by data rather than by city constants.

### Modified Capabilities

- `vgi-bias-and-uncertainty`: submission no longer rejects coordinates outside a demo bbox; the
  positional-uncertainty and conflation stages still apply, and out-of-area provenance is recorded.
- `directed-network-diffusion`: topology and lixel distances are computed in each dataset's own metric
  CRS instead of the global EPSG:25832.

## Impact

Backend: `app/study_areas.py`, `app/services/study_area_service.py`, `app/services/ingest.py`,
`app/context.py`, `app/crs.py`, `app/geo_bbox.py`, `app/api/routes.py`, `app/schemas.py`, `app/main.py`,
`app/migrations.py`, `app/security.py`, the spatial services that read `wkt_25832`
(`network_generator.py`, `point_process_sim.py`, `map_matching.py`, `stewardship.py`,
`analytics_cmv.py`, `adaptive_tnkde.py`, `spatial_lab.py`, `risk_eb_engine.py`), and migration
`migrations/005_generalize_study_areas.sql`.
Frontend: `src/utils/colors.ts` (CRS-aware readout), `src/components/MapCanvas.tsx` (data-driven framing),
`src/components/CitizenReportWorkspace.tsx` (dataset-supplied demo point), `src/types/uai.ts`,
`src/App.tsx`, i18n strings.
Tests: `backend/tests/test_study_areas_ingest.py` (new), plus updated `test_platform.py`,
`test_migrations.py`, `test_research.py`, `test_security.py`, `test_directed_topology.py`.
Docs: `README.md`, `docs/ARCHITECTURE.md`, `openspec/README.md`.

## Dependencies and scope

Builds on `roadscope-foundation` (security/audit), `roadscope-experience` (bilingual map UX) and
`vgi-bias-and-uncertainty` (positional-uncertainty conflation).

**Out of scope:** a per-city profile/boundary *whitelist* (explicitly rejected: bounds stay open), live
OSM Overpass harvesting at request time (import accepts GeoJSON/URL payloads), geocoding services, and any
claim that the synthetic Tehran network or its derived risk surfaces are real-world safety statements.
