/**
 * Analysis catalogue: parameter schemas, interpretive texts and limitations. Drives both the
 * UI parameter forms and server-side validation, so the two cannot drift apart.
 */
import type { AnalysisType } from "./domain";

export type ParamDef =
  | { key: string; label: string; kind: "number"; min: number; max: number; step: number; default: number; unit?: string; help?: string }
  | { key: string; label: string; kind: "select"; options: { value: string; label: string }[]; default: string; help?: string };

export interface AnalysisDef {
  type: AnalysisType;
  label: string;
  short: string;
  represents: string;
  method: string;
  limitations: string[];
  params: ParamDef[];
}

export const ANALYSIS_DEFS: Record<AnalysisType, AnalysisDef> = {
  kde: {
    type: "kde",
    label: "Kernel density estimation",
    short: "KDE",
    represents:
      "A smoothed surface of recorded-incident intensity (events per km²). It shows where incidents concentrate in continuous space, not where risk is highest once traffic exposure is considered.",
    method:
      "Bivariate kernel density with bandwidth h. Quartic kernel K(u)=(3/π)(1−u²)² for u≤1, or Gaussian with σ=h truncated at 3h. Density λ̂(s)=Σᵢ K(‖s−sᵢ‖/h)/h², evaluated on a regular grid in EPSG:32633 and masked to within 250 m of the road network.",
    limitations: [
      "Describes the concentration of recorded incidents, not risk: no traffic-volume (exposure) correction.",
      "The bandwidth controls the visual scale of the surface; compare several bandwidths before interpreting.",
      "Reporting bias: unreported or unverified incidents are absent or under-represented.",
    ],
    params: [
      { key: "bandwidthM", label: "Bandwidth", kind: "number", min: 100, max: 1000, step: 25, default: 300, unit: "m" },
      { key: "cellSizeM", label: "Grid cell", kind: "number", min: 50, max: 250, step: 25, default: 100, unit: "m" },
      {
        key: "kernel",
        label: "Kernel",
        kind: "select",
        options: [
          { value: "quartic", label: "Quartic (compact support)" },
          { value: "gaussian", label: "Gaussian (truncated 3h)" },
        ],
        default: "quartic",
      },
    ],
  },
  gistar: {
    type: "gistar",
    label: "Getis-Ord Gi* hotspot analysis",
    short: "Gi*",
    represents:
      "Locally significant clusters of high (hot) or low (cold) incident counts on a fishnet, relative to the study-area average. Only cells that survive false-discovery-rate control are classified as hotspots.",
    method:
      "Getis & Ord (1995) Gi* with binary distance-band weights including the focal cell. z-scores under randomisation; two-sided normal p-values; Benjamini–Hochberg FDR across cells. Analysis is skipped with an explicit message when assumptions fail.",
    limitations: [
      "Requires adequate sample size and neighbourhoods; see the assumption checks.",
      "Counts are not exposure-normalised: a hotspot can reflect traffic volume rather than unusual risk.",
      "Results depend on the fishnet and distance band (modifiable areal unit problem).",
    ],
    params: [
      { key: "neighborhoodM", label: "Distance band", kind: "number", min: 100, max: 1000, step: 25, default: 250, unit: "m" },
      { key: "cellSizeM", label: "Fishnet cell", kind: "number", min: 50, max: 250, step: 25, default: 100, unit: "m" },
      {
        key: "alpha",
        label: "Max. significance tier",
        kind: "select",
        options: [
          { value: "0.01", label: "99% (α = 0.01)" },
          { value: "0.05", label: "95% (α = 0.05)" },
          { value: "0.1", label: "90% (α = 0.10)" },
        ],
        default: "0.05",
      },
    ],
  },
  dbscan: {
    type: "dbscan",
    label: "DBSCAN spatial clustering",
    short: "DBSCAN",
    represents:
      "Dense groups of incidents: each cluster is a set of incidents density-connected within ε metres, containing at least minPts incidents. Unclustered incidents are labelled noise.",
    method:
      "Ester et al. (1996) density-based clustering on EPSG:32633 coordinates with a grid-accelerated range query. Each cluster is summarised by its convex hull and severity-weighted index.",
    limitations: [
      "Cluster count and extent are sensitive to ε and minPts; test sensitivity.",
      "Clusters are descriptive groupings, not statistically tested hotspots.",
      "The temporal dimension is not used in this method.",
    ],
    params: [
      { key: "epsM", label: "Neighbourhood ε", kind: "number", min: 20, max: 500, step: 5, default: 120, unit: "m" },
      { key: "minPts", label: "Minimum points", kind: "number", min: 3, max: 50, step: 1, default: 8 },
    ],
  },
  segment_aggregation: {
    type: "segment_aggregation",
    label: "Road-segment aggregation",
    short: "Segments",
    represents:
      "Incidents assigned to their nearest road segment and aggregated per segment: counts, per-kilometre densities, severity-weighted indices and exposure rates where traffic counts exist.",
    method:
      "Nearest-segment snapping by point-to-polyline distance in EPSG:32633 (snap distance stored per incident). Global Moran's I over segment adjacency (shared junction nodes, row-standardised) with a permutation test.",
    limitations: [
      "Positional error (GPS accuracy, geocoding) can assign incidents to a neighbouring street at junctions.",
      "Long segments accumulate more incidents; compare per-kilometre or exposure-based rates.",
      "Moran's I on sparse counts is interpreted cautiously.",
    ],
    params: [
      {
        key: "moranPermutations",
        label: "Moran permutations",
        kind: "select",
        options: [
          { value: "99", label: "99" },
          { value: "199", label: "199" },
          { value: "499", label: "499" },
        ],
        default: "199",
      },
    ],
  },
  spatial_comparison: {
    type: "spatial_comparison",
    label: "Environmental comparison",
    short: "Environment",
    represents:
      "Associations between incident density and environmental or road covariates (lighting, speed limit, traffic exposure), and incident rates in wet versus dry hours.",
    method:
      "Spearman rank correlation of per-segment density with each covariate, quartile-stratified rates, and wet/dry rate ratio with a log-normal confidence interval. Wet hours are defined by hourly station precipitation above the threshold.",
    limitations: [
      "Correlational. Confounding by road class, exposure and time of day is likely.",
      "Weather is station-level and hourly; incidents are matched to the hour, not to the minute.",
    ],
    params: [
      { key: "wetThresholdMm", label: "Wet-hour threshold", kind: "number", min: 0.1, max: 2, step: 0.1, default: 0.2, unit: "mm/h" },
    ],
  },
  risk: {
    type: "risk",
    label: "Transparent relative risk index",
    short: "Risk index",
    represents:
      "A weighted, normalised composite of frequency, density, severity, exposure and environmental indicators per road segment. It is a relative ranking aid on a 0–100 scale, not a probability of collision.",
    method:
      "Each indicator is percentile-normalised across segments (or min–max); the score is the weighted mean of available indicators ×100. Uncertainty is shown as a Poisson 95% interval on the observed count, and coverage as the share of configured weight with data.",
    limitations: [
      "Not a calibrated accident probability, and not validated against independent outcomes.",
      "Rankings are sensitive to the chosen weights; inspect the sensitivity of the top-ranked segments.",
      "Segments with few recorded incidents carry high uncertainty even when their score is high.",
    ],
    params: [
      { key: "wCount", label: "Weight · frequency", kind: "number", min: 0, max: 1, step: 0.05, default: 0.15 },
      { key: "wDensity", label: "Weight · density", kind: "number", min: 0, max: 1, step: 0.05, default: 0.2 },
      { key: "wSeverity", label: "Weight · severity", kind: "number", min: 0, max: 1, step: 0.05, default: 0.25 },
      { key: "wExposure", label: "Weight · exposure", kind: "number", min: 0, max: 1, step: 0.05, default: 0.2 },
      { key: "wDarkness", label: "Weight · darkness", kind: "number", min: 0, max: 1, step: 0.05, default: 0.1 },
      { key: "wSpeed", label: "Weight · speed limit", kind: "number", min: 0, max: 1, step: 0.05, default: 0.1 },
      {
        key: "normalization",
        label: "Normalisation",
        kind: "select",
        options: [
          { value: "percentile", label: "Percentile rank" },
          { value: "minmax", label: "Min–max" },
        ],
        default: "percentile",
      },
    ],
  },
};

export function defaultParamValues(type: AnalysisType): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const p of ANALYSIS_DEFS[type].params) out[p.key] = p.default;
  return out;
}
