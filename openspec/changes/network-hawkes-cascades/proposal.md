# network-hawkes-cascades

## Why

A memoryless simulator cannot evaluate secondary crash cascades or distinguish background and triggered intensity (GAP-3).

## What Changes

Add reproducible directed upstream Hawkes simulations and research-only probabilistic declustering.

## Capabilities

### New Capabilities

- `network-secondary-crashes`: Add reproducible directed upstream Hawkes simulations and research-only probabilistic declustering.

### Modified Capabilities

None. These are proposed new specifications; they do not assert that the capability is already implemented.

## Impact

point_process_sim.py, new hawkes_declustering.py, schema, API, simulator and analysis UI.

## Dependencies and scope

directed-network-diffusion and roadscope-foundation. See `IMPLEMENTATION_PLAN_FA.md` for sequencing. Out of scope: representing synthetic or unvalidated results as operational safety conclusions.
