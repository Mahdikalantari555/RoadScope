# Urban Accident Intelligence

**A crowdsourced Web-GIS platform for road-accident reporting, spatiotemporal analysis and
scientifically responsible urban road-safety risk assessment.**

> **All data served by this build is synthetic.** The Meridian District corpus is generated
> deterministically from a documented seed. Nothing in this repository is a finding about a real
> city, and no predictive accuracy is claimed anywhere in the product.

The console is designed as a night-shift traffic-management control room: an anodised dark plate,
engraved mono micro-labels, tabular figures, and a map that is the central instrument rather than a
background. Six modules sit behind a fixed icon rail with a persistent status strip.

| | Module | What it does |
| --- | --- | --- |
| **A** | Geospatial Explorer | Full-featured vector map with six analytical renderings: individual reports, clustering, KDE, Getis-Ord Gi* hotspots, road-segment aggregation and the risk surface. |
| **B** | Citizen Reporting | Map-driven submission with coordinate validation, nearest-segment snapping, live duplicate detection and status tracking. |
| **C** | Analytics Dashboard | Severity, temporal, categorical and spatial statistics with linked cross-filtering between every chart and the map. |
| **D** | Spatial Analysis Laboratory | Parameterised KDE, Gi*, DBSCAN, map matching, segment aggregation, temporal aggregation and spatial comparison — each with assumptions, legends and downloadable output. |
| **E** | Risk Assessment Workspace | Configurable weighted composite risk index with factor decomposition, coverage and uncertainty disclosure. |
| **F** | Administration & Data Quality | Review queue, duplicate triage, data-quality indicators, dataset registry and append-only audit trail. |

