# Design

## Context

The platform had one demo study area (Frankfurt) and validation that only accepted coordinates inside a
hard-coded German bbox, stored in EPSG:25832. Three problems followed from that:

1. A Persian-first product whose demo city was German, with Persian copy pointing at "Mainkai".
2. Ingestion was effectively single-city: `POST /api/v1/vgi/submit` answered 422 for anything outside the
   bbox, and every service read the `wkt_25832` column, so a second city could not be added without a
   code change.
3. There was no record of where data came from — no way to say "this network was imported from OSM in
   EPSG:4326" versus "this is the synthetic demo".

The user's decision was explicit: *accept data everywhere*; Tehran is a demo, not a constraint. Open
bounds were chosen over a study-area profile registry that would whitelist bboxes.

## Goals / Non-Goals

**Goals**

- Keep Tehran as a first-class, labelled demo area for citizen reporting.
- Make ingestion region-agnostic: any globally valid coordinate, any declared input CRS, any dataset.
- Make the canonical metric CRS a property of the data (`dataset_sources.crs_epsg`), never a constant.
- Support both a synthetic Tehran network (offline, deterministic, with expressways/junctions/bridges)
  and real network import from GeoJSON or a URL.
- Preserve `/api/v1` compatibility and bilingual Persian/English behavior, including RTL numeric readouts.

**Non-Goals**

- Enforcing or whitelisting geographic boundaries per city.
- Running Overpass queries inside a request; imports take payloads or URLs.
- Treating the synthetic network, or any risk surface derived from it, as operational safety evidence.
- Building a geocoder or an address service.

## Decisions

### 1. Open bounds with descriptive (non-enforcing) boundaries

A `StudyArea` carries an *optional* `boundary_4326` that is used only for framing, for the optional
`outside_study_area` provenance flag on reports, and for counting `outside_boundary_vertices` during
imports. Validation checks representability instead — finite values, |lat| ≤ 85.05112878, and
convertibility into the dataset CRS — and returns 422 only when a coordinate genuinely cannot exist in
that CRS. Every public surface states this: `boundary_enforced: false`, `ingestion_scope: "worldwide"`,
`rejects_outside_boundary: false`, `records_outside_boundary_flag: true`.

*Alternative rejected:* a per-city bbox whitelist with a profile registry. It would still tell users
"your report from outside Tehran is invalid", which is exactly the limitation being removed.

### 2. Study areas are data

`study_areas` (new table, migration `005`) holds key, bilingual names, country code, `canonical_epsg`,
centre, optional boundary, network source/generator, demo flag and provenance. A `studies` service
(`upgrade_schema`-safe `sync_study_areas`) seeds built-ins (`tehran` as demo) and merges runtime
registrations without clobbering user edits. Datasets reference a study area by key
(`dataset_sources.study_area_key`), so a study area can own several datasets (synthetic demo, imported
OSM extract, simulation run).

### 3. Canonical CRS resolution is per dataset

`app/context.py::dataset_context(conn, dataset_id)` returns `{dataset_id, canonical_epsg, study_area,
study_area_key, crs_name}` by reading the dataset row (falling back to the default dataset, then to the
study area's CRS). All routes and services call it and never mention an EPSG literal. The spatial schema
stores geometry in `wkt_m` (metres, CRS implied by the dataset) instead of `wkt_25832`; `srid` columns
carry the EPSG so reprojection stays explicit. `crs.py` exposes `to_metric`/`to_wgs84`/`safe_to_metric`
that accept an `epsg` argument and return `None` rather than raising for unrepresentable points.

### 4. Validation happens at the boundary, provenance is recorded

Citizen submission resolves coordinates from either `(lon, lat)` or `(x_m, y_m)` in the dataset CRS,
flags `outside_study_area`, and stores the submission's provenance (country code, geocode source,
whether the reporter allowed out-of-area data). Imported networks write an `ingestion_events` row with
`epsg_in`, feature/rejected counts, `outside_boundary_vertices`, and a JSON report, exposed via
`GET /api/v1/ingest/events`.

### 5. Two network sources, one persistence path

