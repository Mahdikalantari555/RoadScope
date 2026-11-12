/** Shared domain types — used by API handlers, geospatial engine and UI. */

import type { CategoryCode, SeverityCode } from "./constants";

export type { CategoryCode, SeverityCode };

export type ReportStatus = "pending" | "verified" | "rejected" | "duplicate";
export type UserRole = "administrator" | "contributor";
export type RoadClass = "arterial" | "collector" | "local";

export interface Accident {
  id: number;
  publicId: string;
  categoryCode: CategoryCode;
  categoryLabel: string;
  categoryGroup: string;
  severityCode: SeverityCode;
  severityLabel: string;
  severityWeight: number;
  roadSegmentId: number | null;
  roadSegmentCode: string | null;
  streetName: string | null;
  lon: number;
  lat: number;
  reportedLon: number;
  reportedLat: number;
  positionalAccuracyM: number;
  geocodePrecision: "pin" | "address" | "street" | "approximate";
  occurredAt: string;
  reportedAt: string;
  reportDelayH: number;
  vehicles: number;
  casualties: number;
  description: string | null;
  emergencyServices: boolean;
  status: ReportStatus;
  duplicateOfId: number | null;
  rejectReason: string | null;
  reporterHandle: string | null;
  isSynthetic: boolean;
  datasetSourceId: number | null;
  lighting: string;
  weather: string;
  roadSurface: string;
  district: string;
  attachmentCount: number;
}

export interface RoadSegment {
  id: number;
  segmentCode: string;
  streetName: string;
  roadClass: RoadClass;
  district: string;
  lengthM: number;
  bearingDeg: number;
  speedLimitKph: number;
  lanes: number;
  lighting: string;
  surface: string;
  hasJunctionControl: boolean;
  hasCycleLane: boolean;
  centroidLon: number;
  centroidLat: number;
  coordinates: [number, number][];
  /** Populated by the risk engine. */
  accidentCount?: number;
  severityWeightedIndex?: number;
  riskIndex?: number;
  exposureCoverage?: number;
}

export interface TrafficObservation {
  roadSegmentId: number;
  hourOfDay: number;
  dayType: string;
  volumeVehPerHour: number;
  avgSpeedKph: number;
  aadt: number | null;
  congestionIndex: number;
  coverageRatio: number;
}

export interface DatasetSource {
  id: number;
  slug: string;
  name: string;
  kind: string;
  isSynthetic: boolean;
  description: string;
  licence: string;
  generatorVersion: string | null;
  randomSeed: number | null;
  recordCount: number;
  coverageStart: string | null;
  coverageEnd: string | null;
}

export interface AuditLogEntry {
  id: number;
  actorUserId: number | null;
  actorRole: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  detail: unknown;
  createdAt: string;
}

export interface AccidentFilters {
  from?: string;
  to?: string;
  categories?: CategoryCode[];
  severities?: SeverityCode[];
  statuses?: ReportStatus[];
  roadClass?: RoadClass[];
  minVehicles?: number;
  emergencyOnly?: boolean;
  bbox?: [number, number, number, number];
  district?: string;
  text?: string;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// --- Geospatial analysis results -------------------------------------------

export interface GridCell {
  /** cell index x (column) */
  i: number;
  /** cell index y (row) */
  j: number;
  lon: number;
  lat: number;
  value: number;
  count: number;
  /** Getis-Ord Gi* */
  zScore?: number;
  pValue?: number;
  fdrThreshold?: number;
  significant?: boolean;
  /** neighbours used in the local statistic */
  neighbourCount?: number;
}

export interface AnalysisGrid {
  cellSizeM: number;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  nx: number;
  ny: number;
  cells: GridCell[];
  statistics: Record<string, number>;
}

export interface ClusterResult {
  clusterId: number;
  pointIds: number[];
  lon: number;
  lat: number;
  size: number;
  centroidLon: number;
  centroidLat: number;
  radiusM: number;
  severityMix: Record<string, number>;
}

export interface DbscanResult {
  clusters: ClusterResult[];
  noise: number[];
  labels: number[];
  params: { epsM: number; minPts: number };
  statistics: Record<string, number>;
}

export interface GiStarResult {
  grid: AnalysisGrid;
  params: { bandM: number; cellSizeM: number; fdr: boolean };
  statistics: Record<string, number>;
  assumptions?: AssumptionCheck[];
}

export interface AssumptionCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface RiskFactor {
  key: string;
  label: string;
  weight: number;
  description: string;
  unit: string;
}

export interface SegmentRisk extends RoadSegment {
  factors: Record<string, number>;
  riskIndex: number;
  riskRank: number;
  exposureCoverage: number;
  uncertainty: number;
}

export interface RiskResult {
  segments: SegmentRisk[];
  factors: RiskFactor[];
  statistics: Record<string, number>;
  coverage: {
    segmentCoverageRatio: number;
    trafficCoverageRatio: number;
    positionalAccuracyMedian: number;
    verifiedRatio: number;
    temporalSpanDays: number;
    caveats: string[];
  };
}

// --- GeoJSON ---------------------------------------------------------------

export type Position = [number, number];

export interface GeoJsonFeature {
  type: "Feature";
  id?: number | string;
  geometry:
    | { type: "Point"; coordinates: Position }
    | { type: "LineString"; coordinates: Position[] }
    | { type: "Polygon"; coordinates: Position[][] };
  properties: Record<string, unknown>;
}

export interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}
