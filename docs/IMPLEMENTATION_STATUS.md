# RoadScope Scientific & Engineering Implementation Status

This document describes 10 earlier OpenSpec changes. Newer Tehran and frontend changes remain open and are not included in the earlier 68-task count. Research capabilities and passing tests are not evidence of approval for sensitive data or production use.

A further change, [`tehran-citizen-reporting`](../openspec/changes/tehran-citizen-reporting/), replaces the former
Frankfurt demo area with a labelled synthetic **Tehran** citizen-reporting demo and makes ingestion region-agnostic
(open bounds, dataset-driven canonical CRS, GeoJSON network import in any EPSG). See its `tasks.md` for the current
checklist.

---

## 1. Implemented & Verified End-to-End Capabilities (10/10 OpenSpec Changes)

1. **Operational Foundation & Security (`roadscope-foundation`)**
   - Dual `ROADSCOPE_*` / `UAI_*` configuration (`backend/app/config.py`), SHA-256 checksummed SQLite migrations (`migrations/001..004`), online backup/restore (`backend/app/backup.py`, `scripts/database.py`), server-side bearer RBAC + synthetic-only demo guard + rate/body limits (`backend/app/security.py`), XSS-escaped cartographic popups (`frontend/src/utils/html.ts`), honest SQLite Docker Compose, and GitHub Actions CI.

2. **Bilingual EN/FA & RTL/LTR Geovisual Experience (`roadscope-experience`)**
   - Full English (`ltr`) and Persian (`rtl`, Vazirmatn + JetBrains Mono `tabular-nums`, `<bdi>` isolation for metric coordinates, formulas, and corridor names) across all workspaces (`HeaderBar`, `MapCanvas`, `AnalyticsWorkspace`, `SpatialLabWorkspace`, `RiskEbWorkspace`, `CitizenReportWorkspace`, `StewardWorkspace`, `SimulatorWorkspace`, `ResearchAccess`).

3. **Directed Network Topology & Conservative Transport (`directed-network-diffusion`)**
   - Directed road-segment attributes (`oneway_mode`, `forward_lanes`, `backward_lanes`, `direction_source`), validated `turn_restrictions` triggers, topology cache revisioning (`migrations/003_directed_network.sql`), directed lixel graph (`backend/app/services/directed_topology.py`), implicit backward-Euler conservative advection-diffusion (`backend/app/services/directed_transport.py`), and symmetric lixel heat diffusion (`backend/app/services/research.py`).

4. **Bounded Adaptive Spatiotemporal TNKDE & LOO-LCV (`spatiotemporal-adaptive-tnkde`)**
   - Mass-conserving space-time network kernel density estimation with clipped Abramson pilot bandwidth adaptation, causal past-only vs. retrospective temporal kernels, and event-level Leave-One-Out Likelihood Cross-Validation (`backend/app/services/adaptive_tnkde.py`, `POST /api/v1/research/tnkde`).

5. **Safety Bayes, Length-Scaled NB-SPF, Hauer CURE, BYM2 MCMC & Posterior EVPI (`safety-bayes-and-decisions`)**
   - Road-class EB/PSI, length-scaled Negative Binomial SPF ($\mu_i = L_i \exp(\beta_0 + \beta_1 \ln \text{AADT}_i)$, $\alpha_i = \alpha_1 / L_i$), tie-invariant Hauer CURE residual diagnostics (`CureChart.tsx`), Riebler-scaled BYM2 spatial hierarchical MCMC via multi-chain Laplace-preconditioned Elliptical Slice Sampling with Gelman-Rubin split-$\hat{R}$ & bulk ESS diagnostics (`backend/app/services/spatial_bayes.py`, `POST /api/v1/research/bym2`), and posterior EVPI decision support (`POST /api/v1/research/evpi`).

6. **Directed Upstream Hawkes Cascades & EM Declustering (`network-hawkes-cascades`)**
   - Subcritical ($\eta < 1$) upstream-only network Hawkes secondary crash simulation with exact parent/root ground truth and research-only Expectation-Maximization stochastic declustering (`backend/app/services/hawkes_network.py`, `POST /api/v1/research/hawkes`).

7. **Fractional VGI Allocation, Stabilized IPW & Rubin Multiple Imputation (`vgi-bias-and-uncertainty`)**
   - Persistent `incident_lixel_allocations` table (`migrations/004_research_contracts.sql`), selectable `hard | fractional` NKDE allocation with L1 mass-shift sensitivity, VGI ambiguity/entropy diagnostics (`GET /api/v1/research/vgi-diagnostics`), clipped stabilized IPW (`POST /api/v1/research/ipw`), and Rubin's Multiple Imputation across $M$ discrete categorical VGI allocations recording within/between-imputation variance and Fraction of Missing Information (`POST /api/v1/research/bym2`).

8. **Chronological Holdouts, Exact Length-Weighted PAI Curves & Multi-Seed MAUP Sensitivity (`reproducible-research-benchmarks`)**
   - Immutable `research_runs` manifests, exact fractional-lixel `PAI(a)` & `AU-PAI` curves (`backend/app/services/benchmark_curves.py`, `PaiCurveChart.tsx`), leakage-free 70%/30% chronological benchmarks (`POST /api/v1/research/benchmark`), and multi-seed / multi-resolution (`10m / 25m / 50m`) MAUP sensitivity experiments reporting CIs, calibration, Spearman rank stability, runtime ms, and peak memory (`POST /api/v1/research/maup-sensitivity`).

9. **Privacy-Preserving Surrogate Safety Schema & Bivariate Poisson-Lognormal Fusion (`surrogate-safety-fusion`)**
   - Aggregate-only `surrogate_observations` schema (`>= 60` min buckets, zero raw trajectory IDs), seeded paired crash-surrogate generator with partial sensor coverage, and multi-chain Bivariate Poisson-Lognormal MCMC (`backend/app/services/surrogate_bivariate.py`, `POST /api/v1/research/surrogate-joint`) strictly separating uncovered segments from zero-conflict covered segments and evaluated on held-out windows against crash-only and exposure-only baselines.

10. **Advanced Network Point Processes, Joint Link-Node, ZINB-STGraph & PII-Scrubbed Text Ablation (`advanced-network-research`)**
    - Network Voronoi (`POST /api/v1/research/voronoi`), Inhomogeneous Network $K_{\text{inhom}}(r)$ & $L_{\text{inhom}}(r)$ with Monte Carlo inhomogeneous Poisson envelopes (`POST /api/v1/research/network-k`), Coupled Bipartite Link-Node BYM2 (`POST /api/v1/research/joint-link-node`), Directed Viterbi Trajectory HMM (`POST /api/v1/research/trajectory-hmm`), multi-seed `ZINB-STGraph` spatiotemporal message-passing benchmark (`POST /api/v1/research/st-graph`), and consent-gated local PII-scrubbed deterministic narrative 4-way ablation (`local-charword-svd-v1`, `POST /api/v1/research/text-ablation`).

---

## 2. Explicit Ethical & Operational Guards (`unavailable`)

Exposed transparently via `GET /api/v1/research/capabilities` and localized in English and Persian:

- **`external_cloud_llm_narratives`**: Disabled by strict privacy policy; narrative experiments execute 100% locally via deterministic PII scrubbing and `local-charword-svd-v1` only after `consent_verified=true`.
- **`uncalibrated_operational_deployment`**: Research posteriors and rankings are calibrated on synthetic/demo urban data and require agency-verified police crash registries + metered AADT sensors prior to real-world capital allocation.
