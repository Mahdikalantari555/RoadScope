# Tasks

## 1. Implementation and validation

- [ ] 1.1 Define immutable experiment manifest, versioned dataset snapshots, split policy and deterministic seeds.
- [ ] 1.2 Implement historical count, linear density, legacy NKDE/EB and exposure-aware NB baselines using identical held-out splits.
- [ ] 1.3 Implement full length-based PAI(a), capture/Lorenz and explicitly normalized AU-PAI with tie, endpoint and zero-event rules.
- [ ] 1.4 Run multi-seed, multi-resolution and zoning sensitivity experiments; report uncertainty, calibration, RMSE, RRI, PAI, rank metrics and resource use.
- [ ] 1.5 Build benchmark contracts for directed diffusion, TNKDE, VGI, Hawkes, BYM2 and SSM; export reproducible metadata without leaking truth.
- [ ] 1.6 Specify gated optional Voronoi/inhomogeneous second-order, joint link–node, ST-GNN, trajectory HMM and privacy-reviewed text baselines; implement only with required datasets and comparison protocols.
- [ ] 1.7 Verify cited claims/parameters against primary sources and publish negative results, dataset limitations and exact reproduction instructions.
- [ ] 1.8 Add localized plots and tests for leakage, ties, unequal lengths, no events, fixed seeds, splits and manifest replay.

Progress: the synthetic in-sample NKDE results now expose a length-based PAI/capture curve and exact normalized AU-PAI, with tie and zero-mass tests. Held-out event evaluation, experimental manifests, and the remaining benchmark integrations are not yet implemented.
