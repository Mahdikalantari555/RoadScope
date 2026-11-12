"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExpressionSpecification, Map as MLMap, MapMouseEvent } from "maplibre-gl";
import { Play } from "lucide-react";
import { EChart, axisStyle, baseOption, chartTheme, type ChartOption } from "@/components/charts/EChart";
import { FilterPanel } from "@/components/FilterPanel";
import { MapView, removeLayers, upsertSource } from "@/components/map/MapView";
import { useApp } from "@/components/providers";
import { Badge, Button, Explain, KV, LoadingBar, Notice, Panel, Segmented, cx } from "@/components/ui";
import { api, cleanFilters, fmt } from "@/lib/client/api";
import { RISK_DOC } from "@/lib/methods";

interface Row {
  id: number;
  name: string;
  roadClass: string;
  lengthM: number;
  n: number;
  ciLow: number;
  ciHigh: number;
  epdo: number;
  densityKmYr: number;
  epdoKmYr: number;
  ratePerMVKm: number | null;
  expected: number;
  ebWeight: number;
  eb: number;
  psi: number;
  components: Record<string, number | null>;
  index: number;
  rankIndex: number;
  rankSafety: number;
  rankLow: number;
  rankHigh: number;
  pTopK: number;
  reliability: "low" | "moderate" | "high";
  pendingShare: number;
}
interface Resp {
  rows: Row[];
  groups: { roadClass: string; segments: number; meanRateKm: number; overdispersion: number; totalN: number }[];
  coverage: { segments: number; segmentsWithEvents: number; segmentsWithAadt: number; lowReliabilityShare: number; totalEvents: number; pendingEventsUsed: number; years: number };
  effectiveWeights: Record<string, number>;
  notes: string[];
  geometry: Record<string, [number, number][]>;
  unassignedEvents: number;
  syntheticData: boolean;
  runtimeMs: number;
  config: { useEmpiricalBayes: boolean; useExposure: boolean; topK: number };
}
type Symbol = "index" | "eb" | "psi" | "pTopK" | "reliability";

const WEIGHT_LABELS: Record<string, { label: string; hint: string }> = {
  frequency: { label: "Frequency", hint: "EB (or observed) incidents per km·yr" },
  severity: { label: "Severity", hint: "EPDO per km·yr" },
  exposure: { label: "Exposure rate", hint: "incidents per million vehicle-km (needs AADT)" },
  road: { label: "Road design", hint: "speed limit, lanes, lighting (expert prior)" },
  environment: { label: "Environment", hint: "share in adverse weather or darkness (shrunk)" },
};

