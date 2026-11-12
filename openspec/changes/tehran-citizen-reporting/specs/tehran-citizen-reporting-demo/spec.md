# tehran-citizen-reporting-demo

## Purpose

The shipped demo must demonstrate network-constrained citizen reporting in Persian and English on a
recognizable Tehran network, while making clear that the network is synthetic and that the same flow
works anywhere else. This specification defines the demo network, the reporting flow and the
data-driven map framing that replaces city constants.

## ADDED Requirements

### Requirement: The demo study area is Tehran and is explicitly synthetic
The system SHALL ship a seeded Tehran study area whose road network is generated deterministically from a
seeded spec and labelled synthetic in both languages.

#### Scenario: Deterministic demo network
- **WHEN** the demo database is initialized twice with the same seed
- **THEN** the generated Tehran network (node/segment counts, names, geometry) is identical

#### Scenario: Network topology exercises the safety analytics
- **WHEN** the demo network is generated
- **THEN** it contains major expressways, at least two grade-separated spans, a river channel crossed only by bridges, and collector streets, so bridge detours and overpass disambiguation are testable

#### Scenario: Bridge-only crossing yields a longer network distance
- **WHEN** two points on opposite banks of the demo river are snapped to the network
- **THEN** the exact network distance between them is strictly greater than their straight-line distance

### Requirement: Synthetic generators are a registry, not a single city
Synthetic network generation SHALL be addressable by generator key and SHALL be selectable per dataset,
so additional cities can be synthesized without changing the ingestion pipeline.

#### Scenario: Selecting a generator by key
- **WHEN** a dataset requests `network_generator = "tehran_demo_v1"`
- **THEN** the Tehran spec is persisted for that dataset and the key is recorded on it

#### Scenario: Unknown generator
- **WHEN** an unknown generator key is requested
- **THEN** the request fails with a message listing the available generators and no dataset is created

### Requirement: Citizen reporting works from the map in both directions of the UI
The system SHALL let a user place a report on the map, preview snapping/conflation, submit it as
unverified raw VGI, corroborate it as a witness, and have a steward verify it — with Persian RTL and
English LTR parity.

#### Scenario: Submit and corroborate
- **WHEN** a citizen submits a report and a second witness corroborates it
- **THEN** the report starts as `unverified_raw_vgi` with EXIF-stripped attachments, its witness count increases, and its credibility score rises to `corroborated_pending`

#### Scenario: Steward-only verification
- **WHEN** a non-steward actor attempts to verify a report
- **THEN** the request is refused with 403, and a `data_steward` can then verify it successfully with an audit entry

#### Scenario: Persian numeric readout stays legible
- **WHEN** the interface is in Persian (RTL)
- **THEN** metric coordinate readouts are rendered left-to-right (`dir="ltr"`) with the active EPSG displayed

### Requirement: Map framing follows the active data
The interface SHALL frame the map from the active dataset's extents as published by `/api/v1/meta` and
SHALL NOT hard-code a city centre, zoom level or projection.

#### Scenario: Switching datasets recentres the map
- **WHEN** a different dataset is activated
- **THEN** the map recentres or fits to that dataset's `network_bbox_4326` (falling back to `center_4326`) and the readout shows that dataset's EPSG

#### Scenario: Empty network
- **WHEN** the active dataset has no network geometry yet
- **THEN** the map falls back to the study-area centre without error, and the reporting form uses a dataset-derived default point rather than a fixed city coordinate
