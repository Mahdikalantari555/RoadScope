# RoadScope

RoadScope is the new name for the Urban Accident Intelligence (UAI) research platform. Existing `UAI_*` configuration names and `/api/v1` remain available for compatibility; equivalent `ROADSCOPE_*` settings take precedence when both are present.

- [برنامهٔ جامع پیاده‌سازی](IMPLEMENTATION_PLAN_FA.md)
- [OpenSpec proposals and specifications](openspec/README.md)
- [Literature review](LITERATURE_REVIEW_FA.md)

## RoadScope research platform

**Network-Constrained Spatiotemporal Road Accident Intelligence, Uncertainty-Aware VGI Conflation & Empirical Bayes Safety Modeling**

---

> **Research prototype:** the current backend and Compose deployment use SQLite. Role strings supplied by clients are not secure authentication. Do not deploy with sensitive data or expose privileged operations without server-side authentication and authorization.

## Core GIScience & Geomatics Capabilities

1. **1D Linear Network Space vs. 2D Euclidean Space:**
   - Canonical metric storage and computation in **`EPSG:25832` (ETRS89 / UTM Zone 32N, meters)**, transforming to **`EPSG:4326` (WGS84)** strictly at the GeoJSON serialization boundary.
   - Shortest-path network traversal over a **Lixel Dual Graph** $G_{\mathcal{L}}$, respecting Main River bridge bottlenecks and grade-separated elevated viaduct crossings (`elevation_level = 1` vs `0`).
   - Direct head-to-head comparison of **Mass-Conserving Lixel NKDE** vs. **2D Planar Euclidean KDE** with a live **Planar Distortion Bias ($\Delta$)** difference map.
2. **MAUP Mitigation via Uniform Linear Referencing (LRS) Lixels:**
   - Dynamic road edge subdivision into uniform lixels ($10\text{ m}, 25\text{ m}, 50\text{ m}$) preserving parent segment provenance and exact arc-length intervals $[m_{\text{start}}, m_{\text{end}}]$.
3. **Uncertainty-Aware Citizen VGI Acquisition & Topological Map-Matching:**
   - Preserves raw observational coordinates + metric uncertainty radii while scoring candidate topological road snaps via orthogonal Gaussian emission likelihood, road-hierarchy/taxonomy priors, and junction degree (disambiguating pedestrian/cyclist surface crashes beneath elevated motorway overpasses).
   - Real-time spatiotemporal network conflation alerts ($\Delta d_{\text{net}}, \Delta t$), Bayesian multi-witness credibility scoring, duplicate cluster merging, role-string checks, and audit records. The role strings are client-supplied and are not authentication.
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
PYTHONPATH=backend pytest -v backend/tests

# Build production WebGL SPA bundle
cd frontend && npm ci && npm run build

# Launch unified FastAPI + SpatiaLite/R*Tree server
cd ../backend && uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Storage and analytical limitations

Compose uses the existing `uai_sqlite_data` volume. The formerly provisioned PostGIS service was unused by the backend and has been removed; its existing volume is not deleted automatically. Do not run `docker compose down -v` if data must be preserved. `ROADSCOPE_SQLITE_PATH` (or legacy `UAI_SQLITE_PATH`) changes the local backend database path; Compose deliberately stores the database in its mounted volume. The PostGIS schema file remains a reference, not a supported runtime.

Synthetic NKDE results include a network-length PAI curve. It evaluates *expected synthetic intensity in-sample*, not held-out events. It assumes event mass is uniform within a lixel; equal scores are fractionally selected by length, so realized coverage equals requested coverage. AU-PAI is the exact integral of PAI(a) on (0,1], normalized to a random-ranking baseline of 1. PAI at zero coverage and PAI with zero total event mass are undefined. The existing single-point PAI uses whole lixels and can therefore differ from the curve at the same requested fraction.

### Backup and restore (SQLite)

Use SQLite's online backup API to make a consistent copy without overwriting an existing file. Both source and destination must be accessible to the process; the destination's parent directory must already exist. The tool checks database integrity and refuses existing destinations. Protect backups as sensitive data and store them outside the repository.

```bash
# Local deployment: back up the configured database to a NEW path.
PYTHONPATH=backend python -m app.backup /path/to/uai.sqlite /secure/path/backup.sqlite
# Restore to a NEW path; stop all application writers first.
PYTHONPATH=backend python -m app.backup /secure/path/backup.sqlite /secure/path/restored.sqlite
# Start the local backend with ROADSCOPE_SQLITE_PATH=/secure/path/restored.sqlite.
```

For Compose, `docker compose exec backend python -m app.backup /data/uai.sqlite /data/uai-backup.sqlite` writes a new backup into the SQLite volume. Copy it to secure external storage and test recovery before maintenance. To restore, stop the application and arrange for a verified copy to be placed at the configured `/data/uai.sqlite` in the volume; preserve the previous database separately rather than overwriting it without a backup. Never use `down -v` as a restore step.

The risk workspace also provides a CURE diagnostic for the **existing** road-class SPF. It sums observed minus expected counts by increasing effective AADT and groups ties. Its dotted envelope is pointwise ±2√(cumulative NB variance), assumes independent observations and treats fitted parameters as fixed; it is not a simultaneous confidence band or a formal goodness-of-fit test. Imputed/fallback exposure is counted. This is not the proposed length-scaled SPF or spatial BYM2 model.

### Language support status

The language selector persists Persian/English, changes the document direction and localizes navigation, startup states, the coordinated analytics workspace and simulator controls. **Persian translation is incomplete**: the remaining workspaces, map controls, scientific diagnostics and some server-provided labels remain in English. The interface displays a notice until the remaining OpenSpec localization tasks are finished.
