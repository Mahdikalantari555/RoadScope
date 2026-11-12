"use client";
import { useMemo, useState } from "react";
import type { ExpressionSpecification } from "maplibre-gl";
import MapCanvas, { type FC, type Overlay } from "@/components/MapCanvas";
import { Bars, HourDowMatrix, TimeSeries } from "@/components/charts";
import { Panel, RampLegend, Stat, Swatches, SyntheticTag, fmt } from "@/components/ui";
import { useJson, useNetwork, useTheme, sevColor, fmtDate } from "@/components/hooks";
import { CLASS_COLORS, GI_COLORS, ramp } from "@/lib/colors";
import Link from "next/link";

interface Stats { daily: { day: string; n: number; verified: number }[]; matrix: { hour: number; dow: number; n: number }[]; bySev: { severityId: number; n: number }[]; byCat: { categoryId: number; n: number }[]; byWeather: { weather: string; n: number }[]; byLight: { lighting: string; n: number }[]; topSegments: { segmentId: number; n: number; epdo: number; lengthM: number; roadClass: string; density: number; aadt: number | null }[]; totals: { n: number; verified: number; raw: number; meanCred: number; meanSnap: number; meanLag: number; multiWitness: number; epdo: number } }
interface Job { id: number; kind: string; status: string; params: Record<string, unknown>; createdAt: string }

