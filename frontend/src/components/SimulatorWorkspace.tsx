import React, { useState } from 'react';
import { Eye, GitBranch, Play, Sparkles } from 'lucide-react';
import { uaiApi } from '../api/client';
import { useLanguage } from '../i18n';
import { formatNumber } from '../analyticsI18n';
import { scenarioLabel, simulatorText } from '../simulatorI18n';
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
  const { language } = useLanguage();
  const copy = simulatorText(language);
  const n = (value: number) => formatNumber(language, value);
  const [scenarioKey, setScenarioKey] = useState('MULTI_COVARIATE_URBAN');
  const [lixelResM, setLixelResM] = useState(25);
  const [seed, setSeed] = useState(108);
  const [intensityScale, setIntensityScale] = useState(1);
  const [vgiSigmaM, setVgiSigmaM] = useState(15);
  const [dupRate, setDupRate] = useState(0.4);
  const [falseAlarms, setFalseAlarms] = useState(12);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultSummary, setResultSummary] = useState<Record<string, any> | null>(null);

  // Research Upstream Hawkes Cascade controls
  const [hawkesEta, setHawkesEta] = useState(0.35);
  const [hawkesTauMin, setHawkesTauMin] = useState(25);
  const [hawkesLenM, setHawkesLenM] = useState(150);
  const [hawkesRunning, setHawkesRunning] = useState(false);
  const [hawkesResult, setHawkesResult] = useState<Record<string, any> | null>(null);
  const [hawkesErr, setHawkesErr] = useState<string | null>(null);

  const handleGenerate = async (event: React.FormEvent) => {
    event.preventDefault();
    setRunning(true);
    setError(null);
    setResultSummary(null);
    try {
      const result = await uaiApi.runSimulation({
        scenario_key: scenarioKey,
        lixel_resolution_m: lixelResM,
        random_seed: seed,
        base_intensity_scale: intensityScale,
        vgi_positional_sigma_m: vgiSigmaM,
        vgi_duplicate_rate: dupRate,
        vgi_false_alarm_count: falseAlarms,
        study_period_years: 1,
        actor_role: activeRole,
      });
      setResultSummary(result);
      onSimulationCompleted();
      onChangeOverlay('true_lambda');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unknown error');
    } finally {
      setRunning(false);
    }
  };

  const handleRunHawkes = async () => {
    setHawkesRunning(true);
    setHawkesErr(null);
    try {
      const res = await uaiApi.runResearchHawkes({
        dataset_id: activeDataset.id,
        background_rate_per_hr: 0.75,
        window_hr: 12.0,
        branching_ratio: hawkesEta,
        temporal_decay_min: hawkesTauMin,
        spatial_decay_m: hawkesLenM,
        seed,
        run_em_declustering: true,
      });
      setHawkesResult(res.result);
    } catch (reason) {
      setHawkesErr(reason instanceof Error ? reason.message : 'Hawkes simulation failed');
    } finally {
      setHawkesRunning(false);
    }
  };

  const cardCls = `rounded-md border p-3 ${
    darkMode ? 'bg-slate-900/75 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
  }`;
  const inputCls = `w-full px-2 py-1 rounded border font-mono text-xs ${
    darkMode ? 'border-slate-700 bg-slate-950' : 'border-slate-300 bg-white text-slate-900'
  }`;
  const selectedScenario = scenarios.find((s) => s.key === scenarioKey);

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-sm flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-amber-400" />
            {copy.title}
          </h2>
          <p className="text-[11px] opacity-70">{copy.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => onChangeOverlay(overlayMode === 'true_lambda' ? 'incidents' : 'true_lambda')}
          className="px-2.5 py-1 rounded border border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-200 text-[11px] flex items-center gap-1"
        >
          <Eye className="w-3.5 h-3.5" />
          {overlayMode === 'true_lambda' ? copy.showIncidents : copy.inspectTruth}
        </button>
      </div>

      <div className={cardCls}>
        <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 mb-0.5">
          {activeDataset.is_synthetic ? copy.activeSynthetic : copy.activeObserved}
        </div>
        <div className="font-semibold">
          <bdi>{activeDataset.name}</bdi>
        </div>
        <p className="text-[11px] opacity-75 mt-1" dir="auto">
          {activeDataset.description}
        </p>
      </div>

      <form onSubmit={handleGenerate} className={`${cardCls} space-y-3`}>
        <div className="font-semibold">{copy.configure}</div>
        <div>
          <label htmlFor="sim-scenario" className="block text-[10px] opacity-70 mb-1">
            {copy.scenario}
          </label>
          <select
            id="sim-scenario"
            value={scenarioKey}
            onChange={(event) => setScenarioKey(event.target.value)}
            className={inputCls}
          >
            {scenarios.map((sc) => (
              <option key={sc.key} value={sc.key}>
                {scenarioLabel(language, sc.key, sc).title}
              </option>
            ))}
          </select>
          {selectedScenario && (
            <p className="text-[10.5px] opacity-70 mt-1">
              {scenarioLabel(language, selectedScenario.key, selectedScenario).description}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label htmlFor="sim-lixel" className="block text-[10px] opacity-70 mb-1">
              {copy.lixel}
            </label>
            <select
              id="sim-lixel"
              value={lixelResM}
              onChange={(event) => setLixelResM(Number(event.target.value))}
              className={inputCls}
            >
              <option value={10}>10 m ({copy.fine})</option>
              <option value={25}>25 m ({copy.standard})</option>
              <option value={50}>50 m ({copy.coarse})</option>
            </select>
          </div>
          <div>
            <label htmlFor="sim-seed" className="block text-[10px] opacity-70 mb-1">
              {copy.seed}
            </label>
            <input
              id="sim-seed"
              dir="ltr"
              type="number"
              min={1}
              max={999999}
              required
              value={seed}
              onChange={(event) => setSeed(Number(event.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="sim-rate" className="block text-[10px] opacity-70 mb-1">
              {copy.rate}
            </label>
            <input
              id="sim-rate"
              dir="ltr"
              type="number"
              step="0.1"
              min={0.3}
              max={3}
              required
              value={intensityScale}
              onChange={(event) => setIntensityScale(Number(event.target.value))}
              className={inputCls}
            />
          </div>
        </div>

        <div className="border-t border-slate-800 pt-2.5 space-y-2">
          <div className="font-semibold text-[11px]">{copy.noiseTitle}</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
            <div>
              <label htmlFor="sim-sigma" className="block text-[10px] opacity-75">
                {copy.sigma}
              </label>
              <input
                id="sim-sigma"
                dir="ltr"
                type="number"
                min={2}
                max={45}
                required
                value={vgiSigmaM}
                onChange={(event) => setVgiSigmaM(Number(event.target.value))}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="sim-duplicate" className="block text-[10px] opacity-75">
                {copy.duplicate}
              </label>
              <input
                id="sim-duplicate"
                dir="ltr"
                type="number"
                step="0.05"
                min={0}
                max={1}
                required
                value={dupRate}
                onChange={(event) => setDupRate(Number(event.target.value))}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="sim-false" className="block text-[10px] opacity-75">
                {copy.falseAlarms}
              </label>
              <input
                id="sim-false"
                dir="ltr"
                type="number"
                min={0}
                max={60}
                required
                value={falseAlarms}
                onChange={(event) => setFalseAlarms(Number(event.target.value))}
                className={inputCls}
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
          {running ? copy.running : copy.generate}
        </button>
        {error && (
          <p role="alert" className="text-rose-500">
            {copy.failed}: <bdi>{error}</bdi>
          </p>
        )}
      </form>

      {resultSummary && (
        <div role="status" className={`${cardCls} text-[11px] space-y-1 border-emerald-500/50`}>
          <div className="text-emerald-600 dark:text-emerald-400 font-semibold">
            {copy.generated} #<bdi>{n(resultSummary.dataset_id)}</bdi> · {copy.networkLength}:{' '}
            <bdi>{n(resultSummary.total_network_length_km)}</bdi>
          </div>
          <div>
            {copy.nodes}: <b>{n(resultSummary.node_count)}</b> · {copy.edges}:{' '}
            <b>{n(resultSummary.segment_count)}</b> · {copy.lixels}: <b>{n(resultSummary.lixel_count)}</b>
          </div>
          <div>
            {copy.verified}: <b>{n(resultSummary.verified_crash_count)}</b> · {copy.reports}:{' '}
            <b>{n(resultSummary.vgi_report_count)}</b> ({copy.bursts}:{' '}
            {n(resultSummary.duplicate_burst_groups)})
          </div>
        </div>
      )}

      {/* Upstream Network Hawkes Cascade & EM Declustering Panel */}
      <div className={`${cardCls} space-y-2.5`}>
        <div className="font-semibold flex items-center gap-1.5 text-cyan-300">
          <GitBranch className="w-3.5 h-3.5" />
          {copy.hawkesTitle}
        </div>
        <p className="text-[10.5px] opacity-75">{copy.hawkesDesc}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label className="block text-[10px] opacity-75 mb-0.5">{copy.hawkesBranching}</label>
            <input
              dir="ltr"
              type="number"
              step="0.05"
              min={0}
              max={0.95}
              value={hawkesEta}
              onChange={(e) => setHawkesEta(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[10px] opacity-75 mb-0.5">{copy.hawkesDecayMin}</label>
            <input
              dir="ltr"
              type="number"
              min={2}
              max={180}
              value={hawkesTauMin}
              onChange={(e) => setHawkesTauMin(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[10px] opacity-75 mb-0.5">{copy.hawkesSpatialM}</label>
            <input
              dir="ltr"
              type="number"
              min={25}
              max={1000}
              value={hawkesLenM}
              onChange={(e) => setHawkesLenM(Number(e.target.value))}
              className={inputCls}
            />
          </div>
        </div>
        <button
          type="button"
          disabled={hawkesRunning}
          onClick={handleRunHawkes}
          className="w-full py-1.5 rounded bg-cyan-500/25 border border-cyan-400/60 hover:bg-cyan-500/35 text-cyan-200 font-semibold"
        >
          {hawkesRunning ? copy.runningHawkes : copy.runHawkes}
        </button>
        {hawkesErr && <p className="text-rose-400 text-[11px] font-mono">{hawkesErr}</p>}
        {hawkesResult && (
          <div className="p-2 rounded bg-slate-950/75 border border-slate-800 font-mono text-[10.5px] space-y-1">
            <div className="grid grid-cols-2 gap-1">
              <span>
                {copy.hawkesSummary}: <b>{hawkesResult.simulation.total_events}</b>
              </span>
              <span>
                {copy.hawkesSecondary}: <b>{hawkesResult.simulation.secondary_events_truth}</b>
              </span>
              <span>
                {copy.hawkesEstEta}:{' '}
                <b className="text-cyan-300">{hawkesResult.declustering?.estimated_branching_ratio}</b>
              </span>
              <span>
                {copy.hawkesBrier}:{' '}
                <b className="text-emerald-300">
                  {hawkesResult.declustering?.synthetic_calibration?.brier_score ?? '—'}
                </b>
              </span>
            </div>
            <p className="text-[10px] opacity-70 font-sans">{hawkesResult.declustering?.disclaimer}</p>
          </div>
        )}
      </div>
    </div>
  );
};
