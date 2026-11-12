# research-benchmarking

## Purpose

The literature identifies MAUP, leakage and trivial-baseline failures; a single PAI and one simulated seed cannot validate a research model. This specification defines proposed behavior and acceptance cases for RoadScope.

## ADDED Requirements

### Requirement: Reproducible and fair experiments
The system SHALL record a versioned experiment manifest, seeds, data snapshot, split, configuration, code version, software and metrics; tuning SHALL exclude held-out observations.

#### Scenario: Repeated experiment
- **WHEN** a run is replayed with the same inputs and computational environment
- **THEN** it reproduces the declared deterministic outputs within documented tolerance

#### Scenario: Time split
- **WHEN** the prediction test period follows the training period
- **THEN** no future event or ground-truth label is used for fitting or tuning

### Requirement: Network-length PAI curve
The system SHALL report PAI over a declared grid of network-length coverage fractions, realized coverage, capture and a documented normalized area, with explicit tie and zero-event handling.

#### Scenario: Unequal lixels
- **WHEN** the coverage boundary cuts through a lixel or a tie
- **THEN** the result follows its documented partial or discrete policy and reports actual coverage

#### Scenario: No observed events
- **WHEN** the test period has no eligible events
- **THEN** PAI is marked undefined rather than divided by zero or displayed as a valid score

### Requirement: Baselines and sensitivity
The system SHALL compare research models against declared simple historical, exposure-aware and existing statistical baselines on identical held-out multi-seed splits and report segmentation sensitivity and uncertainty.

#### Scenario: Complex model underperforms
- **WHEN** a GNN or other model scores below a simple baseline
- **THEN** the report retains the negative result and does not claim superiority

#### Scenario: Segmentation change
- **WHEN** the lixel resolution or zoning changes
- **THEN** the experiment records the new definition and reports variation without claiming MAUP is eliminated

### Requirement: Evidence-gated research extensions
The research roadmap SHALL treat Voronoi and inhomogeneous second-order methods, link–node models, trajectory HMM and text-enhanced ST-GNN as separately validated experiments with data and privacy prerequisites.

#### Scenario: No trajectories
- **WHEN** only single-fix citizen reports are available
- **THEN** trajectory HMM is not presented as applicable to those reports
