# reproducible-research-benchmarks

## Why

The literature identifies MAUP, leakage and trivial-baseline failures; a single PAI and one simulated seed cannot validate a research model.

## What Changes

Establish reproducible multi-seed, multi-scale and held-out benchmarks, PAI curves and documented research baselines and optional extensions.

## Capabilities

### New Capabilities

- `research-benchmarking`: Establish reproducible multi-seed, multi-scale and held-out benchmarks, PAI curves and documented research baselines and optional extensions.

### Modified Capabilities

None. These are proposed new specifications; they do not assert that the capability is already implemented.

## Impact

spatial_lab.py, simulator, benchmark harness, stored job provenance, CI, UI/export and research documentation.

## Dependencies and scope

roadscope-foundation; integrate each scientific change when available. Optional advanced methods require suitable data and separate validation. See `IMPLEMENTATION_PLAN_FA.md` for sequencing. Out of scope: representing synthetic or unvalidated results as operational safety conclusions.
