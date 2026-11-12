export type WorkspaceMode =
  | 'analytics'
  | 'spatial_lab'
  | 'risk_eb'
  | 'citizen_vgi'
  | 'stewardship'
  | 'simulator';

export type PersonaRole =
  | 'mobility_analyst'
  | 'gis_researcher'
  | 'safety_engineer'
  | 'citizen_reporter'
  | 'data_steward'
  | 'simulation_scientist';

export type MapOverlayMode =
  | 'incidents'
  | 'nkde'
  | 'planar_kde'
  | 'planar_bias'
  | 'true_lambda'
  | 'gi_star'
  | 'ndbscan'
  | 'risk_raw_n'
  | 'risk_linear_density'
  | 'risk_epdo'
  | 'risk_mvkt'
  | 'risk_eb_expected'
  | 'risk_psi'
  | 'risk_mcda'
  | 'risk_bivariate_uncertainty';

export type MapInteractionTool = 'inspect' | 'box_select' | 'poly_select' | 'vgi_pin';

export interface DatasetSource {
  id: number;
  name: string;
  scenario_key: string;
  is_synthetic: boolean;
  crs_epsg: number;
  lixel_resolution_m: number;
  study_period_years: number;
  random_seed: number;
  description: string;
  is_active: boolean;
  created_at_utc: string;
  generator_params: Record<string, unknown>;
}

export interface CategoryMeta {
  id: number;
  code: string;
  label: string;
  description: string;
}

export interface SeverityMeta {
  id: number;
  code: string;
  rank: number;
  label: string;
  epdo_weight: number;
  color_hex: string;
}

export interface PersonaUser {
  id: number;
  username: string;
  full_name: string;
  role: PersonaRole;
  trust_weight: number;
}

export interface ScenarioSpec {
  key: 'MULTI_COVARIATE_URBAN' | 'INTERSECTION_CLUSTERED' | 'DIURNAL_RUSH_HOUR_SHOCK' | 'UNIFORM_BASELINE';
  title: string;
  description: string;
}

export interface PlatformMeta {
  canonical_crs: string;
  canonical_crs_name: string;
  web_crs: string;
  study_area: string;
  center_4326: [number, number];
  active_dataset: DatasetSource;
  datasets: DatasetSource[];
  categories: CategoryMeta[];
  severities: SeverityMeta[];
  personas: PersonaUser[];
  scenarios: ScenarioSpec[];
  context_geojson: GeoJSON.FeatureCollection;
}

export interface NetworkLayersPayload {
  segments_geojson: GeoJSON.FeatureCollection;
  nodes_geojson: GeoJSON.FeatureCollection;
  lixels_geojson: GeoJSON.FeatureCollection;
}

export interface CmvFilterState {
  verification_mode: 'verified_only' | 'all_active' | 'vgi_queue';
  start_utc: string | null;
  end_utc: string | null;
  severity_codes: string[];
  category_codes: string[];
  dow_filter: number | null;
  hour_filter: number | null;
  segment_id: number | null;
  bbox_4326: [number, number, number, number] | null;
  polygon_4326: [number, number][] | null;
}

export interface CmvStatePayload {
  kpis: {
    filtered_incidents: number;
    total_epdo: number;
    ksi_severe_fatal_count: number;
    ksi_share_pct: number;
    mean_credibility: number;
    mean_snap_drift_m: number;
  };
  weekly_series: {
    week_start: string;
    total_count: number;
    selected_count: number;
  }[];
  diurnal_matrix: number[][];
  severity_breakdown: {
    code: string;
    label: string;
    rank: number;
    color: string;
    count: number;
    epdo_sum: number;
  }[];
  taxonomy_breakdown: {
    code: string;
    label: string;
    count: number;
    epdo_sum: number;
  }[];
  top_segments: {
    segment_id: number;
    name: string;
    road_class: string;
    length_m: number;
    count: number;
    epdo_sum: number;
    ksi_count: number;
    density_per_km: number;
    epdo_per_km: number;
  }[];
  incidents_geojson: GeoJSON.FeatureCollection;
  vgi_displacement_geojson: GeoJSON.FeatureCollection;
  vgi_uncertainty_geojson: GeoJSON.FeatureCollection;
}

