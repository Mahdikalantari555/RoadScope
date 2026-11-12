import React, { useEffect, useState } from 'react';
import {
  Award,
  Download,
  FlaskConical,
  History,
  Play,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { uaiApi } from '../api/client';
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
  nkdeResult: Record<string, any> | null;
  giStarResult: Record<string, any> | null;
  ndbscanResult: Record<string, any> | null;
}

type LabTab = 'nkde' | 'gistar' | 'ndbscan' | 'covariates' | 'provenance';

export const SpatialLabWorkspace: React.FC<SpatialLabWorkspaceProps> = ({
  darkMode,
  datasetId,
  activeRole,
  onChangeOverlay,
  onNkdeResult,
  onGiStarResult,
  onNdbscanResult,
  nkdeResult,
  giStarResult,
  ndbscanResult,
}) => {
  const [tab, setTab] = useState<LabTab>('nkde');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // NKDE params
  const [kernel, setKernel] = useState<'quartic' | 'epanechnikov' | 'gaussian'>('quartic');
  const [bandwidthM, setBandwidthM] = useState<number>(180);
  const [weighting, setWeighting] = useState<'uniform' | 'epdo_severity' | 'credibility_weighted'>('uniform');
  const [massConserving, setMassConserving] = useState<boolean>(true);
  const [includeVgi, setIncludeVgi] = useState<boolean>(false);

  // Gi* params
  const [weightScheme, setWeightScheme] = useState<'inverse_network_distance' | 'fixed_network_band' | 'k_order_contiguity'>('inverse_network_distance');
  const [distThreshM, setDistThreshM] = useState<number>(200);
  const [permutations, setPermutations] = useState<number>(499);
  const [attrMode, setAttrMode] = useState<'crash_density' | 'epdo_rate' | 'raw_count'>('crash_density');

  // N-DBSCAN params
  const [epsNetM, setEpsNetM] = useState<number>(85);
  const [minSamples, setMinSamples] = useState<number>(4);

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

  const executeNkde = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await uaiApi.runNkde({
        dataset_id: datasetId,
        kernel,
        bandwidth_m: bandwidthM,
        weighting,
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

  const cardCls = `rounded-md border p-3 ${
    darkMode ? 'bg-slate-900/75 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
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
          <Download className="w-3 h-3" /> CSV Table
        </a>
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3 text-xs">
      <div>
        <h2 className="font-semibold text-sm flex items-center gap-1.5">
          <FlaskConical className="w-4 h-4 text-cyan-400" />
          Spatial Analysis Laboratory (Network vs. Planar Geocomputation)
        </h2>
        <p className="text-[11px] opacity-70">
          Shortest-path Lixel topology in EPSG:25832 · PAI/RRI/RMSE Ground-Truth Validation
        </p>
      </div>

      {/* Sub-Navigation */}
      <div className="flex flex-wrap gap-1 border-b border-slate-800 pb-2">
        {[
          { id: 'nkde', label: 'NKDE vs Planar' },
          { id: 'gistar', label: "Gi* & Moran's I" },
          { id: 'ndbscan', label: 'N-DBSCAN' },
          { id: 'covariates', label: 'Covariates' },
          { id: 'provenance', label: `Jobs (${jobs.length})` },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id as LabTab)}
            className={`px-2.5 py-1 rounded text-[11px] font-medium border ${
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
        <div className="p-2.5 rounded border border-rose-500/60 bg-rose-500/15 text-rose-200 font-mono text-[11px]">
          {error}
        </div>
      )}

      {/* TAB 1: NKDE vs PLANAR KDE */}
      {tab === 'nkde' && (
        <div className="space-y-3">
          <div className={cardCls}>
            <div className="font-semibold mb-2 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              Lixel Network KDE Parameters
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[10px] uppercase opacity-70 mb-1">Kernel K(u)</label>
                <select
                  value={kernel}
                  onChange={(e) => setKernel(e.target.value as any)}
                  className="w-full px-2 py-1 rounded border border-slate-700 bg-slate-950 font-mono text-xs"
                >
                  <option value="quartic">Quartic (Biweight)</option>
                  <option value="epanechnikov">Epanechnikov</option>
                  <option value="gaussian">Gaussian (Truncated 3h)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase opacity-70 mb-1">
                  Event Weighting
                </label>
                <select
                  value={weighting}
                  onChange={(e) => setWeighting(e.target.value as any)}
                  className="w-full px-2 py-1 rounded border border-slate-700 bg-slate-950 font-mono text-xs"
                >
                  <option value="uniform">Uniform Count (w=1)</option>
                  <option value="epdo_severity">EPDO Severity Weighted</option>
                  <option value="credibility_weighted">VGI Credibility Weighted</option>
                </select>
              </div>
              <div className="col-span-2">
                <div className="flex justify-between text-[11px] font-mono mb-1">
                  <span>Network Bandwidth h_net (meters)</span>
                  <span className="text-cyan-400 font-bold">{bandwidthM} m</span>
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
                Okabe-Sugihara Mass Conservation
              </label>
              <label className="flex items-center gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  checked={includeVgi}
                  onChange={(e) => setIncludeVgi(e.target.checked)}
                />
                Include Unverified VGI
              </label>
            </div>

            <button
              disabled={busy}
              onClick={executeNkde}
              className="mt-3 w-full py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              {busy ? 'Computing Shortest-Path Lixel Kernels...' : 'Execute NKDE & Planar KDE Comparison'}
            </button>
          </div>

          {nkdeResult && (
            <>
              {/* Map Layer Quick Switcher: NKDE vs Planar vs Difference */}
              <div className={cardCls}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-cyan-300">
                    Job #{nkdeResult.job_id} · {nkdeResult.runtime_ms}ms
                  </span>
                  {renderExportButtons(nkdeResult.job_id)}
                </div>
                <div className="grid grid-cols-3 gap-1.5 mb-2.5">
                  <button
                    onClick={() => onChangeOverlay('nkde')}
                    className="py-1 px-2 rounded border border-cyan-500/50 bg-cyan-500/15 text-cyan-200 font-mono text-[10px]"
                  >
                    View NKDE
                  </button>
                  <button
                    onClick={() => onChangeOverlay('planar_kde')}
                    className="py-1 px-2 rounded border border-amber-500/50 bg-amber-500/15 text-amber-200 font-mono text-[10px]"
                  >
                    View Planar KDE
                  </button>
                  <button
                    onClick={() => onChangeOverlay('planar_bias')}
                    className="py-1 px-2 rounded border border-rose-500/50 bg-rose-500/15 text-rose-200 font-mono text-[10px]"
                  >
                    Planar Bias Δ
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 font-mono text-[11px] opacity-90">
                  <div>Events Mass: <b>{nkdeResult.summary_metrics.total_weighted_mass}</b></div>
                  <div>Conserved ∫λ dl: <b>{nkdeResult.summary_metrics.conserved_nkde_mass}</b></div>
                  <div>Peak NKDE: <b>{nkdeResult.summary_metrics.max_nkde_per_km_yr}/km</b></div>
                  <div>Max Planar Bias: <b className="text-rose-400">+{nkdeResult.summary_metrics.max_planar_overestimation}/km</b></div>
                </div>
              </div>

              {/* Quantitative Ground-Truth Benchmark (US-1.4) */}
              {nkdeResult.ground_truth_eval && (
                <div className={cardCls}>
                  <div className="font-semibold mb-1.5 flex items-center gap-1.5 text-emerald-400">
                    <Award className="w-4 h-4" />
                    Ground-Truth Benchmark vs. True λ(e, m, t)
                  </div>
                  <table className="w-full font-mono tabular-nums text-[11px] border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-[10px] opacity-70">
                        <th className="py-1 text-left">Metric</th>
                        <th className="py-1 text-right text-cyan-400">Network KDE</th>
                        <th className="py-1 text-right text-amber-400">Planar KDE</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-slate-800/50">
                        <td className="py-1">PAI (Prediction Accuracy)</td>
                        <td className="py-1 text-right font-bold">{nkdeResult.ground_truth_eval.nkde.pai}</td>
                        <td className="py-1 text-right">{nkdeResult.ground_truth_eval.planar_kde.pai}</td>
                      </tr>
                      <tr className="border-b border-slate-800/50">
                        <td className="py-1">RRI (Recapture Rate Index)</td>
                        <td className="py-1 text-right font-bold">{nkdeResult.ground_truth_eval.nkde.rri}</td>
                        <td className="py-1 text-right">{nkdeResult.ground_truth_eval.planar_kde.rri}</td>
                      </tr>
                      <tr className="border-b border-slate-800/50">
                        <td className="py-1">RMSE (crashes/km·yr)</td>
                        <td className="py-1 text-right font-bold text-emerald-400">{nkdeResult.ground_truth_eval.nkde.rmse_per_km_yr}</td>
                        <td className="py-1 text-right">{nkdeResult.ground_truth_eval.planar_kde.rmse_per_km_yr}</td>
                      </tr>
                      <tr>
                        <td className="py-1">Spearman Rank ρ</td>
                        <td className="py-1 text-right font-bold">{nkdeResult.ground_truth_eval.nkde.spearman_rho}</td>
                        <td className="py-1 text-right">{nkdeResult.ground_truth_eval.planar_kde.spearman_rho}</td>
                      </tr>
                    </tbody>
                  </table>
                  {nkdeResult.ground_truth_eval.nkde.pai_curve && nkdeResult.ground_truth_eval.planar_kde.pai_curve && (
                    <PaiCurveChart network={nkdeResult.ground_truth_eval.nkde.pai_curve} planar={nkdeResult.ground_truth_eval.planar_kde.pai_curve} />
                  )}
                </div>
              )}

              {/* Mathematical Formulation Note */}
              <div className={cardCls}>
                <div className="text-[10px] uppercase font-semibold opacity-70 mb-1">
                  Formal Model Specification
                </div>
                <div className="p-2 rounded bg-slate-950 font-mono text-[10px] text-cyan-200 overflow-x-auto">
                  {nkdeResult.mathematical_notes.formula_latex}
                </div>
                <p className="text-[11px] opacity-75 mt-1.5">
                  {nkdeResult.mathematical_notes.planar_comparison_note}
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 2: NETWORK GETIS-ORD Gi* & MORAN'S I */}
      {tab === 'gistar' && (
        <div className="space-y-3">
          <div className={cardCls}>
            <div className="font-semibold mb-2">Network Spatial Autocorrelation (Gi* &amp; LISA)</div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="col-span-2">
                <label className="block text-[10px] uppercase opacity-70 mb-1">
                  Topological Spatial Weights W_net
                </label>
                <select
                  value={weightScheme}
                  onChange={(e) => setWeightScheme(e.target.value as any)}
                  className="w-full px-2 py-1 rounded border border-slate-700 bg-slate-950 font-mono text-xs"
                >
                  <option value="inverse_network_distance">Inverse Shortest-Path Distance</option>
                  <option value="fixed_network_band">Binary Network Distance Band</option>
                  <option value="k_order_contiguity">k-Order Lixel Contiguity</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase opacity-70 mb-1">Distance Cut (m)</label>
                <input
                  type="number"
                  min={50}
                  max={800}
                  step={25}
                  value={distThreshM}
                  onChange={(e) => setDistThreshM(Number(e.target.value))}
                  className="w-full px-2 py-1 rounded border border-slate-700 bg-slate-950 font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase opacity-70 mb-1">Permutations R</label>
                <select
                  value={permutations}
                  onChange={(e) => setPermutations(Number(e.target.value))}
                  className="w-full px-2 py-1 rounded border border-slate-700 bg-slate-950 font-mono text-xs"
                >
                  <option value={199}>199 (Fast)</option>
                  <option value={499}>499 (Standard)</option>
                  <option value={999}>999 (Publication)</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] uppercase opacity-70 mb-1">Lixel Variable x_j</label>
                <select
                  value={attrMode}
                  onChange={(e) => setAttrMode(e.target.value as any)}
                  className="w-full px-2 py-1 rounded border border-slate-700 bg-slate-950 font-mono text-xs"
                >
                  <option value="crash_density">Linear Crash Density (N / km)</option>
                  <option value="epdo_rate">Severity-Weighted EPDO / km</option>
                  <option value="raw_count">Raw Lixel Crash Count</option>
                </select>
              </div>
            </div>
            <button
              disabled={busy}
              onClick={executeGiStar}
              className="mt-3 w-full py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              {busy ? 'Running Monte Carlo Spatial Permutations...' : "Execute Network Gi* & Moran's I"}
            </button>
          </div>

          {giStarResult && (
            <div className={cardCls}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-cyan-300">
                  Job #{giStarResult.job_id} · R={giStarResult.summary_metrics.permutations}
                </span>
                {renderExportButtons(giStarResult.job_id)}
              </div>
              <div className="grid grid-cols-2 gap-2 font-mono text-[11px] mb-2">
                <div>Global Moran&apos;s I: <b>{giStarResult.summary_metrics.global_network_morans_i}</b> (p={giStarResult.summary_metrics.global_morans_p_value})</div>
                <div>Peak Gi* Z: <b className="text-rose-400">{giStarResult.summary_metrics.max_gi_star_z}</b></div>
                <div>Hotspots (p&lt;0.01): <b className="text-rose-400">{giStarResult.summary_metrics.class_counts.hotspot_99} lixels</b></div>
                <div>FDR q&lt;0.05 Sig: <b className="text-emerald-400">{giStarResult.summary_metrics.class_counts.hotspot_fdr_05} lixels</b></div>
              </div>
              {giStarResult.ground_truth_eval && (
                <div className="p-2 rounded bg-slate-950 border border-slate-800 font-mono text-[10px] flex justify-between">
                  <span>GT PAI: <b className="text-emerald-400">{giStarResult.ground_truth_eval.pai}</b></span>
                  <span>Hit Rate: <b>{giStarResult.ground_truth_eval.hit_rate_pct}%</b></span>
                  <span>Coverage: <b>{giStarResult.ground_truth_eval.network_coverage_pct}%</b></span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: NETWORK DBSCAN */}
      {tab === 'ndbscan' && (
        <div className="space-y-3">
          <div className={cardCls}>
            <div className="font-semibold mb-2">Network DBSCAN (Shortest-Path Graph Clustering)</div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[10px] uppercase opacity-70 mb-1">ε_net Neighborhood (m)</label>
                <input
                  type="number"
                  min={20}
                  max={400}
                  step={5}
                  value={epsNetM}
                  onChange={(e) => setEpsNetM(Number(e.target.value))}
                  className="w-full px-2 py-1 rounded border border-slate-700 bg-slate-950 font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase opacity-70 mb-1">MinPts Core Threshold</label>
                <input
                  type="number"
                  min={2}
                  max={20}
                  value={minSamples}
                  onChange={(e) => setMinSamples(Number(e.target.value))}
                  className="w-full px-2 py-1 rounded border border-slate-700 bg-slate-950 font-mono text-xs"
                />
              </div>
            </div>
            <button
              disabled={busy}
              onClick={executeNdbscan}
              className="mt-3 w-full py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {busy ? 'Traversing Graph Neighborhoods...' : 'Execute N-DBSCAN Subgraph Clustering'}
            </button>
          </div>

          {ndbscanResult && (
            <div className={cardCls}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-cyan-300">
                  {ndbscanResult.summary_metrics.cluster_count} Micro-Scale Network Clusters
                </span>
                {renderExportButtons(ndbscanResult.job_id)}
              </div>
              <div className="text-[11px] font-mono mb-2 opacity-85">
                Clustered: <b>{ndbscanResult.summary_metrics.clustered_incidents}</b> · Noise:{' '}
                <b>{ndbscanResult.summary_metrics.noise_incidents}</b> ({ndbscanResult.summary_metrics.noise_ratio_pct}%)
              </div>
              <div className="max-h-56 overflow-y-auto space-y-1.5">
                {(ndbscanResult.clusters || []).map((cl: any) => (
                  <div
                    key={cl.cluster_id}
                    className="p-2 rounded border border-slate-800 bg-slate-950/60 flex items-center justify-between font-mono text-[11px]"
                  >
                    <div className="truncate pr-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style={{ backgroundColor: cl.color }} />
                      <b>C#{cl.cluster_id}</b> · {cl.primary_corridors}
                    </div>
                    <div className="shrink-0 text-right">
                      <b>{cl.incident_count}</b> pts · EPDO {cl.epdo_sum}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: COVARIATE CROSS-COMPARISON */}
      {tab === 'covariates' && covariates && (
        <div className="space-y-3">
          <div className={cardCls}>
            <div className="font-semibold mb-2">Infrastructure Hierarchy Cross-Comparison</div>
            <table className="w-full font-mono tabular-nums text-[11px] border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] opacity-70">
                  <th className="py-1 text-left">Road Class</th>
                  <th className="py-1 text-right">km</th>
                  <th className="py-1 text-right">N/km</th>
                  <th className="py-1 text-right">EPDO/km</th>
                </tr>
              </thead>
              <tbody>
                {covariates.by_infrastructure.map((row: any) => (
                  <tr key={row.road_class} className="border-b border-slate-800/40">
                    <td className="py-1">{row.road_class}</td>
                    <td className="py-1 text-right">{row.total_km}</td>
                    <td className="py-1 text-right font-semibold text-cyan-400">{row.crashes_per_km}</td>
                    <td className="py-1 text-right text-amber-400">{row.epdo_per_km}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className={cardCls}>
              <div className="font-semibold mb-1.5">Weather Regimes</div>
              {covariates.by_weather.map((w: any) => (
                <div key={w.weather} className="flex justify-between font-mono text-[11px] py-0.5">
                  <span>{w.weather}</span>
                  <span><b>{w.crash_count}</b> (EPDO μ={w.mean_epdo})</span>
                </div>
              ))}
            </div>
            <div className={cardCls}>
              <div className="font-semibold mb-1.5">Lighting Conditions</div>
              {covariates.by_lighting.map((l: any) => (
                <div key={l.lighting} className="flex justify-between font-mono text-[11px] py-0.5">
                  <span>{l.lighting}</span>
                  <span><b>{l.crash_count}</b> (μ={l.mean_epdo})</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: JOB PROVENANCE */}
      {tab === 'provenance' && (
        <div className={cardCls}>
          <div className="font-semibold mb-2 flex items-center gap-1.5">
            <History className="w-3.5 h-3.5 text-cyan-400" />
            Reproducible Analytical Job Provenance
          </div>
          <div className="space-y-2">
            {jobs.length === 0 && <div className="opacity-60 font-mono">No spatial jobs executed yet.</div>}
            {jobs.map((jb) => (
              <div key={jb.job_id} className="p-2 rounded border border-slate-800 bg-slate-950/60 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold text-cyan-300">
                    #{jb.job_id} · {jb.job_type} (EPSG:{jb.crs_epsg})
                  </span>
                  {renderExportButtons(jb.job_id)}
                </div>
                <div className="text-[10px] font-mono opacity-75">
                  N={jb.sample_size} · {jb.runtime_ms}ms · {jb.created_at_utc}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
