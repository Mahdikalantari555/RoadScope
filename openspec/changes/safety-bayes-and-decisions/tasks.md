# Tasks

## 1. Implementation and validation

- [ ] 1.1 Define versioned SPF and exposure/length policy; fit length-scaled NB dispersion and compare with existing EB.
- [ ] 1.2 Implement CURE residuals and justified uncertainty envelopes with insufficient-data handling.
- [ ] 1.3 Specify edge-node adjacency, connected-component scaling and priors; implement validated BYM2 with uncertainty and convergence diagnostics.
- [ ] 1.4 Integrate optional VGI uncertainty via compatible latent count or multiple imputation; document assumptions and provenance.
- [ ] 1.5 Implement transparent heuristic decision regimes and separate posterior-based EVPI/optional EVSI with explicit actions, loss, costs and horizon.
- [ ] 1.6 Add localized CURE, uncertainty, decision and assumption views plus export provenance.
- [ ] 1.7 Test analytical NB/EB, disconnected graphs, zero counts, fit failure, posterior calibration, segmentation sensitivity and decision-value invariants.

Progress: a descriptive CURE curve for the legacy SPF is implemented with pointwise working-model envelopes, tie grouping, exposure-imputation counts, and insufficient-variation tests. The length-scaled model, independently validated diagnostic uncertainty, BYM2, decisions/EVPI and bilingual views remain open.
