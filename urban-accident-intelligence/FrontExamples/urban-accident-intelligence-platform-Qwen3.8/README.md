# Urban Accident Intelligence

**A Web-GIS research platform for crowdsourced road-accident intelligence and network-constrained spatiotemporal analysis.**

Not a CRUD dashboard and not a naive web map: every spatial statistic is computed over **shortest-path network distances** on a **uniform lixel lattice**, and the platform ships with its own **stochastic ground truth** so that each algorithm can be scored against a known intensity function λ(s,t).

---

## 1. Quick start

```bash
# single command: PostgreSQL 15 + schema application + Next.js runtime
docker compose up --build          # → http://localhost:3000
```

Local development without Docker:

```bash
npm install
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
npx drizzle-kit push --force       # applies the relational-spatial schema
npm run dev                        # → http://localhost:3000
```

On first load the platform seeds its controlled vocabularies and persona accounts. If no dataset exists, the cold-start panel generates a **synthetic ground-truth dataset** (topology → lixels → λ(s,t) → Poisson realisation → VGI noise → probabilistic map-matching → conflation) in a few seconds.

```bash
npm exec vitest run                # 77 tests: projection, topology, statistics, API, RBAC
npm run build                      # production bundle
```

---

## 2. Scientific paradigms enforced by the code

| # | Paradigm | Implementation |
|---|----------|----------------|
| 1 | **Network ≠ Euclidean space** | Lixel-centre graph + truncated Dijkstra with Okabe equal-splitting `1/(deg−1)` at vertices. Planar KDE exists only as a measurable counterfactual. |
| 2 | **MAUP mitigation via lixels** | Linear Referencing System: every edge is subdivided into uniform units with `m_start/m_end/m_mid ∈ [0,L]` and parent-edge provenance. |
| 3 | **VGI uncertainty & conflation** | Declared positional σ, injected drift oracle, probabilistic snap posterior, spatiotemporal network decay kernel, six-facet credibility score. |
| 4 | **Exposure awareness & RTM** | Four separated metric tiers + SPF fitted by Poisson quasi-likelihood IRLS + Gamma–Poisson Empirical Bayes with PSI/excess. |
| 5 | **Stochastic ground-truth benchmarking** | Seeded inhomogeneous network point process; PAI, RRI, RMSE, MAE, R², Spearman ρ and a bandwidth sensitivity sweep against the oracle. |

---

## 3. Mathematical formulation

**Network KDE (discontinuous, Okabe et al. 2009)**

```
λ̂_net(u) = (1/c(u)) · Σⱼ wⱼ · K(d_N(u,vⱼ)/h) · (1/h) · Π_{v∈V(p_uj)} 1/(deg(v)−1)
c(u)     = Σ_k L_k · K(d_N(u,k)/h)/h                     (boundary correction)
```

**Planar counterfactual & distortion**

```
f̂_pla(u) = Σⱼ wⱼ K₂(‖u−vⱼ‖/h)/h² ,   Δ(u) = f̃_pla(u) − λ̃_net(u)
```

**Network Getis-Ord G\*i (Ord & Getis 1995)**

```
G*ᵢ = [Σⱼ w_ij xⱼ − X̄ Σⱼ w_ij] / { S √[ (n Σⱼ w²_ij − (Σⱼ w_ij)²)/(n−1) ] }
w_ij = exp(−d_N(i,j)/h)   or   k-order edge contiguity
```
Permutation pseudo p-values over the salient candidate set, then Benjamini–Hochberg FDR. Global Moran's *I* with `E[I] = −1/(n−1)`; Local Moran quadrants as a separate method.

**Network DBSCAN**

```
N_ε^net(p) = { q ∈ D : d_N(p,q) ≤ ε } ,   core ⟺ |N_ε^net(p)| ≥ MinPts
spanRatio  = network span / planar span   (topological distortion per cluster)
```

**Probabilistic map-matching**

```
P(e,m|z) ∝ 𝒩(d⊥; 0, σ²) · π_class(e) · τ_topo(d_node, category)
π_class(e) ∝ classRisk(e) · (AADT/10⁴)^0.35
diagnostics: posterior entropy H (nats), ambiguity 1 − (p₁ − p₂)
```

