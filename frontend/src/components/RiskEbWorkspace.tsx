import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { uaiApi } from '../api/client';
import { CureChart } from './CureChart';
import type { MapOverlayMode, RiskEbPayload } from '../types/uai';

interface RiskEbWorkspaceProps {
  darkMode: boolean;
  datasetId: number;
  overlayMode: MapOverlayMode;
  onChangeOverlay: (mode: MapOverlayMode) => void;
  riskData: RiskEbPayload | null;
  onRiskDataLoaded: (payload: RiskEbPayload) => void;
  onFlyToSegment: (segmentId: number) => void;
}

const METRIC_BUTTONS: { mode: MapOverlayMode; short: string; desc: string }[] = [
  { mode: 'risk_bivariate_uncertainty', short: '3×3 Bivariate', desc: 'EB Risk × Epistemic U' },
  { mode: 'risk_eb_expected', short: 'EB Expected', desc: 'RTM Smoothed N_EB' },
  { mode: 'risk_psi', short: 'PSI Excess', desc: 'N_EB − μ_SPF' },
  { mode: 'risk_mcda', short: 'MCDA Index', desc: 'Composite (0-100)' },
  { mode: 'risk_raw_n', short: 'Tier 1: N', desc: 'Raw Frequency' },
  { mode: 'risk_linear_density', short: 'Tier 2: N/km', desc: 'Linear Density' },
  { mode: 'risk_epdo', short: 'Tier 3: EPDO', desc: 'Severity Weighted' },
  { mode: 'risk_mvkt', short: 'Tier 4: MVKT', desc: 'Per Million VKT' },
];

