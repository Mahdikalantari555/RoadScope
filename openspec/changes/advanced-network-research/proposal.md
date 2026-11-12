# Advanced network research methods

## Why

The literature review discusses network Voronoi and inhomogeneous second-order statistics, joint link–node spatial modeling, trajectory map-matching and modern graph/text models beyond the eight explicit gaps. They need implementable research plans and reproducibility gates, not unsupported claims of superiority.

## What Changes

Implement experimental, separately labeled methods and synthetic fixtures for each research line, then compare them with appropriate baselines under the benchmark protocol. Guard availability on suitable inputs, privacy and diagnostics. These do not replace core methods.

## Capabilities

### New Capabilities

- `advanced-network-methods`: network Voronoi, inhomogeneous point-process methods, joint link–node analysis, trajectory matching and reproducible graph/text experiments.

### Modified Capabilities

None; this proposal defines a new experimental capability.

## Impact

Network/statistical services, synthetic fixtures, research job APIs, documentation and UI; optional isolated ML dependencies and infrastructure. Preserve current API and data behavior.

## Dependencies and scope

Requires `directed-network-diffusion`, `safety-bayes-and-decisions`, `roadscope-foundation`, and the manifest/split/baseline contracts of `reproducible-research-benchmarks`. Trajectories and text require suitable consented datasets or synthetic test fixtures. These methods remain research-only until independently validated.
