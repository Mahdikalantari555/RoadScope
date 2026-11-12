/** Shared domain vocabulary (client + server). */
export const CATEGORIES = [
  { code: "rear_end", label: "Rear-end collision", color: "#60a5fa", description: "Vehicle strikes the rear of another vehicle travelling in the same direction." },
  { code: "angle", label: "Angle / side impact", color: "#f59e0b", description: "Collision between vehicles on crossing paths, typically at intersections." },
  { code: "head_on", label: "Head-on collision", color: "#ef4444", description: "Front-to-front collision between vehicles travelling in opposite directions." },
  { code: "pedestrian", label: "Pedestrian involved", color: "#e879f9", description: "Collision involving at least one pedestrian." },
  { code: "cyclist", label: "Cyclist involved", color: "#34d399", description: "Collision involving at least one cyclist or micromobility user." },
  { code: "single_vehicle", label: "Single vehicle / run-off", color: "#a78bfa", description: "Loss of control, run-off-road or collision with a fixed object." },
  { code: "sideswipe", label: "Sideswipe", color: "#22d3ee", description: "Side-to-side contact between vehicles travelling in parallel." },
  { code: "other", label: "Other", color: "#94a3b8", description: "Any other collision type." },
] as const;

export const SEVERITIES = [
  { code: "pdo", label: "Property damage only", rank: 1, epdoWeight: 1, color: "#8b9bb0" },
  { code: "slight", label: "Slight injury", rank: 2, epdoWeight: 3, color: "#eab308" },
  { code: "serious", label: "Serious injury", rank: 3, epdoWeight: 6, color: "#f97316" },
  { code: "fatal", label: "Fatal", rank: 4, epdoWeight: 12, color: "#e11d48" },
] as const;

export const STATUSES = [
  { code: "reported", label: "Reported (unverified)", color: "#a3a3a3" },
  { code: "verified", label: "Verified", color: "#22c55e" },
  { code: "rejected", label: "Rejected", color: "#ef4444" },
  { code: "duplicate", label: "Duplicate", color: "#8b5cf6" },
] as const;

export const SCENARIOS = [
  { code: "uniform", label: "Uniform (null model)", description: "Length-weighted random locations, flat temporal profile, no environmental or severity effects. Useful to estimate false-positive rates of hotspot methods." },
  { code: "intersection", label: "Intersection-dominated", description: "75% of events clustered around 10 signalised intersections; urban temporal profile." },
  { code: "rushhour", label: "Rush-hour dominated", description: "Exposure-weighted (AADT × length) locations with strong AM/PM commuter peaks and weekend dampening." },
  { code: "mixed", label: "Mixed urban pattern", description: "Exposure, intersection hotspots, an arterial corridor and background noise; rain/fog/snow and darkness effects injected." },
] as const;

export type CategoryCode = (typeof CATEGORIES)[number]["code"];
export type SeverityCode = (typeof SEVERITIES)[number]["code"];
export type StatusCode = (typeof STATUSES)[number]["code"];
export type ScenarioCode = (typeof SCENARIOS)[number]["code"];

export const WEATHER_CONDITIONS = ["dry", "rain", "fog", "snow"] as const;

export const ANALYSIS_METHODS = [
  { code: "kde", label: "Kernel Density Estimation" },
  { code: "gistar", label: "Getis-Ord Gi* hotspots" },
  { code: "dbscan", label: "DBSCAN clustering" },
  { code: "nearest", label: "Nearest-segment assignment" },
  { code: "segments", label: "Road-segment aggregation" },
  { code: "temporal", label: "Temporal aggregation" },
  { code: "environment", label: "Environmental comparison" },
  { code: "pattern", label: "Global pattern diagnostics" },
] as const;
export type AnalysisMethod = (typeof ANALYSIS_METHODS)[number]["code"];

export interface Filters {
  from?: string; // ISO date (inclusive)
  to?: string; // ISO date (inclusive)
  categories?: string[];
  severities?: string[];
  statuses?: string[];
  datasets?: number[];
  hourFrom?: number;
  hourTo?: number;
  weekdays?: number[];
  bbox?: [number, number, number, number]; // lon/lat
}

export const DEFAULT_ANALYSIS_STATUSES = ["verified"];
