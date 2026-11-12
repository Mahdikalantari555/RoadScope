# study-areas

## Purpose

The platform must be able to ingest data for any place on Earth without a code change. A study area is
the unit that makes a place first-class: it carries a bilingual name, a canonical metric CRS for storage
and computation, a map centre, and — optionally, and never enforceably — a descriptive geographic
boundary. This specification defines the registry, its lifecycle and its relationship to datasets, so
that Tehran is the shipped demo rather than a permanent limit.

## ADDED Requirements

### Requirement: Study areas are registered data, not code constants
The system SHALL persist study areas with a stable key, bilingual names (`name_en`, `name_fa`), ISO
country code, canonical metric EPSG, map centre in EPSG:4326, optional descriptive boundary, network
provenance (`network_source`, `network_generator`) and a synthetic-demo flag, and SHALL expose them via
`GET /api/v1/study-areas` and within `GET /api/v1/meta`.

#### Scenario: Default demo area is Tehran
- **WHEN** a fresh database is initialized with no configuration
- **THEN** `GET /api/v1/meta` reports `study_area_key = "tehran"` and a `tehran` entry in `study_areas` with `demo = true` and `network_generator = "tehran_demo_v1"`

#### Scenario: Registering a new city at runtime
- **WHEN** a client posts a valid new study area (e.g. `key = "amsterdam"`, `center_4326 = [4.8952, 52.3702]`)
- **THEN** the area is persisted, appears in `GET /api/v1/study-areas`, and a dataset can be created for it via `POST /api/v1/study-areas/{key}/datasets`

#### Scenario: Invalid registration is rejected clearly
- **WHEN** a registration omits the key, uses an invalid key character set, supplies an impossible centre or an unknown EPSG
- **THEN** the request is rejected with 422 and a message naming the offending field

#### Scenario: Seeding does not destroy user registrations
- **WHEN** the application restarts and re-runs built-in seeding after a user registered a study area
- **THEN** the user's study area and its datasets remain present and unchanged

### Requirement: A study area carries its own canonical metric CRS
The system SHALL resolve the canonical metric CRS per dataset from stored data and SHALL NOT assume a
global projected CRS. All geometry, distance and density computations SHALL use the dataset's CRS.

#### Scenario: Meta reports the dataset CRS
- **WHEN** the active dataset declares `crs_epsg = 3857`
- **THEN** `GET /api/v1/health` and `GET /api/v1/meta` report `canonical_crs = "EPSG:3857"`

#### Scenario: Mixed datasets across areas
- **WHEN** one dataset uses EPSG:3857 and another declares a national grid such as EPSG:25832
- **THEN** each dataset's API responses, projections and network metrics use that dataset's CRS, and neither dataset's CRS leaks into the other

### Requirement: Boundaries are descriptive and never gate ingestion
A study area boundary SHALL be optional and SHALL NOT be used to reject data. Its only permitted uses are
map framing, provenance flagging (`outside_study_area`) and import diagnostics
(`outside_boundary_vertices`).

#### Scenario: Open-bounds contract is published
- **WHEN** any client reads `GET /api/v1/health`, `GET /api/v1/meta` or `GET /api/v1/vgi/location-context`
- **THEN** the response states `boundary_enforced = false` and `ingestion_scope = "worldwide"`, and the location context states `rejects_outside_boundary = false` with `records_outside_boundary_flag = true`

#### Scenario: Report from another continent
- **WHEN** a citizen report is submitted from a coordinate far outside the active study area boundary
- **THEN** the report is accepted (200) with `outside_study_area = true` and the active `study_area_key`, rather than being rejected for being out of bounds
