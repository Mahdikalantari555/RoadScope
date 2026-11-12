export type WorkspaceMode =
  | 'analytics'
  | 'spatial_lab'
  | 'risk_eb'
  | 'citizen_vgi'
  | 'stewardship'
  | 'simulator'
  /** Restricted real-report pilot: closed unless an owner enabled the server-side flags. */
  | 'pilot_reporting';

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
  | 'tnkde'
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

export interface StudyAreaMeta {
  key: string;
  name_en: string;
  name_fa: string;
  country_code: string;
  canonical_epsg: number;
  canonical_crs_name: string;
  center_4326: [number, number];
  label_en: string;
  label_fa: string;
  boundary_4326: { min_lon: number; min_lat: number; max_lon: number; max_lat: number } | null;
  bounded: boolean;
  network_source: string;
  network_generator: string | null;
  demo: boolean;
  dataset_count?: number;
}

export interface BasemapConfig {
  enabled: boolean;
  tile_url: string;
  name: string;
  provider: string;
  policy_url: string;
  attribution: string;
  optional: boolean;
  fallback: string;
  bulk_download: string;
}

export interface DatasetProvenance {
  network_source?: string;
  network_generator?: string;
  generator_seed?: number;
  is_synthetic_geometry?: boolean;
  canonical_crs?: string;
  extract_version?: string;
  checksum_sha256?: string;
  license?: string;
  source_attribution?: string;
  snapshot_date?: string;
  lixel_resolution_m?: number;
  ambiguous_crossing_count?: number;
  [key: string]: unknown;
}

export interface IncidentProvenance {
  incident_provenance?: string;
  scenario_key?: string;
  random_seed?: number;
  parameters?: Record<string, number | string>;
  notice_en?: string;
  notice_fa?: string;
  [key: string]: unknown;
}

/** Presentation contract shared with the backend (frontend-experience-improvements task 1.3). */
export interface PresentationContract {
  dataset_id: number | null;
  dataset_name: string;
  dataset_profile: string;
  synthetic_incidents: boolean | null;
  study_area_key: string;
  study_area_label_en: string;
  study_area_label_fa: string;
  network_source: string;
  network_extract_version: string;
  network_checksum_sha256: string;
  license: string;
  attribution: string;
  legend_note: string;
  required_visible_elements: string[];
  screenshot_guidance: string;
  center_4326: [number, number];
  network_bbox_4326: GeoBounds | null;
  canonical_crs: string;
  filters_persisted: boolean;
}

export interface PilotFeatureFlag {
  key: string;
  enabled: boolean;
  owner: string;
  approval_reference: string;
  updated_at_utc: string;
}

export interface PilotDatasetState {
  dataset_id: number | null;
  profile_key: string;
  purpose: string;
  allows_real_reports: boolean;
  allows_publication: boolean;
  is_synthetic: boolean;
  calibration_status: string;
  is_publishable: boolean;
  user_disclosure_approved: boolean;
  study_area_key: string;
  archived_at_utc: string | null;
}

export interface PilotStatus {
  process_profile: string;
  process_profile_database: string;
  dataset: PilotDatasetState | null;
  flags: Record<string, PilotFeatureFlag>;
  consent_version?: string;
  pilot_configuration: Record<string, unknown> | null;
  release_gates: {
    owner_and_hosting_approved: boolean;
    legal_privacy_review_recorded: boolean;
    identity_model_recorded: boolean;
    intake_enabled: boolean;
    publication_enabled: boolean;
    /** Present only on deployments that expose separate tracking/correction gates. */
    tracking_enabled?: boolean;
    corrections_enabled?: boolean;
  };
  note: string;
}

export interface PilotBootstrap {
  dataset_id: number | null;
  intake_enabled: boolean;
  tracking_enabled: boolean;
  publication: { enabled: boolean; status: string; minimum_cell_size: number | null };
  study_area: Record<string, unknown> | null;
  categories: CategoryMeta[];
  severities: SeverityMeta[];
  network_extract: Record<string, unknown> | null;
  consent_version: string;
  privacy: Record<string, string>;
  timezone: string;
}

