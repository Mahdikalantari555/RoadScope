# Design

## Context

Winner-only snap and uncorrected reporting propensities hide positional and selection uncertainty (GAP-4/5).

## Goals / Non-Goals

**Goals:** Preserve and propagate event-level snap distributions, model reporting propensities only when identifiable, and diagnose bias without double-counting witnesses.

**Non-Goals:** Claiming real-world calibration or completing other changes implicitly. Maintain the existing /api/v1 and user data during rollout.

## Decisions

Add versioned event-to-lixel allocations with dataset, candidate origin, probability and generation/review revision. Sum probabilities per event to one within tolerance; retain winner, raw observation and candidates for compatibility, and transactionally recalculate on review/merge. Define missing/invalid candidate handling and preserve manually corrected allocations without silently recreating them. Do not count corroborating reports as independent crashes. Support hard and fractional analysis; for count likelihoods use an appropriate latent allocation model or multiple imputation, not naive NB on fractional counts.

Fit pi(e,t) using a linked independent verified reference and VGI observation opportunities, with time, road class and exposure covariates, verified matching and explicit selection assumptions. Provide stabilized clipped inverse weights, cap/floor, effective sample size, overlap, missingness and uncertainty diagnostics. If reference coverage or positivity is inadequate, return uncorrected results and an explicit unavailable reason, not a claimed correction. Simulate configurable day/night and road-class selection for validation; distinguish credibility from reporting probability.

## Dependencies

roadscope-foundation and directed-network-diffusion for topology; downstream TNKDE and safety integrate the shared event allocation contract.

## Risks / Trade-offs

Nonrandom verification and lack of reference coverage make propensity non-identifiable. Candidate probabilities and reference linkage can be miscalibrated. IPW can amplify variance.

## Migration and verification

Use versioned, backwards-compatible contracts and migrations where needed; preserve existing data and legacy behavior until replacement is tested. Include deterministic unit and integration tests, bilingual accessibility/error states for UI-facing behavior, documented provenance, and recovery or rollback steps appropriate to the change.
