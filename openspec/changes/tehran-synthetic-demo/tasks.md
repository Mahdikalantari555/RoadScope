# Tasks

## 0. Replacement scope
- [ ] 0.1 Make Tehran the default across the map, simulator and supported analytical workflows; remove Frankfurt-specific context from the normal user-facing path without deleting or reinterpreting legacy data.
- [ ] 0.2 Verify the default startup uses a central-Tehran analytical dataset and fails clearly when it is not configured, rather than silently falling back to Frankfurt.

## 1. Data and safety
- [ ] 1.1 Select and document central-Tehran polygon, buffer, extract version, licensing and tile provider; confirm availability from target environment.
- [ ] 1.2 Design separate network and incident provenance, synthetic-only guard and profile isolation; document demo database location and backup/restore.
- [ ] 1.3 Implement versioned, idempotent OSM extract/import into segment/node/lixel topology; preserve source IDs, directions and grades and report coverage and ambiguous links.
- [ ] 1.4 Audit and implement dataset/profile CRS and bounds support including Tehran EPSG:32639, Frankfurt EPSG:25832, WGS84 exchange and legacy column/API compatibility.
- [ ] 1.5 Generate reproducible, synthetic incidents on real Tehran roads; store seed, parameters, version and synthetic provenance; prevent any writes to existing datasets.
- [ ] 1.6 Audit exposure, environmental data and risk outputs; label simulated values and disable inappropriate uncalibrated outputs.

## 2. Presentation and operations
- [ ] 2.1 Configure bounds, center, map reset, road search, coordinate readout and localized contexts from dataset metadata; remove Frankfurt-specific assumptions from Tehran.
- [ ] 2.2 Make basemap configurable, accessible, attributed and optional with provider failure fallback; comply with provider policy.
- [ ] 2.3 Add Persian/English presentation view with permanent synthetic and network provenance labels and screenshot instructions.
- [ ] 2.4 Document licensed extraction, profile startup, snapshot/update, screenshot workflow, backup, migration and rollback; keep large data and outputs out of Git.

## 3. Validation
- [ ] 3.1 Add fixture-based import tests for idempotence, topology, OSM metadata, grade separation, invalid and missing inputs.
- [ ] 3.2 Test metric CRS reference distances, coordinate order and round trips; regression-test existing Frankfurt database and API behavior.
- [ ] 3.3 Test fixed-seed reproducibility, incident-to-road matching, guard behavior and non-overwrite isolation.
- [ ] 3.4 Test map states, provider failures, RTL/LTR, attribution, screenshot-visible warnings and representative viewport performance; record results.
