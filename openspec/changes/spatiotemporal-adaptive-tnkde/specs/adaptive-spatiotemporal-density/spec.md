# adaptive-spatiotemporal-density

## Purpose

Static spatial bandwidth and time-window filtering conceal transient hotspots and do not select bandwidth from evidence (GAP-2). This specification defines proposed behavior and acceptance cases for RoadScope.

## ADDED Requirements

### Requirement: Space-time density
The system SHALL estimate lixel intensity over a specified spatial and temporal domain using fixed or bounded adaptive bandwidth, and return the domain, kernel, units, boundary treatment and input provenance.

#### Scenario: Transient event
- **WHEN** events are concentrated in a short interval on a connected network
- **THEN** the output includes time slices aligned with the requested timestamps and identifies the temporal bandwidth

#### Scenario: Empty input
- **WHEN** no eligible events are available
- **THEN** the job returns an explicit empty result without fabricating an optimum

### Requirement: Reproducible leave-one-out bandwidth
The system SHALL optionally evaluate a declared grid of spatial and temporal bandwidths using event-level leave-one-out likelihood and return candidate scores, selected parameters and numerical safeguards.

#### Scenario: Fractional event
- **WHEN** one incident has multiple candidate lixel allocations
- **THEN** all of that incident’s allocations are omitted when scoring that incident

#### Scenario: Prospective evaluation
- **WHEN** a model is evaluated at a prediction cutoff
- **THEN** training and bandwidth selection use only events available by that cutoff

### Requirement: Time exploration
The UI SHALL provide a localized time-slice player and expose selection and uncertainty metadata for completed space-time results.

#### Scenario: Failed job
- **WHEN** a TNKDE job fails
- **THEN** the user sees a localized failure and no stale result is labeled as the failed run
