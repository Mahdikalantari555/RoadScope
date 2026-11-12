# surrogate-safety

## Purpose

Rare observed crashes alone cannot characterize newly built roads or near misses (GAP-7). This specification defines proposed behavior and acceptance cases for RoadScope.

## ADDED Requirements

### Requirement: Coverage-aware surrogate observations
The system SHALL store quality-controlled surrogate counts or aggregated measurements with their segment, period, measurement definition, exposure denominator, source and privacy provenance.

#### Scenario: No device coverage
- **WHEN** a segment has no observed device coverage
- **THEN** the system marks surrogate evidence unavailable instead of treating it as zero events

#### Scenario: Public export
- **WHEN** a public aggregate is exported
- **THEN** it excludes raw identifying trajectory data and respects the configured disclosure threshold

### Requirement: Joint risk model
The research system SHALL offer an explicitly specified joint crash–surrogate model with exposure offsets, uncertainty and convergence diagnostics, and SHALL label it as non-causal.

#### Scenario: Zero crashes with evidence
- **WHEN** a segment has zero crashes but valid surrogate evidence and coverage
- **THEN** the model may estimate nonzero risk and reports posterior uncertainty and model assumptions

#### Scenario: Insufficient data
- **WHEN** paired observations or fit diagnostics are inadequate
- **THEN** the model is unavailable or flagged unreliable rather than silently producing a confident score
