# Design

## Context

A memoryless simulator cannot evaluate secondary crash cascades or distinguish background and triggered intensity (GAP-3).

## Goals / Non-Goals

**Goals:** Add reproducible directed upstream Hawkes simulations and research-only probabilistic declustering.

**Non-Goals:** Claiming real-world calibration or completing other changes implicitly. Maintain the existing /api/v1 and user data during rollout.

## Decisions

Define upstream reachability relative to legal traffic flow and a finite space/time support. Implement background intensity plus normalized directed exponential triggering with explicit time and length units, severity productivity and branching stability constraint; persist simulation seed, parameters and true parent/root only for synthetic events. Implement stochastic or deterministic EM declustering with probability-normalized parent/background components, exposure and boundary corrections and diagnostics. Mark model as observational, not causal; confounding and queue direction are assumptions. Bound event counts and runtime and expose job failure without partial results mislabeled as complete.

## Dependencies

directed-network-diffusion and roadscope-foundation.

## Risks / Trade-offs

Low counts, confounding, missing traffic direction and unobserved parents harm identification; induced cascades can explode near instability.

## Migration and verification

Use versioned, backwards-compatible contracts and migrations where needed; preserve existing data and legacy behavior until replacement is tested. Include deterministic unit and integration tests, bilingual accessibility/error states for UI-facing behavior, documented provenance, and recovery or rollback steps appropriate to the change.
