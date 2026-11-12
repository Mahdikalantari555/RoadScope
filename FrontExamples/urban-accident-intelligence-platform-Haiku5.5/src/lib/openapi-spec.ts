/**
 * OpenAPI 3.0 description of the REST API, served at /api/openapi.json and rendered at /api-docs.
 */

export interface EndpointDoc {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  tag: string;
  summary: string;
  auth: "public" | "user" | "admin";
  query?: { name: string; description: string }[];
  body?: string;
  responses: string;
}

export const ENDPOINTS: EndpointDoc[] = [
  { method: "GET", path: "/api/meta", tag: "Reference", summary: "Study area, categories, severity levels, scenarios and current user.", auth: "public", responses: "MetaResponse" },
  { method: "GET", path: "/api/auth/me", tag: "Auth", summary: "Current session user (or null).", auth: "public", responses: "{ user }" },
  { method: "POST", path: "/api/auth/login", tag: "Auth", summary: "Sign in with email and password. Sets an HttpOnly session cookie.", auth: "public", body: "{ email, password }", responses: "{ user }" },
  { method: "POST", path: "/api/auth/logout", tag: "Auth", summary: "End the current session.", auth: "public", responses: "{ ok }" },
  {
    method: "GET",
    path: "/api/accidents",
    tag: "Accidents",
    summary: "Paginated accident list with analytical filters. Public callers see verified records only.",
    auth: "public",
    query: [
      { name: "page / pageSize", description: "Pagination (pageSize ≤ 100)." },
      { name: "sort / order", description: "occurred | reported | status | severity; asc | desc." },
      { name: "from / to", description: "Local calendar dates, YYYY-MM-DD, inclusive." },
      { name: "categories", description: "Comma-separated category codes." },
      { name: "severities", description: "Comma-separated severity ids (1–4)." },
      { name: "hours", description: "Local hour window, e.g. 7-9." },
      { name: "months / dow", description: "Comma-separated months (1–12) and weekdays (0 = Mon)." },
      { name: "statuses", description: "reported, verified, rejected, duplicate (admin only beyond verified)." },
      { name: "datasets", description: "Comma-separated dataset ids (default: all active)." },
      { name: "bbox", description: "minLon,minLat,maxLon,maxLat." },
    ],
    responses: "Paginated<AccidentListItem>",
  },
  {
    method: "GET",
    path: "/api/accidents/geojson",
    tag: "Accidents",
    summary: "Accident points as GeoJSON for map rendering (same filters as the list).",
    auth: "public",
    query: [{ name: "limit", description: "Maximum features (default 20000, max 50000)." }],
    responses: "FeatureCollection<Point>",
  },
  { method: "POST", path: "/api/accidents", tag: "Reporting", summary: "Submit a citizen report. Returns a tracking code and possible duplicates.", auth: "public", body: "reportSchema (lon, lat, occurredLocal, categoryCode, severityId, vehiclesInvolved, emergencyServices, description, privacyConsent)", responses: "ReportResult (201)" },
  { method: "POST", path: "/api/accidents/check-duplicates", tag: "Reporting", summary: "Check for similar existing incidents before submission.", auth: "public", body: "{ lon, lat, occurredLocal, categoryCode }", responses: "{ candidates }" },
  { method: "GET", path: "/api/accidents/track", tag: "Reporting", summary: "Status and review history of a report by tracking code.", auth: "public", query: [{ name: "code", description: "Tracking code, e.g. UAI-ABCD-2345." }], responses: "TrackResult" },
  { method: "GET", path: "/api/accidents/{id}", tag: "Accidents", summary: "Accident detail. Narrative and history are visible to administrators and to the tracking-code owner.", auth: "public", query: [{ name: "code", description: "Tracking code of the report (optional)." }], responses: "AccidentDetail" },
  { method: "PATCH", path: "/api/accidents/{id}", tag: "Administration", summary: "Edit an accident record. Coordinate changes are recorded as validated locations.", auth: "admin", body: "{ categoryCode?, severityId?, occurredLocal?, vehiclesInvolved?, emergencyServices?, description?, lon?, lat?, note? }", responses: "AccidentDetail" },
  { method: "POST", path: "/api/accidents/{id}/review", tag: "Administration", summary: "Verify, reject, mark as duplicate, or reopen a record.", auth: "admin", body: "{ action, duplicateOfId?, note? }", responses: "AccidentDetail" },
  { method: "POST", path: "/api/accidents/{id}/attachments", tag: "Reporting", summary: "Attach a JPEG, PNG or WebP photograph (≤ 8 MB, ≤ 5 per report).", auth: "public", body: "multipart: file, trackingCode", responses: "Attachment (201)" },
  { method: "GET", path: "/api/attachments/{id}", tag: "Reporting", summary: "Download an attachment (administrators or tracking-code owner).", auth: "public", query: [{ name: "code", description: "Tracking code." }], responses: "binary image" },
  { method: "GET", path: "/api/segments", tag: "Analytics", summary: "Road network as GeoJSON with per-segment incident counts and rates.", auth: "public", query: [{ name: "(filters)", description: "Same analytical filters as /api/accidents." }], responses: "FeatureCollection<LineString>" },
  { method: "GET", path: "/api/segments/{id}", tag: "Analytics", summary: "Road-segment statistics: counts, rates, category and hourly profile, recent incidents.", auth: "public", query: [{ name: "(filters)", description: "Analytical filters." }], responses: "SegmentDetail" },
  { method: "GET", path: "/api/dashboard", tag: "Analytics", summary: "Dashboard statistics: severity, categories, temporal patterns, top segments, concentration.", auth: "public", query: [{ name: "(filters)", description: "Analytical filters." }, { name: "bbox", description: "Restrict to the current map view." }], responses: "DashboardStats" },
  { method: "GET", path: "/api/quality", tag: "Administration", summary: "Data-quality indicators and reporting activity.", auth: "admin", responses: "QualityReport" },
  { method: "GET", path: "/api/network", tag: "Reference", summary: "Road network, traffic and weather coverage summary.", auth: "public", responses: "NetworkSummary" },
  { method: "GET", path: "/api/analysis/jobs", tag: "Analysis", summary: "Recent analysis jobs.", auth: "public", query: [{ name: "limit", description: "1–100." }], responses: "{ items: JobView[] }" },
  {
    method: "POST",
    path: "/api/analysis/jobs",
    tag: "Analysis",
    summary: "Start an asynchronous analysis. Identical requests within 30 minutes return the cached result.",
    auth: "public",
    body: "{ type: kde | gistar | dbscan | segment_aggregation | spatial_comparison | risk, params: {…}, filters: {…} }",
    responses: "JobView (202 queued, 200 cached)",
  },
  { method: "GET", path: "/api/analysis/jobs/{id}", tag: "Analysis", summary: "Job status, progress and result.", auth: "public", responses: "JobView" },
  {
    method: "GET",
    path: "/api/analysis/jobs/{id}/export",
    tag: "Analysis",
    summary: "Download a completed result as GeoJSON or CSV.",
    auth: "public",
    query: [{ name: "format", description: "geojson | csv" }],
    responses: "file download",
  },
  { method: "GET", path: "/api/datasets", tag: "Datasets", summary: "Synthetic and real dataset sources with record counts.", auth: "public", responses: "{ items: DatasetInfo[] }" },
  { method: "POST", path: "/api/datasets/synthetic", tag: "Datasets", summary: "Generate a reproducible synthetic dataset (scenario, seed, size).", auth: "admin", body: "{ scenario, seed, accidentCount, kind?, name? }", responses: "DatasetGenerationResult (201)" },
  { method: "POST", path: "/api/datasets/import", tag: "Datasets", summary: "Import real accident points from a GeoJSON FeatureCollection.", auth: "admin", body: "{ name, features[] }", responses: "ImportResult (201)" },
  { method: "PATCH", path: "/api/datasets/{id}", tag: "Datasets", summary: "Activate or deactivate a dataset for analytics.", auth: "admin", body: "{ isActive }", responses: "DatasetInfo" },
  { method: "DELETE", path: "/api/datasets/{id}", tag: "Datasets", summary: "Delete a dataset and its records (the road network is protected).", auth: "admin", responses: "{ ok }" },
  { method: "GET", path: "/api/audit", tag: "Administration", summary: "Append-only audit trail of administrative actions.", auth: "admin", query: [{ name: "limit", description: "1–500." }], responses: "{ items: AuditEntryView[] }" },
];