export default function Explorer() {
  const { net } = useNetwork();
  const theme = useTheme();
  const [range, setRange] = useState<[string, string] | null>(null);
  const [hours, setHours] = useState<number[]>([]); const [dows, setDows] = useState<number[]>([]);
  const [sev, setSev] = useState<number[]>([]); const [cat, setCat] = useState<number[]>([]); const [weather, setWeather] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>(["verified", "raw", "flagged"]);
  const [segs, setSegs] = useState<number[]>([]); const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);
  const [boxMode, setBoxMode] = useState(false);
  const [layer, setLayer] = useState<string>("none"); const [basemap, setBasemap] = useState(true);
  const [picked, setPicked] = useState<Record<string, unknown> | null>(null);

  const qs = useMemo(() => { const p = new URLSearchParams(); if (range) { p.set("from", range[0] + "T00:00:00Z"); p.set("to", range[1] + "T23:59:59Z"); } if (hours.length) p.set("hours", hours.join(",")); if (dows.length) p.set("dows", dows.join(",")); if (sev.length) p.set("severity", sev.join(",")); if (cat.length) p.set("category", cat.join(",")); if (weather.length) p.set("weather", weather.join(",")); p.set("status", statuses.join(",")); if (segs.length) p.set("segments", segs.join(",")); if (bbox) p.set("bbox", bbox.map((v) => v.toFixed(6)).join(",")); return p.toString(); }, [range, hours, dows, sev, cat, weather, statuses, segs, bbox]);
  const { data: points } = useJson<FC>(net?.source ? `/api/accidents?${qs}` : null);
  const { data: stats } = useJson<Stats>(net?.source ? `/api/stats?${qs}` : null);
  const { data: jobs } = useJson<{ jobs: Job[] }>(net?.source ? "/api/analysis/jobs" : null);
  const doneJobs = (jobs?.jobs ?? []).filter((j) => j.status === "done" && j.kind !== "ndbscan");
  const { data: layerRes } = useJson<{ geojson: FC; summary: Record<string, unknown>; job: Job }>(layer !== "none" ? `/api/analysis/jobs/${layer}` : null);

  const sevById = useMemo(() => new Map((net?.severities ?? []).map((s) => [s.id, s])), [net]);
  const catById = useMemo(() => new Map((net?.categories ?? []).map((c) => [c.id, c])), [net]);
  const pointColor = useMemo<ExpressionSpecification>(() => ["match", ["get", "severityId"], ...(net?.severities ?? []).flatMap((s) => [s.id, sevColor(s.code)]), "#7d8795"] as unknown as ExpressionSpecification, [net]);
  const pointRadius = useMemo<ExpressionSpecification>(() => ["interpolate", ["linear"], ["zoom"], 12, ["match", ["get", "severityId"], ...(net?.severities ?? []).flatMap((s) => [s.id, 1.5 + s.rank * 0.6]), 2], 16, ["match", ["get", "severityId"], ...(net?.severities ?? []).flatMap((s) => [s.id, 3 + s.rank * 1.3]), 4]] as unknown as ExpressionSpecification, [net]);

  const overlay = useMemo<{ overlays: Overlay[]; legend: React.ReactNode }>(() => {
    if (!layerRes?.geojson || !layerRes.job) return { overlays: [], legend: null };
    const k = layerRes.job.kind; const feats = layerRes.geojson.features;
    if (k === "gistar") return { overlays: [{ id: "lix", data: layerRes.geojson, type: "line", paint: { "line-color": ["match", ["get", "cls"], ...Object.entries(GI_COLORS).flat(), "#4b5563"], "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 16, 8], "line-opacity": ["match", ["get", "cls"], "ns", 0.25, 0.95] } }], legend: <Swatches items={[{ color: GI_COLORS.hot99, label: "hot q<0.01" }, { color: GI_COLORS.hot95, label: "hot q<0.05" }, { color: GI_COLORS.hot_uncorrected, label: "hot p<0.05 (no FDR)" }, { color: GI_COLORS.cold95, label: "cold q<0.05" }, { color: GI_COLORS.cold99, label: "cold q<0.01" }]} /> };
    const prop = k === "benchmark" ? "truth" : "nkde";
    const vals = feats.map((f) => Number((f.properties as Record<string, number>)[prop] ?? 0)).sort((a, b) => a - b);
    const max = vals[Math.floor(0.98 * (vals.length - 1))] || 1;
    const stops = Array.from({ length: 6 }, (_, i) => [(i / 5) * max, ramp(k === "benchmark" ? "viridis" : "inferno", i / 5)]).flat();
    return { overlays: [{ id: "lix", data: layerRes.geojson, type: "line", paint: { "line-color": ["interpolate", ["linear"], ["coalesce", ["get", prop], 0], ...stops], "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 16, 8], "line-opacity": 0.95 } }], legend: <RampLegend name={k === "benchmark" ? "viridis" : "inferno"} min={0} max={max} label={k === "benchmark" ? "Hidden true intensity λ (events/km, p98 clip)" : `NKDE h=${layerRes.job.params.bandwidth}m (events/km, p98 clip)`} /> };
  }, [layerRes]);

  const toggle = <T,>(arr: T[], v: T, set: (a: T[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const clearAll = () => { setRange(null); setHours([]); setDows([]); setSev([]); setCat([]); setWeather([]); setSegs([]); setBbox(null); };
  const active = [range && "time", hours.length && "hours", dows.length && "weekday", sev.length && "severity", cat.length && "type", weather.length && "weather", segs.length && `${segs.length} segment(s)`, bbox && "bbox"].filter(Boolean);

  if (net && !net.source) return (<div className="h-full flex items-center justify-center"><div className="panel p-6 max-w-lg text-center space-y-3"><div className="text-sm">No active dataset.</div><p style={{ color: "var(--fg-2)" }}>The platform runs out-of-the-box on a seeded inhomogeneous network point process. Generate a synthetic road network and crash realisation to begin.</p><Link href="/simulate" className="btn btn-primary">Open simulator</Link></div></div>);

  return (
    <div className="h-full grid" style={{ gridTemplateColumns: "1fr 380px" }}>
      <div className="relative min-h-0">
        <MapCanvas segments={net?.segments} points={points} pointColor={pointColor} pointRadius={pointRadius} cluster overlays={overlay.overlays} selectedSegmentIds={segs} fitBbox={net?.bbox ?? null} showBasemap={basemap} theme={theme}
          boxMode={boxMode} bbox={bbox} onBox={(b) => { setBbox(b); setBoxMode(false); }}
          onSegmentClick={(id) => toggle(segs, id, setSegs)} onPointClick={(_, pr) => setPicked(pr)}
          hoverHtml={(l, pr) => l === "segments" ? `<b>Segment #${pr.id}</b><br/>${pr.roadClass} · ${pr.lengthM} m · ${pr.speedLimit} km/h · ${pr.lanes} lanes<br/>AADT ${pr.aadt ?? "<i>missing</i>"} · sinuosity ${pr.sinuosity}` : l === "lix" ? `<b>Lixel #${pr.lixelId}</b> (seg ${pr.segmentId})<br/>${Object.entries(pr).filter(([k]) => !["lixelId", "segmentId"].includes(k)).map(([k, v]) => `${k}: ${typeof v === "number" ? v.toFixed(3) : v}`).join("<br/>")}` : l.startsWith("points") ? `<b>Report #${pr.id}</b> · ${sevById.get(Number(pr.severityId))?.label}<br/>${catById.get(Number(pr.categoryId))?.label}<br/>${fmtDate(String(pr.occurredAt))} · ${pr.status}<br/>snap ${Number(pr.snapDistanceM).toFixed(1)} m · P=${Number(pr.snapPosterior).toFixed(2)} · witnesses ${pr.witnessCount}` : null}>
          <div className="absolute top-2 left-2 flex flex-col gap-1 w-56">
            <div className="panel p-2 space-y-1.5">
              <div className="flex gap-1"><button className={`btn btn-xs flex-1 ${boxMode ? "btn-primary" : ""}`} onClick={() => setBoxMode(!boxMode)}>▭ Box select</button><button className="btn btn-xs" onClick={() => setBasemap(!basemap)}>{basemap ? "Hide" : "Show"} basemap</button></div>
              <select className="inp" value={layer} onChange={(e) => setLayer(e.target.value)}><option value="none">Overlay: none (incidents only)</option>{doneJobs.map((j) => <option key={j.id} value={j.id}>#{j.id} {j.kind.toUpperCase()} {j.kind === "gistar" ? `δ=${j.params.delta}m` : `h=${j.params.bandwidth}m`}</option>)}</select>
              <div className="flex flex-wrap gap-1">{["verified", "raw", "flagged"].map((s) => <button key={s} className={`btn btn-xs ${statuses.includes(s) ? "btn-primary" : ""}`} onClick={() => toggle(statuses, s, setStatuses)}>{s}</button>)}</div>
            </div>
            <div className="panel p-2 space-y-1">
              <Swatches items={(net?.severities ?? []).map((s) => ({ color: sevColor(s.code), label: s.label, shape: "dot" as const }))} />
              <Swatches items={Object.entries(CLASS_COLORS).map(([k, c]) => ({ color: c, label: k }))} />
              {overlay.legend}
              <div className="text-[9px]" style={{ color: "var(--fg-2)" }}>{net?.crs?.metric}</div>
            </div>
          </div>
          {picked && <div className="absolute bottom-6 left-2 panel p-2 w-64 text-[11px]"><div className="flex justify-between"><b>Report #{String(picked.id)}</b><button className="btn btn-xs" onClick={() => setPicked(null)}>×</button></div>
            <dl className="kv mt-1"><dt>Status</dt><dd>{String(picked.status)}</dd><dt>Severity</dt><dd>{sevById.get(Number(picked.severityId))?.label}</dd><dt>Type</dt><dd>{catById.get(Number(picked.categoryId))?.label}</dd><dt>Occurred</dt><dd>{fmtDate(String(picked.occurredAt))}</dd><dt>Reported</dt><dd>{fmtDate(String(picked.reportedAt))}</dd><dt>Segment / m</dt><dd>#{String(picked.segmentId)} @ {fmt(Number(picked.offsetM), 1)} m</dd><dt>Snap dist / P</dt><dd>{fmt(Number(picked.snapDistanceM), 1)} m / {fmt(Number(picked.snapPosterior))}</dd><dt>σ reporter</dt><dd>{String(picked.uncertaintyRadiusM)} m</dd><dt>Witnesses / cred.</dt><dd>{String(picked.witnessCount)} / {fmt(Number(picked.credibility))}</dd><dt>Weather / light</dt><dd>{String(picked.weather)} / {String(picked.lighting)}</dd></dl>
            <div className="mt-1 flex gap-1"><button className="btn btn-xs" onClick={() => { toggle(segs, Number(picked.segmentId), setSegs); }}>Filter to segment</button>{picked.isSynthetic ? <span className="tag tag-syn">synthetic</span> : <span className="tag">empirical</span>}</div></div>}
        </MapCanvas>
      </div>
      <aside className="min-h-0 overflow-y-auto border-l p-1.5 space-y-1.5" style={{ borderColor: "var(--line)", background: "var(--bg)" }}>
        <div className="panel grid grid-cols-4">
          <Stat label="Reports" value={stats?.totals.n ?? "—"} sub={`${stats?.totals.verified ?? 0} verified`} /><Stat label="EPDO" value={fmt(stats?.totals.epdo, 0)} sub="severity-weighted" /><Stat label="Mean snap" value={`${fmt(stats?.totals.meanSnap, 1)} m`} sub={`lag ${fmt(stats?.totals.meanLag, 0)} min`} /><Stat label="Multi-witness" value={stats?.totals.multiWitness ?? "—"} sub={`cred. ${fmt(stats?.totals.meanCred)}`} />
        </div>
        <div className="flex items-center gap-1 flex-wrap text-[10.5px] px-1"><span style={{ color: "var(--fg-2)" }}>Active filters:</span>{active.length ? active.map((a) => <span key={String(a)} className="tag">{String(a)}</span>) : <span style={{ color: "var(--fg-2)" }}>none</span>}{active.length > 0 && <button className="btn btn-xs ml-auto" onClick={clearAll}>clear all</button>}<SyntheticTag kind={net?.source?.kind} /></div>
        <Panel title="Daily series · brush to filter" right={range && <span className="mono text-[10px]">{range[0]} → {range[1]}</span>}><TimeSeries data={stats?.daily ?? []} range={range} onBrush={setRange} /></Panel>
        <Panel title="Hour × weekday matrix · click to filter"><HourDowMatrix data={stats?.matrix ?? []} hours={hours} dows={dows} onToggleHour={(h) => toggle(hours, h, setHours)} onToggleDow={(d) => toggle(dows, d, setDows)} /></Panel>
        <div className="grid grid-cols-2 gap-1.5">
          <Panel title="Severity"><Bars items={(net?.severities ?? []).map((s) => ({ key: s.id, label: s.label, n: stats?.bySev.find((b) => b.severityId === s.id)?.n ?? 0, color: sevColor(s.code) }))} selected={sev} onToggle={(k) => toggle(sev, Number(k), setSev)} /></Panel>
          <Panel title="Weather"><Bars items={(stats?.byWeather ?? []).map((w) => ({ key: w.weather, label: w.weather, n: w.n }))} selected={weather} onToggle={(k) => toggle(weather, String(k), setWeather)} color="#5ec8f2" /><div className="mt-1"><Bars items={(stats?.byLight ?? []).map((w) => ({ key: w.lighting, label: w.lighting, n: w.n }))} color="#7d8795" /></div></Panel>
        </div>
        <Panel title="Accident taxonomy"><Bars items={(net?.categories ?? []).map((c) => ({ key: c.id, label: c.label, n: stats?.byCat.find((b) => b.categoryId === c.id)?.n ?? 0 }))} selected={cat} onToggle={(k) => toggle(cat, Number(k), setCat)} color="#a78bfa" /></Panel>
        <Panel title="Top segments in subset · click to select on map" bodyClass="overflow-auto max-h-56 p-0">
          <table className="tbl"><thead><tr><th>#</th><th>Class</th><th>N</th><th>N/km</th><th>EPDO</th><th>AADT</th></tr></thead><tbody>
            {(stats?.topSegments ?? []).map((s) => <tr key={s.segmentId} className={segs.includes(s.segmentId) ? "sel" : ""} onClick={() => toggle(segs, s.segmentId, setSegs)}><td className="mono">{s.segmentId}</td><td>{s.roadClass}</td><td className="mono">{s.n}</td><td className="mono">{fmt(s.density, 1)}</td><td className="mono">{fmt(s.epdo, 0)}</td><td className="mono">{s.aadt ?? <span style={{ color: "var(--warn)" }}>n/a</span>}</td></tr>)}
          </tbody></table>
        </Panel>
        {layerRes?.summary && <Panel title={`Overlay job #${layer} metadata`}><pre className="mono text-[10px] whitespace-pre-wrap" style={{ color: "var(--fg-1)" }}>{JSON.stringify(Object.fromEntries(Object.entries(layerRes.summary).filter(([k]) => k !== "method")), null, 1).slice(0, 900)}</pre></Panel>}
      </aside>
    </div>
  );
}
