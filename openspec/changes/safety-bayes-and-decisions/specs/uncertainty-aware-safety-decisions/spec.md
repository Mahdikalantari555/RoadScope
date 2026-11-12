# uncertainty-aware-safety-decisions

## Purpose

Existing EB ignores length-dependent dispersion and spatial borrowing and does not connect uncertainty to a defensible decision value (GAP-6/8). This specification defines proposed behavior and acceptance cases for RoadScope.

## ADDED Requirements

### Requirement: Length-aware safety estimation
The system SHALL offer a versioned NB-SPF and EB mode using alpha_e=alpha_1/L_e where L_e is in kilometres, reporting parameter estimates, exposure sources and uncertainty separately from legacy results.

#### Scenario: Different segment lengths
- **WHEN** valid segments have different lengths
- **THEN** the model records each effective length and corresponding dispersion without asserting automatic MAUP invariance

#### Scenario: Missing exposure
- **WHEN** AADT is missing or imputed
- **THEN** the result identifies the missingness or imputation and its limitations

### Requirement: CURE and spatial model diagnostics
The system SHALL provide CURE residual diagnostics and a separately identified BYM2 model with documented adjacency, component handling, priors, inference and uncertainty diagnostics.

#### Scenario: Disconnected network
- **WHEN** the graph contains disconnected components or isolated segments
- **THEN** the model applies documented scaling/constraints or marks unsupported components without linking them artificially

#### Scenario: Failed fit
- **WHEN** the inference does not converge or diagnostics fail
- **THEN** the result is marked unreliable or failed rather than presented as calibrated

### Requirement: Decision value with explicit assumptions
The system SHALL distinguish heuristic action categories from EVPI, which requires posterior uncertainty and explicit action-specific losses, costs, time horizon and units.

#### Scenario: Missing loss model
- **WHEN** a user requests EVPI without defined actions and losses
- **THEN** the calculation is unavailable with a localized explanation

#### Scenario: Certain outcome
- **WHEN** all posterior draws imply the same optimal action
- **THEN** EVPI is zero within numerical tolerance