**Spatiotemporal conflation & credibility**

```
K(i,j) = exp(−(d_net/Δd)²) · exp(−|Δt|/Δt*) · agreement(i,j) ≥ θ
C      = Π_f facet_f^ωf   (witness, attribute, spatial, temporal, contributor, age)
```

**Safety Performance Function & Empirical Bayes**

```
μ_i = exp(β₀ + β₁ ln VKT_i + β₂ ln L_i + γ_class)          (IRLS, ridge-guarded)
φ̂  = (χ²/dof − 1)/mean(μ)                                   (method of moments)
λ ~ Gamma(1/φ, φμ) ;  N ~ Poisson(λ)
λ|N ~ Gamma(N + 1/φ, φμ/(1+φμ))
E_i = w_i N_i + (1−w_i) μ_i ,   w_i = φμ_i/(1+φμ_i)
PSI_i = (N_i − E_i)/N_i ,      excess_i = N_i − E_i
```

**Ground-truth evaluation**

```
RRI(k) = a_k/A ,   PAI(k) = (a_k/A)/(n_k/N) ,   RMSE = √(mean_i (λ̂_i − λ_i)²)
```
Estimators are rescaled so `Σλ̂ = Σλ` before RMSE/MAE, isolating shape recovery from scale bias; `Σλ/Σλ̂` is reported separately as `biasRatio`.

**Ground-truth intensity model**

```
λ(s,t) = Λ(s) · τ(t) · Ξ(s,t)
Λ(s) = β₀ · f_class · (1 + ω·e^(−d_node/δ)) · (AADT/10⁴)^ε · (v/50)^κ · latentCoxField(s) · environment
τ(t) = diurnal(h) · weekly(dow) · seasonal(doy)      (numerically normalised to mean 1)
Ξ(s,t) = 1 + rushHourInteraction · rush(h) · arterial(s)
```

Scenarios: `uniform_baseline`, `intersection_clustered`, `diurnal_rush_hour_shock`, `multi_covariate_complex_urban`.

---

## 4. Architecture

```
Presentation (React 19 / Next 16 App Router)
  ├─ MapCanvas: canvas vector engine, Web-Mercator view transform, DPR scaling,
  │             pan/zoom, hover picking, bbox brush, zoom-dependent clustering,
  │             scale bar, dual geographic/projected coordinate readout
  └─ SVG statistical graphics: brushable series, 7×24 diurnal matrix, ranked
     bar lists, histograms, calibration scatter, publication legends
        │  coordinated multiple views — bidirectional linked brushing
        ▼
REST / GeoJSON contract layer (src/app/api/**)
        ▼
Transactional persistence (Drizzle ORM → PostgreSQL 15, 17 normalised tables)
        │  metric canonical CRS (EPSG:326xx) + spatial-hash grid index
        ▼
Geocomputation engine (src/lib/**)
  ├─ geo/      UTM projection, lixel-centre graph, Dijkstra, LRS, snap candidates
  ├─ sim/      network generator, λ(s,t) model, point-process realisation, VGI noise
  ├─ vgi/      probabilistic map-matching, conflation, credibility
  ├─ stats/    NKDE, planar KDE, Gi*/Moran + FDR, N-DBSCAN, SPF/EB, PAI/RRI/RMSE
  └─ analysis/ async job runner (progress, stages, content-hash cache, provenance)
```

**Dual CRS.** Geometry is canonical in metric UTM with an explicit SRID on every table; WGS84 lon/lat is produced only in `src/lib/geojson.ts` at the serialisation boundary. This PostgreSQL deployment has no PostGIS, so the spatial engine (projection, indexing, network traversal, kernels) is implemented natively and is fully auditable; a 100 m spatial-hash `grid_key` is persisted and B-tree indexed as the R-Tree/GiST surrogate.

**Asynchrony.** Heavy methods (NKDE, Gi*, N-DBSCAN, EB, benchmarking, simulation) run through `spatial_analysis_jobs` with progress/stage reporting, self-healing re-execution after a restart, and SHA-256 content-hash result caching. Results store parameters, CRS, sample size, runtime, the LaTeX formulation and the benchmark block.

