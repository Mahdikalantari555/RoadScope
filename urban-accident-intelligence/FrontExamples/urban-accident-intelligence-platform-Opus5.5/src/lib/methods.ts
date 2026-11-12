/** Methodological documentation shown next to every analysis (single source of truth). */
import type { AnalysisMethod } from "./domain";

export interface MethodDoc {
  title: string;
  kind: "descriptive" | "inferential" | "processing";
  input: string;
  output: string;
  summary: string;
  details: string[];
  assumptions: string[];
  references: string[];
}

export const METHOD_DOCS: Record<AnalysisMethod, MethodDoc> = {
  kde: {
    title: "Kernel Density Estimation (planar)",
    kind: "descriptive",
    input: "Verified incident points (EPSG:32633), optional EPDO weights",
    output: "Regular lattice of density values (events/km²) as GeoJSON polygons",
    summary: "Smooths point events into a continuous intensity surface λ̂(s) = Σ wᵢ K(‖s − sᵢ‖/h) / h².",
    details: [
      "Kernels: quartic (biweight, default), Epanechnikov, Gaussian (truncated at 3h). Kernel integrates to 1 so the surface conserves event mass (tested).",
      "Bandwidth h: user-defined or spatial Silverman rule h = 0.9·min(SD, √(1/ln2)·Dm)·n^(−0.2), with SD the standard distance and Dm the median distance to the mean centre.",
      "The surface is masked to a 150 m buffer around the road network to avoid extrapolating into unpopulated space.",
    ],
    assumptions: ["Describes concentration, not significance or risk.", "Planar distance ignores network topology; results depend strongly on h and cell size (MAUP).", "No exposure normalisation."],
    references: ["Silverman (1986) Density Estimation for Statistics and Data Analysis.", "Xie & Yan (2008) Kernel density estimation of traffic accidents in a network space. CEUS 32(5).", "Okabe, Satoh & Sugihara (2009) A kernel density estimation method for networks. IJGIS 23(1)."],
  },
  gistar: {
    title: "Getis–Ord Gi* local hotspot analysis",
    kind: "inferential",
    input: "Counts per lattice cell (study-area-masked, zeros retained) or per road segment (events/km)",
    output: "z-scores, raw p-values, FDR q-values and confidence classes per unit",
    summary: "Gi* = (Σⱼ wᵢⱼxⱼ − x̄Σⱼwᵢⱼ) / (S·√[(nΣⱼwᵢⱼ² − (Σⱼwᵢⱼ)²)/(n−1)]) with binary fixed-distance weights including i.",
    details: [
      "Global Moran's I with 499 conditional permutations is computed first to document global autocorrelation.",
      "Because one test is run per unit, p-values are adjusted with the Benjamini–Hochberg false discovery rate procedure (can be disabled for comparison).",
      "Execution is refused when blocking pre-conditions fail: < 30 units, < 30 events or units without neighbours. Non-blocking warnings: mean neighbours < 8 (normal approximation), non-significant global Moran's I.",
    ],
    assumptions: ["Normal approximation of Gi* requires sufficiently many neighbours.", "Distance band and lattice size influence results (scale dependency / MAUP).", "Counts are not exposure-adjusted — a hotspot of counts may reflect traffic volume."],
    references: ["Getis & Ord (1992) The analysis of spatial association by use of distance statistics. Geogr. Anal. 24(3).", "Ord & Getis (1995) Local spatial autocorrelation statistics. Geogr. Anal. 27(4).", "Caldas de Castro & Singer (2006) Controlling the FDR: a new application to account for multiple and dependent tests in local statistics. Geogr. Anal. 38(2).", "Anselin (1995) Local indicators of spatial association — LISA. Geogr. Anal. 27(2)."],
  },
  dbscan: {
    title: "DBSCAN density-based clustering",
    kind: "descriptive",
    input: "Verified incident points (EPSG:32633)",
    output: "Cluster convex hulls, membership, size, severity composition; noise share; k-distance curve",
    summary: "Groups points with ≥ minPts neighbours within ε metres into clusters; the rest is labelled noise.",
    details: ["Region queries use a uniform grid index (O(n·k)).", "The sorted k-distance curve (k = minPts) is returned to support selecting ε at its 'knee'.", "Convex hulls are cartographic summaries, not cluster boundaries in a statistical sense."],
    assumptions: ["No significance test: clusters can arise under complete spatial randomness at high intensity.", "Single global density threshold; heterogeneous densities may require HDBSCAN/OPTICS."],
    references: ["Ester, Kriegel, Sander & Xu (1996) A density-based algorithm for discovering clusters. KDD-96."],
  },
  nearest: {
    title: "Nearest-road-segment assignment (map-matching)",
    kind: "processing",
    input: "Original reported coordinates (EPSG:4326 → 32633)",
    output: "Snap vectors (reported → network), distance distribution, assignment rate",
    summary: "Orthogonal projection of each report onto the nearest polyline within a tolerance (default 60 m).",
    details: ["A line grid index restricts candidates to nearby segments.", "Reports beyond tolerance remain unassigned and are flagged 'off_network'; 25–60 m are flagged 'low_positional_confidence'.", "Original coordinates are never overwritten (stored separately from validated geometry)."],
    assumptions: ["Assignment to the nearest segment may be wrong at intersections (ambiguity within a few metres of a node)."],
    references: ["Quddus, Ochieng & Noland (2007) Current map-matching algorithms for transport applications. Transp. Res. C 15(5)."],
  },
  segments: {
    title: "Road-segment aggregation",
    kind: "descriptive",
    input: "Verified incidents with segment assignment; road segment lengths",
    output: "Per-segment count, exact Poisson 95% CI, density (events/km/yr), EPDO",
    summary: "Linear-referencing aggregation of incidents to the road network.",
    details: ["Garwood exact Poisson intervals communicate uncertainty for low counts.", "EPDO uses configurable severity weights (default 1/3/6/12 for PDO/slight/serious/fatal — illustrative, not calibrated costs)."],
    assumptions: ["Density on very short segments is unstable.", "Segment definition (node-to-node) affects results."],
    references: ["Hauer (1997) Observational Before–After Studies in Road Safety. Pergamon."],
  },
  temporal: {
    title: "Temporal aggregation",
    kind: "descriptive",
    input: "Verified incident timestamps (UTC → Europe/Vienna local time)",
    output: "Hour, weekday, hour×weekday matrix, monthly series, seasons, χ² uniformity tests",
    summary: "Aggregates events into cyclical and linear time bins and tests departure from temporal uniformity.",
    details: ["χ² goodness-of-fit against a uniform distribution (Wilson–Hilferty approximation of the χ² tail).", "Peak share = proportion in 07–08 h and 16–18 h, compared with 5/24 expected under uniformity."],
    assumptions: ["Uniformity is a naive null: traffic exposure itself is non-uniform in time."],
    references: ["Plug, Xia & Caulfield (2011) Spatial and temporal visualisation techniques for crash analysis. AAP 43(6)."],
  },
  environment: {
    title: "Environmental and road-attribute comparison",
    kind: "inferential",
    input: "Verified incidents, hourly environmental observations, solar geometry, segment attributes, AADT",
    output: "Exposure-normalised rates and Poisson rate ratios with 95% CI",
    summary: "Compares incident rates across conditions, normalising by the time (hours) or network exposure (km·yr, MVkm) of each condition.",
    details: ["Weather exposure = hours observed in each condition within the time window; light exposure from NOAA solar elevation (civil twilight −6°).", "Rate ratios vs a reference level with log-normal Wald CIs.", "For synthetic data, the injected generator effects are displayed alongside estimates to validate the method."],
    assumptions: ["Crude (unadjusted) associations — confounded by time of day, season and traffic volume.", "Single city-wide weather station assumed."],
    references: ["Eisenberg (2004) The mixed effects of precipitation on traffic crashes. AAP 36(4).", "Theofilatos & Yannis (2014) A review of the effect of traffic and weather characteristics on road safety. AAP 72."],
  },
  pattern: {
    title: "Global point-pattern diagnostics",
    kind: "inferential",
    input: "Verified incidents; lattice counts; segment densities",
    output: "Clark–Evans R, Global Moran's I, Gini/Lorenz of segment densities, mean centre & standard distance",
    summary: "Characterises whether incidents are clustered overall and how concentrated they are on the network.",
    details: ["Clark–Evans R = observed / expected mean nearest-neighbour distance under planar CSR (area = masked study area).", "Lorenz curve of incidents vs cumulative network length (segments sorted by density) and share on top 5% of length."],
    assumptions: ["Planar CSR is not the correct null for network-constrained events; R < 1 is expected even for network-random events. Prefer network K-functions for inference."],
    references: ["Clark & Evans (1954) Distance to nearest neighbor as a measure of spatial relationships. Ecology 35(4).", "Yamada & Thill (2004) Comparison of planar and network K-functions in traffic accident analysis. J. Transp. Geogr. 12(2)."],
  },
};

