# RoadScope

RoadScope is the new name for the Urban Accident Intelligence (UAI) research platform. Existing `UAI_*` configuration names and `/api/v1` remain unchanged for compatibility.

- [برنامهٔ جامع پیاده‌سازی](IMPLEMENTATION_PLAN_FA.md)
- [OpenSpec proposals and specifications](openspec/README.md)
- [Literature review](LITERATURE_REVIEW_FA.md)
- [Operations & Security Runbook](docs/OPERATIONS.md)
- [Scientific & Engineering Implementation Status (68/68 OpenSpec Complete)](docs/IMPLEMENTATION_STATUS.md)
- [ارائهٔ علمی و دفاع فنی پروژه (Reveal.js — فارسی)](docs/presentation/roadscope_presentation_fa.html)

## RoadScope research platform

**Network-Constrained Spatiotemporal Road Accident Intelligence, Uncertainty-Aware VGI Conflation & Empirical Bayes Safety Modeling**

---

> **Research prototype:** the current backend uses SQLite, even though Compose also starts PostGIS. Role strings supplied by clients are not secure authentication. Do not deploy with sensitive data or expose privileged operations without server-side authentication and authorization.

## Core GIScience & Geomatics Capabilities

1. **1D Linear Network Space vs. 2D Euclidean Space:**
   - Metric storage and computation in **each dataset's own canonical CRS** (`dataset_sources.crs_epsg`; the Tehran demo uses `EPSG:3857`), transforming to **`EPSG:4326` (WGS84)** strictly at the GeoJSON serialization boundary and on import from any declared `epsg_in`.
   - Shortest-path network traversal over a **Lixel Dual Graph** $G_{\mathcal{L}}$, respecting river/bridge bottlenecks and grade-separated elevated viaduct crossings (`elevation_level = 1` vs `0`).
   - Direct head-to-head comparison of **Mass-Conserving Lixel NKDE** vs. **2D Planar Euclidean KDE** with a live **Planar Distortion Bias ($\Delta$)** difference map.
2. **MAUP Mitigation via Uniform Linear Referencing (LRS) Lixels:**
   - Dynamic road edge subdivision into uniform lixels ($10\text{ m}, 25\text{ m}, 50\text{ m}$) preserving parent segment provenance and exact arc-length intervals $[m_{\text{start}}, m_{\text{end}}]$.
3. **Uncertainty-Aware Citizen VGI Acquisition & Topological Map-Matching:**
   - Preserves raw observational coordinates + metric uncertainty radii while scoring candidate topological road snaps via orthogonal Gaussian emission likelihood, road-hierarchy/taxonomy priors, and junction degree (disambiguating pedestrian/cyclist surface crashes beneath elevated motorway overpasses).
   - Real-time spatiotemporal network conflation alerts ($\Delta d_{\text{net}}, \Delta t$), Bayesian multi-witness credibility scoring, automated duplicate cluster merging, RBAC enforcement, and immutable audit trails.
4. **Spatial Analysis Laboratory & Ground-Truth Benchmarking:**
   - **Lixel NKDE** (Quartic, Epanechnikov, Gaussian), **Network Getis-Ord $G_i^*$ & Global/Local Moran's $I$** (Monte Carlo spatial permutations + Benjamini–Hochberg FDR), and **Network DBSCAN (N-DBSCAN)**.
   - Quantitative benchmarking against the simulator's analytical intensity $\lambda(e, m, t)$ using **PAI**, **RRI**, **RMSE**, and **Spearman $\rho$**, with open GeoJSON and CSV exports.
5. **Study Areas & Region-Agnostic Ingestion:**
   - Tehran (فارسی: تهران) ships as the labelled **synthetic citizen-reporting demo** study area; study areas are
     persisted data (bilingual names, canonical metric EPSG, map centre, optional descriptive boundary) and can be
     registered at runtime via `POST /api/v1/study-areas`.
   - **Open bounds:** ingestion is worldwide. `boundary_enforced = false` and `ingestion_scope = "worldwide"` are
     published by `/api/v1/health`, `/meta` and `/vgi/location-context`; reports outside a study-area boundary are
     accepted and *flagged* (`outside_study_area`) rather than rejected.
   - **Two network sources:** the seeded synthetic Tehran generator (`tehran_demo_v1`, expressways, river bridges,
     grade-separated spans) for offline demos, and real network import from GeoJSON or an `http(s)` URL in any EPSG
     via `POST /api/v1/ingest/network` (reprojected, lixelized, logged in `GET /api/v1/ingest/events`).
6. **Exposure-Aware Safety Metrics & Empirical Bayes RTM Correction:**
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
PYTHONPATH=backend pytest -v backend/tests

# Build production WebGL SPA bundle
cd frontend && npm run build

# Launch unified FastAPI + SpatiaLite/R*Tree server
cd ../backend && uvicorn app.main:app --host 0.0.0.0 --port 8000
```
