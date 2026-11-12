# Design

## Context

Single-fix VGI reports are not trajectories; sophisticated models cannot be evaluated fairly without matched splits, exposure and simple baselines. The review describes further point-process and link–node methods that complement GAP-1 through GAP-8.

## Goals / Non-Goals

**Goals:** Provide implementations, fixtures, APIs, documentation and validation for each method rather than claiming that literature citations themselves implement functionality.

**Non-Goals:** Operational prediction, fabricated real-world accuracy, treating text or trajectories as available for current data, or asserting the named published GNN is exactly replicated without confirming its code, inputs and license.

## Decisions

1. Implement network Voronoi intensity with explicit metric-graph distance, boundary/disconnected component and zero-event policy. Implement a defined inhomogeneous network K or comparable second-order test with intensity correction, null simulation envelopes and an explicit edge correction. Publish formulas, units and assumptions.
2. Implement a joint link–node research model using incidence-based adjacency and compatible observations at both links and nodes. Handle missing node events and disconnected components; compare with the segment-only BYM2 model using held-out likelihood and uncertainty. Label the approach and priors, not as a reproduction unless verified.
3. Implement a trajectory HMM with emission/transition likelihoods and network-constrained legal routes, ordered timestamps and uncertainty. Provide synthetic trajectories; reject single-point inputs for trajectory mode, leaving existing single-fix matching unchanged. Document gaps, unreachable transitions and sampling assumptions.
4. Implement an exposure-aware graph/time baseline and an experimental spatiotemporal graph model with zero-inflated or other justified count distribution. Provide synthetic fixtures, multiple seeds, uncertainty calibration and strict chronological splits; compare historical counts, NB/EB and simple graph baselines. If the cited model is replicated, pin primary source, license, preprocessing and code; otherwise name the implementation honestly. A text-enhanced variant must use opt-in, de-identified text and a reproducible versioned embedding; synthetic narrative fixtures for tests. Benchmark ablations with and without text and exposure.
5. Use versioned manifests and job states, bounded resources, clear diagnostics, metric/CRS units and localization of results. Do not download models or send sensitive narratives to external services without explicit approved consent and data handling.

## Risks / Trade-offs

Computational and dataset requirements can be high; methodological choices can invalidate comparison. Privacy-preserving synthetic fixtures test functionality but do not prove real-world utility. External weights and model licenses require review.

## Migration and verification

Add research-only endpoints and opt-in dependencies; preserve existing event, network, VGI and risk flows. Test synthetic known cases and failure modes, document resources and reproducibility, and suppress unsupported output on missing data or failed diagnostics.
