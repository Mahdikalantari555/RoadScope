/** Shared analysis parameter/result contracts (API ⇄ engine boundary). */
import type { KernelName, WeightedPoint } from "@/lib/stats/nkde";
import type { ClusterPoint } from "@/lib/stats/ndbscan";
import type { BinUnit } from "@/lib/stats/common";
import type { CompositeWeights, MetricLevel } from "@/lib/stats/risk";
import type { WeightMode } from "@/lib/stats/getisord";
import type { FeatureCollection } from "@/lib/geojson";

export type { ClusterPoint };
export type WeightedPointAlias = WeightedPoint;

export type Method =
  | "nkde"
  | "planar_kde"
  | "nkde_planar_diff"
  | "network_getis_ord"
  | "network_moran"
  | "n_dbscan"
  | "lixel_aggregation"
  | "covariate_cross_comparison"
  | "eb_smoothing"
  | "composite_vulnerability"
  | "ground_truth_benchmark"
  | "simulation";

export const METHODS: Method[] = [
  "nkde",
  "planar_kde",
  "nkde_planar_diff",
  "network_getis_ord",
  "network_moran",
  "n_dbscan",
  "lixel_aggregation",
  "covariate_cross_comparison",
  "eb_smoothing",
  "composite_vulnerability",
  "ground_truth_benchmark",
  "simulation",
];

export interface AnalysisParams {
  level?: MetricLevel;
  /* NKDE / planar */
  bandwidthM?: number;
  kernel?: KernelName;
  edgeCorrection?: boolean;
  splitting?: boolean;
  comparePlanar?: boolean;
  planarBandwidthM?: number;
  /* autocorrelation */
  weightMode?: WeightMode;
  contiguityK?: number;
  permutations?: number;
  alpha?: number;
  seed?: number;
  /* clustering */
  epsilonM?: number;
  minPoints?: number;
  /* aggregation */
  timeBin?: BinUnit;
  covariate?: string;
  /* filters */
  includeGroundTruth?: boolean;
  includeUnverified?: boolean;
  statuses?: string[];
  severities?: string[];
  categories?: string[];
  dateFrom?: string;
  dateTo?: string;
  bbox?: [number, number, number, number];
  weightBy?: "count" | "epdo" | "credibility" | "severity";
  credibilityFloor?: number;
  /* risk */
  compositeWeights?: CompositeWeights;
  topPercent?: number[];
  persist?: boolean;
  benchmarkLayers?: string[];
}

export interface MethodPayload {
  features: FeatureCollection | null;
  stats: Record<string, unknown>;
  benchmark: Record<string, unknown> | null;
  formulation: { title: string; latex: string; notes: string[] };
  sampleSize: number;
  unitCount: number;
}
