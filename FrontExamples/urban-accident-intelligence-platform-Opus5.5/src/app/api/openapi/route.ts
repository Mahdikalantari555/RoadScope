export const dynamic = "force-static";

const filterParams = ["from", "to", "categories", "severities", "statuses", "datasets", "hourFrom", "hourTo", "weekdays", "bbox"].map((name) => ({
  name,
  in: "query",
  required: false,
  schema: { type: "string" },
  description:
    {
      from: "ISO date (inclusive, UTC)",
      to: "ISO date (inclusive, UTC)",
      categories: "comma-separated category codes",
      severities: "comma-separated severity codes (pdo,slight,serious,fatal)",
      statuses: "comma-separated statuses (reported,verified,rejected,duplicate). Analyses default to verified.",
      datasets: "comma-separated dataset_source ids (default: active datasets)",
      hourFrom: "local hour 0–23 (wraps midnight if > hourTo)",
      hourTo: "local hour 0–23",
      weekdays: "0=Mon … 6=Sun",
      bbox: "minLon,minLat,maxLon,maxLat (EPSG:4326)",
    }[name] ?? "",
}));

const spec = {
  openapi: "3.1.0",
  info: { title: "Urban Accident Intelligence API", version: "1.0.0", description: "Crowdsourced road-accident reporting and spatial road-safety analytics. Spatial exchange uses GeoJSON (RFC 7946, EPSG:4326); metric computation in EPSG:32633. All data shipped with the platform is SYNTHETIC." },
  paths: {
    "/api/health": { get: { summary: "Liveness / DB check (triggers idempotent seeding)" } },
    "/api/meta": { get: { summary: "Reference data: categories, severities, statuses, datasets, bounds, current user" } },
    "/api/accidents": {
      get: { summary: "Retrieve accidents (paginated JSON or GeoJSON with format=geojson)", parameters: [...filterParams, { name: "format", in: "query", schema: { enum: ["json", "geojson"] } }, { name: "page", in: "query" }, { name: "pageSize", in: "query" }, { name: "sort", in: "query", schema: { enum: ["newest", "oldest"] } }] },
      post: { summary: "Submit a citizen report (validated, snapped to network, duplicate-checked). Returns tracking code.", responses: { "201": { description: "Created" }, "422": { description: "Validation error" } } },
    },
    "/api/accidents/check": { post: { summary: "Pre-submission location validation and duplicate candidates" } },
    "/api/accidents/{id}": { get: { summary: "Accident detail" }, patch: { summary: "Edit record (admin). Original coordinates preserved." } },
    "/api/accidents/{id}/review": { post: { summary: "verify | reject | mark_duplicate | reopen (admin)" } },
    "/api/track/{code}": { get: { summary: "Public status lookup by tracking code" } },
    "/api/attachments/{id}": { get: { summary: "Attachment binary (admin)" } },
    "/api/roads": { get: { summary: "Road network GeoJSON; stats=1 adds per-segment aggregation under filters", parameters: filterParams } },
    "/api/roads/{id}": { get: { summary: "Segment attributes + statistics (CI, density, rate)", parameters: filterParams } },
    "/api/basemap": { get: { summary: "Offline synthetic basemap context (land-use, water, intersections)" } },
    "/api/geocode": { get: { summary: "Offline gazetteer: streets, intersections (A & B), coordinates", parameters: [{ name: "q", in: "query", required: true }] } },
    "/api/stats": { get: { summary: "Dashboard statistics", parameters: filterParams } },
    "/api/analysis/run": { post: { summary: "Synchronous analysis {method, params, filters}" } },
    "/api/analysis/jobs": { get: { summary: "Recent jobs" }, post: { summary: "Enqueue asynchronous analysis job (202)" } },
    "/api/analysis/jobs/{id}": { get: { summary: "Job status + result" } },
    "/api/analysis/jobs/{id}/download": { get: { summary: "Export result (format=geojson|csv|json) with provenance metadata" } },
    "/api/risk": { post: { summary: "Segment risk assessment: EB, EPDO, configurable relative index, rank uncertainty" } },
    "/api/datasets": { get: { summary: "Dataset sources" }, post: { summary: "Regenerate synthetic dataset (admin)" } },
    "/api/datasets/{id}": { patch: { summary: "Activate/deactivate dataset (admin)" } },
    "/api/admin/quality": { get: { summary: "Data-quality indicators and detector evaluation (admin)" } },
    "/api/admin/audit": { get: { summary: "Audit log (admin)" } },
    "/api/auth/login": { post: { summary: "Session login" } },
    "/api/auth/logout": { post: { summary: "Session logout" } },
    "/api/auth/me": { get: { summary: "Current user" } },
  },
  components: {
    schemas: {
      AnalysisMethod: { enum: ["kde", "gistar", "dbscan", "nearest", "segments", "temporal", "environment", "pattern"] },
    },
  },
};

export function GET() {
  return Response.json(spec);
}
