/**
 * Shared domain vocabulary. Pure TypeScript: safe for server and client bundles.
 */

export const STUDY_AREA = {
  id: "SYN-01",
  name: "Synthetic City SYN-01",
  disclaimer:
    "Fictional urban road grid. Every accident, weather and traffic record in this environment is synthetic and must not be read as a real-world finding.",
  center: { lon: 13.405, lat: 52.52 },
  utmEpsg: 32633,
  timeZone: "Europe/Berlin",
  nodesPerSide: 13,
  nodeSpacingM: 640,
  networkHalfExtentM: 3840,
  reportBufferM: 500,
} as const;

export const USER_ROLES = ["admin", "user"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ACCIDENT_STATUSES = ["reported", "verified", "rejected", "duplicate"] as const;
export type AccidentStatus = (typeof ACCIDENT_STATUSES)[number];

export const DATASET_KINDS = ["synthetic", "citizen", "real_import"] as const;
export type DatasetKind = (typeof DATASET_KINDS)[number];

export const JOB_STATUSES = ["queued", "running", "completed", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const ROAD_CLASSES = ["arterial", "collector", "local"] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

export const ROAD_CLASS_META: Record<RoadClass, { label: string; speedKmh: number; lanes: number; colorHex: string; width: number }> = {
  arterial: { label: "Arterial", speedKmh: 60, lanes: 3, colorHex: "#cbd5e1", width: 3.4 },
  collector: { label: "Collector", speedKmh: 50, lanes: 2, colorHex: "#8593a6", width: 2.2 },
  local: { label: "Local street", speedKmh: 30, lanes: 1, colorHex: "#4b5565", width: 1.2 },
};

export const CATEGORY_CODES = ["rear_end", "side_impact", "pedestrian", "cyclist", "single_vehicle"] as const;
export type CategoryCode = (typeof CATEGORY_CODES)[number];

export const CATEGORY_META: Record<CategoryCode, { label: string; description: string; colorHex: string }> = {
  rear_end: {
    label: "Rear-end collision",
    description: "Following vehicle strikes the vehicle in front, typically in queues or at signals.",
    colorHex: "#f59e0b",
  },
  side_impact: {
    label: "Side-impact / angle",
    description: "Collision between vehicles with crossing or turning paths, typical at junctions.",
    colorHex: "#a78bfa",
  },
  pedestrian: {
    label: "Pedestrian struck",
    description: "A pedestrian is struck by a motor vehicle.",
    colorHex: "#f43f5e",
  },
  cyclist: {
    label: "Cyclist involved",
    description: "A pedal cyclist is involved in the collision.",
    colorHex: "#22d3ee",
  },
  single_vehicle: {
    label: "Single-vehicle / run-off",
    description: "No second party: loss of control, run-off-road or fixed-object impact.",
    colorHex: "#84cc16",
  },
};

export const SEVERITY_IDS = [1, 2, 3, 4] as const;
export type SeverityId = (typeof SEVERITY_IDS)[number];

export const SEVERITY_META: Record<SeverityId, { code: string; label: string; weight: number; colorHex: string; description: string }> = {
  1: {
    code: "pdo",
    label: "Property damage only",
    weight: 1,
    colorHex: "#94a3b8",
    description: "Vehicle or property damage, no injury reported.",
  },
  2: {
    code: "minor",
    label: "Minor injury",
    weight: 3,
    colorHex: "#facc15",
    description: "Injury treated on site or as outpatient; no hospitalisation.",
  },
  3: {
    code: "serious",
    label: "Serious injury",
    weight: 8,
    colorHex: "#fb923c",
    description: "Hospitalisation or incapacitating injury.",
  },
  4: { code: "fatal", label: "Fatal", weight: 20, colorHex: "#ef4444", description: "At least one fatality within 30 days." },
};

export const SCENARIO_IDS = ["uniform", "intersection", "rush_hour", "mixed"] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

export const SCENARIO_META: Record<ScenarioId, { label: string; description: string }> = {
  uniform: {
    label: "Uniform (random)",
    description: "Incidents distributed along the network proportionally to exposure, with a mild daytime profile. Null hypothesis for clustering tests.",
  },
  intersection: {
    label: "Intersection-dominated",
    description: "About 60% of incidents occur in the immediate approach to junctions, reflecting conflict-point concentration.",
  },
  rush_hour: {
    label: "Rush-hour dominated",
    description: "About 70% of incidents follow a bimodal commuter profile (07–09 and 16–19 local time).",
  },
  mixed: {
    label: "Mixed urban pattern",
    description: "Junction-proximal incidents, eight embedded hotspot corridors, commuter peaks and a uniform background.",
  },
};

export const ANALYSIS_TYPES = ["kde", "gistar", "dbscan", "segment_aggregation", "spatial_comparison", "risk"] as const;
export type AnalysisType = (typeof ANALYSIS_TYPES)[number];

export const QUALITY_FLAGS = ["off_network", "possible_duplicate", "delayed_report", "coordinate_moved"] as const;
export type QualityFlag = (typeof QUALITY_FLAGS)[number];

export const QUALITY_FLAG_META: Record<QualityFlag, string> = {
  off_network: "Location more than 40 m from the nearest road segment",
  possible_duplicate: "Similar incident (same category, <120 m, <2 h) already exists",
  delayed_report: "Reported more than 24 h after occurrence",
  coordinate_moved: "Location validated / moved by an administrator",
};

/** Geometry primitives (WGS84 lon/lat or projected metres depending on context). */
export type BBox = [minLon: number, minLat: number, maxLon: number, maxLat: number];
export type Position = [number, number];

export type GeoGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: Position[][] };

export interface GeoFeature<P = Record<string, unknown>> {
  type: "Feature";
  geometry: GeoGeometry;
  properties: P;
}

export interface GeoFeatureCollection<P = Record<string, unknown>> {
  type: "FeatureCollection";
  features: GeoFeature<P>[];
}

/** Normalised accident record used by analytics (server-side and in tests). */
export interface AccidentPoint {
  id: number;
  status: AccidentStatus;
  categoryCode: CategoryCode;
  severityId: SeverityId;
  severityWeight: number;
  lon: number;
  lat: number;
  x: number;
  y: number;
  tMs: number;
  yearLocal: number;
  monthLocal: number;
  dowLocal: number;
  hourLocal: number;
  segmentId: number | null;
  snapDistanceM: number | null;
  reportingDelayMin: number;
  qualityFlags: string[];
  duplicateCandidateId: number | null;
  datasetId: number;
  datasetKind: DatasetKind;
  isSynthetic: boolean;
  locationSource: string;
}

/** Road segment with both coordinate reference systems. */
export interface SegmentRow {
  id: number;
  code: string;
  name: string;
  roadClass: RoadClass;
  speedLimitKmh: number;
  lanes: number;
  lightingScore: number;
  lengthM: number;
  startNodeId: number;
  endNodeId: number;
  midLon: number;
  midLat: number;
  lonLat: Position[];
  utm: Position[];
}

export const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