export const RISK_DOC = {
  title: "Transparent road-segment risk assessment",
  points: [
    "Observed frequency N with exact Poisson CI; density N/(L·T); exposure rate N/(AADT·365·T·L/10⁶) per million vehicle-km.",
    "Empirical Bayes (method of moments): reference groups by road class, μᵢ = λ_g·Eᵢ with Eᵢ = L·T (or vehicle-km), overdispersion φ_g = max(0, Σ[(N−μ)² − N]/Σμ²), weight w = 1/(1+φμ), EB = wμ + (1−w)N. Potential for safety improvement PSI = EB − μ.",
    "Relative Risk Index = Σ wₖ·Pₖ, where Pₖ are mid-rank percentiles of indicators (frequency [EB density], severity [EPDO density], exposure rate, road design prior [speed, lanes, lighting], environment [shrunk share in adverse/dark conditions]). Weights are user-defined and renormalised.",
    "Rank uncertainty: 300 Monte Carlo draws from the Gamma posterior of each segment's mean (EB) or Jeffreys Gamma(N+½) → 90% rank interval and P(segment in top-K).",
    "The index is ordinal and uncalibrated: it is not a probability of accident occurrence and carries no predictive validity claim without independent validation.",
  ],
  references: ["Hauer, Harwood, Council & Griffith (2002) Estimating safety by the Empirical Bayes method. TRR 1784.", "AASHTO (2010) Highway Safety Manual, Part B (network screening).", "Elvik (2008) A survey of operational definitions of hazardous road locations. AAP 40(6).", "Cheng & Washington (2005) Experimental evaluation of hotspot identification methods. AAP 37(5)."],
};
