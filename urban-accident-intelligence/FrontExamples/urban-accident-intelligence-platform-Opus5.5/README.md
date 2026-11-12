# Urban Accident Intelligence

**A crowdsourced Web-GIS for road-accident reporting, spatiotemporal analysis and transparent road-safety risk assessment.**

> All data shipped with the platform are **synthetic** ("Synthetica", a fictitious city generated from a fixed seed). Patterns reflect the generator's configuration, not real-world findings. The synthetic ground truth is used on purpose: it lets you validate each method against known, injected effects.

## What it does (user stories)

| As a… | I can… |
|---|---|
| Citizen | pick a location on the map (or search a street / "A & B" intersection / coordinates), enter time, collision type, severity, vehicles, emergency involvement, description and up to 3 photos (EXIF stripped in-browser); get live feedback on the matched road and possible duplicates; receive a tracking code and follow the report status — no account needed. |
| Analyst | explore incidents as points, clusters, a visual heatmap, KDE (events/km²), FDR-corrected Getis-Ord Gi* hotspots, road-segment densities or a relative risk index; filter by time window, hours, weekdays, type, severity, status and dataset; query by area; inspect incidents, segments and hotspot cells together with their underlying records. |
| Analyst | use a linked dashboard: clicking chart elements or brushing the timeline filters every chart and the maps. |
| Researcher | run asynchronous analysis jobs (KDE, Gi*, DBSCAN, nearest-segment assignment, segment aggregation, temporal aggregation, environmental rate ratios, global pattern diagnostics) with parameters, legends, method documentation, assumption checks and GeoJSON/CSV/JSON export with provenance. |
| Safety engineer | configure a transparent risk model (Empirical Bayes, EPDO, exposure, design and environment indicators), see ranked segments with Poisson CIs, posterior rank intervals and P(top-K), plus data coverage and reliability. |
| Administrator | review the queue, compare reported vs validated position, verify / reject / merge duplicates / reopen, correct records (original coordinates are preserved), monitor data quality (positional accuracy, delays, flags, duplicate-detector precision/recall vs ground truth), regenerate synthetic scenarios, toggle datasets and read the audit log. |

## Scientific design choices

* **Unverified ≠ confirmed.** Unverified reports are displayed (hollow symbols) but excluded from all statistics unless explicitly included for sensitivity analysis.
* **Descriptive vs inferential.** KDE/DBSCAN/densities are labelled descriptive. Gi* is inferential, Benjamini–Hochberg-corrected, preceded by Global Moran's I (permutation test), and *refused* if pre-conditions fail (< 30 units/events, isolated units).
* **Frequency, risk and probability are kept distinct.** Exact Garwood Poisson CIs, EB estimates (method-of-moments by road class) for regression-to-the-mean, and an explicitly ordinal, uncalibrated Relative Risk Index. Rank uncertainty from Gamma-posterior Monte Carlo.
* **Exposure-normalised environmental comparison.** Weather hours, solar light condition (NOAA), km·yr and vehicle-km exposure → Poisson rate ratios with CIs, shown next to the injected synthetic effects, with explicit confounding caveats.
* **Reproducible QA benchmark.** Injected GPS noise, gross errors, fabricated reports and duplicates allow precision/recall of snapping and duplicate rules to be measured (Admin → Data quality).

See **/methods** in the app for formulas, assumptions and references.

## Architecture

```
src/
  db/schema.ts            normalised schema (users, accidents, accident_categories, severity_levels, road_nodes,
                          road_segments, basemap_features, environmental_observations, traffic_observations,
                          report_attachments, report_verifications, spatial_analysis_jobs/results,
                          dataset_sources, audit_logs) — constraints, B-tree/composite indexes, UTC timestamptz
  lib/geo/                pure, tested spatial engine (no UI / DB):
                          projection (UTM, Snyder) · geometry & grid indexes · stats (Poisson CI, BH-FDR, …)
                          kde · hotspot (Gi*, Moran's I) · cluster (DBSCAN, Clark–Evans) · risk (EB, index,
                          rank uncertainty) · temporal (profiles, rate ratios) · duplicates · time (tz, solar)
  lib/synthetic/          seeded city / network / weather / traffic / accident generator (4 scenarios)
  lib/server/             data access, auth (scrypt + HMAC cookies), seeding, analysis orchestration, async jobs
  app/api/**              REST API (GeoJSON) — see /api/openapi
  components/             design system, MapLibre canvas (offline basemaps), ECharts wrapper, filters, explorer
  app/*                   Explorer · Report · Track · Analytics · Analysis Lab · Risk · Admin · Methods
tests/geo.test.ts         22 tests: projection accuracy, KDE mass conservation, planted-hotspot detection,
                          FDR false-positive control, Moran's I, DBSCAN, EB shrinkage bounds, generator reproducibility
docs/postgis-migration.sql  native geometry + GiST upgrade path
deploy/                   Dockerfile + docker-compose (PostGIS image)
```

**Spatial storage.** Every point is stored in EPSG:4326 (exchange) *and* EPSG:32633 (metric). Original reported and validated (network-snapped) coordinates are separate columns. On PostGIS, `docs/postgis-migration.sql` adds generated `geometry` columns with GiST indexes.

## Running locally

```bash
cp .env.example .env            # set DATABASE_URL and SESSION_SECRET
npm install
npx drizzle-kit push            # create schema
npm run build && npm start      # or: npm run dev
npx vitest run                  # automated tests
```

The database is seeded automatically on the first request (default: `mixed` scenario, seed 42, ~2,800 reports, ~770 road segments; ≈2 s).

**Docker:** `SESSION_SECRET=… docker compose -f deploy/docker-compose.yml up --build` → http://localhost:3000

**Demo accounts** (override with `DEMO_ADMIN_PASSWORD` / `DEMO_CITIZEN_PASSWORD`):
`admin@uai.local / admin-demo` · `citizen@uai.local / citizen-demo`

## Extending with real data

1. Insert a `dataset_sources` row of kind `official`, load its road network into `road_nodes`/`road_segments` (both CRSs), AADT into `traffic_observations`, weather into `environmental_observations`.
2. Load accidents with `reported_*` (original) coordinates; run snapping via the API or SQL (see migration script).
3. The newest active `official`/`synthetic` dataset provides the network; keep synthetic and real datasets separate via the dataset filter.
4. Statistical models (NB-SPF) or GNNs can be added as additional indicator providers in `lib/geo/risk.ts` without changing the API contract.

## Limitations

Planar KDE and planar CSR (Clark–Evans) are not network-constrained; EB uses group means rather than a calibrated SPF; environmental rate ratios are crude associations; MapLibre glyphs (labels) are fetched from a public font CDN and degrade gracefully offline.
