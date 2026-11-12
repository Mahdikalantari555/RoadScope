# Urban Accident Intelligence — a crowdsourced Web-GIS platform

A research-grade, spatially intelligent web application for **crowdsourced road-accident reporting**, **moderation of citizen submissions**, **spatiotemporal accident analytics**, **spatial-statistics workflows**, and **transparent road-segment risk screening**.

The demonstrator runs on the **synthetic city of Vantia** (12 districts, ~600 road segments, 132 junctions, ~1,800 accidents over 2024–2025 UTC) generated from a **fixed seed**. Every surface states that the data are synthetic, and every analytical product carries its assumptions, sample size and uncertainty.

> **Scientific stance.** This is a demonstration and research scaffold, not an operational safety product. No value shown is a real-world road-safety statistic, and the weighted risk index is explicitly **not** a calibrated crash probability.

---

## 1. What the application does (user stories)

### Citizens
- *As a citizen, I can place an incident on the map, enter date/time, category, severity, vehicles, casualties, emergency attendance and a description, optionally attach photos, and receive a tracking reference.*
- *I am warned when a similar report already exists within 250 m / 24 h, and told my report is **pending** rather than confirmed.*
- *I can track my report’s verification timeline without exposing my identity.*
- *I can explore verified and pending incidents separately, and see verification state through symbology.*

### Analysts and researchers
- *I can explore incidents with points, clustering, heatmap, KDE, Getis-Ord Gi*, DBSCAN, road-segment aggregation, environmental context and a relative risk layer — each with its legend, method statement and limitations.*
- *I can filter by period, status, severity, category, district, hour window and day-of-week, with every panel and the map sharing one filter state.*
- *I can run parameterised analyses and download GeoJSON/CSV with job provenance.*
- *I can configure a weighted risk index (frequency, severity, density, exposure, environment) with stability weighting and readable component contributions.*
- *I can see coverage, missingness, positional uncertainty, reporting-delay statistics and Gini concentration.*

### Administrators
- *I can review pending, verified, rejected and duplicate reports, verify/reject/reopen, merge duplicates, correct severity/description, and see an append-only audit trail.*
- *I can monitor data-quality indicators and manage dataset publication state (synthetic vs. observed kept separate).*

### Visitors without an account
- Full read access to the explorer, analytics, reporting, tracking and documentation. Moderation and the risk workspace require elevated roles.

---

## 2. Implemented features

| Module | Route | Highlights |
| --- | --- | --- |
| Geospatial explorer | `/` | MapLibre vector map, 9 layer modes, clustering, heat, KDE, Gi*, DBSCAN, segment aggregation, risk, environmental context, map-driven statistics, feature inspector, scale/coordinate readout, basemap variants, dark/light themes |
| Analytics dashboard | `/analytics` | KPI strip, severity/category/hour/day-of-week/monthly distributions, environmental context, top segments, district ranking, coverage & delay, linked chart↔map filtering |
| Citizen reporting | `/report` | Map picking, GPS shortcut, validation, duplicate screening, photo attachments (≤ 1 MB), privacy notice, submission confirmation |
| Report tracking | `/track` | Reference lookup, append-only verification timeline, uncertainty statement, private-by-design response |
| Spatial analysis lab | `/lab` | KDE, Gi*, DBSCAN, segment aggregation, environmental comparison, temporal matrix; parameter controls, persisted jobs, result tables, method/limitation panels, downloads |
| Risk workspace | `/risk` | Configurable weighted index, normalisation methods, stability weighting, exposure toggle, ranked segments, component diagnostics, coverage bars, methodology & responsible-use panel |
| Administration | `/admin` | Moderation queue with map, verify/reject/reopen/duplicate/edit, quality indicators, flag frequencies, audit trail, dataset management |
| Methods | `/about` | Data model, synthetic scenarios, formulas, API reference, uncertainty catalogue, references |
| REST API | `/api/*` | GeoJSON exchange, filters, pagination, validation, job persistence, exports, health check |

Role-gated: `/lab` and `/risk` require `analyst` or `admin`; `/admin` requires `admin`.

### Demo accounts (seeded)

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `admin@vantia.example` | `admin1234` |
| Analyst | `analyst@vantia.example` | `analyst1234` |
| Citizen | `citizen@vantia.example` | `citizen1234` |

Passwords are scrypt-hashed; sessions are HMAC-signed HttpOnly cookies (12 h).

---

## 3. Running locally