function schemaFor(name: string) {
  return { type: "object", description: name };
}

function buildPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of ENDPOINTS) {
    const operation: Record<string, unknown> = {
      tags: [e.tag],
      summary: e.summary,
      "x-auth": e.auth,
      parameters: (e.query ?? []).map((q) => ({ name: q.name, in: "query", description: q.description, schema: { type: "string" } })),
      responses: {
        "200": { description: e.responses },
        "401": { description: "Sign-in required" },
        "403": { description: "Administrator role required" },
        "422": { description: "Validation error" },
      },
    };
    if (e.body) operation.requestBody = { description: e.body, content: { "application/json": { schema: schemaFor(e.body) } } };
    const key = e.path.replace("/api", "");
    paths[key] = { ...(paths[key] ?? {}), [e.method.toLowerCase()]: operation };
  }
  return paths;
}

export const OPENAPI_DOCUMENT = {
  openapi: "3.0.3",
  info: {
    title: "Urban Accident Intelligence API",
    version: "1.0.0",
    description:
      "REST API for crowdsourced accident reporting, spatial analytics and road-safety intelligence. All data in the default environment is SYNTHETIC. Timestamps are ISO 8601 in UTC; local calendar fields use Europe/Berlin. Coordinates are WGS84 (lon, lat); analysis uses EPSG:32633.",
  },
  servers: [{ url: "/" }],
  tags: [...new Set(ENDPOINTS.map((e) => e.tag))].map((name) => ({ name })),
  paths: buildPaths(),
};
