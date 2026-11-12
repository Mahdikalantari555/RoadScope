# Design

## Context

The literature identifies MAUP, leakage and trivial-baseline failures; a single PAI and one simulated seed cannot validate a research model.

## Goals / Non-Goals

**Goals:** Establish reproducible multi-seed, multi-scale and held-out benchmarks, PAI curves and documented research baselines and optional extensions.

**Non-Goals:** Claiming real-world calibration or completing other changes implicitly. Maintain the existing /api/v1 and user data during rollout.

## Decisions

Define immutable experiment manifests with dataset/snapshot or generator version, network/segmentation, seed, temporal cutoff, data selection, model/parameters, software version, hardware and metrics. Separate train/validation/test by time and, where appropriate, geography; all tuning uses training only. Measure performance across seeds with uncertainty and compare historical counts, density, current NKDE/EB, exposure-aware NB and null baselines before any GNN. Compute PAI(a) over selected network-length fractions, including partial lixel or explicitly documented discrete tie treatment; report realized coverage, capture, oracle/RRI, uncertainty and a defined normalized area with integration endpoints and zero-event behavior. Avoid comparing inconsistent denominators.

Evaluate 10/25/50 m lixels and alternative segmentation, geometry, bridge/turn effects and temporal boundaries; do not claim full MAUP elimination. Include experiment designs for network Voronoi intensity and inhomogeneous second-order statistics, joint link–node models, and exposure-aware ST-GNN vs baselines; trajectory HMM requires consented sequences and text embeddings require privacy review. These are optional research prototypes gated by data and reproducible evidence, not guaranteed production features. Verify citations and numeric claims from literature before incorporating them.

## Dependencies

roadscope-foundation; integrate each scientific change when available. Optional advanced methods require suitable data and separate validation.

## Risks / Trade-offs

Synthetic truth does not establish real-world generalization. Discrete network lengths and zero-event intervals make PAI curves ambiguous unless definitions are fixed. Advanced models may not beat baselines.

## Migration and verification

Use versioned, backwards-compatible contracts and migrations where needed; preserve existing data and legacy behavior until replacement is tested. Include deterministic unit and integration tests, bilingual accessibility/error states for UI-facing behavior, documented provenance, and recovery or rollback steps appropriate to the change.