export const RiskEbWorkspace: React.FC<RiskEbWorkspaceProps> = ({
  darkMode,
  datasetId,
  overlayMode,
  onChangeOverlay,
  riskData,
  onRiskDataLoaded,
  onFlyToSegment,
}) => {
  const [wEb, setWEb] = useState(0.40);
  const [wEpdo, setWEpdo] = useState(0.30);
  const [wGeom, setWGeom] = useState(0.15);
  const [wEnv, setWEnv] = useState(0.15);
  const [loading, setLoading] = useState(false);

  const recompute = async (eb = wEb, ep = wEpdo, gm = wGeom, ev = wEnv) => {
    setLoading(true);
    try {
      const res = await uaiApi.evaluateRiskEb({
        dataset_id: datasetId,
        w_eb_risk: eb,
        w_epdo_severity: ep,
        w_geometric_hazard: gm,
        w_environmental_cov: ev,
      });
      onRiskDataLoaded(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    recompute();
  }, [datasetId]);

  const cardCls = `rounded-md border p-3 ${
    darkMode ? 'bg-slate-900/75 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
  }`;

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-sm flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            Exposure-Aware Safety &amp; Empirical Bayes Engine
          </h2>
          <p className="text-[11px] opacity-70">
            NB-SPF Prior Calibration · RTM Correction · Epistemic Uncertainty Cartography
          </p>
        </div>
        {loading && <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />}
      </div>

      {/* Multi-Tiered Safety & Risk Map Layer Selector (US-5.1, US-5.2, US-5.4) */}
      <div className={cardCls}>
        <div className="font-semibold mb-2">Select Active Cartographic Safety Metric</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {METRIC_BUTTONS.map((btn) => {
            const active = overlayMode === btn.mode;
            return (
              <button
                key={btn.mode}
                onClick={() => onChangeOverlay(btn.mode)}
                className={`p-1.5 rounded border text-left transition-colors ${
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

      {/* Multi-Criteria Vulnerability Sensitivity Sliders + Epistemological Guardrail (US-5.3) */}
      <div className={cardCls}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold flex items-center gap-1.5">
            <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
            Multi-Criteria Vulnerability Weights (Sensitivity)
          </span>
          <button
            onClick={() => recompute(wEb, wEpdo, wGeom, wEnv)}
            className="px-2 py-0.5 rounded bg-cyan-500 text-slate-950 font-semibold text-[11px]"
          >
            Apply Sliders
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5 font-mono text-[11px]">
          <div>
            <div className="flex justify-between"><span>EB Expected Risk</span><b>{wEb.toFixed(2)}</b></div>
            <input type="range" min={0} max={1} step={0.05} value={wEb} onChange={(e) => setWEb(Number(e.target.value))} className="w-full accent-cyan-400" />
          </div>
          <div>
            <div className="flex justify-between"><span>EPDO Severity</span><b>{wEpdo.toFixed(2)}</b></div>
            <input type="range" min={0} max={1} step={0.05} value={wEpdo} onChange={(e) => setWEpdo(Number(e.target.value))} className="w-full accent-amber-400" />
          </div>
          <div>
            <div className="flex justify-between"><span>Road Geometry</span><b>{wGeom.toFixed(2)}</b></div>
            <input type="range" min={0} max={1} step={0.05} value={wGeom} onChange={(e) => setWGeom(Number(e.target.value))} className="w-full accent-emerald-400" />
          </div>
          <div>
            <div className="flex justify-between"><span>Adverse Weather</span><b>{wEnv.toFixed(2)}</b></div>
            <input type="range" min={0} max={1} step={0.05} value={wEnv} onChange={(e) => setWEnv(Number(e.target.value))} className="w-full accent-purple-400" />
          </div>
        </div>

        {riskData && (
          <div className="mt-2 p-2 rounded border border-amber-500/35 bg-amber-500/10 text-amber-200 text-[10px] flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
            <span>{riskData.metric_epistemology_disclaimer}</span>
          </div>
        )}
      </div>

      {/* Empirical Bayes RTM Shrinkage Visualization */}
      {riskData && (
        <>
          <div className={cardCls}>
            <div className="font-semibold mb-1.5">
              Regression-to-the-Mean (RTM) Shrinkage: Observed N vs. SPF μ vs. Posterior N_EB
            </div>
            <p className="text-[10px] opacity-70 mb-2">
              Segments where random short-term spikes (Observed N) shrink toward Road-Class Negative Binomial SPF Prior (μ_e):
            </p>
            <div className="space-y-2 font-mono text-[10px]">
              {riskData.ranked_corridors.slice(0, 6).map((c) => {
                const maxVal = Math.max(15, c.eb_ci95_high, c.raw_crash_frequency, c.spf_prior_expected);
                return (
                  <div key={c.segment_id} className="space-y-0.5">
                    <div className="flex justify-between">
                      <span className="font-sans font-medium truncate max-w-[200px]">{c.name}</span>
                      <span>
                        Obs <b>{c.raw_crash_frequency}</b> → EB <b className="text-cyan-400">{c.eb_expected_crashes}</b>{' '}
                        (w={c.eb_weight_w}, PSI={c.psi_excess_crashes > 0 ? `+${c.psi_excess_crashes}` : c.psi_excess_crashes})
                      </span>
                    </div>
                    <div className="relative h-3 bg-slate-800 rounded overflow-hidden">
                      {/* 95% Credible Interval Band */}
                      <div
                        className="absolute top-0.5 bottom-0.5 bg-cyan-400/25 rounded"
                        style={{
                          left: `${(c.eb_ci95_low / maxVal) * 100}%`,
                          width: `${Math.max(2, ((c.eb_ci95_high - c.eb_ci95_low) / maxVal) * 100)}%`,
                        }}
                      />
                      {/* SPF Prior Marker */}
                      <div
                        title={`SPF Prior μ = ${c.spf_prior_expected}`}
                        className="absolute top-0 bottom-0 w-1 bg-slate-400"
                        style={{ left: `${(c.spf_prior_expected / maxVal) * 100}%` }}
                      />
                      {/* Observed N Marker */}
                      <div
                        title={`Observed N = ${c.raw_crash_frequency}`}
                        className="absolute top-0 bottom-0 w-1.5 bg-rose-400"
                        style={{ left: `${(c.raw_crash_frequency / maxVal) * 100}%` }}
                      />
                      {/* EB Expected Posterior Marker */}
                      <div
                        title={`EB Posterior = ${c.eb_expected_crashes}`}
                        className="absolute top-0 bottom-0 w-1.5 bg-cyan-300"
                        style={{ left: `${(c.eb_expected_crashes / maxVal) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="flex justify-between pt-1 text-[9px] opacity-75">
                <span>■ Grey = NB-SPF Prior (μ)</span>
                <span className="text-cyan-300">■ Cyan = EB Posterior ± 95% CI</span>
                <span className="text-rose-400">■ Red = Raw Observed (N)</span>
              </div>
            </div>
          </div>

          {riskData.cure_diagnostic && (
            <div className={cardCls}>
              <CureChart diagnostic={riskData.cure_diagnostic} />
            </div>
          )}

          {/* Ranked Corridor Priority Table */}
          <div className={cardCls}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold">Ranked Corridor Priority Table</span>
              <span className="text-[10px] font-mono opacity-70">
                Imputed AADT: {riskData.network_summary.imputed_aadt_segments} segs
              </span>
            </div>
            <div className="overflow-x-auto max-h-64">
              <table className="w-full text-left border-collapse font-mono tabular-nums text-[10.5px]">
                <thead>
                  <tr className="border-b border-slate-800 text-[9.5px] uppercase opacity-70">
                    <th className="py-1">#</th>
                    <th className="py-1">Corridor</th>
                    <th className="py-1 text-right">N_EB</th>
                    <th className="py-1 text-right">PSI</th>
                    <th className="py-1 text-right">MVKT</th>
                    <th className="py-1 text-right">MCDA</th>
                    <th className="py-1 text-right">Biv</th>
                  </tr>
                </thead>
                <tbody>
                  {riskData.ranked_corridors.slice(0, 18).map((row) => (
                    <tr
                      key={row.segment_id}
                      onClick={() => onFlyToSegment(row.segment_id)}
                      className="border-b border-slate-800/40 cursor-pointer hover:bg-cyan-500/10"
                    >
                      <td className="py-1 pr-1">{row.priority_rank}</td>
                      <td className="py-1 pr-2 font-sans truncate max-w-[135px]" title={row.name}>
                        {row.name}
                        {row.aadt_is_imputed && (
                          <span className="ml-1 text-[9px] text-amber-400 font-mono" title="Imputed AADT Exposure">
                            [Imp]
                          </span>
                        )}
                      </td>
                      <td className="py-1 px-1 text-right text-cyan-300 font-semibold">{row.eb_expected_crashes}</td>
                      <td className={`py-1 px-1 text-right ${row.psi_excess_crashes > 0 ? 'text-rose-400' : 'text-blue-400'}`}>
                        {row.psi_excess_crashes > 0 ? `+${row.psi_excess_crashes}` : row.psi_excess_crashes}
                      </td>
                      <td className="py-1 px-1 text-right">{row.exposure_mvkt_rate}</td>
                      <td className="py-1 px-1 text-right font-bold">{row.mcda_vulnerability_index}</td>
                      <td className="py-1 pl-1 text-right">
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
