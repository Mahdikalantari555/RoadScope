# OpenSpec implementation ledger

This branch implements a **first increment**, not all ten changes. No change is
archived. An available primitive is not a validated scientific model or a completed
workspace. Unchecked OpenSpec tasks remain authoritative. The Persian master plan
and literature review remain research requirements, not claims of delivered results.

## Delivered and outstanding

| Change | Delivered | Still required before acceptance |
|---|---|---|
| foundation | SQLite-only Compose; compatible configuration aliases; ordered transactional migrations and pre-upgrade backups; backup/restore CLI; bearer identities resolved to DB users; trusted audit attribution; role checks; per-process mutation limits; synthetic-only demo guard; dependency locks and CI | Container runtime verification, production identity provisioning, comprehensive abuse limits and read-data privacy, full asset/source license inventory |
| experience | Typed English/Persian shell catalogs; persistent language; lang/dir; translated navigation, startup, access, availability and no-WebGL states; keyboard dialog; scientific value isolation; mobile overflow fix | Full six-workspace forms, legends, backend errors and map-popup translation; locale-aware formatting throughout; browser RTL, accessibility, keyboard and E2E regression coverage |
| directed diffusion | Direction/provenance migration; dataset-scoped forbidden turns; directed lixel orientation states using topological nodes (not geometric crossings); fresh topology hashes; conservative sparse matrix exponential; separate symmetric edge-state heat; immutable job records and export | Continuous metric-graph solver comparison, topology-edit API validation, line/Y/bridge analytical fixtures, graph-size runtime/memory benchmark, localized map layers and controls |
| adaptive TNKDE | Fixed network-distance/length-quadrature exponential spatial kernel and truncated causal/retrospective time kernel primitive; empty/disconnected behavior and normalization tests | Real incident distance/allocation adapter, bounded pilot adaptation, full event-level LOO-LCV integral/objective/grid, time player, API/jobs, holdout experiments |
| VGI uncertainty | Candidate normalization including 52/48; lazy versioned allocation backfill; invalidation on correction/status/merge; excluded duplicates; no implicit missing-support fallback; linked-stratum stabilized IPW primitive with positivity checks/ESS | Fractional propagation into lab/statistics, hard-vs-fractional comparisons, linked-reference estimator/data, allocation multiple imputation and calibration; synthetic reporting mechanisms |
| Hawkes | Seeded stable bounded uniform-upstream branching **baseline primitive** with synthetic parent/root truth and finite-window censoring; zero-trigger and legal-upstream tests | Simulator/UI scenario integration, distance-kernel specification, fitted declustering and identifiability/convergence diagnostics, truth-isolated calibration and non-Hawkes null evaluation |
| Bayes/decisions | Supplied-SPF length-scaled NB/EB primitive/API, gamma-Poisson latent variance conditional on fixed SPF, cumulative residual sequence, explicit posterior-loss EVPI | Fitted/versioned SPF with parameter uncertainty, justified CURE envelopes, validated BYM2 inference/scaling/priors/convergence, VGI imputation, localized diagnostic layers and decision views |
| surrogate fusion | Aggregate-only SQLite storage schema; no raw trajectories; positive exposure and time-domain constraints; joint-model unavailable state | Ingestion/quality/retention/access/disclosure controls, coverage-aware adapter and synthetic pairs, validated bivariate Poisson-lognormal posterior, held-out calibration and localized comparisons |
| benchmarks | Partial-length/tie-aware capture and PAI curve, explicit zero-event handling and normalized **excess capture area**; hashed inputs, software/code metadata and immutable diffusion runs | Experiment runner, immutable dataset snapshots, chronological tuning/holdout policy enforcement, all baselines, multi-seed/multi-resolution sensitivity, AU-PAI convention agreed with spec, calibration/resource reports and replay CLI |
| advanced methods | Discrete length-weighted network Voronoi primitive with unsupported-component output; legal-route Viterbi HMM baseline with single-fix/no-route failures; explicit bilingual model gates | Inhomogeneous second-order statistics/envelopes, joint link–node posterior, calibrated trajectory likelihoods/quality checks, exposure-aware probabilistic ST-GNN, privacy-reviewed text variant, verified sources/licenses and multi-seed baseline comparisons |

## Numerical policies

- Diffusion is a **finite-state event-mass operator**, not a validated continuous
  metric-graph PDE. Directed transitions have total exit rate `rate_per_s`, equally
  split between outgoing states. Symmetric heat uses symmetric edge conductance.
  Terminal states retain mass. Duration is seconds; output is event mass, not risk.
  Reverse and forward orientations are distinct states. Legacy NKDE is unchanged.
- `expm_multiply` diagnostic tolerances: minimum mass >= -1e-10 and total absolute
  mass error <= 1e-8 × max(1,input mass). At most 20,000 states; rate × time <= 10,000.
- PAI ties share length and observed counts uniformly; partial-lixel capture is
  interpolated. PAI at coverage zero and any no-event PAI are null. The reported
  area is `2 integral(capture(a)-a) da`, **not** a mislabeled integral of PAI(a).
- Fixed TNKDE quadrature returns events/metre/second. Network-unreachable locations
  receive zero. Temporal integration is normalized on a finite declared window.
  A causal event at the exact right boundary has zero represented temporal mass;
  prospective fitting/cutoff enforcement is not yet a delivered workflow.
- EB assumes supplied SPF and dispersion are fixed. It is not a fitted spatial
  posterior. Cumulative residuals are not a confidence envelope. EVPI requires
  action losses for each posterior draw including costs in a stated unit/horizon.
- Candidate arrays are normalized once per incident. Verified canonical incidents
  use explicit verified hard assignments. Allocation versions preserve historical
  weights; raw observation coordinates are never overwritten by this adapter.
- No primary-paper replication, calibrated real-world performance, MAUP elimination
  or model superiority is claimed. No narratives are transmitted to external services.

## Verification performed

- `PYTHONPATH=backend .venv/bin/python -m pytest -q backend/tests`: 25 passed.
- `npm ci --prefix frontend && npm run build --prefix frontend`: production build.
- `npm test --prefix frontend`: 3 DOM tests passed (shell catalog parity, six-workspace navigation language/persistence/RTL/LTR, research access dialog).
- `npm audit --prefix frontend`: zero known advisories at verification time after
  updating MapLibre, Vite and the React plugin; not a guarantee of future safety.
- OpenSpec 2.0.0 strict validation: all ten changes pass.
- Docker and browser E2E tests were **not run** in this environment.

The baseline SQLite file is retained unchanged as a legacy-upgrade fixture. Generated
SPA artifacts are no longer tracked: the build is now an explicit prerequisite.
