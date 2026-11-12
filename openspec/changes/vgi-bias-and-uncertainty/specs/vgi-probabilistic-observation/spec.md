# vgi-probabilistic-observation

## Purpose

Winner-only snap and uncorrected reporting propensities hide positional and selection uncertainty (GAP-4/5). This specification defines proposed behavior and acceptance cases for RoadScope.

## ADDED Requirements

### Requirement: Event allocation conservation
The system SHALL persist versioned candidate-to-lixel probabilities and propagate them as a single incident distribution; each eligible event allocation SHALL sum to one within a documented tolerance.

#### Scenario: Ambiguous snap
- **WHEN** a single report has candidate probabilities 0.52 and 0.48
- **THEN** fractional analysis allocates those weights to the two candidates and preserves total event mass of one

#### Scenario: Merged reports
- **WHEN** multiple witness reports are merged into one incident
- **THEN** downstream crash counts do not treat each witness as a separate crash

### Requirement: Identifiable reporting correction
The system SHALL offer bounded stabilized inverse-propensity weighting only when a documented linked reference, overlap and support are adequate; it SHALL report model, clipping, effective sample size and uncertainty.

#### Scenario: No reference
- **WHEN** no suitable reference data exist
- **THEN** the correction is unavailable with a reason and uncorrected results remain clearly labeled

#### Scenario: Poor positivity
- **WHEN** a supported stratum has near-zero estimated reporting probability
- **THEN** the run reports the support failure and does not silently claim unbiased correction

### Requirement: Allocation lifecycle
The system SHALL update or invalidate allocation versions after stewardship corrections and retain original coordinates and provenance.

#### Scenario: Manual correction
- **WHEN** a steward revises the chosen segment
- **THEN** subsequent analyses do not reuse a stale allocation without recording the revision
