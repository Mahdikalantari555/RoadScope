import React, { useEffect, useState } from 'react';
import {
  Award,
  Clock,
  Compass,
  Download,
  FlaskConical,
  History,
  Play,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { uaiApi } from '../api/client';
import { useLanguage } from '../i18n';
import { domainLabel, formatNumber } from '../analyticsI18n';
import { getSpatialLabText } from '../workspaceI18n';
import { PaiCurveChart } from './PaiCurveChart';
import type { MapOverlayMode, PersonaRole } from '../types/uai';

interface SpatialLabWorkspaceProps {
  darkMode: boolean;
  datasetId: number;
  activeRole: PersonaRole;
  onChangeOverlay: (mode: MapOverlayMode) => void;
  onNkdeResult: (res: Record<string, any>) => void;
  onGiStarResult: (res: Record<string, any>) => void;
  onNdbscanResult: (res: Record<string, any>) => void;
  onTnkdeGeojson?: (fc: GeoJSON.FeatureCollection | null) => void;
  nkdeResult: Record<string, any> | null;
  giStarResult: Record<string, any> | null;
  ndbscanResult: Record<string, any> | null;
}

type LabTab = 'nkde' | 'tnkde' | 'gistar' | 'ndbscan' | 'transport' | 'covariates' | 'provenance';

export const SpatialLabWorkspace: React.FC<SpatialLabWorkspaceProps> = ({
  darkMode,
  datasetId,
  activeRole,
  onChangeOverlay,
  onNkdeResult,
  onGiStarResult,
  onNdbscanResult,
  onTnkdeGeojson,
  nkdeResult,
  giStarResult,
  ndbscanResult,
}) => {
  const { language } = useLanguage();
  const copy = getSpatialLabText(language);
  const n = (value: number) => formatNumber(language, value);

  const [tab, setTab] = useState<LabTab>('nkde');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // NKDE params
  const [kernel, setKernel] = useState<'quartic' | 'epanechnikov' | 'gaussian'>('quartic');
  const [bandwidthM, setBandwidthM] = useState<number>(180);
  const [weighting, setWeighting] = useState<'uniform' | 'epdo_severity' | 'credibility_weighted'>('uniform');
  const [allocationMode, setAllocationMode] = useState<'hard' | 'fractional'>('hard');
  const [massConserving, setMassConserving] = useState<boolean>(true);
  const [includeVgi, setIncludeVgi] = useState<boolean>(false);

  // Adaptive TNKDE params & state
  const [tnkdeSpatialM, setTnkdeSpatialM] = useState<number>(180);
  const [tnkdeTemporalDays, setTnkdeTemporalDays] = useState<number>(14);
  const [tnkdeSlices, setTnkdeSlices] = useState<number>(10);
  const [tnkdeAdaptive, setTnkdeAdaptive] = useState<boolean>(true);
  const [tnkdeCausal, setTnkdeCausal] = useState<boolean>(false);
  const [tnkdeLcv, setTnkdeLcv] = useState<boolean>(true);
  const [tnkdeRes, setTnkdeRes] = useState<Record<string, any> | null>(null);
  const [activeSliceIdx, setActiveSliceIdx] = useState<number>(0);

  // Gi* params
  const [weightScheme, setWeightScheme] = useState<
    'inverse_network_distance' | 'fixed_network_band' | 'k_order_contiguity'
  >('inverse_network_distance');
  const [distThreshM, setDistThreshM] = useState<number>(200);
  const [permutations, setPermutations] = useState<number>(499);
  const [attrMode, setAttrMode] = useState<'crash_density' | 'epdo_rate' | 'raw_count'>('crash_density');

  // N-DBSCAN params
  const [epsNetM, setEpsNetM] = useState<number>(85);
  const [minSamples, setMinSamples] = useState<number>(4);

  // Directed Transport & Benchmark state
  const [topoSummary, setTopoSummary] = useState<Record<string, any> | null>(null);
  const [transportSummary, setTransportSummary] = useState<Record<string, any> | null>(null);
  const [benchResult, setBenchResult] = useState<Record<string, any> | null>(null);
  const [netKResult, setNetKResult] = useState<Record<string, any> | null>(null);
  const [voronoiResult, setVoronoiResult] = useState<Record<string, any> | null>(null);
  const [hmmResult, setHmmResult] = useState<Record<string, any> | null>(null);
  const [maupResult, setMaupResult] = useState<Record<string, any> | null>(null);
  const [stGraphResult, setStGraphResult] = useState<Record<string, any> | null>(null);
  const [textAblationResult, setTextAblationResult] = useState<Record<string, any> | null>(null);
  const [consentVerified, setConsentVerified] = useState<boolean>(true);

  // Covariates & Job Provenance
  const [covariates, setCovariates] = useState<Record<string, any> | null>(null);
  const [jobs, setJobs] = useState<Record<string, any>[]>([]);

  const refreshCovariatesAndJobs = async () => {
    try {
      const [cov, jb] = await Promise.all([
        uaiApi.getCovariates(datasetId, includeVgi),
        uaiApi.getLabJobs(datasetId),
      ]);
      setCovariates(cov);
      setJobs(jb.jobs);
    } catch {
      // ignore background fetch errors
    }
  };

  useEffect(() => {
    refreshCovariatesAndJobs();
  }, [datasetId, includeVgi]);

  const applyTnkdeSliceToMap = (resObj: Record<string, any>, sliceIdx: number) => {
    if (!onTnkdeGeojson || !resObj?.layer_geojson) return;
    const row = resObj.slice_lixel_km_day?.[sliceIdx] || [];
    const maxVal = Math.max(1e-6, ...row);
    const updated: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: resObj.layer_geojson.features.map((f: GeoJSON.Feature, idx: number) => {
        const val = Number(row[idx] ?? 0);
        return {
          ...f,
          properties: {
            ...(f.properties || {}),
            tnkde_slice_km_day: Number(val.toFixed(5)),
            tnkde_norm: Math.min(1, val / maxVal),
          },
        };
      }),
    };
    onTnkdeGeojson(updated);
  };

  const executeNkde = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await uaiApi.runNkde({
        dataset_id: datasetId,
        kernel,
        bandwidth_m: bandwidthM,
        weighting,
        allocation_mode: allocationMode,
        equal_split_mass_conserving: massConserving,
        include_unverified_vgi: includeVgi,
        actor_role: activeRole,
      });
      onNkdeResult(res);
      onChangeOverlay('nkde');
      refreshCovariatesAndJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'NKDE execution failed');
    } finally {
      setBusy(false);
    }
  };

  const executeTnkde = async () => {
    setBusy(true);
    setError(null);
    try {
      const env = await uaiApi.runResearchTnkde({
        dataset_id: datasetId,
        spatial_bandwidth_m: tnkdeSpatialM,
        temporal_bandwidth_days: tnkdeTemporalDays,
        slice_count: tnkdeSlices,
        adaptive: tnkdeAdaptive,
        causal: tnkdeCausal,
        select_via_lcv: tnkdeLcv,
        allocation_mode: allocationMode,
        include_unverified_vgi: includeVgi,
      });
      setTnkdeRes(env.result);
      setActiveSliceIdx(0);
      applyTnkdeSliceToMap(env.result, 0);
      onChangeOverlay('tnkde');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Adaptive TNKDE failed');
    } finally {
      setBusy(false);
    }
  };

  const executeGiStar = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await uaiApi.runAutocorrelation({
        dataset_id: datasetId,
        weight_scheme: weightScheme,
        distance_threshold_m: distThreshM,
        permutations,
        attribute_mode: attrMode,
        include_unverified_vgi: includeVgi,
        actor_role: activeRole,
      });
      onGiStarResult(res);
      onChangeOverlay('gi_star');
      refreshCovariatesAndJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network Gi* failed');
    } finally {
      setBusy(false);
    }
  };

  const executeNdbscan = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await uaiApi.runNdbscan({
        dataset_id: datasetId,
        eps_net_m: epsNetM,
        min_samples: minSamples,
        include_unverified_vgi: includeVgi,
        actor_role: activeRole,
      });
      onNdbscanResult(res);
      onChangeOverlay('ndbscan');
      refreshCovariatesAndJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'N-DBSCAN failed');
    } finally {
      setBusy(false);
    }
  };

  const executeDirectedTransportDemo = async () => {
    setBusy(true);
    setError(null);
    try {
      const topo = await uaiApi.getDirectedTopology(datasetId, true);
      setTopoSummary(topo);
      if (topo.states?.length) {
        const s0 = topo.states[0];
        const tr = await uaiApi.runDirectedTransport({
          dataset_id: datasetId,
          segment_id: s0.segment_id,
          lixel_id: s0.lixel_id,
          direction: s0.direction,
          mass: 1.0,
          speed_m_s: 12.0,
          duration_s: 20.0,
          steps: 40,
        });
        setTransportSummary(tr);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Directed transport failed');
    } finally {
      setBusy(false);
    }
  };

  const executeHoldoutBenchmark = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await uaiApi.runResearchBenchmark({
        dataset_id: datasetId,
        train_fraction: 0.7,
        nkde_bandwidth_m: bandwidthM,
      });
      setBenchResult(res.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Benchmark failed');
    } finally {
      setBusy(false);
    }
  };

  const executeNetworkK = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await uaiApi.runResearchNetworkK({
        dataset_id: datasetId,
        max_radius_m: 350,
        n_radii: 8,
        n_simulations: 19,
        random_seed: 42,
      });
      setNetKResult(res.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network K failed');
    } finally {
      setBusy(false);
    }
  };

  const executeVoronoiAndHmm = async (which: 'voronoi' | 'hmm') => {
    setBusy(true);
    setError(null);
    try {
      if (which === 'voronoi') {
        const res = await uaiApi.runResearchVoronoi({ dataset_id: datasetId });
        setVoronoiResult(res.result);
      } else {
        const res = await uaiApi.runResearchTrajectoryHmm({
          dataset_id: datasetId,
          synthetic_steps: 5,
          transition_scale_m: 100.0,
          random_seed: 42,
        });
        setHmmResult(res.result);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Primitive execution failed');
    } finally {
      setBusy(false);
    }
  };

  const executeMaupSuite = async (which: 'maup' | 'stgraph' | 'text') => {
    setBusy(true);
    setError(null);
    try {
      if (which === 'maup') {
        const res = await uaiApi.runResearchMaupSensitivity({
          dataset_id: datasetId,
          resolutions_m: [10.0, 25.0, 50.0],
          seeds: [17, 42, 89],
          bandwidth_m: bandwidthM,
        });
        setMaupResult(res.result);
      } else if (which === 'stgraph') {
        const res = await uaiApi.runResearchStGraph({
          dataset_id: datasetId,
          n_periods: 8,
          seeds: [11, 29, 47],
        });
        setStGraphResult(res.result);
      } else {
        const res = await uaiApi.runResearchTextAblation({
          dataset_id: datasetId,
          consent_verified: consentVerified,
          random_seed: 42,
        });
        setTextAblationResult(res.result);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Benchmark execution failed');
    } finally {
      setBusy(false);
    }
  };

  const cardCls = `rounded-md border p-3 ${
    darkMode ? 'bg-slate-900/75 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
  }`;
  const inputCls = `w-full px-2 py-1 rounded border font-mono text-xs ${
    darkMode ? 'border-slate-700 bg-slate-950' : 'border-slate-300 bg-white text-slate-900'
  }`;

  const renderExportButtons = (jobId: number | undefined) => {
    if (!jobId) return null;
    return (
      <div className="flex items-center gap-1.5">
        <a
          href={`/api/v1/lab/jobs/${jobId}/export?fmt=geojson`}
          download
          className="px-2 py-1 rounded border border-cyan-500/50 bg-cyan-500/10 text-cyan-300 text-[10px] font-mono flex items-center gap-1 hover:bg-cyan-500/20"
        >
          <Download className="w-3 h-3" /> GeoJSON
        </a>
        <a
          href={`/api/v1/lab/jobs/${jobId}/export?fmt=csv`}
          download
          className="px-2 py-1 rounded border border-emerald-500/50 bg-emerald-500/10 text-emerald-300 text-[10px] font-mono flex items-center gap-1 hover:bg-emerald-500/20"
        >
          <Download className="w-3 h-3" /> CSV
        </a>
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3 text-xs">
      <div>
        <h2 className="font-semibold text-sm flex items-center gap-1.5">
          <FlaskConical className="w-4 h-4 text-cyan-400" />
          {copy.title}
        </h2>
        <p className="text-[11px] opacity-70">{copy.subtitle}</p>
      </div>

      {/* Sub-Navigation */}
      <div className="flex flex-wrap gap-1 border-b border-slate-800 pb-2">
        {[
          { id: 'nkde', label: copy.tabNkde },
          { id: 'tnkde', label: copy.tabTnkde },
          { id: 'gistar', label: copy.tabGiStar },
          { id: 'ndbscan', label: copy.tabNdbscan },
          { id: 'transport', label: copy.tabTransport },
          { id: 'covariates', label: copy.tabCovariates },
          { id: 'provenance', label: `${copy.tabJobs} (${n(jobs.length)})` },
        ].map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => setTab(item.id as LabTab)}
            className={`px-2 py-1 rounded text-[11px] font-medium border ${
              tab === item.id
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                : 'border-slate-800 opacity-75 hover:opacity-100'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="p-2.5 rounded border border-rose-500/60 bg-rose-500/15 text-rose-200 font-mono text-[11px]">
          <bdi>{error}</bdi>
        </div>
      )}

      {/* TAB 1: NKDE vs PLANAR KDE */}
      {tab === 'nkde' && (
        <div className="space-y-3">
          <div className={cardCls}>
            <div className="font-semibold mb-2 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              {copy.nkdeParams}
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[10px] opacity-70 mb-1">{copy.kernel}</label>
                <select value={kernel} onChange={(e) => setKernel(e.target.value as any)} className={inputCls}>
                  <option value="quartic">{copy.quartic}</option>
                  <option value="epanechnikov">{copy.epanechnikov}</option>
                  <option value="gaussian">{copy.gaussian}</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] opacity-70 mb-1">{copy.weighting}</label>
                <select value={weighting} onChange={(e) => setWeighting(e.target.value as any)} className={inputCls}>
                  <option value="uniform">{copy.uniform}</option>
                  <option value="epdo_severity">{copy.epdo}</option>
                  <option value="credibility_weighted">{copy.credibility}</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] opacity-70 mb-1">{copy.allocationMode}</label>
                <select
                  value={allocationMode}
                  onChange={(e) => setAllocationMode(e.target.value as 'hard' | 'fractional')}
                  className={inputCls}
                >
                  <option value="hard">{copy.allocHard}</option>
                  <option value="fractional">{copy.allocFractional}</option>
                </select>
              </div>
              <div className="col-span-2">
                <div className="flex justify-between text-[11px] font-mono mb-1">
                  <span>{copy.bandwidthM}</span>
                  <span className="text-cyan-400 font-bold">
                    <bdi>{bandwidthM} m</bdi>
                  </span>
                </div>
                <input
                  type="range"
                  min={40}
                  max={500}
                  step={10}
                  value={bandwidthM}
                  onChange={(e) => setBandwidthM(Number(e.target.value))}
                  className="w-full accent-cyan-400"
                />
              </div>
              <label className="flex items-center gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  checked={massConserving}
                  onChange={(e) => setMassConserving(e.target.checked)}
                />
                {copy.massConserving}
              </label>
              <label className="flex items-center gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  checked={includeVgi}
                  onChange={(e) => setIncludeVgi(e.target.checked)}
                />
                {copy.includeVgi}
              </label>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={executeNkde}
              className="mt-3 w-full py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              {busy ? copy.runningNkde : copy.runNkde}
            </button>
          </div>

          {nkdeResult && (
            <>
              <div className={cardCls}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-cyan-300">
                    <bdi>Job #{nkdeResult.job_id}</bdi> · <bdi>{nkdeResult.runtime_ms}ms</bdi>
                  </span>
                  {renderExportButtons(nkdeResult.job_id)}
                </div>
                <div className="grid grid-cols-3 gap-1.5 mb-2.5">
                  <button
                    type="button"
                    onClick={() => onChangeOverlay('nkde')}
                    className="py-1 px-2 rounded border border-cyan-500/50 bg-cyan-500/15 text-cyan-200 font-mono text-[10px]"
                  >
                    {copy.viewNkde}
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeOverlay('planar_kde')}
                    className="py-1 px-2 rounded border border-amber-500/50 bg-amber-500/15 text-amber-200 font-mono text-[10px]"
                  >
                    {copy.viewPlanar}
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeOverlay('planar_bias')}
                    className="py-1 px-2 rounded border border-rose-500/50 bg-rose-500/15 text-rose-200 font-mono text-[10px]"
                  >
                    {copy.viewBias}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 font-mono text-[11px] opacity-90">
                  <div>
                    {copy.eventsMass}: <b>{nkdeResult.summary_metrics.total_weighted_mass}</b>
                  </div>
                  <div>
                    {copy.conservedMass}: <b>{nkdeResult.summary_metrics.conserved_nkde_mass}</b>
                  </div>
                  <div>
                    {copy.peakNkde}: <b>{nkdeResult.summary_metrics.max_nkde_per_km_yr}/km</b>
                  </div>
                  <div>
                    {copy.maxPlanarBias}:{' '}
                    <b className="text-rose-400">+{nkdeResult.summary_metrics.max_planar_overestimation}/km</b>
                  </div>
                </div>
                {nkdeResult.summary_metrics.allocation_comparison && (
                  <div className="mt-2 pt-2 border-t border-slate-800 text-[10.5px] font-mono space-y-0.5 text-emerald-300">
                    <div className="font-sans font-semibold">{copy.allocDiffTitle}</div>
                    <div className="flex justify-between">
                      <span>
                        {copy.ambiguousIncidents}:{' '}
                        <b>{nkdeResult.summary_metrics.allocation_comparison.multi_candidate_incidents}</b>
                      </span>
                      <span>
                        {copy.massShiftPct}:{' '}
                        <b>{nkdeResult.summary_metrics.allocation_comparison.l1_mass_shift_pct}%</b>
                      </span>
                      <span>
                        {copy.maxDensityDiff}:{' '}
                        <b>{nkdeResult.summary_metrics.allocation_comparison.max_abs_density_diff_per_km_yr}/km</b>
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {nkdeResult.ground_truth_eval && (
                <div className={cardCls}>
                  <div className="font-semibold mb-1.5 flex items-center gap-1.5 text-emerald-400">
                    <Award className="w-4 h-4" />
                    {copy.gtBenchmark}
                  </div>
                  <table className="w-full font-mono tabular-nums text-[11px] border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-[10px] opacity-70">
                        <th className="py-1 text-start">{copy.metric}</th>
                        <th className="py-1 text-end text-cyan-400">{copy.networkKde}</th>
                        <th className="py-1 text-end text-amber-400">{copy.planarKde}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-slate-800/50">
                        <td className="py-1">PAI</td>
                        <td className="py-1 text-end font-bold">{nkdeResult.ground_truth_eval.nkde.pai}</td>
                        <td className="py-1 text-end">{nkdeResult.ground_truth_eval.planar_kde.pai}</td>
                      </tr>
                      <tr className="border-b border-slate-800/50">
                        <td className="py-1">RRI</td>
                        <td className="py-1 text-end font-bold">{nkdeResult.ground_truth_eval.nkde.rri}</td>
                        <td className="py-1 text-end">{nkdeResult.ground_truth_eval.planar_kde.rri}</td>
                      </tr>
                      <tr className="border-b border-slate-800/50">
                        <td className="py-1">RMSE (/km·yr)</td>
                        <td className="py-1 text-end font-bold text-emerald-400">
                          {nkdeResult.ground_truth_eval.nkde.rmse_per_km_yr}
                        </td>
                        <td className="py-1 text-end">{nkdeResult.ground_truth_eval.planar_kde.rmse_per_km_yr}</td>
                      </tr>
                      <tr>
                        <td className="py-1">Spearman ρ</td>
                        <td className="py-1 text-end font-bold">{nkdeResult.ground_truth_eval.nkde.spearman_rho}</td>
                        <td className="py-1 text-end">{nkdeResult.ground_truth_eval.planar_kde.spearman_rho}</td>
                      </tr>
                    </tbody>
                  </table>
                  {nkdeResult.ground_truth_eval.nkde.pai_curve &&
                    nkdeResult.ground_truth_eval.planar_kde.pai_curve && (
                      <PaiCurveChart
                        network={nkdeResult.ground_truth_eval.nkde.pai_curve}
                        planar={nkdeResult.ground_truth_eval.planar_kde.pai_curve}
                      />
                    )}
                </div>
              )}

              <div className={cardCls}>
                <div className="text-[10px] uppercase font-semibold opacity-70 mb-1">{copy.modelSpec}</div>
                <div dir="ltr" className="p-2 rounded bg-slate-950 font-mono text-[10px] text-cyan-200 overflow-x-auto">
                  {nkdeResult.mathematical_notes.formula_latex}
                </div>
                <p className="text-[11px] opacity-75 mt-1.5" dir="auto">
                  {nkdeResult.mathematical_notes.planar_comparison_note}
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 2: ADAPTIVE SPATIOTEMPORAL TNKDE */}
      {tab === 'tnkde' && (
        <div className="space-y-3">
          <div className={cardCls}>
            <div className="font-semibold mb-2 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              {copy.tnkdeTitle}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] opacity-70 mb-1">{copy.tnkdeSpatialM}</label>
                <input
                  dir="ltr"
                  type="number"
                  min={25}
                  max={800}
                  value={tnkdeSpatialM}
                  onChange={(e) => setTnkdeSpatialM(Number(e.target.value))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-[10px] opacity-70 mb-1">{copy.tnkdeTemporalDays}</label>
                <input
                  dir="ltr"
                  type="number"
                  step="0.5"
                  min={1}
                  max={90}
                  value={tnkdeTemporalDays}
                  onChange={(e) => setTnkdeTemporalDays(Number(e.target.value))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-[10px] opacity-70 mb-1">{copy.tnkdeSlices}</label>
                <input
                  dir="ltr"
                  type="number"
                  min={4}
                  max={24}
                  value={tnkdeSlices}
                  onChange={(e) => setTnkdeSlices(Number(e.target.value))}
                  className={inputCls}
                />
              </div>
            </div>
            <div className="space-y-1.5 mt-2.5 text-[11px]">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={tnkdeAdaptive}
                  onChange={(e) => setTnkdeAdaptive(e.target.checked)}
                />
                {copy.tnkdeAdaptive}
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={tnkdeCausal}
                  onChange={(e) => setTnkdeCausal(e.target.checked)}
                />
                {copy.tnkdeCausal}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={tnkdeLcv} onChange={(e) => setTnkdeLcv(e.target.checked)} />
                {copy.tnkdeLcv}
              </label>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={executeTnkde}
              className="mt-3 w-full py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold"
            >
              {busy ? copy.runningTnkde : copy.runTnkde}
            </button>
          </div>

          {tnkdeRes && (
            <div className={`${cardCls} space-y-2.5`}>
              <div className="flex items-center justify-between font-mono text-[11px]">
                <span>{copy.sliceTime}:</span>
                <b className="text-cyan-300" dir="ltr">
                  {tnkdeRes.slices_utc?.[activeSliceIdx]}
                </b>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, (tnkdeRes.slices_utc?.length || 1) - 1)}
                value={activeSliceIdx}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  setActiveSliceIdx(idx);
                  applyTnkdeSliceToMap(tnkdeRes, idx);
                  onChangeOverlay('tnkde');
                }}
                className="w-full accent-cyan-400"
              />
              <div className="grid grid-cols-2 gap-2 font-mono text-[10.5px]">
                <div>
                  {copy.selectedBandwidths}:{' '}
                  <b dir="ltr">
                    ({tnkdeRes.selected_spatial_m}m, {tnkdeRes.selected_temporal_days}d)
                  </b>
                </div>
                <div>
                  {copy.abramsonRange}:{' '}
                  <b dir="ltr">
                    [{tnkdeRes.abramson_factor_range?.[0]?.toFixed(2)},{' '}
                    {tnkdeRes.abramson_factor_range?.[1]?.toFixed(2)}]
                  </b>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: NETWORK GETIS-ORD Gi* & MORAN'S I */}
      {tab === 'gistar' && (
        <div className="space-y-3">
          <div className={cardCls}>
            <div className="font-semibold mb-2">{copy.giTitle}</div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="col-span-2">
                <label className="block text-[10px] opacity-70 mb-1">{copy.weightsScheme}</label>
                <select value={weightScheme} onChange={(e) => setWeightScheme(e.target.value as any)} className={inputCls}>
                  <option value="inverse_network_distance">{copy.invDist}</option>
                  <option value="fixed_network_band">{copy.bandDist}</option>
                  <option value="k_order_contiguity">{copy.kOrder}</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] opacity-70 mb-1">{copy.distCutM}</label>
                <input
                  dir="ltr"
                  type="number"
                  min={50}
                  max={800}
                  step={25}
                  value={distThreshM}
                  onChange={(e) => setDistThreshM(Number(e.target.value))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-[10px] opacity-70 mb-1">{copy.permutations}</label>
                <select value={permutations} onChange={(e) => setPermutations(Number(e.target.value))} className={inputCls}>
                  <option value={199}>199</option>
                  <option value={499}>499</option>
                  <option value={999}>999</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] opacity-70 mb-1">{copy.lixelVar}</label>
                <select value={attrMode} onChange={(e) => setAttrMode(e.target.value as any)} className={inputCls}>
                  <option value="crash_density">{copy.varDensity}</option>
                  <option value="epdo_rate">{copy.varEpdo}</option>
                  <option value="raw_count">{copy.varRaw}</option>
                </select>
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={executeGiStar}
              className="mt-3 w-full py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              {busy ? copy.runningGiStar : copy.runGiStar}
            </button>
          </div>

          {giStarResult && (
            <div className={cardCls}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-cyan-300">
                  <bdi>Job #{giStarResult.job_id}</bdi> · R={giStarResult.summary_metrics.permutations}
                </span>
                {renderExportButtons(giStarResult.job_id)}
              </div>
              <div className="grid grid-cols-2 gap-2 font-mono text-[11px] mb-2">
                <div>
                  Moran&apos;s I: <b>{giStarResult.summary_metrics.global_network_morans_i}</b> (p=
                  {giStarResult.summary_metrics.global_morans_p_value})
                </div>
                <div>
                  Peak Gi* Z: <b className="text-rose-400">{giStarResult.summary_metrics.max_gi_star_z}</b>
                </div>
                <div>
                  Hotspots (p&lt;0.01):{' '}
                  <b className="text-rose-400">{giStarResult.summary_metrics.class_counts.hotspot_99}</b>
                </div>
                <div>
                  FDR q&lt;0.05:{' '}
                  <b className="text-emerald-400">{giStarResult.summary_metrics.class_counts.hotspot_fdr_05}</b>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: NETWORK DBSCAN */}
      {tab === 'ndbscan' && (
        <div className="space-y-3">
          <div className={cardCls}>
            <div className="font-semibold mb-2">{copy.ndbscanTitle}</div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[10px] opacity-70 mb-1">{copy.epsNet}</label>
                <input
                  dir="ltr"
                  type="number"
                  min={20}
                  max={400}
                  step={5}
                  value={epsNetM}
                  onChange={(e) => setEpsNetM(Number(e.target.value))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-[10px] opacity-70 mb-1">{copy.minPts}</label>
                <input
                  dir="ltr"
                  type="number"
                  min={2}
                  max={20}
                  value={minSamples}
                  onChange={(e) => setMinSamples(Number(e.target.value))}
                  className={inputCls}
                />
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={executeNdbscan}
              className="mt-3 w-full py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {busy ? copy.runningNdbscan : copy.runNdbscan}
            </button>
          </div>

          {ndbscanResult && (
            <div className={cardCls}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-cyan-300">
                  {n(ndbscanResult.summary_metrics.cluster_count)} {copy.clustersFound}
                </span>
                {renderExportButtons(ndbscanResult.job_id)}
              </div>
              <div className="text-[11px] font-mono mb-2 opacity-85">
                {copy.clustered}: <b>{ndbscanResult.summary_metrics.clustered_incidents}</b> · {copy.noise}:{' '}
                <b>{ndbscanResult.summary_metrics.noise_incidents}</b> ({ndbscanResult.summary_metrics.noise_ratio_pct}
                %)
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: DIRECTED TOPOLOGY TRANSPORT & CHRONOLOGICAL BENCHMARK */}
      {tab === 'transport' && (
        <div className="space-y-3">
          <div className={`${cardCls} space-y-2.5`}>
            <div className="font-semibold flex items-center gap-1.5 text-cyan-300">
              <Compass className="w-3.5 h-3.5" />
              {copy.transportTitle}
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={executeDirectedTransportDemo}
                className="w-full py-1.5 rounded border border-cyan-500/60 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 font-semibold"
              >
                {copy.runTransport}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={executeHoldoutBenchmark}
                className="w-full py-1.5 rounded border border-emerald-500/60 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 font-semibold"
              >
                {copy.runBench}
              </button>
            </div>
            {topoSummary && (
              <div className="p-2 rounded bg-slate-950/75 border border-slate-800 font-mono text-[10.5px] space-y-1">
                <div>
                  States: <b>{topoSummary.state_count}</b> · Legal Transitions: <b>{topoSummary.transition_count}</b> ·
                  Assumed Bidirectional: <b>{topoSummary.assumed_bidirectional_segments}</b>
                </div>
                {transportSummary && (
                  <div className="text-cyan-300">
                    Mass conserved: {transportSummary.initial_mass} → <b>{transportSummary.final_mass}</b> (v
                    {transportSummary.topology_version})
                  </div>
                )}
              </div>
            )}
            {benchResult && (
              <div className="p-2 rounded bg-slate-950/75 border border-slate-800 space-y-1.5">
                <div className="text-[10.5px] font-semibold text-emerald-300">
                  {copy.benchSplit} ({benchResult.train_events} / {benchResult.holdout_events})
                </div>
                <table dir="ltr" className="w-full font-mono text-[10.5px] tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-800 opacity-70">
                      <th className="text-left py-1">Method</th>
                      <th className="text-right py-1">AU-PAI</th>
                      <th className="text-right py-1">PAI@10%</th>
                      <th className="text-right py-1">ρ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {benchResult.methods.map((m: any) => (
                      <tr key={m.method} className="border-b border-slate-800/40">
                        <td className="py-1">{m.method}</td>
                        <td className="py-1 text-right text-cyan-300 font-semibold">{m.au_pai ?? '—'}</td>
                        <td className="py-1 text-right">{m.pai_at_10pct ?? '—'}</td>
                        <td className="py-1 text-right">{m.spearman_rho}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Advanced Network Point-Process & Trajectory Primitives */}
          <div className={`${cardCls} space-y-2`}>
            <div className="font-semibold text-purple-300">{copy.advNetTitle}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={executeNetworkK}
                className="py-1.5 px-2 rounded border border-purple-500/60 bg-purple-500/15 hover:bg-purple-500/25 text-purple-200 font-semibold text-[10.5px]"
              >
                {copy.runNetK}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => executeVoronoiAndHmm('voronoi')}
                className="py-1.5 px-2 rounded border border-cyan-500/60 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 font-semibold text-[10.5px]"
              >
                {copy.runVoronoi}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => executeVoronoiAndHmm('hmm')}
                className="py-1.5 px-2 rounded border border-amber-500/60 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 font-semibold text-[10.5px]"
              >
                {copy.runHmm}
              </button>
            </div>
            {netKResult && (
              <div dir="ltr" className="p-2 rounded bg-slate-950/75 border border-slate-800 font-mono text-[10.5px]">
                Inhom. K/L (n={netKResult.event_count}): DCLF p ={' '}
                <b className="text-purple-300">{netKResult.dclf_global_p_value}</b> · Exceeds 95% env:{' '}
                <b>{String(netKResult.exceeds_upper_envelope)}</b>
              </div>
            )}
            {voronoiResult && (
              <div dir="ltr" className="p-2 rounded bg-slate-950/75 border border-slate-800 font-mono text-[10.5px]">
                Voronoi seeds: <b>{voronoiResult.event_seeds}</b> · Peak:{' '}
                <b className="text-cyan-300">{voronoiResult.max_voronoi_per_km}/km</b> · Median:{' '}
                <b>{voronoiResult.median_voronoi_per_km}/km</b>
              </div>
            )}
            {hmmResult && (
              <div dir="ltr" className="p-2 rounded bg-slate-950/75 border border-slate-800 font-mono text-[10.5px]">
                Viterbi HMM ({hmmResult.fix_count} fixes): exact recovery ={' '}
                <b className="text-amber-300">{(hmmResult.exact_state_recovery_rate ?? 0) * 100}%</b> · logScore={' '}
                {hmmResult.log_score?.toFixed(2)}
              </div>
            )}
          </div>

          {/* Multi-Seed MAUP Sensitivity, ZINB-STGraph & Consent-Gated Narrative Ablation */}
          <div className={`${cardCls} space-y-2`}>
            <div className="font-semibold text-emerald-300">{copy.maupTitle}</div>
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => executeMaupSuite('maup')}
                className="w-full py-1.5 px-2 rounded border border-emerald-500/60 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 font-semibold text-[10.5px]"
              >
                {copy.runMaup}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => executeMaupSuite('stgraph')}
                className="w-full py-1.5 px-2 rounded border border-cyan-500/60 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 font-semibold text-[10.5px]"
              >
                {copy.runStGraph}
              </button>
              <label className="flex items-center gap-1.5 text-[10.5px] pt-1">
                <input
                  type="checkbox"
                  checked={consentVerified}
                  onChange={(e) => setConsentVerified(e.target.checked)}
                />
                {copy.consentLabel}
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => executeMaupSuite('text')}
                className="w-full py-1.5 px-2 rounded border border-amber-500/60 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 font-semibold text-[10.5px]"
              >
                {copy.runTextAblation}
              </button>
            </div>
            {maupResult && (
              <div dir="ltr" className="p-2 rounded bg-slate-950/75 border border-slate-800 font-mono text-[10px] space-y-1">
                <div className="text-emerald-300 font-semibold truncate" title={maupResult.zoning_sensitivity_note}>
                  {maupResult.zoning_sensitivity_note}
                </div>
                {maupResult.resolutions?.map((rRow: any) => (
                  <div key={rRow.lixel_resolution_m} className="flex justify-between">
                    <span>
                      {rRow.lixel_resolution_m}m ({rRow.lixel_count} lx)
                    </span>
                    <span>AU-PAI: {rRow.au_pai?.mean}±{rRow.au_pai?.ci95_halfwidth}</span>
                    <span>
                      {rRow.runtime_ms}ms / {rRow.peak_memory_kb}KB
                    </span>
                  </div>
                ))}
              </div>
            )}
            {stGraphResult && (
              <div dir="ltr" className="p-2 rounded bg-slate-950/75 border border-slate-800 font-mono text-[10px] space-y-0.5">
                {stGraphResult.comparisons?.map((bRow: any) => (
                  <div key={bRow.method} className="flex justify-between">
                    <span>{bRow.method}</span>
                    <span className="text-cyan-300">AU-PAI: {bRow.au_pai}</span>
                    <span>RMSE: {bRow.test_rmse}</span>
                  </div>
                ))}
              </div>
            )}
            {textAblationResult && (
              <div dir="ltr" className="p-2 rounded bg-slate-950/75 border border-slate-800 font-mono text-[10px] space-y-0.5">
                <div className="text-amber-300">
                  Encoder: {textAblationResult.embedding_version} (ΔLogScore: {textAblationResult.text_lift_log_score})
                </div>
                {textAblationResult.ablations?.map((ab: any) => (
                  <div key={ab.variant} className="flex justify-between">
                    <span>{ab.variant}</span>
                    <span>AU-PAI: {ab.au_pai}</span>
                    <span>LogS: {ab.holdout_mean_log_score}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 6: COVARIATE CROSS-COMPARISON */}
      {tab === 'covariates' && covariates && (
        <div className="space-y-3">
          <div className={cardCls}>
            <div className="font-semibold mb-2">{copy.infraTitle}</div>
            <table className="w-full font-mono tabular-nums text-[11px] border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] opacity-70">
                  <th className="py-1 text-start">{copy.roadClass}</th>
                  <th className="py-1 text-end">km</th>
                  <th className="py-1 text-end">N/km</th>
                  <th className="py-1 text-end">EPDO/km</th>
                </tr>
              </thead>
              <tbody>
                {covariates.by_infrastructure.map((row: any) => (
                  <tr key={row.road_class} className="border-b border-slate-800/40">
                    <td className="py-1">
                      <bdi>{row.road_class}</bdi>
                    </td>
                    <td className="py-1 text-end">{row.total_km}</td>
                    <td className="py-1 text-end font-semibold text-cyan-400">{row.crashes_per_km}</td>
                    <td className="py-1 text-end text-amber-400">{row.epdo_per_km}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className={cardCls}>
              <div className="font-semibold mb-1.5">{copy.weatherRegimes}</div>
              {covariates.by_weather.map((w: any) => (
                <div key={w.weather} className="flex justify-between font-mono text-[11px] py-0.5">
                  <span>
                    <bdi>{domainLabel(language, w.weather, w.weather)}</bdi>
                  </span>
                  <span>
                    <b>{w.crash_count}</b> (μ={w.mean_epdo})
                  </span>
                </div>
              ))}
            </div>
            <div className={cardCls}>
              <div className="font-semibold mb-1.5">{copy.lightingCond}</div>
              {covariates.by_lighting.map((l: any) => (
                <div key={l.lighting} className="flex justify-between font-mono text-[11px] py-0.5">
                  <span>
                    <bdi>{l.lighting}</bdi>
                  </span>
                  <span>
                    <b>{l.crash_count}</b> (μ={l.mean_epdo})
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 7: JOB PROVENANCE */}
      {tab === 'provenance' && (
        <div className={cardCls}>
          <div className="font-semibold mb-2 flex items-center gap-1.5">
            <History className="w-3.5 h-3.5 text-cyan-400" />
            {copy.jobProvenance}
          </div>
          <div className="space-y-2">
            {jobs.length === 0 && <div className="opacity-60 font-mono">{copy.noJobs}</div>}
            {jobs.map((jb) => (
              <div
                key={jb.id}
                className="p-2 rounded border border-slate-800 bg-slate-950/60 flex items-center justify-between font-mono text-[11px]"
              >
                <div>
                  <span className="text-cyan-400 font-bold">
                    <bdi>
                      #{jb.id} {jb.job_type}
                    </bdi>
                  </span>{' '}
                  · N={jb.sample_size} · {jb.runtime_ms}ms · EPSG:{jb.crs_epsg}
                </div>
                {renderExportButtons(jb.id)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