API reference: [`/docs`](http://localhost:3000/docs) · machine-readable catalogue: `GET /api/docs`.

---

## 1. Quick start

### Local (Node + PostgreSQL)

```bash
cp .env.example .env          # set DATABASE_URL
npm install
npx drizzle-kit push          # create the schema
npx tsx src/db/seed.ts        # deterministic synthetic corpus (~2 s)
npm run dev                   # http://localhost:3000
```

Regenerate the corpus with a different scenario or seed:

```bash
npx tsx src/db/seed.ts --scenario=intersection_dominated --seed=424242 --count=3000
```

Scenarios: `uniform`, `intersection_dominated`, `rush_hour_dominated`, `mixed` (default).

### Docker Compose

```bash
docker compose up --build
```

Starts PostgreSQL 16 + PostGIS (`db`), the application (`web`, port 3000) and an Adminer client
(port 8080). The web container seeds the corpus on boot.

---

## 2. Architecture

```
src/
├── app/
│   ├── page.tsx              # server entry — loads corpus, renders the console
│   ├── docs/                 # REST API reference page
│   └── api/                  # REST route handlers
│       ├── health/           #   liveness + database probe
│       ├── accidents/        #   query · submit · edit · review
│       ├── roads/            #   road network retrieval & segment detail
│       ├── stats/            #   dashboard aggregates
│       ├── traffic/          #   exposure observations
│       ├── datasets/         #   dataset registry · corpus regeneration
│       ├── audit/            #   audit trail & quality counters
│       └── docs/             #   machine-readable endpoint catalogue
├── components/
│   ├── ConsoleShell.tsx      # rail + status strip + view router
│   ├── MapPlate.tsx          # MapLibre GL JS console plate
│   ├── charts.tsx            # Apache ECharts wrappers & option builders
│   ├── LayerInfo.tsx         # legend + methodological disclosure
│   ├── ui.tsx                # design-system primitives
│   └── views/                # one file per module (A–F)
├── db/
│   ├── schema.ts             # Drizzle schema (13 tables)
│   ├── index.ts              # connection pool
│   └── seed.ts               # database materialiser
└── lib/
    ├── constants.ts          # vocabularies, palette tokens, study-area bounds
    ├── types.ts              # shared domain types
    ├── geo.ts                # spatial engine (projection, KDE, DBSCAN, Gi*)
    ├── layerBuilder.ts       # analysis → styled GeoJSON + method text + risk engine
    ├── stats.ts              # descriptive statistics
    ├── repo.ts               # data access layer (all SQL lives here)
    ├── synthetic.ts          # deterministic generator (mulberry32)
    └── appState.tsx          # shared console state + URL synchronisation
```

**Separation of responsibilities.** Geospatial mathematics lives in `lib/geo.ts` and has no I/O and
no UI dependency. Analysis production lives in `lib/layerBuilder.ts`. SQL lives in `lib/repo.ts` and
`db/`. Components only compose and render.

**Stack note.** The brief specified SvelteKit + FastAPI + SQLAlchemy; this deployment runs on the
Next.js App Router + Drizzle ORM runtime available in the target environment. The architectural
shape is preserved — typed domain models, a single data-access layer, REST route handlers with
validation, a pure geospatial engine, and a documented adapter boundary — so a FastAPI/SQLAlchemy
service can replace the route handlers without touching the analysis or presentation layers. The
MapLibre GL JS, Apache ECharts and Lucide parts of the requested stack are used exactly as specified.

---

## 3. Database

13 normalised tables in PostgreSQL (`src/db/schema.ts`):

```
users ─────────────┐
                   ├─< accidents >── accident_categories
dataset_sources ───┘      │     │
                          │     └──< report_attachments
                          │     └──< report_verifications
                          │     └──< environmental_observations
                   road_segments ──< traffic_observations
                   severity_levels        spatial_analysis_jobs ──< spatial_analysis_results
                   audit_logs
```

| Table | Purpose |
| --- | --- |
| `users` | Identity and role (`administrator`, `contributor`). |
| `accidents` | Reports. Stores validated coordinates **and** the original reported coordinates separately, plus positional accuracy and geocode precision. |
| `accident_categories`, `severity_levels` | Controlled vocabularies. Severity carries the risk weight (fatal 10 · serious 5 · slight 2 · damage 1). |
| `road_segments` | Synthetic road network with class, design speed, lanes, lighting, junction control, cycle lane, WKT + GeoJSON geometry. |
| `environmental_observations` | Weather, visibility, precipitation, wind, surface condition at the time of the event. |
| `traffic_observations` | Synthetic exposure model: hourly volume, mean speed, AADT, congestion index, coverage ratio. |
| `report_attachments` | Evidence metadata (content type, byte size, capture time, storage key). |
| `report_verifications` | Append-only review decisions with reviewer, confidence and notes. |
| `spatial_analysis_jobs`, `spatial_analysis_results` | Job bookkeeping for asynchronous geoprocessing in production. |
| `dataset_sources` | Provenance registry: synthetic vs. real, licence, generator version, random seed, coverage window. |
| `audit_logs` | Append-only action trail. |

**Indexes.** Unique index on `accidents.public_id`; composite indexes on `(occurred_at)`,
`(status)`, `(severity_code)`, `(category_code)`, `(lon, lat)`, `(road_segment_id)`; temporal indexes
on every observation table.

**Spatial requirements.** `drizzle/0001_postgis_reference.sql` contains the production DDL:
`geometry(LineString, 4326)` for segments, `geometry(Point, 4326)` + `geometry(Point, 25832)` for
reports, GiST indexes on all geometry columns, and the nearest-segment / segment-aggregation views.
This sandbox build has no PostGIS extension available, so coordinates are stored as typed
`doublePrecision` columns with a WKT mirror and metric operations run in a local equirectangular
frame (distortion below 0.1 % at city extent, far inside crowdsourced positional accuracy).

---

## 4. Synthetic data generation

`src/lib/synthetic.ts` generates a configurable urban road network (26 × 18 intersections, ~890
segments across arterials, collectors and local streets) and an accident corpus with:

* uniform background events **and** spatial clusters around signalised junctions;
* hour-of-day profiles with morning/evening peaks and weekend suppression;
* speed-dependent severity distributions and category mixtures;
* log-normal reporting delays (0–96 h);
* weather, lighting and road-surface conditions;
* **deliberately duplicated reports** (4.5 %) and **imprecisely geocoded reports** (11 %) to
  exercise the data-quality workflows;
* synthetic traffic exposure and meteorological observations.

Everything draws from a seeded **mulberry32** stream, so `(seed, scenario, count)` always yields
identical rows. The corpus is registered in `dataset_sources` with its generator version and seed.

---

## 5. Analytical methods

| Method | Implementation | Disclosure |
| --- | --- | --- |
| **Kernel Density Estimation** | Gaussian kernel on a regular metric lattice, configurable bandwidth and cell size, uniform or severity-weighted. | Descriptive intensity surface. Not a significance test. |
| **Getis-Ord Gi*** | Local z-scores on the lattice with a distance band; two-sided p-values; optional Benjamini–Hochberg FDR correction. | Six assumption checks (sample size, μ/σ ratio, zero-inflation, stationarity, band choice, multiple testing) are reported and can fail. Descriptive concentration and significance are never merged. |
| **DBSCAN** | Metric ε-neighbourhood with a uniform grid index; noise retained and reported. | Unsupervised grouping. No null hypothesis is tested. Sensitive to ε and minPts. |
| **Nearest-segment assignment** | Perpendicular distance to the segment polyline in the metric frame, 120 m snap radius. | Unassigned reports are reported, not silently dropped. |
| **Segment aggregation** | Counts, severity-weighted indices and length-normalised density per segment. | Low-exposure segments can appear safe merely because few vehicles use them. |
| **Temporal aggregation** | Hour-of-day and calendar-month binning in UTC. | Reporting delay biases recent periods. |
| **Spatial comparison** | Pearson correlation between segment attributes and snapped counts. | Descriptive; no causal claim. |
| **Risk index** | Min–max normalised factors with configurable weights: frequency, density, severity-weighted index, exposure, design speed, lighting, junction exposure. | **Relative index only.** Explicitly *not* a calibrated accident probability. Frequency, relative risk and probability are distinguished in the UI. |

Every layer carries a legend, a formula, a parameter string, a limitations note and a working
**GeoJSON download** of exactly the geometry rendered on the map.

---

## 6. API

REST, JSON/GeoJSON, ISO-8601 UTC timestamps. Full reference at `/docs`; `GET /api/docs` returns the
catalogue as JSON.

```bash
# GeoJSON of serious and fatal reports in a time window
curl 'http://localhost:3000/api/accidents?format=geojson&severities=fatal,serious&from=2024-06-01&limit=500'

# Submit a citizen report
curl -X POST http://localhost:3000/api/accidents \
  -H 'Content-Type: application/json' \
  -d '{"lon":13.4021,"lat":52.5163,"occurredAt":"2025-01-14T08:20:00Z",
       "categoryCode":"pedestrian","severityCode":"serious","vehicles":1,"casualties":1,
       "description":"Pedestrian struck at the signalised crossing on the approach."}'

# Verify it
curl -X POST http://localhost:3000/api/accidents/1882/review \
  -H 'Content-Type: application/json' \
  -d '{"decision":"verified","reviewerName":"A. Vasquez","confidence":0.9}'
```

Validation is enforced with Zod schemas; errors return
`{ error, issues: [{ path, message }] }` with 400/404/422/500.

---

## 7. Testing & verification

* **Determinism** — the generator is seeded; `npx tsx src/db/seed.ts` twice with the same seed
  produces identical row counts and identical statistics.
* **Type safety** — `npm run typecheck` (strict TypeScript), `npx next typegen`, `npm run build`.
* **API contract** — every route validates input and returns typed errors; `/api/health` reports
  database latency and the active spatial engine.
* **Method self-checks** — the Gi* workspace evaluates its own assumptions and refuses to present
  significance when they are not satisfied.

```bash
npm run typecheck
npm run build
```

---

## 8. Configuration

See `.env.example`. No secrets are hardcoded; the application reads configuration from the
environment. `DATABASE_URL` is the only required variable.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. |
| `ANALYSIS_CRS` / `SOURCE_CRS` | Projected CRS for metric operations / storage CRS. |
| `SYNTHETIC_SEED`, `SYNTHETIC_SCENARIO`, `SYNTHETIC_ACCIDENT_COUNT` | Corpus generation. |
| `LOG_LEVEL` | Service logging verbosity. |

---

## 9. Roadmap beyond this build

1. **Real dataset integration** — `dataset_sources` already separates synthetic from official
   corpora; add an ingestion adapter that normalises a crash registry into `accidents` with its own
   source id and coverage window.
2. **PostGIS push-down** — apply `drizzle/0001_postgis_reference.sql` and move snapping,
   aggregation and clustering into SQL (`ST_ClusterDBSCAN`, `ST_KNN`).
3. **Asynchronous geoprocessing** — long-running analyses already have job/result tables.
4. **Statistical & ML models** — the risk engine is an interface; calibrated count models or Graph
   Neural Networks can be registered as additional factor providers without changing storage,
   rendering or the API.

---

## 10. Licence & attribution

Generated data: CC0-1.0. Application code: MIT. MapLibre GL JS, Apache ECharts and Lucide are used
under their respective open-source licences. No external tile service is contacted — the console
plate is rendered entirely from local vector data.