Requirements: Node.js ≥ 20, PostgreSQL ≥ 14.

```bash
cp .env.example .env          # set DATABASE_URL and SESSION_SECRET
npm install
npx drizzle-kit push          # apply the schema (or let the app bootstrap it)
npm run dev                   # http://localhost:3000
```

On the first request the application:
1. creates any missing tables (idempotent DDL, `src/db/ddl.ts`, guarded by a Postgres advisory lock);
2. seeds the synthetic datasets, network, observations, users and audit entry when the dataset registry is empty.

`GET /api/health` returns readiness plus dataset counts. Production build:

```bash
npm run build && npm run start
```

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `SESSION_SECRET` | recommended | HMAC key for session cookies |
| `SYNTHETIC_SEED` | optional | Documented default seed (generator currently pins `20260117`) |
| `NODE_ENV` | auto | `production` enables secure cookies |

### Tests

```bash
npx tsx --test tests/*.test.ts
```

Eleven unit tests cover the projection round-trip and scale error, geodesic helpers, point–segment distance, normal CDF/quantiles, KDE mass and peak location, DBSCAN clustering/noise, the Gi* statistic under a known planted cluster, Clark–Evans clustering, generator determinism + injected quality defects, and bounded risk scoring.

---

## 4. Architecture

```
src/
├─ app/                    Next.js App Router pages + REST route handlers
│  ├─ page.tsx             Explorer
│  ├─ analytics/           Dashboard
│  ├─ report/ track/ lab/ risk/ admin/ about/ login/
│  └─ api/                 health, accidents, analysis, risk, stats, admin, export, network, datasets, auth
├─ components/
│  ├─ map/                 MapLibre map engine + cartographic style variants
│  ├─ charts/              ECharts wrapper (tree-shaken)
│  ├─ explorer/ analytics/ lab/ risk/ admin/ report/ track/ shell/ ui
├─ db/
│  ├─ schema.ts            Drizzle schema (source of truth for typed queries)
│  ├─ ddl.ts               Idempotent bootstrap DDL for fresh deployments
│  └─ index.ts             Pooled Postgres client
├─ lib/
│  ├─ geo.ts               Projection, geodesy, point–segment, polygons (framework-free)
│  ├─ stats.ts             KDE, Gi*, DBSCAN, Clark–Evans, distributions (framework-free)
│  ├─ analytics.ts         Descriptive summaries + segment aggregation (pure)
│  ├─ risk.ts              Transparent weighted risk engine (pure)
│  ├─ analysis.ts          Spatial-analysis orchestrator + job payloads
│  ├─ data.ts              Drizzle data access and metadata cache
│  ├─ filters.ts           Shared filter contract and SQL predicate builder
│  ├─ auth.ts password.ts roles.ts demoAccounts.ts
│  ├─ seed/                Deterministic city + accident generator and seeder
│  └─ chartOptions.ts      Pure chart specifications
└─ tests/                  node:test unit tests for the GIS core
```

**Why Next.js here?** The execution environment for this deliverable provides a Next.js/PostgreSQL runtime, so the reference implementation uses it end-to-end (server components for data loading, route handlers for the REST API, React client components for the GIS interface). The geospatial and statistical cores contain **no framework imports**, so the analytical engine is portable to a SvelteKit + FastAPI/GeoPandas deployment without changes. The data model and API contracts are documented so a PostGIS/PostgreSQL spatial schema can replace the JSONB/TypeScript geometry layer (see below).

### Spatial strategy

- Coordinates stored in **EPSG:4326** (`lat`/`lng` doubles + GeoJSON in `jsonb`), timestamps in UTC.
- Metric operations (KDE bandwidth, Gi* distance band, DBSCAN eps, point-to-segment distance, polygon area) use a **local equidistant projection** centred on the study area; documented planar error is ≈0.2 % at 8 km, smaller than report positional uncertainty.
- B-tree indexes on `lat`, `lng`, `occurred_at`, `status`, `category_code`, `severity_code`, `road_segment_id`, `district`; composite query predicates use lat/lng windows.
- **PostGIS migration path:** add `geometry(Point, 27700)` / `geometry(LineString, 27700)` columns, backfill from GeoJSON, add GiST indexes, and replace the nearest-segment and distance-band helpers with `ST_DWithin` / `ST_Nearest`. Analytical output formats do not change.
- Original and validated report locations are stored separately (`original_lat/lng` vs `lat/lng`) with an explicit positional-uncertainty column.

