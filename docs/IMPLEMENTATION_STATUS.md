# RoadScope Scientific & Engineering Implementation Status

This document records the exact implementation status of the 10 OpenSpec changes integrated into RoadScope, distinguishing **end-to-end verified capabilities**, **standalone library primitives**, and **gated models** whose data prerequisites are not met by a single synthetic urban snapshot.

---

## 1. Implemented & Verified End-to-End Capabilities

1. **Operational Foundation & Security (`roadscope-foundation`)**
   - Dual `ROADSCOPE_*` / `UAI_*` configuration (`backend/app/config.py`), SHA-256 checksummed SQLite migrations (`migrations/001..004`), online backup/restore (`backend/app/backup.py`, `scripts/database.py`), server-side bearer RBAC + synthetic-only demo guard + rate/body limits (`backend/app/security.py`), XSS-escaped cartographic popups (`frontend/src/utils/html.ts`), honest SQLite Docker Compose, and GitHub Actions CI.

2. **Bilingual EN/FA & RTL/LTR Geovisual Experience (`roadscope-experience`)**
   - Full English (`ltr`) and Persian (`rtl`, Vazirmatn + JetBrains Mono `tabular-nums`, `<bdi>` isolation for metric coordinates, formulas, and corridor names) across all 6 workspaces (`HeaderBar`, `MapCanvas`, `AnalyticsWorkspace`, `SpatialLabWorkspace`, `RiskEbWorkspace`, `CitizenReportWorkspace`, `StewardWorkspace`, `ResearchAccess`).

3. **Directed Network Topology & Conservative Transport (`directed-network-diffusion`)**
   - Directed road-segment attributes (`oneway_mode`, `forward_lanes`, `backward_lanes`, `direction_source`), validated `turn_restrictions` triggers, topology cache revisioning (`migrations/003_directed_network.sql`), directed lixel graph (`backend/app/services/directed_topology.py`), implicit backward-Euler conservative advection-diffusion (`backend/app/services/directed_transport.py`), and symmetric lixel heat diffusion (`backend/app/services/research.py`).
   - Endpoints: `GET /api/v1/network/directed-topology`, `POST /api/v1/network/turn-restrictions`, `POST /api/v1/lab/directed-transport`.

4. **Bounded Adaptive Spatiotemporal TNKDE & LOO-LCV (`spatiotemporal-adaptive-tnkde`)**
   - Mass-conserving space-time network kernel density estimation with clipped Abramson pilot bandwidth adaptation, causal past-only vs. retrospective temporal kernels, and event-level Leave-One-Out Likelihood Cross-Validation (`backend/app/services/adaptive_tnkde.py`), wired to an interactive time-slice player in `SpatialLabWorkspace` and `MapCanvas` (`POST /api/v1/research/tnkde`).

5. **Safety Bayes, Length-Scaled NB-SPF, Hauer CURE & Posterior EVPI (`safety-bayes-and-decisions`)**
   - Road-class EB/PSI plus fitted length-scaled Negative Binomial SPF ($\mu_i = L_i \exp(\beta_0 + \beta_1 \ln \text{AADT}_i)$, $\alpha_i = \alpha_1 / L_i$) via `scipy.optimize` (`backend/app/services/length_spf.py`), tie-invariant Hauer CURE cumulative residual plots with $\pm 2\hat{\sigma}$ bands (`backend/app/services/cure_diagnostics.py`, `CureChart.tsx`), and posterior Expected Value of Perfect Information (`POST /api/v1/research/evpi`) strictly separated from heuristic MCDA weights in `RiskEbWorkspace`.

6. **Directed Upstream Hawkes Cascades & EM Declustering (`network-hawkes-cascades`)**
   - Subcritical ($\eta < 1$) upstream-only network Hawkes secondary crash simulation with exact parent/root ground truth and research-only Expectation-Maximization stochastic declustering (`backend/app/services/hawkes_network.py`, `POST /api/v1/research/hawkes`, interactive panel in `SimulatorWorkspace`).

7. **Fractional VGI Allocation & Stabilized IPW Diagnostics (`vgi-bias-and-uncertainty`)**
   - Persistent `incident_lixel_allocations` table (`migrations/004_research_contracts.sql`) automatically invalidated/recomputed on steward review or cluster merge (`backend/app/services/allocations.py`), selectable `allocation_mode: "hard" | "fractional"` in NKDE with L1 mass-shift sensitivity (`SpatialLabWorkspace`), VGI ambiguity/entropy diagnostics (`GET /api/v1/research/vgi-diagnostics` in `StewardWorkspace`), and clipped stabilized Inverse Probability Weighting (`POST /api/v1/research/ipw`).

8. **Chronological Holdout Benchmarks & Exact Length-Weighted PAI Curves (`reproducible-research-benchmarks`)**
   - Immutable `research_runs` manifests, exact fractional-lixel `PAI(a)` & `AU-PAI` curves (`backend/app/services/benchmark_curves.py`, `PaiCurveChart.tsx`), and leakage-free 70%/30% chronological train/future-holdout benchmarking across Historical Count, Linear Crash Density, Exposure-Aware NB-EB, and Shortest-Path NKDE (`backend/app/services/benchmarks.py`, `POST /api/v1/research/benchmark`).

9. **Privacy-Preserving Surrogate Safety Schema (`surrogate-safety-fusion`)**
   - Aggregate-only `surrogate_observations` schema rejecting sub-60-minute buckets or raw trajectory identifiers (`migrations/004_research_contracts.sql`), distinguishing uncovered segments from zero-conflict covered segments (`GET/POST /api/v1/research/surrogates`).

---

## 2. Library Primitives & Honesty-Gated Models

Exposed transparently via `GET /api/v1/research/capabilities` and the UI **Research availability & access** dialog:

- **Library Primitives (`primitives_only`)**: `network_voronoi_intensity` and `viterbi_map_match` in `backend/app/services/research.py` (unit-tested in `backend/tests/test_research.py`).
- **Explicitly Gated (`unavailable`)**:
  - `spatial_bayes_bym2_inla`: Requires multi-period panel crash counts and MCMC/INLA posterior validation; not approximated by deterministic smoothing.
  - `joint_crash_surrogate_poisson_lognormal`: Requires paired empirical crash and conflict observation windows before joint latent-risk fusion is enabled.
  - `st_gnn_forecasting` & `text_narrative_embedding`: Require longitudinal panel horizons and PII-scrubbed narrative corpora respectively.
