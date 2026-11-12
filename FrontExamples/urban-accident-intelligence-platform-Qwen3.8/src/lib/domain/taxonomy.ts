/** Domain-controlled vocabularies: severity, taxonomy, environment, personas. */

export interface SeverityDef {
  code: string;
  label: string;
  rank: number;
  epdoWeight: number;
  injuryWeight: number;
  color: string;
  sortOrder: number;
}

export const SEVERITIES: SeverityDef[] = [
  { code: "fatal", label: "Fatal (K)", rank: 5, epdoWeight: 120, injuryWeight: 1, color: "#d81b60", sortOrder: 0 },
  { code: "serious_injury", label: "Serious injury (A)", rank: 4, epdoWeight: 26, injuryWeight: 0.62, color: "#fb8c00", sortOrder: 1 },
  { code: "minor_injury", label: "Minor injury (B/C)", rank: 3, epdoWeight: 6.2, injuryWeight: 0.24, color: "#fdd835", sortOrder: 2 },
  { code: "property_damage", label: "Property damage only (PDO)", rank: 2, epdoWeight: 1, injuryWeight: 0, color: "#42a5f5", sortOrder: 3 },
  { code: "near_miss", label: "Near miss / conflict", rank: 1, epdoWeight: 0.22, injuryWeight: 0, color: "#78909c", sortOrder: 4 },
];

export interface CategoryDef {
  code: string;
  label: string;
  description: string;
  reportingPropensity: number;
  sortOrder: number;
  /** Prior probability that this taxonomy occurs at/near an intersection. */
  intersectionAffinity: number;
  severityMix: number[];
}

export const CATEGORIES: CategoryDef[] = [
  { code: "rear_end", label: "Rear-end collision", description: "Longitudinal impact, typically queue or braking related.", reportingPropensity: 0.95, sortOrder: 0, intersectionAffinity: 0.72, severityMix: [0.004, 0.05, 0.19, 0.7, 0.056] },
  { code: "right_angle", label: "Right-angle / side impact", description: "Crossing conflict at a signalised or stop-controlled node.", reportingPropensity: 1.15, sortOrder: 1, intersectionAffinity: 0.95, severityMix: [0.02, 0.16, 0.31, 0.48, 0.03] },
  { code: "sideswipe", label: "Sideswipe", description: "Lateral contact during lane change or overtaking.", reportingPropensity: 0.8, sortOrder: 2, intersectionAffinity: 0.34, severityMix: [0.001, 0.02, 0.11, 0.82, 0.049] },
  { code: "pedestrian_struck", label: "Pedestrian struck", description: "Vulnerable road user conflict, often at crossings.", reportingPropensity: 1.45, sortOrder: 3, intersectionAffinity: 0.88, severityMix: [0.06, 0.28, 0.36, 0.27, 0.03] },
  { code: "cyclist_struck", label: "Cyclist struck", description: "Cycle-user conflict, kerbside or crossing manoeuvre.", reportingPropensity: 1.3, sortOrder: 4, intersectionAffinity: 0.8, severityMix: [0.03, 0.21, 0.4, 0.33, 0.03] },
  { code: "single_vehicle", label: "Single vehicle run-off", description: "Loss of control leaving the carriageway.", reportingPropensity: 0.85, sortOrder: 5, intersectionAffinity: 0.18, severityMix: [0.02, 0.13, 0.3, 0.5, 0.05] },
  { code: "rollover", label: "Rollover", description: "Vehicle overturning, high energy.", reportingPropensity: 1.5, sortOrder: 6, intersectionAffinity: 0.12, severityMix: [0.07, 0.25, 0.31, 0.34, 0.03] },
  { code: "fixed_object", label: "Fixed object impact", description: "Collision with street furniture, barrier or pole.", reportingPropensity: 0.9, sortOrder: 7, intersectionAffinity: 0.3, severityMix: [0.02, 0.12, 0.28, 0.55, 0.03] },
];

export const WEATHER_CODES = [
  { code: "clear", label: "Clear", risk: 1, share: 0.55 },
  { code: "rain_light", label: "Light rain", risk: 1.28, share: 0.22 },
  { code: "rain_heavy", label: "Heavy rain", risk: 1.62, share: 0.1 },
  { code: "fog", label: "Fog / low visibility", risk: 1.48, share: 0.05 },
  { code: "snow", label: "Snow", risk: 1.85, share: 0.05 },
  { code: "ice", label: "Ice / black ice", risk: 2.25, share: 0.03 },
];

export const LIGHTING_CODES = [
  { code: "daylight", label: "Daylight", risk: 1, share: 0.62 },
  { code: "dusk", label: "Dawn / dusk", risk: 1.22, share: 0.1 },
  { code: "night_lit", label: "Darkness, lit", risk: 1.15, share: 0.22 },
  { code: "night_unlit", label: "Darkness, unlit", risk: 1.68, share: 0.06 },
];

export const TRAFFIC_STATES = ["free_flow", "dense", "congested", "queue", "unknown"] as const;
export const SURFACE_STATES = ["dry", "wet", "snow", "ice", "unknown"] as const;

export interface PersonaDef {
  email: string;
  displayName: string;
  role:
    | "simulation_scientist"
    | "citizen_reporter"
    | "data_steward"
    | "researcher"
    | "safety_engineer"
    | "mobility_analyst"
    | "administrator";
  permissions: string[];
  synthetic: boolean;
}

export const PERSONAS: PersonaDef[] = [
  { email: "simulator@uai.lab", displayName: "Dr. A. Simulation Scientist", role: "simulation_scientist", permissions: ["dataset:read", "dataset:write", "simulate:run", "ground_truth:read"], synthetic: false },
  { email: "steward@uai.lab", displayName: "M. Geospatial Data Steward", role: "data_steward", permissions: ["dataset:read", "report:read", "report:verify", "report:merge", "report:reject", "audit:read"], synthetic: false },
  { email: "researcher@uai.lab", displayName: "Dr. R. GIScience Researcher", role: "researcher", permissions: ["dataset:read", "report:read", "analysis:run", "analysis:export", "ground_truth:read"], synthetic: false },
  { email: "engineer@uai.lab", displayName: "T. Transportation Safety Engineer", role: "safety_engineer", permissions: ["dataset:read", "report:read", "analysis:run", "risk:read", "risk:configure"], synthetic: false },
  { email: "analyst@uai.lab", displayName: "U. Urban Mobility Analyst", role: "mobility_analyst", permissions: ["dataset:read", "report:read", "analysis:run", "risk:read", "export:read"], synthetic: false },
  { email: "admin@uai.lab", displayName: "Platform Administrator", role: "administrator", permissions: ["*"], synthetic: false },
  { email: "citizen@uai.city", displayName: "Citizen Reporter (public)", role: "citizen_reporter", permissions: ["report:create", "report:read_own"], synthetic: false },
];

export const CITIZEN_NAMES = [
  "Witness #A112", "Witness #B043", "Witness #C771", "Witness #D209", "Witness #E516",
  "Witness #F034", "Witness #G688", "Witness #H127", "Witness #I945", "Witness #J360",
  "Witness #K712", "Witness #L058",
];

export function severityByCode(code: string): SeverityDef {
  return SEVERITIES.find((s) => s.code === code) ?? SEVERITIES[3];
}

export function categoryByCode(code: string): CategoryDef {
  return CATEGORIES.find((c) => c.code === code) ?? CATEGORIES[0];
}

export function epdoWeight(code: string): number {
  return severityByCode(code).epdoWeight;
}
