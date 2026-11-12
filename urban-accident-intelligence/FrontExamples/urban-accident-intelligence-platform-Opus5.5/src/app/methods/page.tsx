import { METHOD_DOCS, RISK_DOC } from "@/lib/methods";
import { SCENARIOS } from "@/lib/domain";

const ENDPOINTS: [string, string, string][] = [
  ["GET", "/api/meta", "Reference data, datasets, bounds, current user"],
  ["GET", "/api/accidents", "Filtered retrieval — paginated JSON or GeoJSON (format=geojson); filters: from,to,categories,severities,statuses,datasets,hourFrom,hourTo,weekdays,bbox"],
  ["POST", "/api/accidents", "Citizen report → validation, network snapping, duplicate detection, tracking code"],
  ["POST", "/api/accidents/check", "Pre-submission location + duplicate check"],
  ["GET/PATCH", "/api/accidents/{id}", "Detail / administrator correction"],
  ["POST", "/api/accidents/{id}/review", "verify | reject | mark_duplicate | reopen"],
  ["GET", "/api/track/{code}", "Public status by tracking code"],
  ["GET", "/api/roads", "Road network GeoJSON (stats=1 → per-segment aggregation)"],
  ["GET", "/api/roads/{id}", "Segment statistics with Poisson CIs"],
  ["GET", "/api/geocode?q=", "Offline gazetteer (streets, A & B intersections, coordinates)"],
  ["GET", "/api/stats", "Dashboard statistics"],
  ["POST", "/api/analysis/run", "Synchronous analysis {method, params, filters}"],
  ["POST/GET", "/api/analysis/jobs", "Asynchronous analysis jobs (202 + polling)"],
  ["GET", "/api/analysis/jobs/{id}/download", "GeoJSON / CSV / JSON export with provenance"],
  ["POST", "/api/risk", "Risk assessment (EB, EPDO, index, rank uncertainty)"],
  ["GET/POST/PATCH", "/api/datasets[/{id}]", "Dataset management; synthetic regeneration (admin)"],
  ["GET", "/api/admin/quality · /api/admin/audit", "Data-quality indicators, detector evaluation, audit log"],
  ["GET", "/api/openapi", "OpenAPI 3.1 document"],
];

const ERD = `users ─┬─< accidents >── accident_categories
        │       │  └──── severity_levels
        │       ├──< report_attachments
        │       ├──< report_verifications >── users (reviewer)
        │       └──> road_segments (segment_id, nearest-segment assignment)
dataset_sources ─┬─< accidents
                 ├─< road_nodes ─< road_segments (from/to)
                 ├─< road_segments ─< traffic_observations (AADT/year)
                 ├─< environmental_observations (hourly)
                 └─< basemap_features
spatial_analysis_jobs ─1:1─ spatial_analysis_results
audit_logs >── users (actor)`;

