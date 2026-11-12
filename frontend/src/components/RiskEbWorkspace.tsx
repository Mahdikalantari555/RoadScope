import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Calculator, RefreshCw, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { uaiApi } from '../api/client';
import { useLanguage } from '../i18n';
import { getRiskEbText } from '../workspaceI18n';
import { CureChart } from './CureChart';
import type { MapOverlayMode, RiskEbPayload } from '../types/uai';

interface RiskEbWorkspaceProps {
  darkMode: boolean;
  datasetId: number;
  overlayMode: MapOverlayMode;
  onChangeOverlay: (mode: MapOverlayMode) => void;
  riskData: RiskEbPayload | null;
  onRiskDataLoaded: (payload: RiskEbPayload | null) => void;
  onFlyToSegment: (segmentId: number) => void;
}

export const RiskEbWorkspace: React.FC<RiskEbWorkspaceProps> = ({
  darkMode,
  datasetId,
  overlayMode,
  onChangeOverlay,
  riskData,
  onRiskDataLoaded,
  onFlyToSegment,
}) => {
  const { language } = useLanguage();
  const copy = getRiskEbText(language);

  const [wEb, setWEb] = useState(0.4);
  const [wEpdo, setWEpdo] = useState(0.3);
  const [wGeom, setWGeom] = useState(0.15);
  const [wEnv, setWEnv] = useState(0.15);
  const [loading, setLoading] = useState(false);
  const [riskError, setRiskError] = useState(false);
  const riskRequest = useRef(0);

  // Posterior EVPI Decision Calculator state
  const [installCostK, setInstallCostK] = useState(45);
  const [cmfPct, setCmfPct] = useState(28);
  const [crashCostK, setCrashCostK] = useState(22);
  const [evpiResult, setEvpiResult] = useState<Record<string, any> | null>(null);
  const [surrogates, setSurrogates] = useState<Record<string, any> | null>(null);
  const [bym2Result, setBym2Result] = useState<Record<string, any> | null>(null);
  const [jointLnResult, setJointLnResult] = useState<Record<string, any> | null>(null);
  const [surrogateFusion, setSurrogateFusion] = useState<Record<string, any> | null>(null);
  const [advBusy, setAdvBusy] = useState(false);

  const recompute = async (eb = wEb, ep = wEpdo, gm = wGeom, ev = wEnv) => {
    const request = ++riskRequest.current;
    setLoading(true);
    setRiskError(false);
    try {
      const [res, surr] = await Promise.all([
        uaiApi.evaluateRiskEb({
          dataset_id: datasetId,
          w_eb_risk: eb,
          w_epdo_severity: ep,
          w_geometric_hazard: gm,
          w_environmental_cov: ev,
        }),
        uaiApi.getSurrogates(datasetId).catch(() => null),
      ]);
      if (request !== riskRequest.current) return;
      onRiskDataLoaded(res);
      setSurrogates(surr);
    } catch {
      if (request === riskRequest.current) {
        onRiskDataLoaded(null);
        setRiskError(true);
      }
    } finally {
      if (request === riskRequest.current) setLoading(false);
    }
  };

  useEffect(() => {
    void recompute();
    return () => { riskRequest.current += 1; };
  }, [datasetId]);

  const computeEvpiDecision = async () => {
    const top = riskData?.ranked_corridors?.[0];
    if (!top) return;
    const mean = Math.max(0.2, top.eb_expected_crashes);
    const sd = Math.max(0.15, top.eb_se);
    // Deterministic quantile grid over Gamma posterior matching (mean, sd)
    const shape = (mean / sd) ** 2;
    const scale = (sd ** 2) / mean;
    const zQuantiles = [-1.64, -1.04, -0.52, 0.0, 0.52, 1.04, 1.64, 2.33];
    const reduction = Math.min(0.9, Math.max(0.01, cmfPct / 100));
    const losses = zQuantiles.map((z) => {
      // Wilson-Hilferty gamma quantile approximation
      const wh = Math.max(0.05, 1 - 1 / (9 * shape) + z / (3 * Math.sqrt(shape))) ** 3;
      const lambdaDraw = shape * scale * wh;
      const lossDoNothing = lambdaDraw * crashCostK;
      const lossTreat = installCostK + lambdaDraw * (1 - reduction) * crashCostK;
      return [Number(lossDoNothing.toFixed(3)), Number(lossTreat.toFixed(3))];
    });
    const res = await uaiApi.runResearchEvpi({
      losses,
      actions: ['do_nothing', 'install_countermeasure'],
      loss_unit: 'kEUR_per_year',
      horizon_years: 1.0,
    });
    setEvpiResult({ ...res, corridorName: top.name });
  };

  const executeBym2 = async () => {
    setAdvBusy(true);
    try {
      const res = await uaiApi.runResearchBym2({
        dataset_id: datasetId,
        imputations_m: 10,
        chains: 4,
        draws_per_chain: 160,
        random_seed: 42,
      });
      setBym2Result(res.result);
    } finally {
      setAdvBusy(false);
    }
  };

  const executeJointLinkNode = async () => {
    setAdvBusy(true);
    try {
      const res = await uaiApi.runResearchJointLinkNode({
        dataset_id: datasetId,
        junction_buffer_m: 22.0,
        chains: 3,
        draws_per_chain: 140,
        random_seed: 42,
      });
      setJointLnResult(res.result);
    } finally {
      setAdvBusy(false);
    }
  };

  const executeSurrogateFusion = async () => {
    setAdvBusy(true);
    try {
      const res = await uaiApi.runResearchSurrogateJoint({
        dataset_id: datasetId,
        seed_synthetic_if_empty: true,
        random_seed: 42,
      });
      setSurrogateFusion(res.result);
      const surr = await uaiApi.getSurrogates(datasetId).catch(() => null);
      if (surr) setSurrogates(surr);
    } finally {
      setAdvBusy(false);
    }
  };

  const metricButtons: { mode: MapOverlayMode; short: string; desc: string }[] = [
    { mode: 'risk_bivariate_uncertainty', short: copy.mBiv, desc: copy.mBivDesc },
    { mode: 'risk_eb_expected', short: copy.mEb, desc: copy.mEbDesc },
    { mode: 'risk_psi', short: copy.mPsi, desc: copy.mPsiDesc },
    { mode: 'risk_mcda', short: copy.mMcda, desc: copy.mMcdaDesc },
    { mode: 'risk_raw_n', short: copy.mRaw, desc: copy.mRawDesc },
    { mode: 'risk_linear_density', short: copy.mLin, desc: copy.mLinDesc },
    { mode: 'risk_epdo', short: copy.mEpdo, desc: copy.mEpdoDesc },
    { mode: 'risk_mvkt', short: copy.mMvkt, desc: copy.mMvktDesc },
  ];

  const cardCls = `rounded-md border p-3 ${
    darkMode ? 'bg-slate-900/75 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
  }`;

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-sm flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            {copy.title}
          </h2>
          <p className="text-[11px] opacity-70">{copy.subtitle}</p>
        </div>
        {loading && <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />}
      </div>

      {riskError && <p role="alert" className="rounded border border-amber-500/50 p-3 text-amber-300">
        {language === 'fa' ? 'ارزیابی ریسک در دسترس نیست؛ ورودی‌ها و اعتبار مدل را بررسی کنید.' : 'Risk evaluation is unavailable; review inputs and model validation.'}
      </p>}

      {/* Multi-Tiered Safety & Risk Map Layer Selector */}
      <div className={cardCls}>
        <div className="font-semibold mb-2">{copy.selectMetric}</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {metricButtons.map((btn) => {
            const active = overlayMode === btn.mode;
            return (
              <button
                type="button"
                key={btn.mode}
                onClick={() => onChangeOverlay(btn.mode)}
                className={`p-1.5 rounded border text-start transition-colors ${
                  active
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                    : 'border-slate-800 hover:border-slate-700 opacity-85'
                }`}
              >
                <div className="font-mono font-semibold text-[11px]">{btn.short}</div>
                <div className="text-[9px] opacity-70 truncate">{btn.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Multi-Criteria Vulnerability Sensitivity Sliders */}
      <div className={cardCls}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold flex items-center gap-1.5">
            <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
            {copy.weightsTitle}
          </span>
          <button
            type="button"
            onClick={() => recompute(wEb, wEpdo, wGeom, wEnv)}
            className="px-2 py-0.5 rounded bg-cyan-500 text-slate-950 font-semibold text-[11px]"
          >
            {copy.applySliders}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5 font-mono text-[11px]">
          <div>
            <div className="flex justify-between">
              <span className="font-sans">{copy.wEbLabel}</span>
              <b>{wEb.toFixed(2)}</b>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={wEb}
              onChange={(e) => setWEb(Number(e.target.value))}
              className="w-full accent-cyan-400"
            />
          </div>
          <div>
            <div className="flex justify-between">
              <span className="font-sans">{copy.wEpdoLabel}</span>
              <b>{wEpdo.toFixed(2)}</b>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={wEpdo}
              onChange={(e) => setWEpdo(Number(e.target.value))}
              className="w-full accent-amber-400"
            />
          </div>
          <div>
            <div className="flex justify-between">
              <span className="font-sans">{copy.wGeomLabel}</span>
              <b>{wGeom.toFixed(2)}</b>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={wGeom}
              onChange={(e) => setWGeom(Number(e.target.value))}
              className="w-full accent-emerald-400"
            />
          </div>
          <div>
            <div className="flex justify-between">
              <span className="font-sans">{copy.wEnvLabel}</span>
              <b>{wEnv.toFixed(2)}</b>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={wEnv}
              onChange={(e) => setWEnv(Number(e.target.value))}
              className="w-full accent-purple-400"
            />
          </div>
        </div>

        {riskData && (
          <div className="mt-2 p-2 rounded border border-amber-500/35 bg-amber-500/10 text-amber-200 text-[10px] flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
            <span dir="auto">{riskData.metric_epistemology_disclaimer}</span>
          </div>
        )}
      </div>

      {riskData && (
        <>
          <div className={cardCls}>
            <div className="font-semibold mb-1.5">{copy.rtmTitle}</div>
            <p className="text-[10px] opacity-70 mb-2">{copy.rtmSubtitle}</p>
            <div className="space-y-2 font-mono text-[10px]">
              {riskData.ranked_corridors.slice(0, 5).map((c) => {
                const maxVal = Math.max(15, c.eb_ci95_high, c.raw_crash_frequency, c.spf_prior_expected);
                return (
                  <div key={c.segment_id} className="space-y-0.5">
                    <div className="flex justify-between">
                      <span className="font-sans font-medium truncate max-w-[190px]">
                        <bdi>{c.name}</bdi>
                      </span>
                      <span dir="ltr">
                        N=<b>{c.raw_crash_frequency}</b> → EB{' '}
                        <b className="text-cyan-400">{c.eb_expected_crashes}</b> (w={c.eb_weight_w})
                      </span>
                    </div>
                    <div dir="ltr" className="relative h-3 bg-slate-800 rounded overflow-hidden">
                      <div
                        className="absolute top-0.5 bottom-0.5 bg-cyan-400/25 rounded"
                        style={{
                          left: `${(c.eb_ci95_low / maxVal) * 100}%`,
                          width: `${Math.max(2, ((c.eb_ci95_high - c.eb_ci95_low) / maxVal) * 100)}%`,
                        }}
                      />
                      <div
                        title={`SPF Prior μ = ${c.spf_prior_expected}`}
                        className="absolute top-0 bottom-0 w-1 bg-slate-400"
                        style={{ left: `${(c.spf_prior_expected / maxVal) * 100}%` }}
                      />
                      <div
                        title={`Observed N = ${c.raw_crash_frequency}`}
                        className="absolute top-0 bottom-0 w-1.5 bg-rose-400"
                        style={{ left: `${(c.raw_crash_frequency / maxVal) * 100}%` }}
                      />
                      <div
                        title={`EB Posterior = ${c.eb_expected_crashes}`}
                        className="absolute top-0 bottom-0 w-1.5 bg-cyan-300"
                        style={{ left: `${(c.eb_expected_crashes / maxVal) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="flex justify-between pt-1 text-[9px] opacity-75 font-sans">
                <span>{copy.legendPrior}</span>
                <span className="text-cyan-300">{copy.legendPost}</span>
                <span className="text-rose-400">{copy.legendRaw}</span>
              </div>
            </div>
          </div>

          {riskData.cure_diagnostic && (
            <div className={cardCls}>
              <CureChart diagnostic={riskData.cure_diagnostic} />
            </div>
          )}

          {/* Fitted Length-Scaled NB-SPF Comparison */}
          {riskData.length_scaled_eb && (
            <div className={`${cardCls} space-y-2`}>
              <div className="font-semibold text-cyan-300">{copy.lengthSpfTitle}</div>
              <div dir="ltr" className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[10.5px]">
                <div>
                  β₀: <b>{riskData.length_scaled_eb.beta_0 ?? '—'}</b>
                </div>
                <div>
                  β₁(ln AADT): <b>{riskData.length_scaled_eb.beta_1_log_aadt ?? '—'}</b>
                </div>
                <div>
                  α₁(/km): <b>{riskData.length_scaled_eb.alpha_1_per_km ?? '—'}</b>
                </div>
                <div>
                  ρ vs Legacy: <b>{riskData.length_scaled_eb.rank_spearman_vs_legacy ?? '—'}</b>
                </div>
              </div>
              <p className="text-[10px] opacity-75" dir="auto">
                {riskData.length_scaled_eb.limitations}
              </p>
            </div>
          )}

          {/* Interactive Posterior EVPI Decision-Support Calculator */}
          <div className={`${cardCls} space-y-2`}>
            <div className="font-semibold flex items-center gap-1.5 text-emerald-300">
              <Calculator className="w-3.5 h-3.5" />
              {copy.evpiTitle}
            </div>
            <p className="text-[10px] opacity-75">{copy.evpiDesc}</p>
            <div className="grid grid-cols-3 gap-2 font-mono text-[10.5px]">
              <div>
                <label className="block text-[9.5px] font-sans opacity-75 mb-0.5">{copy.costInstall}</label>
                <input
                  dir="ltr"
                  type="number"
                  min={1}
                  max={500}
                  value={installCostK}
                  onChange={(e) => setInstallCostK(Number(e.target.value))}
                  className="w-full px-1.5 py-1 rounded border border-slate-700 bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-[9.5px] font-sans opacity-75 mb-0.5">{copy.cmfReduction}</label>
                <input
                  dir="ltr"
                  type="number"
                  min={1}
                  max={85}
                  value={cmfPct}
                  onChange={(e) => setCmfPct(Number(e.target.value))}
                  className="w-full px-1.5 py-1 rounded border border-slate-700 bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-[9.5px] font-sans opacity-75 mb-0.5">{copy.crashUnitCost}</label>
                <input
                  dir="ltr"
                  type="number"
                  min={1}
                  max={1000}
                  value={crashCostK}
                  onChange={(e) => setCrashCostK(Number(e.target.value))}
                  className="w-full px-1.5 py-1 rounded border border-slate-700 bg-slate-950"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={computeEvpiDecision}
              className="w-full py-1.5 rounded bg-emerald-500/20 border border-emerald-400/60 hover:bg-emerald-500/30 text-emerald-200 font-semibold"
            >
              {copy.runEvpi}
            </button>
            {evpiResult && (
              <div className="p-2 rounded bg-slate-950/80 border border-slate-800 font-mono text-[10.5px] flex items-center justify-between">
                <span>
                  <bdi>{evpiResult.corridorName}</bdi> → {copy.optimalAction}:{' '}
                  <b className="text-emerald-300">{evpiResult.actions?.[evpiResult.optimal_action]}</b>
                </span>
                <span>
                  {copy.evpiValue}: <b className="text-cyan-300">{evpiResult.evpi?.toFixed(2)} k€</b>
                </span>
              </div>
            )}
          </div>

          {/* Spatial Hierarchical BYM2 MCMC, Rubin VGI Multiple Imputation & Joint Link-Node */}
          <div className={`${cardCls} space-y-2`}>
            <div className="font-semibold text-cyan-300">{copy.bym2Title}</div>
            <p className="text-[10px] opacity-75">{copy.bym2Desc}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                disabled={advBusy}
                onClick={executeBym2}
                className="py-1.5 px-2 rounded bg-cyan-500/20 border border-cyan-400/60 hover:bg-cyan-500/30 text-cyan-200 font-semibold disabled:opacity-50"
              >
                {copy.runBym2}
              </button>
              <button
                type="button"
                disabled={advBusy}
                onClick={executeJointLinkNode}
                className="py-1.5 px-2 rounded bg-purple-500/20 border border-purple-400/60 hover:bg-purple-500/30 text-purple-200 font-semibold disabled:opacity-50"
              >
                {copy.runJointLinkNode}
              </button>
            </div>
            {bym2Result && (
              <div className="p-2 rounded bg-slate-950/80 border border-slate-800 space-y-1 font-mono text-[10.5px]">
                <div dir="ltr" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    R̂_max: <b className="text-emerald-300">{bym2Result.bym2?.diagnostics?.max_split_rhat}</b>
                  </div>
                  <div>
                    ESS_min: <b className="text-cyan-300">{bym2Result.bym2?.diagnostics?.min_bulk_ess}</b>
                  </div>
                  <div>
                    ρ_Riebler: <b>{bym2Result.bym2?.rho_spatial_mixing}</b>
                  </div>
                  <div>
                    FMI_Rubin: <b className="text-amber-300">{bym2Result.vgi_multiple_imputation?.mean_fmi}</b>
                  </div>
                </div>
              </div>
            )}
            {jointLnResult && (
              <div dir="ltr" className="p-2 rounded bg-slate-950/80 border border-slate-800 font-mono text-[10.5px] flex justify-between">
                <span>
                  Links: <b>{jointLnResult.link_count}</b> · Nodes: <b>{jointLnResult.node_count}</b> (Junction N=
                  <b>{jointLnResult.total_junction_crashes}</b>)
                </span>
                <span className="text-purple-300">
                  ΔLogScore: <b>{jointLnResult.comparison_vs_segment_bym2?.delta_log_score}</b>
                </span>
              </div>
            )}
          </div>

          {/* Surrogate Safety Coverage Summary & Bivariate Poisson-Lognormal Fusion */}
          <div className={`${cardCls} space-y-2`}>
            <div className="font-semibold text-amber-300">{copy.surrogateTitle}</div>
            {surrogates && (
              <div className="grid grid-cols-3 gap-2 font-mono text-[10.5px]">
                <div>
                  {copy.uncoveredSegs}: <b>{surrogates.uncovered_segments}</b>
                </div>
                <div>
                  {copy.zeroConflictSegs}: <b>{surrogates.covered_zero_conflict_segments}</b>
                </div>
                <div>
                  {copy.posConflictSegs}: <b className="text-emerald-300">{surrogates.covered_positive_conflict_segments}</b>
                </div>
              </div>
            )}
            <button
              type="button"
              disabled={advBusy}
              onClick={executeSurrogateFusion}
              className="w-full py-1.5 rounded bg-amber-500/20 border border-amber-400/60 hover:bg-amber-500/30 text-amber-200 font-semibold disabled:opacity-50"
            >
              {copy.surrogateFusionBtn}
            </button>
            {surrogateFusion && (
              <div className="p-2 rounded bg-slate-950/80 border border-slate-800 font-mono text-[10.5px] flex flex-wrap justify-between gap-2">
                <span>
                  {copy.latentRho}:{' '}
                  <b className="text-amber-300">{surrogateFusion.model?.latent_correlation_rho}</b> (R̂=
                  {surrogateFusion.model?.diagnostics?.max_split_rhat})
                </span>
                <span dir="ltr">
                  RMSE: <b className="text-emerald-300">{surrogateFusion.held_out_evaluation?.joint_bivariate_pln?.latent_mu_rmse}</b>{' '}
                  vs {surrogateFusion.held_out_evaluation?.exposure_only_spf?.latent_mu_rmse}
                </span>
              </div>
            )}
          </div>

          {/* Ranked Corridor Priority Table */}
          <div className={cardCls}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold">{copy.rankedTitle}</span>
              <span className="text-[10px] font-mono opacity-70">
                {copy.imputedCount}: {riskData.network_summary.imputed_aadt_segments}
              </span>
            </div>
            <div className="overflow-x-auto max-h-64">
              <table className="w-full text-start border-collapse font-mono tabular-nums text-[10.5px]">
                <thead>
                  <tr className="border-b border-slate-800 text-[9.5px] uppercase opacity-70">
                    <th className="py-1">#</th>
                    <th className="py-1 text-start">{copy.corridor}</th>
                    <th className="py-1 text-end">N_EB</th>
                    <th className="py-1 text-end">PSI</th>
                    <th className="py-1 text-end">MVKT</th>
                    <th className="py-1 text-end">MCDA</th>
                    <th className="py-1 text-end">Biv</th>
                  </tr>
                </thead>
                <tbody>
                  {riskData.ranked_corridors.slice(0, 18).map((row) => (
                    <tr
                      key={row.segment_id}
                      onClick={() => onFlyToSegment(row.segment_id)}
                      className="border-b border-slate-800/40 cursor-pointer hover:bg-cyan-500/10"
                    >
                      <td className="py-1 pe-1">{row.priority_rank}</td>
                      <td className="py-1 pe-2 font-sans truncate max-w-[135px]" title={row.name}>
                        <bdi>{row.name}</bdi>
                        {row.aadt_is_imputed && (
                          <span className="ms-1 text-[9px] text-amber-400 font-mono" title="Imputed AADT Exposure">
                            [Imp]
                          </span>
                        )}
                      </td>
                      <td className="py-1 px-1 text-end text-cyan-300 font-semibold">{row.eb_expected_crashes}</td>
                      <td
                        className={`py-1 px-1 text-end ${
                          row.psi_excess_crashes > 0 ? 'text-rose-400' : 'text-blue-400'
                        }`}
                      >
                        <bdi dir="ltr">
                          {row.psi_excess_crashes > 0 ? `+${row.psi_excess_crashes}` : row.psi_excess_crashes}
                        </bdi>
                      </td>
                      <td className="py-1 px-1 text-end">{row.exposure_mvkt_rate}</td>
                      <td className="py-1 px-1 text-end font-bold">{row.mcda_vulnerability_index}</td>
                      <td className="py-1 ps-1 text-end">
                        <span
                          className="px-1 py-0.5 rounded text-[9px] text-slate-950 font-bold"
                          style={{ backgroundColor: row.bivariate_color }}
                        >
                          {row.bivariate_class}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
