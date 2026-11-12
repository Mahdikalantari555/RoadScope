"use client";

/**
 * Epic 5 — Exposure-aware risk assessment and uncertainty modelling.
 * Four separated safety metrics, Empirical Bayes RTM correction, a transparent
 * (explicitly heuristic) multi-criteria composite and bivariate risk×uncertainty
 * cartography.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Badge, FormulaBlock, Kpi, Panel, Select, Slider, Toggle } from "@/components/ui";
import { BivariateLegend, BarList, DataTable, RampLegend, ScatterPlot } from "@/components/charts";
import { MapCanvas, type MapLayerSpec } from "@/components/MapCanvas";
import { apiGet, fmt, type GeoCollection } from "@/lib/clientApi";
import { networkLayer } from "@/lib/ui";
import { colorFor } from "@/lib/util/colors";

type Metric = "count" | "density" | "epdo" | "rate" | "eb" | "psi" | "composite" | "uncertainty";

const METRIC_META: Record<Metric, { label: string; unit: string; ramp: string; note: string }> = {
  count: { label: "Raw crash frequency N", unit: "crashes", ramp: "ylorrd", note: "Observed frequency only. Ignores length, severity and exposure — never a risk measure." },
  density: { label: "Linear crash density N/L", unit: "crashes · km⁻¹", ramp: "ylorrd", note: "Normalised by curvilinear length, which removes segment-length MAUP bias but not exposure." },
  epdo: { label: "Severity-weighted EPDO", unit: "EPDO · km⁻¹", ramp: "inferno", note: "Equivalent Property Damage Only weighting (K 120 · A 26 · B/C 6.2 · PDO 1)." },
  rate: { label: "Exposure-normalised rate", unit: "crashes · MVKT⁻¹", ramp: "plasma", note: "Requires observed AADT; units without exposure are rendered as data gaps, never as zero risk." },
  eb: { label: "Empirical Bayes estimate", unit: "expected crashes", ramp: "magma", note: "Posterior mean under a Gamma–Poisson SPF prior; shrinks thin samples toward the class prior." },
  psi: { label: "PSI (excess frequency)", unit: "share of N", ramp: "spectral", note: "(N − EB)/N. High values on low-exposure units are the regression-to-the-mean trap." },
  composite: { label: "Multi-criteria composite", unit: "index [0,1]", ramp: "inferno", note: "Weighted rank-transform heuristic. NOT a calibrated crash probability." },
  uncertainty: { label: "Uncertainty & coverage", unit: "u ∈ [0,1]", ramp: "cividis", note: "Sample sparsity + exposure gap + VGI share + positional residual." },
};

export default function RiskPage() {
  const { dataset, datasetId, role } = useApp();
  const [metric, setMetric] = useState<Metric>("eb");
  const [level, setLevel] = useState<"segment" | "lixel">("segment");
  const [data, setData] = useState<any>(null);
  const [network, setNetwork] = useState<GeoCollection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weights, setWeights] = useState({ ebRisk: 0.4, severity: 0.25, geometry: 0.15, environment: 0.1, exposure: 0.1 });
  const [bivariate, setBivariate] = useState(true);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [autoRecompute, setAutoRecompute] = useState(false);

  useEffect(() => {
    if (!datasetId) return;
    apiGet<{ geojson: GeoCollection }>(`/api/datasets/${datasetId}/network?nodes=0`, role).then((r) => setNetwork(r.geojson)).catch(() => undefined);
  }, [datasetId, role]);

  const load = useCallback(
    async (recompute = false) => {
      if (!datasetId) return;
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ level, metric, limit: "3000" });
        if (recompute) qs.set("recompute", "1");
        const res = await apiGet<any>(`/api/datasets/${datasetId}/risk?${qs.toString()}`, role);
        setData(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [datasetId, level, metric, role],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  // Live sensitivity: re-running the composite re-scores and re-persists.
  useEffect(() => {
    if (!autoRecompute || level !== "segment") return;
    const t = setTimeout(() => void recomputeComposite(), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weights, autoRecompute, level]);

  const recomputeComposite = useCallback(async () => {
    if (!datasetId) return;
    setLoading(true);
    try {
      const res = await apiGet<any>(`/api/datasets/${datasetId}/risk?level=${level}&metric=composite&recompute=1`, role);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [datasetId, level, role]);

  const meta = METRIC_META[metric];
  const features = (data?.geojson?.features ?? []) as any[];

  const layer = useMemo<MapLayerSpec>(() => {
    const values = features.map((f) => Number(f.properties?.value ?? 0)).filter((v) => Number.isFinite(v));
    const max = Math.max(1e-9, ...values);
    const min = Math.min(0, ...values);
    return {
      id: "risk",
      data: data?.geojson ?? null,
      visible: true,
      zIndex: 6,
      opacity: 0.95,
      stroke: (p) => {
        const v = Number(p?.value ?? 0);
        const t = max === min ? 0.5 : (v - min) / (max - min);
        if (bivariate) {
          const u = Number(p?.uncertainty ?? 0);
          return bivariateColor(t, u);
        }
        return colorFor(meta.ramp, t);
      },
      width: (p) => {
        const v = Number(p?.value ?? 0);
        const t = max === min ? 0.5 : (v - min) / (max - min);
        const unc = bivariate ? 1 - Number(p?.uncertainty ?? 0) * 0.6 : 1;
        return (level === "segment" ? 1.6 : 2.6) + t * 4.2 * unc;
      },
      pickable: true,
    };
  }, [data, meta.ramp, bivariate, level]);

  const layers = useMemo<MapLayerSpec[]>(() => [networkLayer(network, "exposure", 0.4), layer], [network, layer]);

  const summary = data?.summary ?? {};
  const spf = data?.stats?.spf;
  const ranked = (data?.rankedCorridors ?? []) as any[];

  return (
    <div className="scroll-thin h-full overflow-auto p-2">
      <div className="grid min-h-0 grid-cols-1 gap-2 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <Panel title="Safety metric" subtitle="Four rigorously separated tiers">
            <div className="space-y-2 p-2">
              <Select
                value={metric}
                onChange={(v) => setMetric(v)}
                options={(Object.keys(METRIC_META) as Metric[]).map((m) => ({ value: m, label: METRIC_META[m].label }))}
              />
              <Select value={level} onChange={(v) => setLevel(v)} options={[{ value: "segment", label: "Parent road segment" }, { value: "lixel", label: `Lixel (${dataset?.lixelLengthM ?? 25} m)` }]} label="Spatial unit" />
              <div className="rounded-[3px] border p-2 text-[10.5px] leading-snug" style={{ borderColor: "var(--border)", color: "var(--text-mute)" }}>
                <span className="mono" style={{ color: "var(--text-dim)" }}>{meta.unit}</span> — {meta.note}
              </div>
              <Toggle label="Bivariate risk × uncertainty rendering" checked={bivariate} onChange={setBivariate} hint="Opacity/width modulation encodes epistemic uncertainty; hue encodes risk." />
              <Toggle label="Live composite sensitivity (segment level)" checked={autoRecompute} onChange={setAutoRecompute} hint="Re-runs and re-persists the composite whenever a weight slider moves." />
              <div className="flex gap-1">
                <button type="button" className="btn flex-1" onClick={() => void load(true)} disabled={loading}>
                  {loading ? "Computing…" : "Recompute (SPF + EB)"}
                </button>
                <button type="button" className="btn" onClick={() => void recomputeComposite()} disabled={loading}>
                  Re-score
                </button>
              </div>
              {error && <div className="mono text-[10px]" style={{ color: "var(--danger)" }}>{error}</div>}
            </div>
          </Panel>

          <Panel title="Composite weights" subtitle="Interpretable, rank-based, always reported">
            <div className="space-y-2 p-2">
              <Slider label="EB crash risk" value={weights.ebRisk} min={0} max={1} step={0.05} onChange={(v) => setWeights({ ...weights, ebRisk: v })} format={(v) => v.toFixed(2)} />
              <Slider label="Severity (EPDO/km)" value={weights.severity} min={0} max={1} step={0.05} onChange={(v) => setWeights({ ...weights, severity: v })} format={(v) => v.toFixed(2)} />
              <Slider label="Geometric hazard" value={weights.geometry} min={0} max={1} step={0.05} onChange={(v) => setWeights({ ...weights, geometry: v })} format={(v) => v.toFixed(2)} />
              <Slider label="Environment (lighting/wet)" value={weights.environment} min={0} max={1} step={0.05} onChange={(v) => setWeights({ ...weights, environment: v })} format={(v) => v.toFixed(2)} />
              <Slider label="Exposure gap penalty" value={weights.exposure} min={0} max={1} step={0.05} onChange={(v) => setWeights({ ...weights, exposure: v })} format={(v) => v.toFixed(2)} />
              <div className="mono text-[10px]" style={{ color: "var(--text-mute)" }}>
                normalised: {Object.entries(weights).map(([k, v]) => `${k}=${(v / total(weights)).toFixed(2)}`).join("  ")}
              </div>
              <div className="rounded-[3px] border p-2 text-[10px] leading-snug" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
                ⚠ The composite is a heuristic prioritisation index. The platform prohibits labelling it a calibrated crash probability.
              </div>
            </div>
          </Panel>

          <Panel title="Exposure model (SPF)" subtitle="Poisson quasi-likelihood IRLS">
            <div className="space-y-1.5 p-2 text-[10.5px]">
              {spf ? (
                <>
                  <Row k="ln μ = β₀ + β₁·ln VKT + β₂·ln L + γ_class" />
                  <Row k="β₀ (intercept)" v={fmt(spf.beta0, 4)} />
                  <Row k="β₁ (exposure elasticity)" v={fmt(spf.betaVkt, 4)} tone="good" />
                  <Row k="β₂ (length)" v={fmt(spf.betaLength, 4)} />
                  <Row k="overdispersion φ" v={fmt(spf.phi, 4)} tone="good" />
                  <Row k="units fitted" v={fmt(spf.n)} />
                  <Row k="excluded (no exposure)" v={fmt(data?.stats?.spfExcludedUnits ?? 0)} tone="bad" />
                  <Row k="converged" v={spf.converged ? "yes" : "no"} tone={spf.converged ? "good" : "bad"} />
                  <Row k="iterations" v={fmt(spf.iterations)} />
                  <Row k="deviance" v={fmt(spf.deviance, 2)} />
                  {spf.droppedCollinearColumns?.length > 0 && <Row k="dropped (collinear)" v={spf.droppedCollinearColumns.join(", ")} />}
                  <div className="mono mt-1 border-t pt-1 text-[10px]" style={{ borderColor: "var(--border)", color: "var(--text-mute)" }}>
                    class γ: {Object.entries(spf.classCoefficients ?? {}).map(([k, v]) => `${k}=${fmt(v, 3)}`).join("  ")}
                  </div>
                </>
              ) : (
                <div style={{ color: "var(--text-mute)" }}>Run “Recompute” to fit the Safety Performance Function.</div>
              )}
            </div>
          </Panel>
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
            <Kpi label="Observed ΣN" value={fmt(summary.totalObserved)} />
            <Kpi label="SPF expected Σμ" value={fmt(summary.totalExpected, 1)} />
            <Kpi label="EB posterior ΣE" value={fmt(summary.totalEb, 1)} tone="good" />
            <Kpi label="Excess Σ(N−E)" value={fmt(summary.totalExcess, 1)} tone={summary.totalExcess > 0 ? "warn" : "good"} />
            <Kpi label="Exposure coverage" value={`${fmt(summary.exposureCoveragePct)} %`} tone={summary.exposureCoveragePct > 70 ? "good" : "warn"} hint={`${fmt(summary.unitsWithZeroCount)} units with zero count`} />
            <Kpi label="RTM candidates" value={fmt(summary.rtmCandidates)} tone="warn" hint="N > 2·μ on thin exposure" />
          </div>

          <Panel
            title="Risk cartography"
            subtitle={`${fmt(data?.unitCount)} ${level} units · metric = ${meta.label}`}
            right={<div className="flex gap-1">{loading && <Badge tone="warn">COMPUTING</Badge>}{data?.computedNow && <Badge tone="info">FRESHLY PERSISTED</Badge>}</div>}
            className="min-h-[440px]"
            bodyClass="relative"
          >
            <MapCanvas
              layers={layers}
              origin={dataset ? { lon: dataset.originLon, lat: dataset.originLat } : undefined}
              fitKey={`${datasetId ?? ""}|${level}|${metric}|${bivariate}`}
              className="h-[440px] w-full"
              onSelect={(f) => setSelectedUnit(f ? String(f.properties?.unitId ?? "") : null)}
              selectedId={selectedUnit}
              legend={
                <div className="flex flex-wrap items-end gap-2">
                  {bivariate ? (
                    <BivariateLegend title={`${meta.label} × uncertainty`} xLabel="risk" yLabel="uncertainty" />
                  ) : (
                    <RampLegend ramp={meta.ramp} min={0} max={Math.max(...features.map((f) => Number(f.properties?.value ?? 0)), 1)} unit={meta.unit} />
                  )}
                  <div className="rounded-[3px] border px-2 py-1.5 text-[10px]" style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text-dim)" }}>
                    <div className="mb-1 text-[9px] uppercase tracking-[0.07em]" style={{ color: "var(--text-mute)" }}>Exposure coverage</div>
                    <div className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-4" style={{ background: "#3d6f8e" }} /> AADT observed</div>
                    <div className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-4" style={{ background: "#a05a2c" }} /> AADT missing (epistemic gap)</div>
                  </div>
                </div>
              }
            />
          </Panel>

          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <Panel title="Ranked corridor priority table" subtitle="Ordered by the active metric · click a row to locate it" bodyClass="p-0">
              <DataTable
                rows={ranked}
                rowKey={(r) => r.unitId}
                selectedKey={selectedUnit}
                onRowClick={(r) => setSelectedUnit(r.unitId)}
                maxHeight={300}
                columns={[
                  { key: "rank", label: "#", align: "right" },
                  { key: "name", label: "Corridor" },
                  { key: "roadClass", label: "Class" },
                  { key: "lengthKm", label: "km", align: "right", format: (v) => fmt(v, 3) },
                  { key: "observed", label: "N", align: "right", format: (v) => fmt(v, 1) },
                  { key: "expected", label: "μ (SPF)", align: "right", format: (v) => fmt(v, 2) },
                  { key: "eb", label: "EB", align: "right", format: (v) => fmt(v, 2), tone: (v) => (v > 3 ? "var(--danger)" : undefined) },
                  { key: "excess", label: "N−EB", align: "right", format: (v) => fmt(v, 2), tone: (v) => (v > 0 ? "var(--warn)" : "var(--accent-2)") },
                  { key: "psi", label: "PSI", align: "right", format: (v) => fmt(v, 3) },
                  { key: "uncertainty", label: "u", align: "right", format: (v) => fmt(v, 2), tone: (v) => (v > 0.6 ? "var(--danger)" : undefined) },
                  { key: "hasExposure", label: "AADT", align: "right", format: (v) => (v ? "yes" : "gap"), tone: (v) => (v ? undefined : "var(--warn)") },
                ]}
              />
            </Panel>

            <div className="flex flex-col gap-2">
              <Panel title="Calibration: observed vs. EB posterior" subtitle="Dashed line = identity; points below it are shrunk toward the prior" bodyClass="p-2">
                <ScatterPlot
                  points={ranked.map((r) => ({ x: r.observed, y: r.eb, c: r.uncertainty, label: `${r.name}: N=${fmt(r.observed, 1)} EB=${fmt(r.eb, 2)} u=${fmt(r.uncertainty, 2)}` }))}
                  xLabel="observed N"
                  yLabel="EB estimate"
                  ramp="cividis"
                  colorBy={{ min: 0, max: 1 }}
                  size={150}
                />
                <div className="mono mt-1 text-[9.5px]" style={{ color: "var(--text-mute)" }}>point colour = uncertainty u ∈ [0,1]</div>
              </Panel>
              <Panel title="Excess crash frequency (PSI ranking)" subtitle="Where safety investment is statistically justified" bodyClass="p-2">
                <BarList
                  items={ranked
                    .slice()
                    .sort((a, b) => b.excess - a.excess)
                    .slice(0, 12)
                    .map((r) => ({ key: r.unitId, label: r.name, value: Math.max(0, r.excess), sub: `PSI ${fmt(r.psi, 2)} · u ${fmt(r.uncertainty, 2)}`, color: colorFor("inferno", 0.35 + Math.min(0.6, r.excess / 6)) }))}
                  valueFormat={(v) => fmt(v, 2)}
                />
              </Panel>
            </div>
          </div>

          <Panel title="Methodological transparency" subtitle="Empirical Bayes formulation and uncertainty accounting">
            <div className="grid grid-cols-1 gap-4 p-2.5 lg:grid-cols-2">
              <FormulaBlock
                title="Empirical Bayes expected crash estimate"
                latex="E_i = w_i N_i + (1 - w_i)\,\mu_i,\qquad w_i = \frac{\varphi\,\mu_i}{1 + \varphi\,\mu_i}"
                notes={[
                  "Prior λ_i ~ Gamma(shape = 1/φ, scale = φμ_i) so that E[λ]=μ_i and Var(λ)=φμ_i²; likelihood N_i ~ Poisson(λ_i).",
                  "Posterior λ_i|N_i ~ Gamma(N_i + 1/φ, φμ_i/(1+φμ_i)); its mean is exactly the EB estimate above.",
                  "w_i increases with exposure μ_i: thin samples are shrunk onto the SPF prior, which is what removes regression-to-the-mean.",
                  `Overdispersion φ̂ = (χ²/dof − 1)/mean(μ) estimated by method of moments from the fitted SPF (φ = ${fmt(spf?.phi, 4)}).`,
                ]}
              />
              <FormulaBlock
                title="Uncertainty accounting"
                latex="u_i = 0.40\,s_i + 0.25\,g_i + 0.20\,v_i + 0.15\,d_i"
                notes={[
                  "s_i = sample sparsity: 1/√E_i (Poisson coefficient of variation of the posterior), capped at 1.",
                  "g_i = exposure gap: 0.85 when AADT/VKT is missing, 0.08 when observed — an explicit epistemic penalty.",
                  "v_i = VGI share: proportion of the evidence base that is still unverified crowd input.",
                  "d_i = positional residual: mean map-matching perpendicular distance normalised by lixel length.",
                  "Rendered bivariately (hue = risk, saturation/width = uncertainty) so that a high-risk, high-uncertainty corridor is never mistaken for a confident finding.",
                ]}
              />
            </div>
            <div className="border-t px-2.5 py-2 text-[10.5px] leading-snug" style={{ borderColor: "var(--border)", color: "var(--text-mute)" }}>
              {data?.disclaimer}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function total(w: Record<string, number>): number {
  return Object.values(w).reduce((s, v) => s + v, 0) || 1;
}

function Row({ k, v, tone }: { k: string; v?: string; tone?: "good" | "bad" }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className={v ? "text-[10px]" : "mono text-[10px]"} style={{ color: "var(--text-mute)" }}>{k}</span>
      {v && (
        <span className="mono text-[11px]" style={{ color: tone === "good" ? "var(--accent-2)" : tone === "bad" ? "var(--danger)" : "var(--text)" }}>
          {v}
        </span>
      )}
    </div>
  );
}

function bivariateColor(riskT: number, uncertaintyT: number): string {
  const r = Math.round(24 + riskT * 195 + uncertaintyT * 18);
  const g = Math.round(28 + (1 - riskT) * 55 + uncertaintyT * 128);
  const b = Math.round(58 + (1 - riskT) * 148 + uncertaintyT * 42);
  return `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)})`;
}
