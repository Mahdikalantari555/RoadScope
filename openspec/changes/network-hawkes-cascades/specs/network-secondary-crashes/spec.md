# network-secondary-crashes

## Purpose

A memoryless simulator cannot evaluate secondary crash cascades or distinguish background and triggered intensity (GAP-3). This specification defines proposed behavior and acceptance cases for RoadScope.

## ADDED Requirements

### Requirement: Seeded upstream cascades
The simulator SHALL generate a stable, bounded network Hawkes scenario with directed upstream triggering and retain synthetic parent labels, parameters and seed.

#### Scenario: Forbidden direction
- **WHEN** an edge is not upstream-reachable under legal flow
- **THEN** a simulated parent does not trigger an event on that edge

#### Scenario: Zero excitation
- **WHEN** trigger productivity is zero
- **THEN** the simulated process has no triggered offspring

### Requirement: Probabilistic declustering
The research analysis SHALL estimate background and secondary probabilities with convergence and support diagnostics, and SHALL identify them as model-based rather than causal findings.

#### Scenario: Insufficient observations
- **WHEN** the event sample is insufficient for identifiable estimation
- **THEN** the analysis reports the limitation instead of returning confident secondary labels

#### Scenario: Synthetic evaluation
- **WHEN** synthetic parent labels exist
- **THEN** evaluation reports calibration against held-out truth without exposing labels as input to inference

### Requirement: Resource safety
The simulation SHALL reject unstable or invalid parameter values and enforce declared resource limits.

#### Scenario: Unstable process
- **WHEN** the specified branching configuration violates the stability rule
- **THEN** the request is rejected with a clear error
