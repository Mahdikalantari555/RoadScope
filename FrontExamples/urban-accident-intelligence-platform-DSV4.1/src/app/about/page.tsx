import Link from "next/link";
import { BookOpen, Database, FlaskConical, Layers, ShieldAlert, Sigma, TriangleAlert } from "lucide-react";
import { Callout, Divider, MetricGrid, Panel, SectionLabel } from "@/components/ui";

export const dynamic = "force-static";

const ENTITIES = [
  ["users", "Role-based accounts (citizen / analyst / admin), scrypt password hashes", "—"],
  ["accidents", "Reported or register-recorded events; validated geometry kept with original coordinates", "lat/lng B-tree, occurred_at, status, segment"],
  ["accident_categories", "Controlled vocabulary for collision typologies", "PK code"],
  ["severity_levels", "Ordered severity with analysis weight (1/3/7/12)", "PK code"],
  ["road_segments", "Directed road segments with class, lanes, speed, lighting, surface, AADT", "bbox + district + class indexes"],
  ["intersections", "Junction nodes used as clustering anchors and signalisation attributes", "district"],
  ["environmental_observations", "Weather / surface / visibility point samples by district and daypart", "district, observed_at"],
  ["traffic_observations", "AADT and heavy-vehicle share per segment and daypart (exposure proxy)", "segment_id"],
  ["report_attachments", "Optional photo evidence (≤ 1 MB, moderated, not exposed publicly)", "accident_id"],
  ["report_verifications", "Append-only moderation timeline", "accident_id"],
  ["spatial_analysis_jobs", "Analysis parameters, filters, duration and summary for reproducibility", "kind"],
  ["spatial_analysis_results", "Selected analysis output features (truncated for storage)", "job_id"],
  ["dataset_sources", "Synthetic / observed dataset registry, scenario and seed, publication state", "slug"],
  ["audit_logs", "Immutable actor-action-entity trail for moderation and analysis", "created_at"],
  ["city_features", "District polygons, river corridor, lake and parks for cartographic context", "kind"],
];