/**
 * Intake receipt, matching `POST /pilot/reports` exactly.
 *
 * There are **no** `duplicate_suggestions` (plural), `consolidated`, `status` or `status_label`
 * fields: the endpoint returns a single `duplicate_suggestion`, `unmatched` and
 * `verification_status`. Reading a field that is not sent would silently render `undefined`.
 */
export interface PilotReportReceipt {
  report_public_id: string;
  dataset_id: number;
  tracking_credential: string;
  tracking_credential_note: string;
  occurred_at_utc: string;
  occurred_at_local_input: string;
  timezone: string;
  verification_status: string;
  snap_confidence: 'confident' | 'uncertain' | 'unmatched';
  unmatched: boolean;
  coarse_location: { lon: number; lat: number; cell_key: string };
  duplicate_suggestion: { accident_id: number; distance_m: number; occurred_at_utc: string; action: string } | null;
  uncertainty_radius_m: number;
  candidate_count: number;
  retention_until_utc: string;
  consent_version: string;
  synthetic: boolean;
  idempotent_replay?: boolean;
}

export interface PilotTracking {
  report_public_id: string;
  status: string;
  status_label: string;
  status_label_fa: string;
  occurred_at_utc: string;
  coarse_cell_key: string | null;
  merged_into: string | null;
  retention_until_utc: string | null;
  can_request_correction: boolean;
  can_withdraw_consent: boolean;
  publication_note: string;
  note: string;
}

export interface GeoBounds {
  min_lon: number;
  min_lat: number;
  max_lon: number;
  max_lat: number;
}

export interface PlatformMeta {
  canonical_crs: string;
  canonical_crs_name: string;
  web_crs: string;
  study_area: string;
  study_area_fa?: string;
  study_area_key?: string;
  center_4326: [number, number];
  network_bbox_4326?: GeoBounds | null;
  network_bbox_geometry?: GeoJSON.Geometry | null;
  boundary_enforced?: boolean;
  ingestion_scope?: string;
  study_areas?: StudyAreaMeta[];
  active_dataset: DatasetSource;
  datasets: DatasetSource[];
  categories: CategoryMeta[];
  severities: SeverityMeta[];
  personas: PersonaUser[];
  scenarios: ScenarioSpec[];
  context_geojson: GeoJSON.FeatureCollection;
  // --- Presentation contract ---------------------------------------------------------------
  dataset_profile?: string;
  dataset_profile_purpose?: string;
  allows_real_reports?: boolean;
  allows_publication?: boolean;
  calibration_status?: 'uncalibrated' | 'research_only' | 'approved' | string;
  network_provenance?: DatasetProvenance;
  incident_provenance?: IncidentProvenance;
  active_extract?: Record<string, unknown> | null;
  is_synthetic_incidents?: boolean | null;
  basemap?: BasemapConfig;
  tile_provider?: BasemapConfig;
  attribution?: string;
  disclaimer_en?: string;
  disclaimer_fa?: string;
  presentation?: PresentationContract;
  profile_independence?: {
    isolated_profiles: string[];
    profile_database_overrides: string;
    note: string;
  };
  study_area_metadata?: Record<string, unknown> | null;
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

export interface LengthScaledEbSummary {
  status: string;
  model_version: string;
  converged: boolean;
  log_likelihood?: number;
  beta_0: number | null;
  beta_1_log_aadt: number | null;
  alpha_1_per_km: number | null;
  parameter_se?: {
    beta_0_centered_se: number | null;
    beta_1_log_aadt_se: number | null;
    log_alpha_1_se: number | null;
  };
  mean_shrinkage_weight?: number;
  rank_spearman_vs_legacy?: number | null;
  cure_diagnostic: CureDiagnostic;
  limitations: string;
}

export interface RiskEbPayload {
  crs_epsg: number;
  cure_diagnostic: CureDiagnostic;
  length_scaled_eb?: LengthScaledEbSummary;
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
