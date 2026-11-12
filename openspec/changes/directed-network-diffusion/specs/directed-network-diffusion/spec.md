# directed-network-diffusion

## Purpose

Undirected distance can transmit traffic influence across illegal turns, grade separation or against allowed flow (GAP-1). This specification defines proposed behavior and acceptance cases for RoadScope.

## ADDED Requirements

### Requirement: Directed network topology
The system SHALL model segment travel direction relative to u→v and dataset-scoped turn restrictions while preserving grade separation and identifying assumed or unknown direction.

#### Scenario: Prohibited turn
- **WHEN** two geometrically crossing edges have no legal connection or their turn is prohibited
- **THEN** the directed graph contains no transition between those edge states

#### Scenario: Legacy network
- **WHEN** a pre-migration network lacks direction
- **THEN** the migration records an explicit assumed-bidirectional status instead of claiming measured direction

### Requirement: Conservative diffusion and transport
The analysis SHALL provide separately identified symmetric heat diffusion and directed transport/diffusion, with units, boundary conditions and solver parameters in result provenance.

#### Scenario: One-way graph
- **WHEN** a directed run starts on a one-way segment with no permitted reverse path
- **THEN** transport does not create mass on an unreachable upstream edge and total mass is conserved within documented numerical tolerance

#### Scenario: Unstable step
- **WHEN** selected solver parameters cannot guarantee the documented nonnegative solution
- **THEN** the run fails clearly or uses a documented positivity-preserving solver rather than silently returning negative intensity

### Requirement: Compatibility and isolation
Existing undirected NKDE SHALL remain available and results SHALL use the dataset and topology version requested.

#### Scenario: Topology update
- **WHEN** a turn restriction changes after an analysis
- **THEN** subsequent jobs use the new topology rather than stale cached transitions
