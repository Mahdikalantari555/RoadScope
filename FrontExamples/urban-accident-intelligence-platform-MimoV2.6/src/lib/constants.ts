/**
 * Controlled vocabularies, palette tokens and study-area constants.
 * Kept free of I/O so both server and client can import it safely.
 */

export const APP_NAME = "Urban Accident Intelligence";
export const APP_CALLSIGN = "UAI";
export const STUDY_AREA = "Meridian District";

/** All data shipped with this build is synthetic. */
export const SYNTHETIC_NOTICE =
  "Synthetic dataset — generated deterministically. Not real-world accident data.";

export const SEVERITIES = [
  {
    code: "fatal",
    label: "Fatal",
    rank: 1,
    weight: 10,
    colour: "#E5484D",
    definition: "Collision resulting in at least one fatality within 30 days.",
  },
  {
    code: "serious",
    label: "Serious",
    rank: 2,
    weight: 5,
    colour: "#F2762E",
    definition: "Casualty requiring hospitalisation; non-fatal.",
  },
  {
    code: "slight",
    label: "Slight",
    rank: 3,
    weight: 2,
    colour: "#F2A03D",
    definition: "Minor injury treated on scene or as outpatient.",
  },
  {
    code: "damage_only",
    label: "Damage only",
    rank: 4,
    weight: 1,
    colour: "#6E9BC5",
    definition: "Property damage, no reported personal injury.",
  },
] as const;

export type SeverityCode = (typeof SEVERITIES)[number]["code"];

export const CATEGORIES = [
  {
    code: "junction_conflict",
    label: "Junction conflict",
    group: "Intersection",
    description: "Right-of-way conflict at a signalised or priority junction.",
  },
  {
    code: "rear_end",
    label: "Rear-end",
    group: "Longitudinal",
    description: "Front-to-rear collision, typically in queued traffic.",
  },
  {
    code: "sideswipe",
    label: "Sideswipe",
    group: "Lateral",
    description: "Lateral contact between vehicles in adjacent lanes.",
  },
  {
    code: "pedestrian",
    label: "Pedestrian",
    group: "Vulnerable road user",
    description: "Vehicle in contact with a pedestrian.",
  },
  {
    code: "cyclist",
    label: "Cyclist",
    group: "Vulnerable road user",
    description: "Vehicle in contact with a cyclist.",
  },
  {
    code: "single_vehicle",
    label: "Single vehicle",
    group: "Run-off-road",
    description: "Loss of control involving one vehicle only.",
  },
  {
    code: "lane_departure",
    label: "Lane departure",
    group: "Run-off-road",
    description: "Vehicle crosses the centre line or carriageway edge.",
  },
  {
    code: "overturning",
    label: "Overturning",
    group: "Run-off-road",
    description: "Vehicle rolls onto its side or roof.",
  },
  {
    code: "obstacle",
    label: "Struck obstacle",
    group: "Fixed object",
    description: "Collision with street furniture, tree or barrier.",
  },
] as const;

export type CategoryCode = (typeof CATEGORIES)[number]["code"];

export const ROAD_CLASSES = [
  {
    code: "arterial",
    label: "Arterial",
    colour: "#7E6A50",
    widthFactor: 1,
    defaultSpeed: 60,
  },
  {
    code: "collector",
    label: "Collector",
    colour: "#4A4740",
    widthFactor: 0.62,
    defaultSpeed: 45,
  },
  {
    code: "local",
    label: "Local street",
    colour: "#33322E",
    widthFactor: 0.38,
    defaultSpeed: 30,
  },
] as const;

export const WEATHER = [
  "clear",
  "overcast",
  "rain",
  "heavy_rain",
  "fog",
  "snow",
  "sleet",
] as const;

export const LIGHTING = ["daylight", "dusk", "dark_lit", "dark_unlit"] as const;

export const ROAD_SURFACE = ["dry", "wet", "icy", "snow_covered"] as const;

export const REPORT_STATUSES = [
  { code: "pending", label: "Pending review", colour: "#E5C24D" },
  { code: "verified", label: "Verified", colour: "#4FD1C5" },
  { code: "rejected", label: "Rejected", colour: "#E5484D" },
  { code: "duplicate", label: "Duplicate", colour: "#8FA3AF" },
] as const;

/** Study-area bounds (WGS84). The synthetic city is generated inside this box. */
export const STUDY_BOUNDS = {
  minLon: 13.368,
  minLat: 52.4925,
  maxLon: 13.456,
  maxLat: 52.5365,
} as const;

export const DEFAULT_CENTRE: [number, number] = [13.412, 52.5145];

/** Analysis working CRS: local equirectangular metres around the study centre. */
export const METRIC_CRS = "LOCAL-EQD (metres, origin 52.5145 N / 13.4120 E)";
export const TARGET_CRS = "EPSG:4326 (WGS 84)";

export const SEVERITY_BY_CODE = Object.fromEntries(
  SEVERITIES.map((s) => [s.code, s]),
) as Record<SeverityCode, (typeof SEVERITIES)[number]>;

export const CATEGORY_BY_CODE = Object.fromEntries(
  CATEGORIES.map((c) => [c.code, c]),
) as Record<CategoryCode, (typeof CATEGORIES)[number]>;