const ENDPOINTS = [
  ["GET /api/health", "Readiness, spatial engine and dataset counts", "public"],
  ["GET /api/accidents?format=geojson", "Filtered accidents with provenance metadata", "public"],
  ["POST /api/accidents", "Citizen report with validation and duplicate screening", "public (optional session)"],
  ["POST /api/accidents/duplicates", "Proximity/temporal similarity scoring", "public"],
  ["GET /api/accidents/{id}", "Full record, neighbours and moderation timeline", "public"],
  ["PATCH /api/accidents/{id}", "Moderator correction / state transition", "admin"],
  ["GET /api/accidents/track", "Privacy-preserving status tracking", "public"],
  ["GET /api/network", "Road network, junctions and cartographic features (GeoJSON)", "public"],
  ["GET /api/stats", "KPIs, distributions, concentration, completeness, uncertainty", "public"],
  ["POST /api/analysis", "KDE, Gi*, DBSCAN, segment, environment or temporal analysis (persisted)", "public (jobs audited)"],
  ["GET /api/analysis/{id}", "Stored job metadata and result features", "public"],
  ["GET /api/risk", "Weighted relative risk index by segment", "public"],
  ["GET /api/admin", "Moderation queue, quality indicators, audit trail, datasets", "admin"],
  ["POST /api/admin", "Verify / reject / merge / edit / dataset publication", "admin"],
  ["GET /api/export", "GeoJSON or CSV export with synthetic provenance", "public"],
  ["GET /api/datasets", "Dataset catalogue, scenarios and generator metadata", "public"],
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-[1100px] space-y-2.5 p-3">
      <header className="panel px-3 py-2.5">
        <h1 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <BookOpen size={16} className="text-accent" /> Methods, provenance and limitations
        </h1>
        <p className="mt-1 max-w-3xl text-[11.5px] leading-relaxed text-muted">
          Urban Accident Intelligence is a Web-GIS research demonstrator for crowdsourced road-safety reporting and spatiotemporal analysis. It is
          designed to be defensible in a geoinformatics conference setting: every layer states what it measures, every statistic carries its
          sample and uncertainty, and synthetic provenance is visible on every surface.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="badge badge-warn">Synthetic study area · Vantia</span>
          <span className="badge">EPSG:4326 storage</span>
          <span className="badge">Local equidistant metrics</span>
          <span className="badge">Seed 20260117</span>
          <span className="badge">UTC timestamps</span>
        </div>
      </header>

      <div className="grid gap-2.5 lg:grid-cols-2">
        <Panel title="Study area and data provenance" icon={<Layers size={12} />}>
          <div className="space-y-2 text-[11px] leading-relaxed text-muted">
            <p>
              The city of <b className="text-ink">Vantia</b> is a fictional 13.6 × 10.8 km metropolitan area generated from a fixed seed. It has 12
              districts, a river corridor and lake, four parks, ~600 road segments across four functional classes, and 132 junctions. The coordinate
              frame is arbitrary and intentionally does not correspond to a real municipality.
            </p>
            <p>
              Two synthetic datasets are maintained separately: a municipal-style <b className="text-ink">register</b> (mostly verified) and{" "}
              <b className="text-ink">citizen submissions</b> with pending, rejected and duplicate records. Environmental observations (weather,
              surface, visibility) and traffic observations (AADT) are generated independently so that joins, coverage gaps and uncertainty are
              realistic.
            </p>
            <MetricGrid
              metrics={[
                { label: "Incidents", value: "≈1,800" },
                { label: "Road segments", value: "≈600" },
                { label: "Districts", value: "12" },
                { label: "Period", value: "2024–2025 (UTC)" },
              ]}
            />
            <Callout tone="warn" title="No real-world claims">
              Nothing displayed on this platform describes a real road network or real collisions. Seeded records exist to test reporting,
              moderation, spatial statistics and uncertainty communication.
            </Callout>
          </div>
        </Panel>

        <Panel title="Synthetic scenarios" icon={<Sigma size={12} />}>
          <p className="mb-1.5 text-[11px] text-muted">The generator supports four reproducible scenarios; each run fixes the seed and records it in the dataset registry.</p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Process</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="mono">mixed</td><td>45 % junction clusters, 27 % arterial corridors, 20 % dispersed background, 8 % ring-road corridors.</td></tr>
              <tr><td className="mono">intersection</td><td>72 % of events drawn from nine weighted signalised junctions with Gaussian dispersion (σ 35–115 m).</td></tr>
              <tr><td className="mono">rush_hour</td><td>Spatially mixed, 68 % of timestamps inside 07–09 and 16–19 with a Friday peak.</td></tr>
              <tr><td className="mono">uniform</td><td>Complete spatial randomness over the built-up area with a flat temporal profile.</td></tr>
            </tbody>
          </table>
          <Divider label="injected defects" />
          <ul className="list-disc space-y-1 pl-3.5 text-[10.5px] leading-relaxed text-muted">
            <li>Reporting delays from minutes to multiple days, producing realistic lag between occurrence and availability.</li>
            <li>Coarse geocoding (≈15 % of citizen records) and positions offset from the network.</li>
            <li>Deliberately missing environmental context (borderline coverage) so indicators expose completeness.</li>
            <li>Duplicate records within 280 m and 36 h with a documented similarity score; linked rather than deleted.</li>
            <li>Seasonal and lighting variations so severity outcomes differ by context.</li>
          </ul>
        </Panel>
      </div>

      <Panel title="Relational & spatial model" icon={<Database size={12} />}>
        <p className="mb-2 text-[11px] leading-relaxed text-muted">
          Geometry is stored as GeoJSON in <span className="mono text-ink">jsonb</span> alongside typed coordinate columns. Metric operations use a
          local equidistant projection centred on the study area; at urban scale the error relative to a geodesic measurement is below 0.1 %, which is
          smaller than the positional uncertainty of crowdsourced reports. All timestamps are <span className="mono">timestamptz</span> in UTC;
          hour/day-of-week/month are denormalised at ingestion for indexed aggregation.
        </p>
        <div className="max-h-[330px] overflow-auto scroll-thin border border-line">
          <table className="data-table">
            <thead>
              <tr>
                <th>Entity</th>
                <th>Purpose & key attributes</th>
                <th>Indexes</th>
              </tr>
            </thead>
            <tbody>
              {ENTITIES.map(([entity, purpose, indexes]) => (
                <tr key={entity}>
                  <td className="mono text-ink">{entity}</td>
                  <td>{purpose}</td>
                  <td className="text-faint">{indexes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Divider label="postgis migration path" />
        <p className="text-[10.5px] leading-relaxed text-muted">
          The sandbox target ships PostgreSQL 15 without PostGIS, so the metric GIS core is implemented in TypeScript and unit-tested. For a
          production deployment, add <span className="mono">geometry(Point, 27700)</span> and <span className="mono">geometry(LineString, 27700)</span>{" "}
          columns, backfill from the stored GeoJSON, create GiST indexes, and replace nearest-segment and distance-band queries with{" "}
          <span className="mono">ST_DWithin</span> / <span className="mono">ST_Nearest</span>. The API contract and analytical outputs are unchanged.
        </p>
      </Panel>

      <div className="grid gap-2.5 lg:grid-cols-2">
        <Panel title="Analytical methods" icon={<FlaskConical size={12} />}>
          <div className="space-y-2 text-[10.5px] leading-relaxed text-muted">
            <div>
              <SectionLabel>Kernel density estimation</SectionLabel>
              <p>
                Isotropic Gaussian kernel on a regular lattice, implemented as a separable convolution of quadrat counts. Cell values integrate to the
                weighted number of events, so the surface communicates concentration, not probability. Bandwidth and cell size are exposed; severity or
                casualty weighting is selectable. Clark–Evans R is reported as a descriptive clustering index (R &lt; 1 indicates clustering relative to
                complete spatial randomness).
              </p>
            </div>
            <div>
              <SectionLabel>Getis-Ord Gi*</SectionLabel>
              <p>
                Binary, self-inclusive fixed-distance weights. E[Gi*] = W/n and Var[Gi*] = (n·S1 − W²)/(n − 1)/n², with z = (local sum − E)/SD and a
                two-tailed normal p-value. Classes at 90/95/99 % are location-specific screens under an assumption of spatial randomness. Multiple
                testing, bandwidth sensitivity and duplicate inflation are stated explicitly; FDR control is required for confirmatory claims.
              </p>
            </div>
            <div>
              <SectionLabel>DBSCAN</SectionLabel>
              <p>
                Density-based clustering with a uniform grid index (eps in metres, minPts configurable). Noise is retained and displayed separately:
                dense clusters are not automatically significant concentrations. Cluster hulls are convex hulls of member points and should be
                interpreted descriptively.
              </p>
            </div>
            <div>
              <SectionLabel>Segment assignment & temporal aggregation</SectionLabel>
              <p>
                Each event is assigned to the nearest road segment within a 70 m tolerance; unassigned events remain in the statistics but are never
                silently snapped. Counts, KSI (killed or seriously injured) and length-normalised density are computed per segment. Hour × day-of-week
                matrices are aggregated directly from stored UTC fields.
              </p>
            </div>
            <div>
              <SectionLabel>Environmental comparison</SectionLabel>
              <p>
                Accident surface/weather shares are compared with the share of wet observations in the same period. This is a crude co-occurrence
                check with an exposure caveat: traffic volume is not controlled, so it cannot be read as attributable wet-weather risk.
              </p>
            </div>
          </div>
        </Panel>

        <div className="space-y-2.5">
          <Panel title="Relative risk index" icon={<ShieldAlert size={12} />}>
            <p className="text-[10.5px] leading-relaxed text-muted">
              Five interpretable components are min–max (or rank / z-score) normalised across the analysed network and blended with user-editable
              weights:
            </p>
            <pre className="mt-1.5 overflow-x-auto rounded border border-line bg-panel2 p-2 font-mono text-[9.5px] leading-relaxed text-muted">{`raw = Σ w_c · c_norm / Σ w_c
if exposure enabled:  rate = n / (AADT · 365 · km) × 10^8
environment = 0.40·wet_share + 0.30·dark_share
            + 0.15·unlit + 0.10·(speed/80)
            + 0.05·(surface ≠ asphalt)
stability  = n / (n + k)
index_0_100 = 100 · raw · (0.35 + 0.65·stability)
uncertainty = min(1, 1/√(n+1) + 0.3·[no AADT]
            + 0.35·unknown_context_share)`}</pre>
            <Callout tone="warn" title="Not a probability">
              The index is ordinal and network-relative. It is not calibrated against outcomes, has no predictive validation, and must never be
              presented as the probability of a future collision. Exposure coverage and environmental completeness are displayed alongside every
              ranking.
            </Callout>
          </Panel>

          <Panel title="Verification workflow" icon={<ShieldAlert size={12} />}>
            <div className="space-y-1.5 text-[10.5px] leading-relaxed text-muted">
              <p>
                States: <span className="mono text-ink">reported</span> → <span className="mono text-ink">verified</span> |{" "}
                <span className="mono text-ink">rejected</span> | <span className="mono text-ink">duplicate</span>. Only verified records enter the
                default analytical denominator; pending records are visible as hollow markers and are counted separately. Every transition writes an
                append-only verification event and an audit log entry with actor, prior state and payload.
              </p>
              <p>
                Duplicate screening combines 60 % inverse distance (≤ 250 m), 30 % temporal proximity (≤ 24 h) and 10 % category match. Scores ≥ 0.85
                are provisionally flagged; 0.60–0.85 are advisory. Human review is mandatory before a duplicate merge.
              </p>
              <p>
                Roles: citizens report and explore; analysts run spatial statistics and configure the risk index; administrators moderate, correct and
                manage datasets. Exports and analysis runs are audited.
              </p>
            </div>
          </Panel>
        </div>
      </div>

      <Panel title="REST API" icon={<Database size={12} />}>
        <div className="max-h-[300px] overflow-auto scroll-thin border border-line">
          <table className="data-table">
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Purpose</th>
                <th>Access</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map(([endpoint, purpose, access]) => (
                <tr key={endpoint}>
                  <td className="mono text-ink">{endpoint}</td>
                  <td>{purpose}</td>
                  <td className="text-faint">{access}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
          Spatial exchange uses GeoJSON. Errors are returned as <span className="mono">{`{ error, details? }`}</span> with appropriate status codes;
          validation uses schema parsing and field-level messages. Exports embed a synthetic provenance header.
        </p>
      </Panel>

      <div className="grid gap-2.5 lg:grid-cols-2">
        <Panel title="Uncertainty, bias and limitations" icon={<TriangleAlert size={12} />}>
          <ul className="list-disc space-y-1.5 pl-3.5 text-[10.5px] leading-relaxed text-muted">
            <li><b className="text-ink">Reporting bias:</b> citizens report what they witness. Severe, urban and visually obvious collisions are over-represented; reporting propensity is not modelled.</li>
            <li><b className="text-ink">Positional uncertainty:</b> map picks are stored with ± 25 m; synthetic coarse geocodes reach 60 m. Proximity and segment assignment inherit this error.</li>
            <li><b className="text-ink">Exposure:</b> AADT is synthetic and only available at segment level. Rate-based indicators inherit both the proxy and its coverage gaps.</li>
            <li><b className="text-ink">Modifiable areal unit problem:</b> segment boundaries and lattice cell size change counts and densities; parameters are therefore reported with every result.</li>
            <li><b className="text-ink">Edge effects:</b> events outside the study area are excluded, biasing boundary densities downwards; KDE extents are padded but not corrected.</li>
            <li><b className="text-ink">Temporal:</b> the final month may be incomplete; delays mean recent periods are under-counted at any snapshot.</li>
            <li><b className="text-ink">No causal claims:</b> environmental and road-characteristic associations are descriptive co-occurrences.</li>
            <li><b className="text-ink">Validation status:</b> no independent outcome validation or predictive benchmarking has been carried out; GNN or statistical risk models are future work, not current dependencies.</li>
          </ul>
        </Panel>

        <Panel title="Reproducibility & references" icon={<FlaskConical size={12} />}>
          <div className="space-y-2 text-[10.5px] leading-relaxed text-muted">
            <p>
              <b className="text-ink">Seed policy:</b> network, incidents, weather and traffic are generated from seed <span className="mono">20260117</span>. The scenario and seed are persisted in{" "}
              <span className="mono">dataset_sources</span>; analysis runs persist parameters, filters, sample size and duration in{" "}
              <span className="mono">spatial_analysis_jobs</span>. Exports include the seed and licence notes.
            </p>
            <p>
              <b className="text-ink">Deterministic analysis:</b> KDE, Gi*, DBSCAN, risk scoring and statistics are implemented in framework-free TypeScript modules and covered by unit tests
              (projection error, segment distance, Gi* variance, KDE mass, DBSCAN labelling, risk normalisation).
            </p>
            <p>
              <b className="text-ink">Commands:</b> <span className="mono">npm run dev</span>, <span className="mono">npm run build</span>,{" "}
              <span className="mono">npx drizzle-kit push</span>, <span className="mono">npx tsx --test tests/*.test.ts</span>. Environment variables are documented in{" "}
              <span className="mono">.env.example</span>.
            </p>
            <Divider label="selected references" />
            <ol className="list-decimal space-y-0.5 pl-4 text-[10px]">
              <li>Getis, A. & Ord, J.K. (1992). The analysis of spatial association by use of distance statistics. <i>Geographical Analysis</i> 24(3), 189–206.</li>
              <li>Ord, J.K. & Getis, A. (1995). Local spatial autocorrelation statistics. <i>Geographical Analysis</i> 27(4), 286–306.</li>
              <li>Silverman, B.W. (1986). <i>Density Estimation for Statistics and Data Analysis</i>. Chapman & Hall.</li>
              <li>Ester, M. et al. (1996). A density-based algorithm for discovering clusters in large spatial databases with noise. <i>KDD-96</i>, 226–231.</li>
              <li>Clark, P.J. & Evans, F.C. (1954). Distance to nearest neighbor as a measure of spatial relationships in populations. <i>Ecology</i> 35(4), 445–453.</li>
              <li>Chainey, S. & Ratcliffe, J. (2005). <i>GIS and Crime Mapping</i>. Wiley.</li>
              <li>Openshaw, S. (1984). <i>The Modifiable Areal Unit Problem</i>. CATMOG 38.</li>
              <li>Benjamini, Y. & Hochberg, Y. (1995). Controlling the false discovery rate. <i>JRSS B</i> 57(1), 289–300.</li>
            </ol>
          </div>
        </Panel>
      </div>

      <Callout tone="info" title="Suggested demonstration citation">
        Urban Accident Intelligence (2026). Crowdsourced road-accident reporting and spatiotemporal analysis on a reproducible synthetic urban network
        (v1.0, synthetic seed 20260117) [software demonstration]. Vantia Road Safety Lab.
      </Callout>

      <div className="pb-2 text-[10px] text-faint">
        Questions about method choice or limitations? Start with the <Link className="link" href="/lab">spatial analysis laboratory</Link> parameter
        notes, or inspect the exact JSON payload for any layer in the browser network panel.
      </div>
    </div>
  );
}
