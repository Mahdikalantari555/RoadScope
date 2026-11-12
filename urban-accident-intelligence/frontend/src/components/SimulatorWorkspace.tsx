import React, { useState } from 'react';
import { Eye, Play, Sparkles } from 'lucide-react';
import { uaiApi } from '../api/client';
import type { DatasetSource, MapOverlayMode, PersonaRole, ScenarioSpec } from '../types/uai';

interface SimulatorWorkspaceProps {
  darkMode: boolean;
  scenarios: ScenarioSpec[];
  activeDataset: DatasetSource;
  activeRole: PersonaRole;
  overlayMode: MapOverlayMode;
  onChangeOverlay: (mode: MapOverlayMode) => void;
  onSimulationCompleted: () => void;
}

export const SimulatorWorkspace: React.FC<SimulatorWorkspaceProps> = ({
  darkMode,
  scenarios,
  activeDataset,
  activeRole,
  overlayMode,
  onChangeOverlay,
  onSimulationCompleted,
}) => {
  const [scenarioKey, setScenarioKey] = useState<string>('MULTI_COVARIATE_URBAN');
  const [lixelResM, setLixelResM] = useState<number>(25);
  const [seed, setSeed] = useState<number>(108);
  const [intensityScale, setIntensityScale] = useState<number>(1.0);
  const [vgiSigmaM, setVgiSigmaM] = useState<number>(15.0);
  const [dupRate, setDupRate] = useState<number>(0.40);
  const [falseAlarms, setFalseAlarms] = useState<number>(12);
  const [running, setRunning] = useState(false);
  const [resultSummary, setResultSummary] = useState<Record<string, any> | null>(null);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunning(true);
    try {
      const res = await uaiApi.runSimulation({
        scenario_key: scenarioKey,
        lixel_resolution_m: lixelResM,
        random_seed: seed,
        base_intensity_scale: intensityScale,
        vgi_positional_sigma_m: vgiSigmaM,
        vgi_duplicate_rate: dupRate,
        vgi_false_alarm_count: falseAlarms,
        study_period_years: 1.0,
        actor_role: activeRole,
      });
      setResultSummary(res);
      onSimulationCompleted();
      onChangeOverlay('true_lambda');
    } finally {
      setRunning(false);
    }
  };

  const cardCls = `rounded-md border p-3 ${
    darkMode ? 'bg-slate-900/75 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
  }`;

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-sm flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-amber-400" />
            Stochastic Network Cox/Poisson Simulator
          </h2>
          <p className="text-[11px] opacity-70">
            Reproducible 1D Linear Referencing (LRS) Lixelation &amp; VGI Noise Injection
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            onChangeOverlay(overlayMode === 'true_lambda' ? 'incidents' : 'true_lambda')
          }
          className="px-2.5 py-1 rounded border border-amber-500/50 bg-amber-500/15 text-amber-200 font-mono text-[11px] flex items-center gap-1"
        >
          <Eye className="w-3.5 h-3.5" />
          {overlayMode === 'true_lambda' ? 'Show Incidents' : 'Inspect True λ(e,m,t)'}
        </button>
      </div>

      {/* Active Dataset Provenance Card */}
      <div className={cardCls}>
        <div className="text-[10px] uppercase font-mono text-amber-400 mb-0.5">
          Active Benchmark Dataset (Synthetic Ground-Truth)
        </div>
        <div className="font-semibold">{activeDataset.name}</div>
        <p className="text-[11px] opacity-75 mt-1">{activeDataset.description}</p>
      </div>

      <form onSubmit={handleGenerate} className={`${cardCls} space-y-3`}>
        <div className="font-semibold">Configure New Controlled Point-Process Realization</div>

        <div>
          <label className="block text-[10px] uppercase opacity-70 mb-1">
            Spatiotemporal Intensity Scenario λ(e, m, t)
          </label>
          <select
            value={scenarioKey}
            onChange={(e) => setScenarioKey(e.target.value)}
            className="w-full px-2 py-1.5 rounded border border-slate-700 bg-slate-950 font-mono text-xs"
          >
            {scenarios.map((sc) => (
              <option key={sc.key} value={sc.key}>
                {sc.title}
              </option>
            ))}
          </select>
          <p className="text-[10.5px] opacity-70 mt-1">
            {scenarios.find((s) => s.key === scenarioKey)?.description}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[10px] uppercase opacity-70 mb-1">Lixel Δℓ (MAUP)</label>
            <select
              value={lixelResM}
              onChange={(e) => setLixelResM(Number(e.target.value))}
              className="w-full px-2 py-1 rounded border border-slate-700 bg-slate-950 font-mono text-xs"
            >
              <option value={10}>10 m (Fine)</option>
              <option value={25}>25 m (Standard)</option>
              <option value={50}>50 m (Coarse)</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase opacity-70 mb-1">PRNG Seed</label>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
              className="w-full px-2 py-1 rounded border border-slate-700 bg-slate-950 font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase opacity-70 mb-1">Rate Scale λ₀</label>
            <input
              type="number"
              step="0.1"
              min={0.3}
              max={3.0}
              value={intensityScale}
              onChange={(e) => setIntensityScale(Number(e.target.value))}
              className="w-full px-2 py-1 rounded border border-slate-700 bg-slate-950 font-mono text-xs"
            />
          </div>
        </div>

        <div className="border-t border-slate-800 pt-2.5 space-y-2">
          <div className="font-semibold text-[11px]">VGI Noise, Drift &amp; Multi-Witness Burst Injection (US-1.3)</div>
          <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
            <div>
              <label className="block text-[9.5px] opacity-75">Gaussian σ_pos (m)</label>
              <input
                type="number"
                min={2}
                max={45}
                value={vgiSigmaM}
                onChange={(e) => setVgiSigmaM(Number(e.target.value))}
                className="w-full px-2 py-1 rounded border border-slate-700 bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-[9.5px] opacity-75">Burst Rate (0-1)</label>
              <input
                type="number"
                step="0.05"
                min={0}
                max={1}
                value={dupRate}
                onChange={(e) => setDupRate(Number(e.target.value))}
                className="w-full px-2 py-1 rounded border border-slate-700 bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-[9.5px] opacity-75">False Alarms</label>
              <input
                type="number"
                min={0}
                max={60}
                value={falseAlarms}
                onChange={(e) => setFalseAlarms(Number(e.target.value))}
                className="w-full px-2 py-1 rounded border border-slate-700 bg-slate-950"
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={running}
          className="w-full py-2 rounded bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          <Play className="w-3.5 h-3.5" />
          {running ? 'Synthesizing LRS Graph & Point Process...' : 'Generate & Activate Seeded Benchmark Dataset'}
        </button>
      </form>

      {resultSummary && (
        <div className={`${cardCls} font-mono text-[11px] space-y-1 border-emerald-500/50`}>
          <div className="text-emerald-400 font-semibold">
            Generated Dataset #{resultSummary.dataset_id} ({resultSummary.total_network_length_km} km network)
          </div>
          <div>
            Nodes: <b>{resultSummary.node_count}</b> · Edges: <b>{resultSummary.segment_count}</b> · Lixels:{' '}
            <b>{resultSummary.lixel_count}</b>
          </div>
          <div>
            Verified Realizations: <b>{resultSummary.verified_crash_count}</b> · VGI Reports:{' '}
            <b>{resultSummary.vgi_report_count}</b> (Burst Groups: {resultSummary.duplicate_burst_groups})
          </div>
        </div>
      )}
    </div>
  );
};
