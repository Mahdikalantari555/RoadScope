/**
 * Typed contracts for the REST API. Shared by route handlers and client components.
 */
import type {
  AccidentStatus,
  AnalysisType,
  BBox,
  CategoryCode,
  DatasetKind,
  GeoFeatureCollection,
  RoadClass,
  ScenarioId,
} from "./domain";

export interface SessionUser {
  id: number;
  email: string;
  displayName: string;
  role: "admin" | "user";
}

export interface MetaResponse {
  study: {
    id: string;
    name: string;
    disclaimer: string;
    timeZone: string;
    center: { lon: number; lat: number };
    coverageBBox: BBox;
    utmEpsg: number;
  };
  categories: { code: CategoryCode; label: string; description: string; colorHex: string }[];
  severities: { id: number; code: string; label: string; weight: number; colorHex: string; description: string }[];
  statuses: AccidentStatus[];
  scenarios: { id: ScenarioId; label: string; description: string }[];
  roadClasses: { id: RoadClass; label: string; speedKmh: number; lanes: number; colorHex: string; width: number }[];
  qualityFlags: { code: string; label: string }[];
  user: SessionUser | null;
}

export interface DatasetInfo {
  id: number;
  code: string;
  name: string;
  kind: DatasetKind;
  isSynthetic: boolean;
  scenario: string | null;
  seed: number | null;
  description: string;
  isActive: boolean;
  recordCount: number;
  createdAt: string;
  statusCounts: Record<AccidentStatus, number>;
  metadata: Record<string, unknown>;
  isNetwork: boolean;
}

export interface AccidentListItem {
  id: number;
  publicId: string;
  status: AccidentStatus;
  occurredAt: string;
  reportedAt: string;
  categoryCode: CategoryCode;
  categoryLabel: string;
  severityId: number;
  severityLabel: string;
  severityWeight: number;
  vehiclesInvolved: number;
  emergencyServices: boolean;
  lon: number;
  lat: number;
  datasetId: number;
  datasetName: string;
  datasetKind: DatasetKind;
  isSynthetic: boolean;
  nearestSegmentId: number | null;
  nearestSegmentName: string | null;
  snapDistanceM: number | null;
  reportingDelayMin: number;
  locationSource: string;
  qualityFlags: string[];
  duplicateOfId: number | null;
  duplicateCandidateId: number | null;
  duplicateScore: number | null;
  yearLocal: number;
  monthLocal: number;
  dowLocal: number;
  hourLocal: number;
}

export interface VerificationEntry {
  id: number;
  action: string;
  previousStatus: AccidentStatus | null;
  newStatus: AccidentStatus | null;
  note: string;
  changes: Record<string, unknown>;
  reviewerEmail: string | null;
  createdAt: string;
}

export interface AccidentDetail extends AccidentListItem {
  reportedLon: number;
  reportedLat: number;
  reportedAccuracyM: number | null;
  xM: number;
  yM: number;
  /** Free-text narrative: visible to administrators and to the submitter (tracking code). */
  description: string | null;
  trackingCode: string | null;
  attachments: { id: number; filename: string; mimeType: string; byteSize: number; createdAt: string }[];
  verifications: VerificationEntry[] | null;
  duplicateCandidate: AccidentListItem | null;
}

export interface DuplicateCandidate {
  id: number;
  status: AccidentStatus;
  occurredAt: string;
  categoryCode: CategoryCode;
  distanceM: number;
  deltaMinutes: number;
  score: number;
}

export interface ReportResult {
  id: number;
  publicId: string;
  trackingCode: string;
  status: AccidentStatus;
  nearestSegment: { id: number; name: string; distanceM: number } | null;
  duplicateCandidates: DuplicateCandidate[];
  locationSource: string;
}

export interface TrackResult {
  trackingCode: string;
  status: AccidentStatus;
  occurredAt: string;
  reportedAt: string;
  categoryLabel: string;
  severityLabel: string;
  history: { action: string; newStatus: AccidentStatus | null; createdAt: string }[];
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SegmentStatsRow {
  segmentId: number;
  name: string;
  roadClass: RoadClass;
  lengthM: number;
  count: number;
  severityWeight: number;
  perKm: number;
  severityPerKm: number;
  aadt: number | null;
}

export interface SegmentDetail {
  segment: {
    id: number;
    code: string;
    name: string;
    roadClass: RoadClass;
    speedLimitKmh: number;
    lanes: number;
    lightingScore: number;
    lengthM: number;
    aadt: number | null;
  };
  stats: {
    count: number;
    severityWeight: number;
    perKm: number;
    severityPerKm: number;
    meanSeverity: number | null;
    byCategory: { code: CategoryCode; label: string; count: number }[];
    bySeverity: { id: number; label: string; count: number }[];
    byHour: { hour: number; count: number }[];
  };
  recent: AccidentListItem[];
}

export interface DashboardStats {
  scope: {
    records: number;
    byStatus: Record<AccidentStatus, number>;
    syntheticShare: number;
    datasets: number;
    years: number[];
    statusesIncluded: AccidentStatus[];
  };
  severity: { id: number; label: string; count: number; weight: number; colorHex: string }[];
  categories: { code: CategoryCode; label: string; count: number; colorHex: string }[];
  monthly: { key: string; count: number; severityWeight: number }[];
  hourly: { hour: number; count: number }[];
  dayOfWeek: { dow: number; label: string; count: number }[];
  monthOfYear: { month: number; label: string; count: number }[];
  seasonal: { season: "DJF" | "MAM" | "JJA" | "SON"; label: string; count: number }[];
  topSegments: SegmentStatsRow[];
  concentration: {
    cellSizeM: number;
    occupiedCells: number;
    top10PctShare: number;
    lorenz: [number, number][];
  };
  reportingDelay: { medianMin: number | null; p90Min: number | null };
}

export interface QualityReport {
  generatedAt: string;
  totals: Record<AccidentStatus, number> & { all: number; syntheticShare: number };
  completeness: { description: number; coordinates: number; vehicles: number; timestamps: number };
  flags: Record<string, number>;
  reportingDelay: { medianMin: number | null; p90Min: number | null };
  verificationRate: number | null;
  positionalAccuracy: { medianM: number | null; p90M: number | null; sample: number };
  activityByDay: { date: string; reports: number }[];
  duplicateCandidates: number;
}

export interface Methodology {
  title: string;
  represents: string;
  method: string;
  assumptions: { id: string; label: string; passed: boolean | null; detail: string }[];
  limitations: string[];
}

export type TableCell = string | number | boolean | null;

export interface AnalysisResultView {
  kind: AnalysisType;
  featureCollection: GeoFeatureCollection | null;
  summary: Record<string, TableCell>;
  table: Record<string, TableCell>[];
  methodology: Methodology;
  notes: string[];
}

export interface JobView {
  id: string;
  analysisType: AnalysisType;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  progressMessage: string;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  cached: boolean;
  params: Record<string, unknown>;
  filters: Record<string, unknown>;
  result: AnalysisResultView | null;
}

export interface DatasetGenerationResult {
  dataset: DatasetInfo;
  accidentsInserted: number;
  injected: { duplicates: number; inaccurate: number };
}

export interface ImportResult {
  dataset: DatasetInfo;
  accepted: number;
  rejected: { index: number; reason: string }[];
}

export interface AuditEntryView {
  id: number;
  action: string;
  entityType: string;
  entityId: string | null;
  actorEmail: string | null;
  changes: Record<string, unknown>;
  createdAt: string;
}
