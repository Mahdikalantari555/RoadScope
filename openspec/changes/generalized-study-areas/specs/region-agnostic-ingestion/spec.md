# region-agnostic-ingestion

## Purpose

Citizens and analysts must be able to bring data from anywhere: a report typed in a browser, a
device-provided metric coordinate, or an entire road network from a GeoJSON/OSM export in any CRS. This
specification defines validation, reprojection, provenance and error behaviour so that ingestion is not
limited to one city, one country or one projection.

## ADDED Requirements

### Requirement: Coordinates are validated for representability, not for location
The system SHALL validate that input coordinates are finite, within the Web Mercator latitude limit
(|lat| ≤ 85.05112878) and convertible into the dataset's canonical CRS, and SHALL reject input only when
it is genuinely unrepresentable.

#### Scenario: Valid point anywhere on Earth
- **WHEN** a report is submitted at `lon = -58.3816, lat = -34.6037` (Buenos Aires) for a Tehran dataset
- **THEN** the request succeeds and the stored geometry round-trips to the submitted coordinates within tolerance

#### Scenario: Impossible geographic input
- **WHEN** a report is submitted with `lon = 500` or `lat = 95`
- **THEN** the request is rejected with 422 and a message identifying the invalid coordinate

#### Scenario: Explicitly invalid non-geographic input
- **WHEN** neither `(lon, lat)` nor `(x_m, y_m)` is supplied
- **THEN** the request is rejected with 422 stating which input is required

### Requirement: Input CRS is declared per import and honoured
Network imports SHALL accept a declared input EPSG and reproject into the dataset's canonical CRS,
recording both the input and output CRS.

#### Scenario: WGS84 GeoJSON import
- **WHEN** a GeoJSON `FeatureCollection` with `epsg_in = 4326` is imported for a study area centred on Amsterdam
- **THEN** the network is persisted, `GET /api/v1/meta` frames the map from the imported extent, and the imported segment names appear in `GET /api/v1/network/layers`

#### Scenario: Projected GeoJSON import
- **WHEN** a GeoJSON payload expressed in EPSG:25832 is imported with `epsg_in = 25832`
- **THEN** the geometries are reprojected into the dataset CRS and the import reports `epsg_in = 25832` with the resulting `epsg_out`

#### Scenario: Malformed import
- **WHEN** the payload is empty, is not a GeoJSON FeatureCollection, or the URL is not `http(s)`
- **THEN** the request is rejected with 422 (or 413 for oversized payloads) and no partial dataset is activated

### Requirement: Every import is logged with provenance
The system SHALL record each ingestion as an event containing source type, study area, input CRS,
accepted and rejected feature counts, out-of-boundary vertex count and a JSON report, retrievable via
`GET /api/v1/ingest/events`.

#### Scenario: Provenance query after import
- **WHEN** a network is imported for `study_area_key = "amsterdam"`
- **THEN** the most recent ingestion event reports `study_area_key = "amsterdam"`, the input CRS and rejection counts for that dataset

### Requirement: Synthetic and imported data are distinguishable and labelled
The system SHALL mark synthetic datasets (`is_synthetic`, study-area `demo`, `network_generator`) and
SHALL label synthetic or research-only outputs in both Persian and English.

#### Scenario: Demo dataset is labelled
- **WHEN** the seeded Tehran dataset is active
- **THEN** `/api/v1/meta` reports `active_dataset.is_synthetic = true`, the study area reports `demo = true`, and the interface labels the network as synthetic

#### Scenario: Real import is not labelled synthetic
- **WHEN** an OSM-derived network is imported
- **THEN** the resulting dataset has `is_synthetic = false` and no generator key

### Requirement: Demo-mode protection does not block legitimate ingestion
Demo-mode restrictions SHALL apply to dataset generation and dataset administration, and SHALL NOT lock
the platform out of reading or extending an imported real network.

#### Scenario: Real dataset present in demo mode
- **WHEN** a non-synthetic dataset exists while demo mode is enabled
- **THEN** dataset-generation endpoints are refused with 503, while `/api/v1/meta` and citizen report submission continue to work