export interface GroundTruthMetrics {
  pai: number;
  hit_rate_pct: number;
  network_coverage_pct: number;
  rri: number;
  rmse_per_km_yr: number;
  nrmse: number;
  spearman_rho: number;
}

export interface SnapCandidate {
  rank: number;
  segment_id: number;
  edge_code: string;
  segment_name: string;
  road_class: string;
  elevation_level: number;
  speed_limit_kmh: number;
  lixel_id: number | null;
  linear_offset_m: number;
  segment_length_m: number;
  orthogonal_dist_m: number;
  snapped_x_m: number;
  snapped_y_m: number;
  snapped_lon: number;
  snapped_lat: number;
  spatial_likelihood: number;
  class_prior: number;
  topo_factor: number;
  snap_probability: number;
  is_naive_euclidean_nearest: boolean;
  topological_override: boolean;
}

export interface ConflationAlert {
  accident_id: number;
  verification_status: string;
  source_type: string;
  occurred_at_utc: string;
  segment_id: number;
  segment_name: string;
  linear_offset_m: number;
  network_distance_m: number;
  time_diff_min: number;
  spatiotemporal_kernel_score: number;
  category_code: string;
  category_label: string;
  severity_code: string;
  severity_label: string;
  severity_color: string;
  vgi_credibility_score: number;
  witness_count: number;
  snapped_lon: number;
  snapped_lat: number;
  narrative: string;
}

export interface RiskCorridorRow {
  priority_rank: number;
  segment_id: number;
  edge_code: string;
  name: string;
  road_class: string;
  elevation_level: number;
  length_m: number;
  speed_limit_kmh: number;
  sinuosity: number;
  aadt: number;
  aadt_is_imputed: boolean;
  exposure_confidence: number;
  raw_crash_frequency: number;
  unverified_vgi_count: number;
  linear_crash_density_per_km: number;
  epdo_total: number;
  epdo_per_km: number;
  exposure_mvkt_rate: number;
  spf_prior_expected: number;
  eb_weight_w: number;
  eb_expected_crashes: number;
  eb_density_per_km: number;
  eb_se: number;
  eb_ci95_low: number;
  eb_ci95_high: number;
  psi_excess_crashes: number;
  rtm_shrinkage_delta: number;
  mcda_vulnerability_index: number;
  epistemic_uncertainty: number;
  aleatoric_cv: number;
  combined_uncertainty: number;
  bivariate_class: string;
  bivariate_color: string;
}

export interface CureDiagnostic {
  status: 'ok' | 'insufficient_aadt_variation';
  method: string;
  envelope: string;
  assumptions: string;
  model: string;
  sample_size: number;
  imputed_aadt_count: number;
  unit: string;
  points: { aadt: number; segment_count: number; cumulative_residual: number; lower: number; upper: number }[];
}

export interface RiskEbPayload {
  crs_epsg: number;
  cure_diagnostic: CureDiagnostic;
  metric_epistemology_disclaimer: string;
  normalized_weights: {
    w_eb_risk: number;
    w_epdo_severity: number;
    w_geometric_hazard: number;
    w_environmental_cov: number;
  };
  spf_strata_diagnostics: {
    road_class: string;
    segment_count: number;
    base_rate_exp_b0: number;
    aadt_elasticity_b1: number;
    overdispersion_alpha: number;
  }[];
  network_summary: {
    segment_count: number;
    total_verified_crashes: number;
    total_eb_expected: number;
    positive_psi_corridors: number;
    imputed_aadt_segments: number;
    mean_epistemic_uncertainty: number;
  };
  bivariate_palette: Record<string, string>;
  layer_geojson: GeoJSON.FeatureCollection;
  ranked_corridors: RiskCorridorRow[];
}
