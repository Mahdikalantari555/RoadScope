# Advanced network methods

## Purpose

Provide evidence-gated implementations of the additional point-process, joint spatial and graph research methods described in the literature review.

## ADDED Requirements

### Requirement: Network point-process research
The system SHALL implement network Voronoi intensity and a documented inhomogeneous network second-order test, recording graph distance, units, boundary correction, intensity estimate and null simulation parameters.

#### Scenario: Disconnected components
- **WHEN** a network component has no eligible events
- **THEN** the result reports that component as unsupported under the declared policy instead of borrowing across disconnected components

#### Scenario: Null simulation
- **WHEN** a researcher runs a second-order test
- **THEN** the result includes reproducible null envelopes, seed and method assumptions

### Requirement: Joint link–node modeling
The system SHALL offer a research model using link and node observations and incidence-based spatial dependence, with documented priors, uncertainty and diagnostics.

#### Scenario: Missing node observations
- **WHEN** node observations are absent or unsuitable
- **THEN** the joint fit is unavailable or explicitly marked as limited and does not fabricate node events

### Requirement: Trajectory-based map matching
The system SHALL provide a network-constrained HMM for ordered trajectories separately from the existing single-fix matching mode, with emission and transition assumptions and legal route constraints.

#### Scenario: Single fix
- **WHEN** an input contains only one position
- **THEN** trajectory HMM is not presented as a valid trajectory result and the single-fix option remains available

#### Scenario: Illegal transition
- **WHEN** a candidate transition requires an illegal turn or unreachable segment
- **THEN** the HMM excludes it or reports no valid route according to its documented policy

### Requirement: Reproducible graph and text research
The system SHALL implement a research-only exposure-aware spatiotemporal graph model and a separately gated text-enhanced variant, evaluated against simple baselines using identical chronological splits and multiple seeds.

#### Scenario: Missing exposure or consented text
- **WHEN** required exposure or consented text is unavailable
- **THEN** the affected model or variant is unavailable with a clear reason and no input is fabricated or transmitted externally

#### Scenario: Baseline wins
- **WHEN** the held-out graph model performs worse than a historical-count or NB/EB baseline
- **THEN** the evaluation reports that outcome and its uncertainty without claiming superiority
