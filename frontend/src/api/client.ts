import type {
  CmvFilterState,
  CmvStatePayload,
  ConflationAlert,
  NetworkLayersPayload,
  PlatformMeta,
  RiskEbPayload,
  SnapCandidate,
} from '../types/uai';

let apiToken = '';
export function setApiToken(token: string) {
  apiToken = token;
}

async function apiJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) {
        errMsg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
      }
    } catch {
      // ignore parse failure
    }
    throw new Error(errMsg);
  }
  return res.json() as Promise<T>;
}

export const uaiApi = {
  getMeta: () => apiJson<PlatformMeta>('/api/v1/meta'),

  activateDataset: (datasetId: number) =>
    apiJson<{ activated_dataset_id: number; name: string }>(`/api/v1/datasets/${datasetId}/activate`, {
      method: 'POST',
    }),

  getNetworkLayers: (datasetId?: number, includeLixels = true) =>
    apiJson<NetworkLayersPayload>(
      `/api/v1/network/layers?include_lixels=${includeLixels}${datasetId ? `&dataset_id=${datasetId}` : ''}`
    ),

  getDirectedTopology: (datasetId?: number, includeEdges = true) =>
    apiJson<Record<string, any>>(
      `/api/v1/network/directed-topology?include_edges=${includeEdges}${datasetId ? `&dataset_id=${datasetId}` : ''}`
    ),

  runDirectedTransport: (payload: Record<string, unknown>) =>
    apiJson<Record<string, any>>('/api/v1/network/directed-transport', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  queryCmv: (datasetId: number, filters: CmvFilterState) =>
    apiJson<CmvStatePayload>('/api/v1/analytics/cmv', {
      method: 'POST',
      body: JSON.stringify({
        dataset_id: datasetId,
        verification_mode: filters.verification_mode,
        start_utc: filters.start_utc,
        end_utc: filters.end_utc,
        severity_codes: filters.severity_codes.length ? filters.severity_codes : null,
        category_codes: filters.category_codes.length ? filters.category_codes : null,
        dow_filter: filters.dow_filter,
        hour_filter: filters.hour_filter,
        segment_id: filters.segment_id,
        bbox_4326: filters.bbox_4326,
        polygon_4326: filters.polygon_4326,
      }),
    }),

  runSimulation: (payload: {
    scenario_key: string;
    lixel_resolution_m: number;
    random_seed: number;
    base_intensity_scale: number;
    vgi_positional_sigma_m: number;
    vgi_duplicate_rate: number;
    vgi_false_alarm_count: number;
    study_period_years: number;
    actor_role: string;
  }) =>
    apiJson<Record<string, unknown>>('/api/v1/simulator/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  previewSnapAndConflate: (payload: {
    dataset_id: number;
    lon?: number;
    lat?: number;
    x_m?: number;
    y_m?: number;
    observational_radius_m: number;
    occurred_at_utc: string;
    category_code: string;
    max_net_dist_m?: number;
    max_time_diff_min?: number;
  }) =>
    apiJson<{
      raw_point: { lon: number; lat: number; x_m: number; y_m: number; srid: number };
      uncertainty_circle_geojson: GeoJSON.Geometry;
      candidate_snaps: SnapCandidate[];
      conflation_alerts: ConflationAlert[];
    }>('/api/v1/vgi/preview-snap-and-conflate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  submitVgiReport: (payload: Record<string, unknown>) =>
    apiJson<Record<string, unknown>>('/api/v1/vgi/submit', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  corroborateIncident: (
    accidentId: number,
    payload: { witness_notes: string; observational_radius_m: number; actor_role: string }
  ) =>
    apiJson<Record<string, unknown>>(`/api/v1/vgi/${accidentId}/corroborate`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getStewardWorkspace: (datasetId: number, maxNetDist = 110, maxTimeDiff = 55) =>
    apiJson<{
      dataset_id: number;
      triage_queue: Record<string, any>[];
      duplicate_clusters: Record<string, any>[];
      diagnostics: Record<string, any>;
    }>(
      `/api/v1/steward/workspace?dataset_id=${datasetId}&max_net_dist_m=${maxNetDist}&max_time_diff_min=${maxTimeDiff}`
    ),

  stewardReview: (payload: Record<string, unknown>) =>
    apiJson<Record<string, unknown>>('/api/v1/steward/review', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  stewardMergeCluster: (payload: {
    canonical_id: number;
    duplicate_ids: number[];
    verify_canonical: boolean;
    review_notes: string;
    actor_role: string;
  }) =>
    apiJson<Record<string, unknown>>('/api/v1/steward/merge-cluster', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  runNkde: (payload: Record<string, unknown>) =>
    apiJson<Record<string, any>>('/api/v1/lab/nkde', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  runAutocorrelation: (payload: Record<string, unknown>) =>
    apiJson<Record<string, any>>('/api/v1/lab/autocorrelation', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  runNdbscan: (payload: Record<string, unknown>) =>
    apiJson<Record<string, any>>('/api/v1/lab/ndbscan', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getCovariates: (datasetId: number, includeUnverified = false) =>
    apiJson<{
      by_weather: Record<string, any>[];
      by_lighting: Record<string, any>[];
      by_infrastructure: Record<string, any>[];
    }>(`/api/v1/lab/covariates?dataset_id=${datasetId}&include_unverified_vgi=${includeUnverified}`),

  getLabJobs: (datasetId: number) =>
    apiJson<{ jobs: Record<string, any>[] }>(`/api/v1/lab/jobs?dataset_id=${datasetId}`),

  evaluateRiskEb: (payload: {
    dataset_id: number;
    w_eb_risk: number;
    w_epdo_severity: number;
    w_geometric_hazard: number;
    w_environmental_cov: number;
  }) =>
    apiJson<RiskEbPayload>('/api/v1/risk/evaluate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Research Contracts API
  runResearchTnkde: (payload: Record<string, unknown>) =>
    apiJson<Record<string, any>>('/api/v1/research/tnkde', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  runResearchBenchmark: (payload: Record<string, unknown>) =>
    apiJson<Record<string, any>>('/api/v1/research/benchmark', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  runResearchHawkes: (payload: Record<string, unknown>) =>
    apiJson<Record<string, any>>('/api/v1/research/hawkes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  runResearchEvpi: (payload: {
    losses: number[][];
    actions: string[];
    loss_unit: string;
    horizon_years: number;
  }) =>
    apiJson<Record<string, any>>('/api/v1/research/evpi', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getVgiDiagnostics: (datasetId?: number) =>
    apiJson<Record<string, any>>(
      `/api/v1/research/vgi-diagnostics${datasetId ? `?dataset_id=${datasetId}` : ''}`
    ),

  runResearchIpw: (payload: { observed: number[]; exposure: number[]; clip?: number }) =>
    apiJson<Record<string, any>>('/api/v1/research/ipw', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getSurrogates: (datasetId?: number) =>
    apiJson<Record<string, any>>(`/api/v1/research/surrogates${datasetId ? `?dataset_id=${datasetId}` : ''}`),
};