export default function RiskPage() {
  const { filters, theme, meta } = useApp();
  const [weights, setWeights] = useState({ frequency: 0.35, severity: 0.25, exposure: 0.2, road: 0.1, environment: 0.1 });
  const [epdo, setEpdo] = useState<Record<string, number>>({ pdo: 1, slight: 3, serious: 6, fatal: 12 });
  const [eb, setEb] = useState(true);
  const [exposure, setExposure] = useState(true);
  const [topK, setTopK] = useState(20);
  const [sims, setSims] = useState(300);
  const [includePending, setIncludePending] = useState(false);
  const [res, setRes] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [map, setMap] = useState<MLMap | null>(null);
  const [sym, setSym] = useState<Symbol>("index");
  const [sel, setSel] = useState<number | null>(null);
  const [sort, setSort] = useState<"rankIndex" | "rankSafety" | "psi">("rankIndex");
  const t = chartTheme(theme);

  const run = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api<Resp>("/api/risk", {
        method: "POST",
        json: { filters: cleanFilters({ ...filters, statuses: includePending ? ["verified", "reported"] : ["verified"] }), config: { weights, epdoWeights: epdo, useEmpiricalBayes: eb, useExposure: exposure, topK, simulations: sims } },
      });
      setRes(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filters, includePending, weights, epdo, eb, exposure, topK, sims]);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const fc = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!res) return null;
    return {
      type: "FeatureCollection",
      features: res.rows.map((r) => ({ type: "Feature", id: r.id, geometry: { type: "LineString", coordinates: res.geometry[r.id] }, properties: { id: r.id, index: r.index, eb: r.eb / (r.lengthM / 1000) / res.coverage.years, psi: r.psi, pTopK: r.pTopK, reliability: r.reliability, rel: r.reliability === "high" ? 2 : r.reliability === "moderate" ? 1 : 0 } })),
    };
  }, [res]);

  useEffect(() => {
    if (!map || !fc || !res) return;
    const draw = () => {
      removeLayers(map, ["rk-line", "rk-low", "rk-sel"]);
      upsertSource(map, "rk", fc);
      const maxEb = Math.max(...fc.features.map((f) => Number(f.properties?.eb ?? 0)), 1);
      const maxPsi = Math.max(...fc.features.map((f) => Math.abs(Number(f.properties?.psi ?? 0))), 0.1);
      const color: Record<Symbol, unknown[]> = {
        index: ["interpolate", ["linear"], ["get", "index"], 0, "#1a9850", 40, "#a6d96a", 60, "#fee08b", 75, "#fc8d59", 90, "#d73027"],
        eb: ["interpolate", ["linear"], ["get", "eb"], 0, "#1a9850", maxEb * 0.25, "#fee08b", maxEb * 0.5, "#fc8d59", maxEb, "#d73027"],
        psi: ["interpolate", ["linear"], ["get", "psi"], -maxPsi, "#2171b5", 0, "#d9d9d9", maxPsi, "#d7301f"],
        pTopK: ["interpolate", ["linear"], ["get", "pTopK"], 0, "#3b4452", 0.2, "#fee08b", 0.5, "#fc8d59", 0.9, "#d73027"],
        reliability: ["match", ["get", "reliability"], "high", "#4ade80", "moderate", "#eab308", "#f87171"],
      };
      const width: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 12, 2, 17, 8];
      map.addLayer({ id: "rk-line", type: "line", source: "rk", filter: ["!=", ["get", "reliability"], "low"], layout: { "line-cap": "round" }, paint: { "line-color": color[sym] as unknown as ExpressionSpecification, "line-width": width } });
      map.addLayer({ id: "rk-low", type: "line", source: "rk", filter: ["==", ["get", "reliability"], "low"], paint: { "line-color": color[sym] as unknown as ExpressionSpecification, "line-width": width, "line-dasharray": [1.2, 1.2], "line-opacity": 0.7 } });
      map.addLayer({ id: "rk-sel", type: "line", source: "rk", filter: ["==", ["get", "id"], sel ?? -1], paint: { "line-color": "#4fd1c5", "line-width": 10, "line-opacity": 0.45 } });
    };
    if (map.isStyleLoaded()) draw();
    else map.once("idle", draw);
  }, [map, fc, res, sym, sel]);

  const onReady = useCallback((m: MLMap) => {
    setMap(m);
    m.on("click", (e: MapMouseEvent) => {
      const layers = ["rk-line", "rk-low"].filter((l) => m.getLayer(l));
      const f = layers.length ? m.queryRenderedFeatures(e.point, { layers })[0] : undefined;
      if (f) setSel(Number(f.properties?.id));
    });
  }, []);

  const flyTo = (id: number) => {
    setSel(id);
    const g = res?.geometry[id];
    if (map && g) map.easeTo({ center: g[Math.floor(g.length / 2)], zoom: Math.max(map.getZoom(), 15.5) });
  };

  const rows = useMemo(() => (res ? [...res.rows].sort((a, b) => (sort === "psi" ? b.psi - a.psi : a[sort] - b[sort])) : []), [res, sort]);
  const selRow = res?.rows.find((r) => r.id === sel) ?? null;

  const rankOpt = useMemo<ChartOption | null>(() => {
    if (!res) return null;
    const top = [...res.rows].sort((a, b) => a.rankSafety - b.rankSafety).slice(0, 25);
    return {
      ...baseOption(theme),
      grid: { left: 34, right: 10, top: 10, bottom: 24 },
      tooltip: { ...baseOption(theme).tooltip, trigger: "axis", formatter: (p: unknown) => { const i = (p as { dataIndex: number }[])[0].dataIndex; const r = top[i]; return `#${r.id} ${r.name}<br/>rank ${r.rankSafety} (90% interval ${r.rankLow}–${r.rankHigh})<br/>P(top-${res.config.topK}) = ${(r.pTopK * 100).toFixed(0)}%`; } },
      xAxis: { type: "category", data: top.map((r) => `#${r.rankSafety}`), ...axisStyle(theme) },
      yAxis: { type: "value", inverse: true, min: 1, ...axisStyle(theme), name: "rank", nameTextStyle: { color: t.faint, fontSize: 10 } },
      series: [
        { type: "bar", stack: "r", data: top.map((r) => r.rankLow), itemStyle: { color: "transparent" }, barWidth: 5 },
        { type: "bar", stack: "r", data: top.map((r) => Math.max(0.5, r.rankHigh - r.rankLow)), itemStyle: { color: t.faint }, barWidth: 5 },
        { type: "scatter", data: top.map((r) => r.rankSafety), itemStyle: { color: t.accent }, symbolSize: 7 },
      ],
    };
  }, [res, theme, t.accent, t.faint]);

  const wsum = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="h-full flex flex-col lg:flex-row">
      <aside className="lg:w-[290px] shrink-0 border-r border-line bg-panel overflow-y-auto max-h-[45%] lg:max-h-none">
        <div className="p-3 space-y-3">
          <div>
            <h1 className="text-[14px] font-semibold">Risk assessment</h1>
            <p className="text-[11.5px] text-muted leading-snug">Transparent, interpretable indicators. The composite index is <b>relative and uncalibrated</b> — not a probability.</p>
          </div>
          <div>
            <div className="label mb-1">Indicator weights (renormalised)</div>
            {Object.entries(weights).map(([k, v]) => (
              <div key={k} className="mb-1.5">
                <div className="flex justify-between text-[12px]">
                  <span title={WEIGHT_LABELS[k].hint}>{WEIGHT_LABELS[k].label}</span>
                  <span className="num text-muted">{fmt.pct(v / wsum, 0)}</span>
                </div>
                <input type="range" min={0} max={1} step={0.05} value={v} onChange={(e) => setWeights((w) => ({ ...w, [k]: Number(e.target.value) }))} className="w-full" />
                <div className="text-[10.5px] text-faint -mt-0.5">{WEIGHT_LABELS[k].hint}</div>
              </div>
            ))}
          </div>
          <div>
            <div className="label mb-1">EPDO severity weights</div>
            <div className="grid grid-cols-4 gap-1">
              {meta?.severities.map((s) => (
                <label key={s.code} className="text-[10.5px] text-muted">
                  {s.code}
                  <input className="field num mt-0.5" type="number" min={0} max={1000} value={epdo[s.code] ?? 1} onChange={(e) => setEpdo((x) => ({ ...x, [s.code]: Number(e.target.value) }))} />
                </label>
              ))}
            </div>
            <p className="text-[10.5px] text-faint mt-1">Illustrative defaults; replace with national crash-cost ratios for operational use.</p>
          </div>
          <div className="space-y-1.5 text-[12px]">
            <label className="flex items-center gap-2"><input type="checkbox" checked={eb} onChange={(e) => setEb(e.target.checked)} /> Empirical Bayes adjustment (RTM correction)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={exposure} onChange={(e) => setExposure(e.target.checked)} /> Exposure-aware (AADT · length)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={includePending} onChange={(e) => setIncludePending(e.target.checked)} /> Include unverified reports (sensitivity)</label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-muted">Top-K<input className="field num mt-0.5" type="number" min={1} max={200} value={topK} onChange={(e) => setTopK(Number(e.target.value))} /></label>
            <label className="text-[11px] text-muted">MC draws<input className="field num mt-0.5" type="number" min={0} max={1000} step={50} value={sims} onChange={(e) => setSims(Number(e.target.value))} /></label>
          </div>
          <Button variant="primary" size="md" className="w-full" loading={loading} onClick={run}>
            <Play className="size-3.5" /> Recompute
          </Button>
          <details className="border border-line rounded-[4px]">
            <summary className="px-2 py-1.5 text-[12px] text-muted cursor-pointer">Input filters</summary>
            <div className="p-2 border-t border-line">
              <FilterPanel statusDefault={["verified"]} hide={["status"]} compact />
            </div>
          </details>
          <Explain title="Methodology & references">
            <ul className="list-disc pl-4 space-y-1">
              {RISK_DOC.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <ul className="space-y-1 text-[11px] pt-1">
              {RISK_DOC.references.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Explain>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <LoadingBar active={loading} />
        <MapView onReady={onReady} basemap="minimal" className="flex-1 min-h-[280px]">
          <div className="absolute top-2 left-2 z-10">
            <Segmented<Symbol>
              size="xs"
              value={sym}
              onChange={setSym}
              options={[
                { value: "index", label: "Index", title: "Relative risk index 0–100" },
                { value: "eb", label: "EB /km·yr", title: "Empirical Bayes expected frequency per km per year" },
                { value: "psi", label: "PSI", title: "Potential for safety improvement (EB − expected)" },
                { value: "pTopK", label: "P(top-K)", title: "Posterior probability of being in the top-K" },
                { value: "reliability", label: "Reliability", title: "Data reliability class" },
              ]}
            />
          </div>
          <div className="absolute left-2 bottom-8 z-10 bg-panel/92 border border-line rounded-[4px] px-2.5 py-2 text-[11px] max-w-[230px]">
            <div className="label mb-1">{{ index: "Relative risk index (unitless)", eb: "EB expected incidents / km·yr", psi: "PSI (excess over group expectation)", pTopK: `P(in top-${topK})`, reliability: "Reliability" }[sym]}</div>
            {sym === "reliability" ? (
              <div className="space-y-0.5">
                {[["high", "#4ade80"], ["moderate", "#eab308"], ["low (n<3 or wide CI)", "#f87171"]].map(([l, c]) => (
                  <div key={l} className="flex items-center gap-1.5"><span className="w-4 h-[3px]" style={{ background: c }} />{l}</div>
                ))}
              </div>
            ) : (
              <>
                <div className="h-2 w-44 rounded-sm" style={{ background: sym === "psi" ? "linear-gradient(90deg,#2171b5,#d9d9d9,#d7301f)" : sym === "pTopK" ? "linear-gradient(90deg,#3b4452,#fee08b,#fc8d59,#d73027)" : "linear-gradient(90deg,#1a9850,#a6d96a,#fee08b,#fc8d59,#d73027)" }} />
                <div className="flex justify-between text-faint num"><span>{sym === "psi" ? "below" : "low"}</span><span>{sym === "psi" ? "above expected" : "high"}</span></div>
              </>
            )}
            <div className="text-muted mt-1">dashed = low reliability</div>
          </div>
          {err && <div className="absolute top-10 left-2 z-10 max-w-sm"><Notice tone="danger">{err}</Notice></div>}
        </MapView>
        {res && (
          <div className="h-[42%] min-h-[220px] border-t border-line bg-panel flex flex-col md:flex-row min-h-0">
            <div className="flex-1 min-w-0 flex flex-col min-h-0">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-line">
                <span className="label">Ranked segments</span>
                <Segmented size="xs" value={sort} onChange={setSort} options={[{ value: "rankIndex", label: "by index" }, { value: "rankSafety", label: `by ${res.config.useEmpiricalBayes ? "EB" : "observed"} density` }, { value: "psi", label: "by PSI" }]} />
                {res.syntheticData && <Badge color="#f5a524" className="ml-auto">synthetic</Badge>}
              </div>
              <div className="overflow-auto flex-1">
                <table className="w-full text-[11.5px]">
                  <thead className="sticky top-0 bg-panel2 text-faint">
                    <tr>
                      {["#", "Segment", "Index", "n [95% CI]", "EB", "μ (exp.)", "PSI", "/MVkm", "Rank 90% int.", `P(top-${res.config.topK})`, "Rel."].map((h) => (
                        <th key={h} className="text-left font-medium px-2 py-1 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 150).map((r) => (
                      <tr key={r.id} onClick={() => flyTo(r.id)} className={cx("border-t border-line/60 cursor-pointer hover:bg-panel2", sel === r.id && "bg-accent-soft")}>
                        <td className="px-2 py-0.5 num text-faint">{sort === "rankIndex" ? r.rankIndex : sort === "rankSafety" ? r.rankSafety : "—"}</td>
                        <td className="px-2 truncate max-w-[170px]" title={r.name}>{r.name} <span className="text-faint">#{r.id}</span></td>
                        <td className="px-2 num font-medium">{r.index.toFixed(1)}</td>
                        <td className="px-2 num">{r.n} <span className="text-faint">[{r.ciLow.toFixed(1)}–{r.ciHigh.toFixed(1)}]</span></td>
                        <td className="px-2 num">{r.eb.toFixed(2)}</td>
                        <td className="px-2 num text-muted">{r.expected.toFixed(2)}</td>
                        <td className={cx("px-2 num", r.psi > 0 ? "text-danger" : "text-muted")}>{r.psi.toFixed(2)}</td>
                        <td className="px-2 num text-muted">{r.ratePerMVKm === null ? "—" : r.ratePerMVKm.toFixed(2)}</td>
                        <td className="px-2 num">{r.rankLow}–{r.rankHigh}</td>
                        <td className="px-2 num">{fmt.pct(r.pTopK, 0)}</td>
                        <td className="px-2"><span className={r.reliability === "high" ? "text-ok" : r.reliability === "moderate" ? "text-warn" : "text-danger"}>{r.reliability}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="md:w-[340px] shrink-0 border-l border-line overflow-y-auto p-3 space-y-3">
              {selRow ? (
                <Panel title={`Segment #${selRow.id}`} subtitle={`${selRow.name} · ${selRow.roadClass} · ${Math.round(selRow.lengthM)} m`}>
                  <KV k="Relative risk index" v={`${selRow.index.toFixed(1)} (rank ${selRow.rankIndex})`} />
                  <KV k="Observed n [95% CI]" v={`${selRow.n} [${selRow.ciLow.toFixed(1)}–${selRow.ciHigh.toFixed(1)}]`} />
                  <KV k="Group expectation μ" v={selRow.expected.toFixed(2)} />
                  <KV k="EB weight w" v={selRow.ebWeight.toFixed(3)} />
                  <KV k="EB estimate" v={selRow.eb.toFixed(2)} />
                  <KV k="Density /km·yr" v={selRow.densityKmYr.toFixed(2)} />
                  <KV k="EPDO /km·yr" v={selRow.epdoKmYr.toFixed(2)} />
                  <KV k="Safety rank 90% interval" v={`${selRow.rankLow}–${selRow.rankHigh}`} />
                  <div className="label mt-2 mb-1">Component percentiles</div>
                  {Object.entries(selRow.components).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2 text-[11px] py-0.5">
                      <span className="w-20 text-muted">{WEIGHT_LABELS[k]?.label ?? k}</span>
                      <div className="flex-1 h-[6px] bg-panel2 rounded-sm overflow-hidden"><div className="h-full bg-accent" style={{ width: `${(v ?? 0) * 100}%` }} /></div>
                      <span className="num w-10 text-right">{v === null ? "n/a" : v.toFixed(2)}</span>
                    </div>
                  ))}
                </Panel>
              ) : (
                <div>
                  <div className="label mb-1">Rank uncertainty — top 25 by {res.config.useEmpiricalBayes ? "EB" : "observed"} density</div>
                  {rankOpt && <EChart option={rankOpt} height={170} />}
                  <p className="text-[10.5px] text-faint">Dot = point rank; bar = 90% posterior rank interval. Overlapping intervals mean the ordering is not statistically distinguishable.</p>
                </div>
              )}
              <Panel title="Data coverage & uncertainty">
                <KV k="Segments" v={res.coverage.segments} />
                <KV k="Segments with ≥1 event" v={`${res.coverage.segmentsWithEvents} (${fmt.pct(res.coverage.segmentsWithEvents / res.coverage.segments, 0)})`} />
                <KV k="Low-reliability share" v={fmt.pct(res.coverage.lowReliabilityShare, 0)} />
                <KV k="AADT coverage" v={`${res.coverage.segmentsWithAadt}/${res.coverage.segments}`} />
                <KV k="Events used / unassigned" v={`${res.coverage.totalEvents} / ${res.unassignedEvents}`} />
                <KV k="Unverified events used" v={res.coverage.pendingEventsUsed} />
                <KV k="Observation span" v={`${res.coverage.years.toFixed(2)} yr`} />
                <div className="label mt-2 mb-1">EB reference groups</div>
                {res.groups.map((g) => (
                  <KV key={g.roadClass} k={g.roadClass} v={`λ=${g.meanRateKm.toFixed(2)} · φ=${g.overdispersion.toFixed(3)} · n=${g.totalN}`} />
                ))}
                {res.notes.map((n) => (
                  <p key={n} className="text-[10.5px] text-faint mt-1">{n}</p>
                ))}
                <p className="text-[10.5px] text-faint mt-1">Computed in {res.runtimeMs} ms.</p>
              </Panel>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
