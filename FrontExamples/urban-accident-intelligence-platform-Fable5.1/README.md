# Urban Accident Intelligence (UAI)
Web-GIS research platform for crowdsourced road-accident intelligence and **network-constrained** spatiotemporal analysis.

## Run
`docker compose up --build` → http://localhost:3000 (db → schema push → app). First request auto-realises the default seeded synthetic dataset.
Dev: `npm install && npx drizzle-kit push && npm run dev`. Tests: `npx vitest run` (snapping, network distance, equal-split, Gi* edge cases, N-DBSCAN, benchmark, RNG).

## Architecture
- `src/db/schema.ts` – normalised relational-spatial schema (users, dataset_sources, road_nodes, road_segments, road_lixels, accidents (raw + snapped geometry + LRS m), accident_categories, severity_levels, report_verifications, report_attachments, environmental_observations, traffic_observations, spatial_analysis_jobs/results, audit_logs). Dual CRS: WGS84 + local metric plane; indexes on x/y, bbox, timestamps (UTC).
- `src/lib/geo` – metric projection, LRS, lixelisation, topological graph, bounded Dijkstra with equal-split tracking.
- `src/lib/sim` – seeded inhomogeneous spatiotemporal Poisson/Cox process on the linear network with hidden λ(e,m,t); VGI noise injection.
- `src/lib/analysis` – probabilistic map-matching, spatiotemporal conflation kernel, credibility scoring; NKDE/planar KDE; network Gi* + Moran's I + FDR; N-DBSCAN; PAI/RRI/RMSE benchmark; SPF/Empirical-Bayes/PSI/MCDA/uncertainty; async job runner.
- `src/app/api/*` – GeoJSON/REST contract. `src/app/*` – coordinated multiple-view geovisual analytics UI (MapLibre GL + SVG linked charts).
