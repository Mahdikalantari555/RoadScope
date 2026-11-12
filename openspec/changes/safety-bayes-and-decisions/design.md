# Design

## Context

Existing EB ignores length-dependent dispersion and spatial borrowing and does not connect uncertainty to a defensible decision value (GAP-6/8).

## Goals / Non-Goals

**Goals:** Add length-aware NB-SPF/EB, CURE diagnostics, calibrated spatial BYM2, and decision analysis with explicit loss and value-of-information assumptions.

**Non-Goals:** Claiming real-world calibration or completing other changes implicitly. Maintain the existing /api/v1 and user data during rollout.

## Decisions

Add a model version with alpha_e=alpha_1/L_km and record length units, minimum segment policy, fitted parameter uncertainty, model fit and exposure source. Compare against current EB and segmentation sensitivity; length scaling does not prove MAUP invariance. Produce ordered CURE residuals versus AADT with a documented simulated or justified uncertainty envelope and report observations/assumptions.

Build edge adjacency only from genuine shared network nodes; disconnected components and isolates need separately defined scaling and constraints. Implement a specified BYM2 ICAR+iid model using a validated inference method, identifiability constraints, priors and calibrated uncertainty. A single posterior mode/Hessian is an approximation, not full Bayes or INLA; validate against a trusted reference and flag approximation/failure. For decision regimes distinguish descriptive heuristics from expected value calculations. EVPI uses posterior draws, explicit action/outcome loss functions, unit costs, horizon and baseline; EVSI requires an observation model and cost. Reject missing decision assumptions, and never label a heuristic EVPI. Preserve existing endpoints and label numerical differences.

## Dependencies

roadscope-foundation; vgi-bias-and-uncertainty for optional fractional inputs; directed-network-diffusion provides topology metadata.

## Risks / Trade-offs

Length scaling, CURE bounds and spatial priors are context-dependent; BYM2 can be underidentified on small/disconnected networks. A value estimate is only as credible as the cost and posterior models.

## Migration and verification

Use versioned, backwards-compatible contracts and migrations where needed; preserve existing data and legacy behavior until replacement is tested. Include deterministic unit and integration tests, bilingual accessibility/error states for UI-facing behavior, documented provenance, and recovery or rollback steps appropriate to the change.
