# RoadScope

RoadScope is the new name for the Urban Accident Intelligence (UAI) research platform. Existing `UAI_*` configuration names and `/api/v1` remain unchanged for compatibility.

- [برنامهٔ جامع پیاده‌سازی](IMPLEMENTATION_PLAN_FA.md)
- [OpenSpec proposals and specifications](openspec/README.md)
- [Literature review](LITERATURE_REVIEW_FA.md)

## RoadScope research platform

**Network-Constrained Spatiotemporal Road Accident Intelligence, Uncertainty-Aware VGI Conflation & Empirical Bayes Safety Modeling**

---

> **Research prototype, partial OpenSpec implementation:** SQLite is the supported database. Mutations now use server-side bearer identities by default; persona selection does not authenticate. Legacy read APIs remain public, so use synthetic data in a private deployment only. See [implementation status](docs/IMPLEMENTATION_STATUS.md) and [operations, backup and recovery](docs/OPERATIONS.md).

## Core GIScience & Geomatics Capabilities

1. **1D Linear Network Space vs. 2D Euclidean Space:**
   - Canonical metric storage and computation in **`EPSG:25832` (ETRS89 / UTM Zone 32N, meters)**, transforming to **`EPSG:4326` (WGS84)** strictly at the GeoJSON serialization boundary.
   - Shortest-path network traversal over a **Lixel Dual Graph** $G_{\mathcal{L}}$, respecting Main River bridge bottlenecks and grade-separated elevated viaduct crossings (`elevation_level = 1` vs `0`).
   - Direct head-to-head comparison of **Mass-Conserving Lixel NKDE** vs. **2D Planar Euclidean KDE** with a live **Planar Distortion Bias ($\Delta$)** difference map.
2. **MAUP Mitigation via Uniform Linear Referencing (LRS) Lixels:**
   - Dynamic road edge subdivision into uniform lixels ($10\text{ m}, 25\text{ m}, 50\text{ m}$) preserving parent segment provenance and exact arc-length intervals $[m_{\text{start}}, m_{\text{end}}]$.
3. **Uncertainty-Aware Citizen VGI Acquisition & Topological Map-Matching:**
   - Preserves raw observational coordinates + metric uncertainty radii while scoring candidate topological road snaps via orthogonal Gaussian emission likelihood, road-hierarchy/taxonomy priors, and junction degree (disambiguating pedestrian/cyclist surface crashes beneath elevated motorway overpasses).
   - Real-time spatiotemporal network conflation alerts ($\Delta d_{\text{net}}, \Delta t$), Bayesian multi-witness credibility scoring, automated duplicate cluster merging, RBAC enforcement, and immutable audit trails.
4. **Spatial Analysis Laboratory & Ground-Truth Benchmarking:**
   - **Lixel NKDE** (Quartic, Epanechnikov, Gaussian), **Network Getis-Ord $G_i^*$ & Global/Local Moran's $I$** (Monte Carlo spatial permutations + Benjamini–Hochberg FDR), and **Network DBSCAN (N-DBSCAN)**.
   - Quantitative benchmarking against the simulator's analytical intensity $\lambda(e, m, t)$ using **PAI**, **RRI**, **RMSE**, and **Spearman $\rho$**, with open GeoJSON and CSV exports.
5. **Exposure-Aware Safety Metrics & Empirical Bayes RTM Correction:**
   - 4-tier safety metrics ($N$, $N/L_{\text{km}}$, HSM EPDO Index, Exposure MVKT Rate), Negative Binomial Safety Performance Function (**NB-SPF**) **Empirical Bayes** expected crashes + **Potential for Safety Improvement (PSI)**, transparent non-probabilistic MCDA sliders, and **$3 \times 3$ Bivariate Risk × Epistemic Uncertainty** cartography.

---

## Quick Start

### Containerized deployment (FastAPI + SQLite + Nginx/React)
```bash
cp .env.example .env
docker compose up --build
```

### Local Sandbox Execution & Automated Test Suite
```bash
# Run spatial & statistical verification suite
python -m venv .venv
.venv/bin/pip install -r backend/requirements.lock
PYTHONPATH=backend .venv/bin/python -m pytest -v backend/tests

# Build production WebGL SPA bundle
cd frontend && npm ci && npm run build

# Launch unified FastAPI + SpatiaLite/R*Tree server
cd .. && PYTHONPATH=backend .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## OpenSpec delivery status

The ten proposals are **not all complete**. This increment adds security, migration,
localization scaffolding and tested numerical research components; advanced
posterior models and full evaluation workflows remain gated. The API exposes exact
availability at `/api/v1/research/capabilities`. See the
[per-change ledger](docs/IMPLEMENTATION_STATUS.md) before interpreting results.
