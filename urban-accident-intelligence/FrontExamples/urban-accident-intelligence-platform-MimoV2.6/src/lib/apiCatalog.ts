/** Machine-readable catalogue of the REST API. Shared by /api/docs and /docs. */

export interface ApiEndpoint {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  summary: string;
  description: string;
  params?: { name: string; in: "query" | "path" | "body"; type: string; required?: boolean; description: string }[];
  returns: string;
  example?: string;
}

export const API_VERSION = "1.0.0";

export const API_ENDPOINTS: ApiEndpoint[] = [
  {
    method: "GET",
    path: "/api/health",
    summary: "Service health",
    description: "Liveness and database connectivity probe. Also reports whether PostGIS is available and which spatial engine is in use.",
    returns: "Health object with database latency and data notice.",
  },
  {
    method: "GET",
    path: "/api/accidents",
    summary: "Query accident reports",
    description:
      "Paginated retrieval of accident reports with temporal, categorical, spatial and free-text filtering. Returns either a JSON page or a GeoJSON FeatureCollection.",
    params: [
      { name: "format", in: "query", type: "json | geojson", description: "Response encoding (default json)." },
      { name: "from", in: "query", type: "ISO-8601", description: "Earliest occurrence timestamp (inclusive)." },
      { name: "to", in: "query", type: "ISO-8601", description: "Latest occurrence timestamp (inclusive)." },
      { name: "categories", in: "query", type: "csv", description: "Category codes, e.g. pedestrian,cyclist." },
      { name: "severities", in: "query", type: "csv", description: "Severity codes: fatal, serious, slight, damage_only." },
      { name: "statuses", in: "query", type: "csv", description: "Review states: pending, verified, rejected, duplicate." },
      { name: "bbox", in: "query", type: "minLon,minLat,maxLon,maxLat", description: "Spatial bounding box in WGS84." },
      { name: "text", in: "query", type: "string", description: "Case-insensitive search over narrative and public identifier." },
      { name: "limit", in: "query", type: "integer", description: "Page size, 1–20000 (default 5000)." },
      { name: "offset", in: "query", type: "integer", description: "Row offset for pagination." },
    ],
    returns: "Paginated accident list or GeoJSON FeatureCollection with a `meta` envelope.",
    example: "/api/accidents?format=geojson&severities=fatal,serious&from=2024-06-01&limit=500",
  },
  {
    method: "POST",
    path: "/api/accidents",
    summary: "Submit a citizen accident report",
    description:
      "Validates coordinates against the study area, snaps the report to the nearest road segment, records positional provenance and runs duplicate detection (75 m / 6 h). New reports always enter the queue as `pending`.",
    params: [
      { name: "lon / lat", in: "body", type: "number", required: true, description: "WGS84 coordinates inside the study area." },
      { name: "occurredAt", in: "body", type: "ISO-8601", required: true, description: "Occurrence timestamp in UTC." },
      { name: "categoryCode / severityCode", in: "body", type: "string", required: true, description: "Controlled vocabulary terms." },
      { name: "vehicles / casualties", in: "body", type: "integer", required: true, description: "Counts, validated to 0–30." },
      { name: "description", in: "body", type: "string", required: true, description: "Narrative, 12–2000 characters." },
      { name: "attachments", in: "body", type: "array", description: "Optional evidence metadata (filename, contentType, byteSize)." },
    ],
    returns: "201 with report identifier, snapped segment, snap distance and duplicate candidates.",
  },
  {
    method: "PATCH",
    path: "/api/accidents",
    summary: "Edit a report record",
    description: "Administrator correction of descriptive fields. Writes an audit entry listing the changed fields.",
    params: [{ name: "id", in: "body", type: "integer", required: true, description: "Accident identifier." }],
    returns: "Confirmation with the updated identifier.",
  },
  {
    method: "GET",
    path: "/api/accidents/{id}",
    summary: "Accident detail",
    description:
      "Full record including snapped road segment, evidence attachments, environmental observations, traffic context for the segment and the complete verification history.",
    params: [{ name: "id", in: "path", type: "integer", required: true, description: "Accident identifier." }],
    returns: "Composite accident detail object.",
  },
  {
    method: "POST",
    path: "/api/accidents/{id}/review",
    summary: "Record a review decision",
    description:
      "Administrator decision: verified, rejected, duplicate or reopened. Appends to `report_verifications`, updates the report status and writes an audit entry. Records are never deleted.",
    params: [
      { name: "decision", in: "body", type: "enum", required: true, description: "verified | rejected | duplicate | reopened" },
      { name: "reviewerName", in: "body", type: "string", required: true, description: "Reviewer identity recorded in the audit trail." },
      { name: "confidence", in: "body", type: "number", description: "Reviewer confidence 0–1 (default 0.8)." },
      { name: "notes", in: "body", type: "string", description: "Free-text justification." },
    ],
    returns: "Confirmation with the resulting status.",
  },
  {
    method: "GET",
    path: "/api/roads",
    summary: "Road network retrieval",
    description: "Synthetic Meridian road network as GeoJSON LineStrings with design attributes and aggregated accident statistics.",
    params: [{ name: "format", in: "query", type: "geojson | json", description: "Response encoding (default geojson)." }],
    returns: "GeoJSON FeatureCollection of road segments.",
  },
  {
    method: "POST",
    path: "/api/roads",
    summary: "Road segment detail",
    description: "Single segment with its snapped accident statistics.",
    params: [{ name: "id", in: "body", type: "integer", required: true, description: "Segment identifier." }],
    returns: "Segment object plus report count.",
  },
  {
    method: "GET",
    path: "/api/stats",
    summary: "Dashboard statistics",
    description:
      "Descriptive aggregates: totals, severity and category distributions, hour-of-day, day-of-week, monthly trend, district concentration (Gini), road-class exposure, top segments and reporting lag.",
    returns: "Dashboard statistics object with a `concentration` interpretation note.",
  },
  {
    method: "GET",
    path: "/api/traffic",
    summary: "Traffic observations",
    description: "Synthetic exposure model: hourly volumes, mean speeds, AADT and congestion index by segment.",
    params: [{ name: "segmentId", in: "query", type: "integer", description: "Restrict to a single road segment." }],
    returns: "Array of traffic observations.",
  },
  {
    method: "GET",
    path: "/api/datasets",
    summary: "Dataset registry",
    description: "Registered data sources with provenance, licence, generator version, random seed and coverage window. Synthetic and real sources are held separately.",
    returns: "Array of dataset sources.",
  },
  {
    method: "POST",
    path: "/api/datasets",
    summary: "Regenerate the synthetic corpus",
    description:
      "Destructive regeneration of the synthetic tables with a chosen scenario (uniform, intersection_dominated, rush_hour_dominated, mixed) and random seed. Real datasets are never touched.",
    params: [
      { name: "scenario", in: "body", type: "enum", description: "Synthetic distribution scenario." },
      { name: "seed", in: "body", type: "integer", description: "Deterministic random seed." },
      { name: "accidentCount", in: "body", type: "integer", description: "Number of base events, 100–12000." },
    ],
    returns: "Regeneration summary with row counts and duration.",
  },
  {
    method: "GET",
    path: "/api/audit",
    summary: "Audit trail and quality counters",
    description: "Append-only audit entries plus verification decisions, report statuses and environmental coverage.",
    returns: "Audit array with quality summary objects.",
  },
  {
    method: "GET",
    path: "/api/docs",
    summary: "This catalogue",
    description: "Machine-readable endpoint catalogue in JSON.",
    returns: "OpenAPI-style catalogue object.",
  },
];
