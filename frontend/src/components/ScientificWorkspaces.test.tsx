import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uaiApi } from '../api/client';
import { LanguageProvider } from '../i18n';
import type { RiskEbPayload } from '../types/uai';
import { SpatialLabWorkspace } from './SpatialLabWorkspace';
import { RiskEbWorkspace } from './RiskEbWorkspace';
import { StewardWorkspace } from './StewardWorkspace';

describe('Advanced Scientific Workspaces (SpatialLab, RiskEb, Stewardship)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('renders SpatialLabWorkspace in Persian RTL and executes NKDE + PAI curve', async () => {
    window.localStorage.setItem('roadscope.language', 'fa');
    vi.spyOn(uaiApi, 'getCovariates').mockResolvedValue({
      by_infrastructure: [],
      by_weather: [],
      by_lighting: [],
    });
    vi.spyOn(uaiApi, 'getLabJobs').mockResolvedValue({ jobs: [] });

    const nkdePayload = {
      job_id: 11,
      runtime_ms: 42,
      summary_metrics: {
        total_weighted_mass: 100,
        conserved_nkde_mass: 99.8,
        max_nkde_per_km_yr: 18.4,
        max_planar_overestimation: 5.2,
        allocation_comparison: {
          multi_candidate_incidents: 14,
          l1_mass_shift_pct: 6.5,
          max_abs_density_diff_per_km_yr: 1.2,
        },
      },
      ground_truth_eval: {
        nkde: {
          pai: 3.4,
          rri: 0.72,
          rmse_per_km_yr: 2.1,
          spearman_rho: 0.88,
          pai_curve: {
            status: 'ok',
            au_pai: 3.1,
            points: [
              { coverage: 0.05, realized_coverage: 0.05, capture: 0.35, pai: 7.0 },
              { coverage: 0.1, realized_coverage: 0.1, capture: 0.62, pai: 6.2 },
            ],
          },
        },
        planar_kde: {
          pai: 2.1,
          rri: 0.48,
          rmse_per_km_yr: 4.5,
          spearman_rho: 0.65,
          pai_curve: {
            status: 'ok',
            au_pai: 2.0,
            points: [
              { coverage: 0.05, realized_coverage: 0.05, capture: 0.21, pai: 4.2 },
              { coverage: 0.1, realized_coverage: 0.1, capture: 0.41, pai: 4.1 },
            ],
          },
        },
      },
      mathematical_notes: {
        formula_latex: '\\hat{\\lambda}_G(q)',
        planar_comparison_note: 'Shortest-path mass splitting.',
      },
    };
    const nkdeSpy = vi.spyOn(uaiApi, 'runNkde').mockResolvedValue(nkdePayload);

    const onNkdeResult = vi.fn();
    const { rerender } = render(
      <LanguageProvider>
        <SpatialLabWorkspace
          darkMode={true}
          datasetId={1}
          activeRole="gis_researcher"
          onChangeOverlay={vi.fn()}
          onNkdeResult={onNkdeResult}
          onGiStarResult={vi.fn()}
          onNdbscanResult={vi.fn()}
          nkdeResult={null}
          giStarResult={null}
          ndbscanResult={null}
        />
      </LanguageProvider>
    );

    expect(screen.getByText(/آزمایشگاه تحلیل مکانی/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /اجرای مقایسهٔ NKDE شبکه‌ای و KDE مسطح/ }));
    await waitFor(() => expect(nkdeSpy).toHaveBeenCalledTimes(1));
    expect(onNkdeResult).toHaveBeenCalledTimes(1);

    rerender(
      <LanguageProvider>
        <SpatialLabWorkspace
          darkMode={true}
          datasetId={1}
          activeRole="gis_researcher"
          onChangeOverlay={vi.fn()}
          onNkdeResult={onNkdeResult}
          onGiStarResult={vi.fn()}
          onNdbscanResult={vi.fn()}
          nkdeResult={nkdePayload}
          giStarResult={null}
          ndbscanResult={null}
        />
      </LanguageProvider>
    );
    expect(screen.getByText(/حساسیت تخصیص کسری/)).toBeTruthy();
  });

  it('renders RiskEbWorkspace CURE diagnostic chart, length-scaled SPF card, and EVPI calculator', async () => {
    const sampleRisk: RiskEbPayload = {
      crs_epsg: 25832,
      normalized_weights: { w_eb_risk: 0.4, w_epdo_severity: 0.3, w_geometric_hazard: 0.15, w_environmental_cov: 0.15 },
      network_summary: {
        segment_count: 10,
        total_verified_crashes: 85,
        total_eb_expected: 84.2,
        positive_psi_corridors: 4,
        imputed_aadt_segments: 1,
        mean_epistemic_uncertainty: 0.25,
      },
      spf_strata_diagnostics: [],
      bivariate_palette: {},
      metric_epistemology_disclaimer: 'Epistemological note',
      layer_geojson: { type: 'FeatureCollection', features: [] },
      ranked_corridors: [
        {
          segment_id: 1,
          edge_code: 'E-01',
          priority_rank: 1,
          name: 'Mainzer Arterial',
          road_class: 'primary_arterial',
          elevation_level: 0,
          length_m: 520,
          speed_limit_kmh: 50,
          sinuosity: 1.05,
          aadt: 18500,
          aadt_is_imputed: false,
          exposure_confidence: 0.95,
          raw_crash_frequency: 14,
          unverified_vgi_count: 2,
          linear_crash_density_per_km: 26.9,
          epdo_total: 46,
          epdo_per_km: 88.2,
          exposure_mvkt_rate: 4.1,
          spf_prior_expected: 8.5,
          eb_weight_w: 0.62,
          eb_expected_crashes: 11.9,
          eb_density_per_km: 22.8,
          psi_excess_crashes: 3.4,
          rtm_shrinkage_delta: -2.1,
          eb_se: 2.1,
          eb_ci95_low: 8.1,
          eb_ci95_high: 16.3,
          epistemic_uncertainty: 0.24,
          aleatoric_cv: 0.18,
          combined_uncertainty: 0.3,
          bivariate_class: '3-1',
          bivariate_color: '#6c83b5',
          mcda_vulnerability_index: 84.5,
        },
      ],
      cure_diagnostic: {
        status: 'ok',
        method: 'hauer_cure',
        envelope: '±2σ',
        assumptions: 'Independent NB segments',
        model: 'Road-class NB-SPF',
        sample_size: 10,
        imputed_aadt_count: 1,
        unit: 'crashes',
        points: [
          { aadt: 9000, segment_count: 3, cumulative_residual: -0.5, lower: -2.1, upper: 2.1 },
          { aadt: 15000, segment_count: 4, cumulative_residual: 1.2, lower: -3.4, upper: 3.4 },
          { aadt: 22000, segment_count: 3, cumulative_residual: 0.1, lower: -4.5, upper: 4.5 },
        ],
      },
      length_scaled_eb: {
        status: 'ok',
        model_version: 'length_scaled_nb_v1',
        converged: true,
        beta_0: -6.12,
        beta_1_log_aadt: 0.84,
        alpha_1_per_km: 0.42,
        rank_spearman_vs_legacy: 0.94,
        cure_diagnostic: {
          status: 'ok',
          method: 'hauer_cure',
          envelope: '±2σ',
          assumptions: 'Length-scaled NB',
          model: 'Length-scaled NB-SPF',
          sample_size: 10,
          imputed_aadt_count: 1,
          unit: 'crashes',
          points: [
            { aadt: 9000, segment_count: 5, cumulative_residual: -0.2, lower: -2.0, upper: 2.0 },
            { aadt: 22000, segment_count: 5, cumulative_residual: 0.0, lower: -3.8, upper: 3.8 },
          ],
        },
        limitations: 'Single road-network realization.',
      },
    };

    vi.spyOn(uaiApi, 'evaluateRiskEb').mockResolvedValue(sampleRisk);
    vi.spyOn(uaiApi, 'getSurrogates').mockResolvedValue({
      uncovered_segments: 8,
      covered_zero_conflict_segments: 1,
      covered_positive_conflict_segments: 1,
    });
    const evpiSpy = vi.spyOn(uaiApi, 'runResearchEvpi').mockResolvedValue({
      optimal_action: 1,
      actions: ['do_nothing', 'install_countermeasure'],
      evpi: 4.85,
    });

    render(
      <LanguageProvider>
        <RiskEbWorkspace
          darkMode={true}
          datasetId={1}
          overlayMode="risk_bivariate_uncertainty"
          onChangeOverlay={vi.fn()}
          riskData={sampleRisk}
          onRiskDataLoaded={vi.fn()}
          onFlyToSegment={vi.fn()}
        />
      </LanguageProvider>
    );

    expect(screen.getByRole('img', { name: 'CURE diagnostic by AADT' })).toBeTruthy();
    expect(screen.getByText(/Fitted Length-Scaled NB-SPF Comparison/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Compute Optimal Action & EVPI/ }));
    await waitFor(() => expect(evpiSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/install_countermeasure/)).toBeTruthy();
  });

  it('renders StewardWorkspace VGI allocation & ambiguity diagnostics in Persian', async () => {
    window.localStorage.setItem('roadscope.language', 'fa');
    vi.spyOn(uaiApi, 'getStewardWorkspace').mockResolvedValue({
      dataset_id: 1,
      duplicate_clusters: [],
      triage_queue: [],
      diagnostics: {
        vgi_subset_count: 10,
        mean_positional_drift_m: 9.2,
        median_reporting_lag_min: 14,
        topological_override_count: 3,
        positional_drift_histogram: [{ bin: '0-10m', count: 6 }],
        reporting_lag_histogram: [{ bin: '0-15m', count: 7 }],
        source_breakdown: { citizen_vgi: 10 },
        audit_logs: [],
      },
    });
    vi.spyOn(uaiApi, 'getVgiDiagnostics').mockResolvedValue({
      ambiguous_share_pct: 28.5,
      witness_inflation_ratio: 1.42,
      mean_allocation_entropy_nats: 0.37,
    });

    render(
      <LanguageProvider>
        <StewardWorkspace
          darkMode={true}
          datasetId={1}
          activeRole="data_steward"
          onSwitchToStewardRole={vi.fn()}
          onDataMutated={vi.fn()}
          onFlyTo={vi.fn()}
        />
      </LanguageProvider>
    );

    const diagBtn = await screen.findByRole('button', { name: 'تشخیص کیفیت و اریبی' });
    fireEvent.click(diagBtn);
    expect(await screen.findByText(/تشخیص تخصیص احتمالی حوادث/)).toBeTruthy();
    expect(screen.getByText('28.5%')).toBeTruthy();
  });

  it('executes Persian RTL BYM2 MCMC, Bivariate Surrogate Fusion, MAUP Sensitivity, and Text Ablation', async () => {
    window.localStorage.setItem('roadscope.language', 'fa');
    vi.spyOn(uaiApi, 'getCovariates').mockResolvedValue({
      by_infrastructure: [],
      by_weather: [],
      by_lighting: [],
    });
    vi.spyOn(uaiApi, 'getLabJobs').mockResolvedValue({ jobs: [] });
    const maupSpy = vi.spyOn(uaiApi, 'runResearchMaupSensitivity').mockResolvedValue({
      result: {
        zoning_sensitivity_note: 'Sub-segment lixelization reduces intensity RMSE (0.9412 stability)',
        resolutions: [
          { lixel_resolution_m: 10, lixel_count: 920, au_pai: { mean: 2.84, ci95_halfwidth: 0.08 }, runtime_ms: 18.2, peak_memory_kb: 420 },
          { lixel_resolution_m: 50, lixel_count: 195, au_pai: { mean: 2.71, ci95_halfwidth: 0.09 }, runtime_ms: 6.4, peak_memory_kb: 180 },
        ],
      },
    });
    const textSpy = vi.spyOn(uaiApi, 'runResearchTextAblation').mockResolvedValue({
      result: {
        embedding_version: 'local-charword-svd-v1',
        text_lift_log_score: -0.123,
        ablations: [
          { variant: 'structured_only', au_pai: 1.58, holdout_mean_log_score: -0.91 },
          { variant: 'structured_plus_text_fusion', au_pai: 1.54, holdout_mean_log_score: -1.03 },
        ],
      },
    });

    render(
      <LanguageProvider>
        <SpatialLabWorkspace
          darkMode={true}
          datasetId={1}
          activeRole="gis_researcher"
          onChangeOverlay={vi.fn()}
          onNkdeResult={vi.fn()}
          onGiStarResult={vi.fn()}
          onNdbscanResult={vi.fn()}
          nkdeResult={null}
          giStarResult={null}
          ndbscanResult={null}
        />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'انتقال جهت‌دار و بنچمارک' }));
    fireEvent.click(screen.getByRole('button', { name: /اجرای تحلیل حساسیت مقیاس لیکسل MAUP/ }));
    await waitFor(() => expect(maupSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/0.9412/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /اجرای مطالعهٔ حذفی متن/ }));
    await waitFor(() => expect(textSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/local-charword-svd-v1/)).toBeTruthy();
  });
});