export default function MethodsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <article className="max-w-4xl mx-auto p-6 space-y-8 text-[13px] leading-relaxed">
        <header className="space-y-2">
          <div className="label">Documentation</div>
          <h1 className="text-[22px] font-semibold tracking-tight">Urban Accident Intelligence — methods, data model and API</h1>
          <p className="text-muted">
            A crowdsourced Web-GIS that integrates citizen accident reporting, a spatial database, data-quality control, spatial statistics and a transparent road-segment risk engine. The platform ships with a fully synthetic, reproducible city (&ldquo;Synthetica&rdquo;) so that every analytical method can be validated against known, injected ground truth before real data are connected.
          </p>
        </header>

        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">1. Scientific positioning</h2>
          <ul className="list-disc pl-5 space-y-1 text-muted">
            <li><b className="text-fg">Verification-aware analytics:</b> unverified reports are stored, displayed (hollow symbols) and tracked, but excluded from all statistics by default; sensitivity runs can include them explicitly.</li>
            <li><b className="text-fg">Descriptive vs inferential separation:</b> KDE, DBSCAN and segment densities are labelled descriptive; Gi* is inferential, FDR-corrected and refused when pre-conditions fail.</li>
            <li><b className="text-fg">Frequency ≠ risk ≠ probability:</b> counts carry exact Poisson CIs; EB estimates correct regression-to-the-mean; the composite index is ordinal and explicitly not a probability; rank uncertainty is quantified by posterior simulation.</li>
            <li><b className="text-fg">Synthetic ground truth as a benchmark:</b> injected hotspots, weather multipliers, GPS noise, gross errors and duplicates allow precision/recall of QA rules and bias of estimators to be measured reproducibly (fixed seeds).</li>
            <li><b className="text-fg">Provenance:</b> original and validated coordinates are stored separately; every review, edit, regeneration and analysis job is audited; exports embed parameters, filters and CRS.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">2. Spatial reference and data model</h2>
          <p className="text-muted">Geographic exchange in EPSG:4326 (GeoJSON, RFC 7946); all metric computation in EPSG:32633 (WGS 84 / UTM 33N) using an in-house Transverse Mercator implementation (Snyder 1987; validated to &lt;1 cm round-trip). Timestamps are stored as UTC <code>timestamptz</code>; temporal aggregation uses the study-area time zone (Europe/Vienna). In deployments with PostGIS, the projected coordinate columns map 1:1 to <code>geometry(Point, 32633)</code> with GiST indexes (see <code>docs/postgis-migration.sql</code>).</p>
          <pre className="num text-[11.5px] bg-panel border border-line rounded-[4px] p-3 overflow-x-auto text-muted">{ERD}</pre>
        </section>

        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">3. Synthetic scenarios</h2>
          <table className="w-full text-[12px]">
            <tbody>
              {SCENARIOS.map((s) => (
                <tr key={s.code} className="border-t border-line">
                  <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{s.label}</td>
                  <td className="text-muted">{s.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-muted">The generator produces a warped grid network with arterial/collector/local hierarchy, a river with bridges, land-use blocks, signalised intersections, log-normal AADT, an hourly Markov weather series, accidents (spatial mixture × temporal profile × weather rejection sampling × context-dependent category and severity), log-normal reporting delays, Gaussian GPS error, gross position errors, fabricated reports and duplicate submissions.</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-[15px] font-semibold">4. Analytical methods</h2>
          {Object.entries(METHOD_DOCS).map(([k, d]) => (
            <div key={k} className="border border-line rounded-[4px] bg-panel p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{d.title}</h3>
                <span className="text-[10.5px] uppercase tracking-wider text-faint">{d.kind}</span>
              </div>
              <p className="text-muted">{d.summary}</p>
              <ul className="list-disc pl-5 text-muted text-[12px] space-y-0.5">
                {d.details.map((x) => <li key={x}>{x}</li>)}
              </ul>
              <p className="text-[12px]"><span className="text-warn">Limitations:</span> <span className="text-muted">{d.assumptions.join(" ")}</span></p>
              <p className="text-[11px] text-faint">{d.references.join(" · ")}</p>
            </div>
          ))}
          <div className="border border-line rounded-[4px] bg-panel p-3 space-y-1.5">
            <h3 className="font-semibold">{RISK_DOC.title}</h3>
            <ul className="list-disc pl-5 text-muted text-[12px] space-y-0.5">
              {RISK_DOC.points.map((x) => <li key={x}>{x}</li>)}
            </ul>
            <p className="text-[11px] text-faint">{RISK_DOC.references.join(" · ")}</p>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">5. Data quality & privacy</h2>
          <ul className="list-disc pl-5 space-y-1 text-muted">
            <li>Coordinate validation (WGS84 ranges, study-area coverage), nearest-segment snapping with 25 m / 60 m confidence thresholds, late-report flag (&gt; 72 h).</li>
            <li>Duplicate detection: hard gates 150 m / ±180 min, weighted spatio-temporal-attribute similarity; evaluated against generator labels (precision/recall/F1 across thresholds).</li>
            <li>No account needed to report; optional contact stored only as a keyed HMAC-SHA256 hash; photos re-encoded client-side (EXIF/GPS stripped) and visible to administrators only; public tracking reveals status only.</li>
            <li>Role-based access (citizen / administrator), scrypt password hashing, HMAC-signed HTTP-only session cookies, audit logging.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">6. REST API</h2>
          <p className="text-muted">Machine-readable specification: <a className="text-accent" href="/api/openapi">/api/openapi</a>. Validation errors return HTTP 422 with field-level details.</p>
          <table className="w-full text-[12px]">
            <tbody>
              {ENDPOINTS.map(([m, p, d]) => (
                <tr key={p + m} className="border-t border-line align-top">
                  <td className="py-1.5 pr-3 num text-accent whitespace-nowrap">{m}</td>
                  <td className="pr-3 num whitespace-nowrap">{p}</td>
                  <td className="text-muted">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="space-y-2 pb-10">
          <h2 className="text-[15px] font-semibold">7. Planned extensions</h2>
          <p className="text-muted">Network-constrained KDE and network K-functions; space-time scan statistics; negative-binomial safety performance functions with covariates; exposure from probe/loop data; graph neural networks as optional, independently validated model plug-ins behind the same risk interface (no architectural dependency).</p>
        </section>
      </article>
    </div>
  );
}
