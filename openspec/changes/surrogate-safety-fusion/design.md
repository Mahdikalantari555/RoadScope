# Design

## Context

Rare observed crashes alone cannot characterize newly built roads or near misses (GAP-7).

## Goals / Non-Goals

**Goals:** Ingest privacy-preserving safety surrogate observations with coverage and fit a validated joint crash–surrogate research model.

**Non-Goals:** Claiming real-world calibration or completing other changes implicitly. Maintain the existing /api/v1 and user data during rollout.

## Decisions

Define event or aggregated SSM schema with source, version, segment, UTC time, harsh-braking threshold or iTTC definition, observation quality, device coverage and vehicle-km/time denominator. Validate coverage, spatial matching, dataset ownership and missingness. Aggregate/minimize trajectory data and apply retention/access controls; no raw identity in public outputs. Simulate paired counts and shared random effects with known truth and missingness. Implement a bivariate Poisson-lognormal (or explicitly justified alternative) with shared effect, exposure offsets, priors/identification and posterior uncertainty; calibrate against established reference. Never imply a zero count means zero risk or association proves causation; suppress forecasts when coverage or model is unsupported.

## Dependencies

safety-bayes-and-decisions and roadscope-foundation; benchmark integration follows reproducible-research-benchmarks.

## Risks / Trade-offs

SSM detection and coverage bias differ by device and operator; joint models need sufficient paired observations. Trajectories can identify people.

## Migration and verification

Use versioned, backwards-compatible contracts and migrations where needed; preserve existing data and legacy behavior until replacement is tested. Include deterministic unit and integration tests, bilingual accessibility/error states for UI-facing behavior, documented provenance, and recovery or rollback steps appropriate to the change.
