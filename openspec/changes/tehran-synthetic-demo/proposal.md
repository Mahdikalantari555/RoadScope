# Tehran synthetic demo

## Why

The current synthetic road network is a fictional Frankfurt study area. The presentation needs recognizable central Tehran streets with reproducible synthetic crash observations located on the actual road geometry, without suggesting that those incidents or risk rankings are real.

## What Changes

Provide an isolated central-Tehran presentation profile: an OSM-derived real street network, an online configurable basemap, and synthetic observations generated against that network. Preserve source/version metadata, accurate metric operations and the existing Frankfurt demonstration. Supply an accessible, presentation-friendly view and a reproducible screenshot procedure. This change specifies future work and does not itself import data or produce a screenshot.

## Capabilities

### New Capabilities

- `tehran-synthetic-demo`: Versioned Tehran street import, isolated deterministic synthetic data, accurate map rendering and honest presentation output.

### Modified Capabilities

None. The existing Frankfurt profile and `/api/v1` contracts remain supported.

## Impact

Backend network ingestion, simulation, schema/migrations, CRS and bounds, API metadata; frontend map, presentation mode and localization; operational scripts, tests and documentation. Network data and generated artifacts remain outside Git unless a small license-compliant fixture is explicitly needed.

## Dependencies and scope

Depends on the existing foundation, directed network and simulator. It does not implement real citizen data, authentication for public use, a production map service or calibrated real-world safety assessment. `tehran-citizen-reporting` is a separate change and MUST NOT silently turn synthetic observations into real ones. `frontend-experience-improvements` is independent except for its optional Tehran presentation integration. Geographic pilot boundary and tile provider must be recorded before data import; start with a small central-Tehran boundary, subject to review. See `docs/TEHRAN_DATA_RESEARCH_FA.md`.