---

## 5. Directory structure

```
src/
  db/schema.ts                  17 normalised relational-spatial tables + indexes
  lib/
    geo/projection.ts           WGS84 ⇄ UTM (Snyder series), spatial-hash keys
    geo/graph.ts                lixel-centre graph, Dijkstra + Okabe splitting, LRS
    geo/datasetGraph.ts         cached hydration of the graph from the database
    geojson.ts                  serialisation boundary, CSV/WKT export
    sim/network.ts              seeded synthetic urban topology generator
    sim/intensity.ts            λ(s,t) ground-truth model + scenario presets
    sim/simulate.ts             realisation, VGI noise, map-matching, conflation
    vgi/mapmatch.ts             snap posterior, conflation kernel, credibility
    stats/{common,nkde,getisord,ndbscan,risk,benchmark}.ts
    analysis/{types,data,methods,jobs}.ts
    bootstrap.ts                cold-start seeding and dataset generation
    auth.ts                     RBAC matrix + immutable audit logging
  app/
    page.tsx                    Overview / command deck
    simulation/                 Epic 1 · simulator + benchmarking
    report/                     Epic 2 · citizen VGI acquisition
    stewardship/                Epic 3 · QA, map-matching, lifecycle, audit
    laboratory/                 Epic 4 · NKDE, Gi*, N-DBSCAN, aggregation, covariates
    risk/                       Epic 5 · metrics, EB, composite, uncertainty
    explorer/                   Epic 6 · coordinated multiple views
    methodology/                formulations, data model, API contract
    api/                        18 REST/GeoJSON endpoints
tests/                          77 tests across 4 suites
Dockerfile · docker-compose.yml · docker-entrypoint.sh · vitest.config.mts
```

---

## 6. API contract (selected)

| Verb | Path | Purpose |
|------|------|---------|
| POST | `/api/bootstrap` | Materialise the default synthetic ground-truth dataset |
| POST | `/api/datasets` | Run the simulator (scenario, seed, lixel length, window) |
| GET | `/api/datasets/:id/network` | GeoJSON topology (segments, nodes, lixel lattice) |
| GET | `/api/datasets/:id/incidents` | Canonical incidents; oracle only with `groundTruth=1` |
| GET | `/api/datasets/:id/stats` | Cross-filtered CMV statistics |
| GET | `/api/datasets/:id/quality` | VGI diagnostics + synthetic/empirical separation |
| GET | `/api/datasets/:id/risk` | Four-tier metrics, EB, PSI, composite, uncertainty |
| POST | `/api/reports` | Citizen report with validation and privacy stripping |
| POST | `/api/reports/candidates` | Real-time network-neighbourhood duplicate alert |
| POST | `/api/reports/conflate` | Batch spatiotemporal deduplication (preview/apply) |
| POST | `/api/reports/:id/verify` | RBAC lifecycle transition + audit trail |
| POST | `/api/analysis/jobs` | Submit an asynchronous geocomputation job |
| GET | `/api/analysis/results/:id/export` | GeoJSON · CSV · WKT (metric + SRID) · manifest |

Validation is strict: coordinate bounds, bbox ordering, temporal sanity (occurrence ≤ report ≤ now+5 min), controlled vocabularies, casualty consistency (`injured ≥ fatalities`, fatality ⇒ emergency response), bandwidth/ε/permutation ranges, and role-based permissions resolved server-side from the persona header.

---

## 7. Honesty constraints

* Synthetic datasets are labelled **SYNTHETIC** in every list, header, map legend, API payload and export manifest, and oracle λ is only returned on explicit request.
* Descriptive density and statistical significance are rendered as **separate layers**: a high NKDE value is not a significant hotspot.
* The multi-criteria composite is a transparent weighted **rank heuristic** and is never labelled a calibrated crash probability — the disclaimer ships with the API response.
* Units without observed AADT/VKT are rendered as **epistemic gaps**, not as zero risk.
* Approximations are declared where used: Wilson–Hilferty gamma quantiles for EB credible intervals, sRGB ramp interpolation, and the NKDE boundary correction `c(u)`.