### Data model (15 tables)

`users`, `accidents`, `accident_categories`, `severity_levels`, `road_segments`, `intersections`, `environmental_observations`, `traffic_observations`, `report_attachments`, `report_verifications`, `spatial_analysis_jobs`, `spatial_analysis_results`, `dataset_sources`, `audit_logs`, `city_features`. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the ER diagram and field notes.

---

## 5. Analytical methods

| Method | Implementation | Interpretation guardrail |
| --- | --- | --- |
| KDE | Separable Gaussian convolution on a regular lattice; weights = count / severity / casualties | Descriptive concentration, not probability; bandwidth and MAUP sensitivity stated |
| Getis-Ord Gi* | Binary self-inclusive fixed-distance weights; E = W·x̄; Var = W(n−W)/(n−1)·σ²; normal two-tailed p | Location-specific screen; multiple testing + FDR guidance; bandwidth sensitivity noted |
| DBSCAN | Grid-indexed density clustering; convex hulls + noise | Cluster ≠ significant hot spot |
| Clark–Evans | Nearest-neighbour index R with bounding extent area | Descriptive only |
| Nearest segment | 70 m tolerance point-to-segment assignment in metres | Unassigned events remain in statistics, never silently snapped |
| Temporal | Hour × day-of-week matrix and monthly series from stored UTC fields | Incomplete final month, reporting delays |
| Environment comparison | Accident wet/dark shares vs. observation shares | Crude exposure proxy, no traffic control |
| Risk index | Normalised weighted blend of frequency, severity, density, exposure rate and environment; stability factor n/(n+k); coverage-aware uncertainty | Ordinal, network-relative, unvalidated; never called a probability |

Reference implementations: `src/lib/stats.ts`, `src/lib/analysis.ts`, `src/lib/risk.ts`. Method documentation is also rendered at `/about`.

### Data quality artefacts (by design)

Citizen records include coarse geocoding, missing environmental context, positions offset from the network, reporting delays up to several days, and duplicate clusters (similarity 60/30/10 distance–time–category weighting). The moderation queue, confidence indicators and duplicate workflow are therefore demonstrable on real payloads rather than mockups.

---

## 6. API summary

`GET /api/health` · `GET/POST /api/accidents` · `GET/PATCH /api/accidents/{id}` · `POST /api/accidents/duplicates` · `GET /api/accidents/track` · `GET /api/network` · `GET /api/stats` · `POST /api/analysis` · `GET /api/analysis/{id}` · `GET /api/risk` · `GET/POST /api/admin` · `GET /api/export` · `GET /api/datasets` · `GET /api/attachments/{id}` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/session`.

Spatial exchange uses GeoJSON; errors return `{ error, details? }`; exports embed synthetic provenance.

---

## 7. Limitations & responsible use

- Reporting bias: citizen reports are an opportunistic sample and over-represent severe/visible collisions.
- Positional uncertainty: ±25 m for map picks, up to 60 m for synthetic coarse geocodes; proximity, duplicate screening and segment assignment inherit it.
- Exposure data (AADT) are synthetic proxies with incomplete coverage; rate indicators inherit both.
- MAUP and edge effects apply to every aggregate; parameters are reported with results.
- No causal claims: environmental and road-characteristic associations are descriptive.
- No independent validation or predictive benchmarking exists for the risk index; future statistical or graph-based models are optional extensions, not architectural dependencies.
- The platform is a conference demonstrator on synthetic data and must not be used for operational decisions.

---

## 8. Conference demonstration script (5 minutes)

1. **Explorer** — switch clusters → heat → KDE → Gi* and read the method panel; note that only Gi* makes significance claims.
2. **Linked filtering** — restrict to serious/fatal incidents in one month; observe the map-driven viewport summary and changed top segments.
3. **Reporting** — place a report near an existing incident; show duplicate score, submission, pending status and tracking timeline.
4. **Moderation** — sign in as admin, verify the submission, show the audit entry and the updated verification state.
5. **Lab** — run DBSCAN and segment aggregation, download GeoJSON, inspect persisted job provenance.
6. **Risk** — change weights and stability k, show component contributions, coverage bars and the explicit “not a probability” statement.
7. **Methods** — close on the uncertainty catalogue and reproducibility notes.

Suggested citation: *Urban Accident Intelligence (2026). Crowdsourced road-accident reporting and spatiotemporal analysis on a reproducible synthetic urban network (v1.0, synthetic seed 20260117) [software demonstration].*
