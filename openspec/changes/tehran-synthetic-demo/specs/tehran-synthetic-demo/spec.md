# Tehran synthetic demo

## ADDED Requirements

### Requirement: Versioned real street network
The system SHALL import an explicitly bounded central-Tehran OSM street snapshot with source, date, extraction rules, checksum, license, OSM identifiers and geometry provenance, separate from incident provenance. Extracts SHALL remain outside version control except small permitted fixtures.

#### Scenario: Reproducible import
- **WHEN** the same snapshot, boundary and import options are applied to an empty demo database
- **THEN** the same road identifiers, node connectivity and metadata are produced without duplicate records

#### Scenario: Overpass crossing
- **WHEN** roads cross geometrically without a connected OSM node or are grade-separated
- **THEN** the importer does not fabricate a junction and records ambiguous topology for review

#### Scenario: Missing extract
- **WHEN** the source is unavailable or checksum does not match
- **THEN** import fails clearly and leaves the previous dataset intact

### Requirement: Spatial integrity and profile isolation
The Tehran demo SHALL use EPSG:32639 for local metric calculations and EPSG:4326 longitude/latitude at the GeoJSON boundary; existing Frankfurt EPSG:25832 datasets SHALL remain valid. An implementation SHALL NOT apply one dataset's CRS or bounds to another dataset.

#### Scenario: Metric calculation
- **WHEN** a Tehran geometry is projected, measured and transformed back
- **THEN** automated tolerance checks confirm meter units, coordinate order and acceptable round-trip error against reference points

#### Scenario: Switching or restoring profiles
- **WHEN** Tehran demo is prepared or opened
- **THEN** Frankfurt's original database, CRS, geometry and results remain unchanged and can still be opened using its documented profile

### Requirement: Synthetic incidents on Tehran roads
The system SHALL generate reproducible incident observations on the imported network using a recorded seed, generator version and parameters. Real street geometry SHALL NOT make the incident records or their simulated indicators appear real.

#### Scenario: Repeat seed
- **WHEN** the same network snapshot and simulation parameters are run twice
- **THEN** generated incidents and relevant metadata match, subject to documented deterministic serialization

#### Scenario: Location and provenance
- **WHEN** a generated incident is inspected
- **THEN** its selected segment/lixel belongs to the imported network, its location is on the intended road within documented metric tolerance, and its synthetic origin is available

#### Scenario: Unavailable measured exposure
- **WHEN** an exposure or environmental input is synthetic or unavailable
- **THEN** the UI identifies it as synthetic or unavailable and does not present derived values as validated Tehran risk

### Requirement: Honest map and presentation view
The map SHALL fit the active study area, provide reset and street search within the dataset, and support an uncluttered screenshot view. It SHALL visibly identify the incidents as synthetic, show source attribution, and preserve the distinction between real streets and fictional observations in Persian and English.

#### Scenario: Tehran presentation
- **WHEN** the user opens the Tehran presentation view
- **THEN** central Tehran and its synthetic incident layer are visible with synthetic disclaimer, attribution, and dataset/seed context even in a screenshot

#### Scenario: Basemap unavailable
- **WHEN** the tile provider cannot be reached
- **THEN** the user sees an understandable failure or fallback and no unrelated Frankfurt map context is substituted

### Requirement: Demo safety and reproducibility
The system SHALL preserve the existing synthetic-only demo guard and provide a documented reproducible import, launch and screenshot procedure with provider policy and licensing requirements.

#### Scenario: Real data in demo mode
- **WHEN** a non-synthetic incident dataset is present in a demo-mode database
- **THEN** the existing guard refuses demo access rather than treating it as synthetic

#### Scenario: Screenshot
- **WHEN** the documented screenshot procedure is followed with the selected snapshot and seed
- **THEN** the view is reproducible and contains the synthetic warning and map attribution without relying on unverified cross-origin canvas export