`app/services/network_generator.py` keeps a generator registry (`NETWORK_GENERATORS`) with
`tehran_demo_v1` → `build_tehran_demo_network_spec()`, selectable per dataset via
`SimulationRequest.network_generator` / study-area `network_generator`. The Tehran spec is a labelled
synthetic grid: a river channel with three bridges, two grade-separated expressway spans with ramps,
arterials (Azadi, Enghelab, Karimkhan Zand, Shariati), collector streets and river quays — enough
topology to exercise bridge detours and overpass disambiguation.
`app/services/ingest.py::import_network_geojson` handles real data: parse FeatureCollection, reproject
from `epsg_in` into the dataset CRS, split at vertices, snap nodes, lixelize at the dataset resolution,
persist, register the topology version and record an ingestion event. Both paths end in the same
`persist_network_spec` so downstream analytics are identical.

### 6. Frontend framing is data-driven

`/meta` publishes `center_4326`, `network_bbox_4326`, `network_bbox_geometry`, `study_area_key`,
`study_areas[]` and the active dataset's `crs_epsg`. `MapCanvas` fits bounds to the network bbox, falls
back to the centre, uses `minZoom: 3` (a world-scale map, not a city window) and prints the active EPSG
inside a `<bdi dir="ltr">` so the numeric readout stays LTR in an RTL document.
`CitizenReportWorkspace` seeds its form from a `suggestedPreset4326` prop derived from the network bbox
centre instead of a Frankfurt constant, and `colors.ts` no longer embeds a UTM-32N forward projection.

### 7. Migration safety

`005_generalize_study_areas.sql` is a rebuild migration (SQLite cannot drop/rename columns in place under
foreign keys). It carries the `-- @foreign-keys-off` header; the runner sets `foreign_keys=OFF` and
`legacy_alter_table=ON` **before** `BEGIN IMMEDIATE` (inside a transaction SQLite silently ignores both),
rebuilds child tables before their parents so no FK text still points at a `__legacy` table, runs
`PRAGMA foreign_key_check` before commit, then restores the caller's pragma state in a `finally`. A
timestamped backup is written before the first rebuild and re-application is a no-op (checksum-guarded
`schema_migrations`).

## Dependencies

`roadscope-foundation` (auth/audit), `roadscope-experience` (bilingual map UX),
`vgi-bias-and-uncertainty` (uncertainty-aware conflation) and `directed-network-diffusion` (directed
topology, now CRS-parameterized).

## Risks / Trade-offs

- **Open bounds admit noise.** Out-of-area or nonsense reports can be submitted. Mitigation: the
  `outside_study_area` flag, provenance fields, corroboration/credibility scoring and steward review —
  the existing VGI pipeline decides what becomes canonical, not the bbox.
- **Web Mercator distortion.** EPSG:3857 metres are scale-distorted away from the equator (≈1.22× at
  Tehran's latitude for the true scale factor; the demo network is generated in the local metric frame).
  Study areas near the poles or requiring cadastral accuracy should declare a local projected CRS in
  `canonical_epsg`; the import path honours `epsg_in`/`epsg_out` so accuracy-critical analysis can use a
  national grid.
- **Generator naming.** `tehran_demo_v1` is a demo artefact; renaming/extension must bump the key so
  persisted `generator_params_json` stay interpretable.
- **Rebuild migration cost.** A full table rebuild on a large database is slow and temporarily doubles
  disk use; the backup plus `foreign_key_check` guard make a bad migration visible rather than silent.
- **Demo mode semantics changed.** Demo mode now guards dataset generation (`/simulator/`, `/datasets/`)
  rather than all of `/api/v1`, so an imported real network does not 503 the read UI. This is intentional
  and tested, but it is a behavioural change for anyone relying on the old blanket refusal.

## Migration and verification

- Schema: `005_generalize_study_areas.sql` (idempotent, backed up, FK-checked) upgrades existing
  `wkt_25832` data in place; verified on a legacy database fixture and for repeated application.
- API: all additions; no removals. `/meta` keeps its existing keys and gains new ones.
- Tests: `backend/tests/test_study_areas_ingest.py` covers open bounds, runtime study-area registration,
  GeoJSON import in EPSG:4326 and EPSG:25832, ingestion events, worldwide VGI acceptance and generator
  reuse; `test_platform.py`, `test_migrations.py`, `test_research.py`, `test_security.py` and
  `test_directed_topology.py` were updated for the Tehran demo and dataset-driven CRS. Frontend: `tsc`
  clean, existing RTL/localization tests green.
- Localization: new study-area labels ship `name_en`/`name_fa`; the map and demo controls have no
  city-specific copy. Synthetic data is labelled in both languages.
- Rollback: restore the pre-migration backup (written automatically), drop `005` from
  `schema_migrations`, and redeploy the previous revision; datasets created after the change stay valid
  because their CRS is stored in the row.
