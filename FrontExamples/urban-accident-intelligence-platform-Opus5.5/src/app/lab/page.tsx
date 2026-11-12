"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExpressionSpecification, Map as MLMap, MapMouseEvent } from "maplibre-gl";
import { Download, Play } from "lucide-react";
import { EChart, axisStyle, baseOption, chartTheme, type ChartOption } from "@/components/charts/EChart";
import { FilterPanel } from "@/components/FilterPanel";
import { MapView, removeLayers, upsertSource } from "@/components/map/MapView";
import * as L from "@/components/explorer/layers";
import { giLabel } from "@/components/explorer/Explorer";
import { useApp } from "@/components/providers";
import { Badge, Button, Empty, Explain, Field, KV, Notice, Panel, Segmented, cx } from "@/components/ui";
import { ANALYSIS_METHODS, type AnalysisMethod } from "@/lib/domain";
import { METHOD_DOCS } from "@/lib/methods";
import { api, cleanFilters, filtersToQuery, fmt } from "@/lib/client/api";

type FC = GeoJSON.FeatureCollection<GeoJSON.Geometry, Record<string, unknown>>;
interface Job {
  id: number;
  method: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  message: string;
  error: string | null;
  createdAt: string;
  params: Record<string, unknown>;
}
interface Result {
  summary: Record<string, unknown>;
  geojson: FC | null;
  table: Record<string, unknown>[] | null;
}

const DEFAULT_PARAMS: Record<AnalysisMethod, Record<string, unknown>> = {
  kde: { cellSize: 100, bandwidth: null, kernel: "quartic", weight: "none" },
  gistar: { unit: "grid", cellSize: 200, band: 500, fdr: true, weight: "none" },
  dbscan: { eps: 60, minPts: 8 },
  nearest: { maxDistance: 60 },
  segments: { metric: "density" },
  temporal: {},
  environment: {},
  pattern: { cellSize: 200, band: 500 },
};
const RESULT_LAYERS = ["lab-kde", "lab-gi", "lab-gi-line", "lab-db-fill", "lab-db-line", "lab-nn-line", "lab-nn-pt", "lab-seg", "lab-pat-fill", "lab-pat-line", "lab-pat-pt", "lab-pts"];
const CLUSTER_COLORS = ["#4fd1c5", "#f5a524", "#e879f9", "#60a5fa", "#f97316", "#34d399", "#a78bfa", "#facc15", "#22d3ee", "#fb7185"];

export default function LabPage() {
  const { filters, theme } = useApp();
  const [method, setMethod] = useState<AnalysisMethod>("gistar");
  const [params, setParams] = useState<Record<AnalysisMethod, Record<string, unknown>>>(DEFAULT_PARAMS);
  const [input, setInput] = useState<"verified" | "all">("verified");
  const [job, setJob] = useState<Job | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<Job[]>([]);
  const [map, setMap] = useState<MLMap | null>(null);
  const [pts, setPts] = useState<FC | null>(null);
  const [picked, setPicked] = useState<Record<string, unknown> | null>(null);
  const [showPts, setShowPts] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const t = chartTheme(theme);
  const p = params[method];
  const setP = (k: string, v: unknown) => setParams((all) => ({ ...all, [method]: { ...all[method], [k]: v } }));
  const statuses = useMemo(() => (input === "verified" ? ["verified"] : ["verified", "reported"]), [input]);
  const doc = METHOD_DOCS[method];

  const loadHistory = useCallback(() => api<{ items: Job[] }>("/api/analysis/jobs").then((r) => setHistory(r.items)).catch(() => undefined), []);
  useEffect(() => {
    void loadHistory();
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, [loadHistory]);

  useEffect(() => {
    api<FC>(`/api/accidents${filtersToQuery({ ...filters, statuses }, { format: "geojson" })}`)
      .then(setPts)
      .catch(() => undefined);
  }, [filters, statuses]);

  const openJob = useCallback(
    (id: number) => {
      if (poll.current) clearInterval(poll.current);
      setErr(null);
      setPicked(null);
      const tick = async () => {
        try {
          const r = await api<{ job: Job; result: Result | null }>(`/api/analysis/jobs/${id}`);
          setJob(r.job);
          if (r.job.status === "succeeded") {
            setResult(r.result);
            if (poll.current) clearInterval(poll.current);
            void loadHistory();
          } else if (r.job.status === "failed") {
            setErr(r.job.error ?? "Analysis failed");
            if (poll.current) clearInterval(poll.current);
            void loadHistory();
          }
        } catch (e) {
          setErr((e as Error).message);
          if (poll.current) clearInterval(poll.current);
        }
      };
      void tick();
      poll.current = setInterval(tick, 600);
    },
    [loadHistory],
  );

  const run = async () => {
    setResult(null);
    setErr(null);
    try {
      const j = await api<Job>("/api/analysis/jobs", { method: "POST", json: { method, params: p, filters: cleanFilters({ ...filters, statuses }) } });
      setJob(j);
      openJob(j.id);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  // Render result layers
  useEffect(() => {
    if (!map) return;
    const draw = () => {
      removeLayers(map, RESULT_LAYERS);
      const m = (job?.method ?? method) as AnalysisMethod;
      const g = result?.geojson;
      if (g) {
        upsertSource(map, "lab", g);
        if (m === "kde") map.addLayer({ id: "lab-kde", type: "fill", source: "lab", paint: { "fill-color": ["interpolate", ["linear"], ["get", "rel"], ...L.KDE_RAMP.flat()] as unknown as ExpressionSpecification, "fill-opacity": ["interpolate", ["linear"], ["get", "rel"], 0, 0.15, 0.2, 0.55, 1, 0.85] } });
        if (m === "gistar") {
          const color = ["match", ["get", "cls"], ...Object.entries(L.GI_COLORS).flat(), "#6b7483"] as unknown as ExpressionSpecification;
          map.addLayer({ id: "lab-gi", type: "fill", source: "lab", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": color, "fill-opacity": ["match", ["get", "cls"], "ns", 0.06, 0.65] } });
          map.addLayer({ id: "lab-gi-line", type: "line", source: "lab", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": color, "line-width": ["match", ["get", "cls"], "ns", 1, 4.5] } });
        }
        if (m === "dbscan") {
          const color = ["to-color", ["at", ["%", ["get", "cluster"], CLUSTER_COLORS.length], ["literal", CLUSTER_COLORS]]] as unknown as ExpressionSpecification;
          map.addLayer({ id: "lab-db-fill", type: "fill", source: "lab", paint: { "fill-color": color, "fill-opacity": 0.3 } });
          map.addLayer({ id: "lab-db-line", type: "line", source: "lab", paint: { "line-color": color, "line-width": 1.5 } });
        }
        if (m === "nearest") {
          map.addLayer({ id: "lab-nn-line", type: "line", source: "lab", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": ["interpolate", ["linear"], ["get", "distance"], 0, "#4fd1c5", 15, "#eab308", 30, "#f97316", 60, "#e11d48"], "line-width": 1.6 } });
          map.addLayer({ id: "lab-nn-pt", type: "circle", source: "lab", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 5, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#e11d48", "circle-stroke-width": 2 } });
        }
        if (m === "segments") {
          const vals = g.features.map((f) => Number(f.properties.value));
          const br = L.quantileBreaks(vals);
          const step: unknown[] = ["step", ["get", "value"], L.SEG_COLORS[0]];
          br.forEach((b, i) => step.push(b, L.SEG_COLORS[Math.min(4, i + 1)]));
          map.addLayer({ id: "lab-seg", type: "line", source: "lab", layout: { "line-cap": "round" }, paint: { "line-color": ["case", ["==", ["get", "n"], 0], "#6b7483", step] as unknown as ExpressionSpecification, "line-width": ["case", ["==", ["get", "n"], 0], 1, 4], "line-opacity": ["case", ["==", ["get", "n"], 0], 0.35, 1] } });
        }
        if (m === "pattern") {
          map.addLayer({ id: "lab-pat-fill", type: "fill", source: "lab", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#4fd1c5", "fill-opacity": 0.08 } });
          map.addLayer({ id: "lab-pat-line", type: "line", source: "lab", filter: ["==", ["geometry-type"], "Polygon"], paint: { "line-color": "#4fd1c5", "line-width": 2, "line-dasharray": [2, 1] } });
          map.addLayer({ id: "lab-pat-pt", type: "circle", source: "lab", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 7, "circle-color": "#4fd1c5", "circle-stroke-color": "#04201d", "circle-stroke-width": 2 } });
        }
      }
      if ((showPts || ["dbscan", "pattern"].includes(m)) && pts) {
        upsertSource(map, "lab-acc", pts);
        map.addLayer({ id: "lab-pts", type: "circle", source: "lab-acc", paint: { "circle-color": L.SEVERITY_COLOR, "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 1.3, 17, 4], "circle-opacity": 0.75 } });
      }
    };
    if (map.isStyleLoaded()) draw();
    else map.once("idle", draw);
  }, [map, result, job?.method, method, pts, showPts]);

  const onReady = useCallback((m: MLMap) => {
    setMap(m);
    m.on("click", (e: MapMouseEvent) => {
      const layers = ["lab-gi", "lab-gi-line", "lab-db-fill", "lab-seg", "lab-kde", "lab-nn-line"].filter((l) => m.getLayer(l));
      const f = layers.length ? m.queryRenderedFeatures(e.point, { layers })[0] : undefined;
      setPicked(f ? (f.properties as Record<string, unknown>) : null);
    });
  }, []);

  const s = result?.summary;
  const rm = (job?.method ?? method) as AnalysisMethod;
  const running = job && (job.status === "queued" || job.status === "running");

  return (
    <div className="h-full flex flex-col lg:flex-row">
      <aside className="lg:w-[300px] shrink-0 border-r border-line bg-panel overflow-y-auto max-h-[45%] lg:max-h-none">
        <div className="p-3 space-y-3">
          <div>
            <div className="label mb-1">Method</div>
            <div className="space-y-0.5">
              {ANALYSIS_METHODS.map((m) => (
                <button key={m.code} onClick={() => setMethod(m.code)} className={cx("w-full flex items-center justify-between px-2 h-7 rounded-[3px] text-[12px] border", method === m.code ? "border-accent bg-accent-soft text-fg" : "border-transparent text-muted hover:text-fg hover:bg-panel2")}>
                  <span>{m.label}</span>
                  <span className="text-[10px] text-faint">{METHOD_DOCS[m.code].kind}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="label mb-1">Input layer</div>
            <Segmented size="xs" value={input} onChange={setInput} options={[{ value: "verified", label: "Verified only" }, { value: "all", label: "Verified + unverified" }]} />
            {input === "all" && <Notice tone="warn" className="mt-1.5">Unverified reports may contain duplicates and positional errors. Use for sensitivity analysis only.</Notice>}
          </div>
          <div className="space-y-2">
            <div className="label">Parameters</div>
            {method === "kde" && (
              <>
                <Field label={`Cell size: ${p.cellSize} m`}>
                  <input type="range" min={25} max={300} step={25} value={Number(p.cellSize)} onChange={(e) => setP("cellSize", Number(e.target.value))} className="w-full" />
                </Field>
                <Field label="Bandwidth (m)" hint="Empty = Silverman spatial rule">
                  <input className="field num" type="number" min={25} max={3000} value={p.bandwidth === null ? "" : Number(p.bandwidth)} placeholder="auto" onChange={(e) => setP("bandwidth", e.target.value ? Number(e.target.value) : null)} />
                </Field>
                <Field label="Kernel">
                  <select className="field" value={String(p.kernel)} onChange={(e) => setP("kernel", e.target.value)}>
                    <option value="quartic">Quartic (biweight)</option>
                    <option value="epanechnikov">Epanechnikov</option>
                    <option value="gaussian">Gaussian</option>
                  </select>
                </Field>
                <Field label="Weighting">
                  <Segmented size="xs" value={String(p.weight)} onChange={(v) => setP("weight", v)} options={[{ value: "none", label: "Count" }, { value: "epdo", label: "EPDO" }]} />
                </Field>
              </>
            )}
            {method === "gistar" && (
              <>
                <Field label="Analysis unit">
                  <Segmented size="xs" value={String(p.unit)} onChange={(v) => setP("unit", v)} options={[{ value: "grid", label: "Lattice" }, { value: "segment", label: "Road segment" }]} />
                </Field>
                {p.unit === "grid" && (
                  <Field label={`Cell size: ${p.cellSize} m`}>
                    <input type="range" min={100} max={500} step={50} value={Number(p.cellSize)} onChange={(e) => setP("cellSize", Number(e.target.value))} className="w-full" />
                  </Field>
                )}
                <Field label={`Distance band: ${p.band} m`}>
                  <input type="range" min={200} max={1500} step={50} value={Number(p.band)} onChange={(e) => setP("band", Number(e.target.value))} className="w-full" />
                </Field>
                <label className="flex items-center gap-2 text-[12px]">
                  <input type="checkbox" checked={Boolean(p.fdr)} onChange={(e) => setP("fdr", e.target.checked)} /> Benjamini–Hochberg FDR correction
                </label>
                <Field label="Weighting">
                  <Segmented size="xs" value={String(p.weight)} onChange={(v) => setP("weight", v)} options={[{ value: "none", label: "Count" }, { value: "epdo", label: "EPDO" }]} />
                </Field>
              </>
            )}
            {method === "dbscan" && (
              <>
                <Field label={`ε (neighbourhood radius): ${p.eps} m`}>
                  <input type="range" min={10} max={300} step={5} value={Number(p.eps)} onChange={(e) => setP("eps", Number(e.target.value))} className="w-full" />
                </Field>
                <Field label={`minPts: ${p.minPts}`}>
                  <input type="range" min={3} max={40} step={1} value={Number(p.minPts)} onChange={(e) => setP("minPts", Number(e.target.value))} className="w-full" />
                </Field>
              </>
            )}
            {method === "nearest" && (
              <Field label={`Snap tolerance: ${p.maxDistance} m`}>
                <input type="range" min={10} max={200} step={5} value={Number(p.maxDistance)} onChange={(e) => setP("maxDistance", Number(e.target.value))} className="w-full" />
              </Field>
            )}
            {method === "segments" && (
              <Field label="Symbolised metric">
                <Segmented size="xs" value={String(p.metric)} onChange={(v) => setP("metric", v)} options={[{ value: "density", label: "/km/yr" }, { value: "count", label: "Count" }, { value: "epdo", label: "EPDO" }]} />
              </Field>
            )}
            {method === "pattern" && (
              <>
                <Field label={`Lattice cell (Moran's I): ${p.cellSize} m`}>
                  <input type="range" min={100} max={500} step={50} value={Number(p.cellSize)} onChange={(e) => setP("cellSize", Number(e.target.value))} className="w-full" />
                </Field>
                <Field label={`Distance band: ${p.band} m`}>
                  <input type="range" min={200} max={1500} step={50} value={Number(p.band)} onChange={(e) => setP("band", Number(e.target.value))} className="w-full" />
                </Field>
              </>
            )}
            {(method === "temporal" || method === "environment") && <p className="text-[11.5px] text-faint">No parameters — uses the active filters.</p>}
          </div>
          <Button variant="primary" size="md" className="w-full" onClick={run} loading={!!running}>
            <Play className="size-3.5" /> Run analysis (async job)
          </Button>
          {running && (
            <div>
              <div className="h-1 bg-panel2 rounded overflow-hidden">
                <div className="h-full bg-accent transition-all" style={{ width: `${job.progress}%` }} />
              </div>
              <div className="text-[11px] text-muted mt-1">
                Job #{job.id} · {job.status} · {job.message}
              </div>
            </div>
          )}
          <details className="border border-line rounded-[4px]">
            <summary className="px-2 py-1.5 text-[12px] text-muted cursor-pointer">Input filters</summary>
            <div className="p-2 border-t border-line">
              <FilterPanel statusDefault={statuses} hide={["status"]} compact />
            </div>
          </details>
          <div>
            <div className="label mb-1">Recent jobs</div>
            <div className="space-y-0.5 max-h-48 overflow-y-auto">
              {history.map((h) => (
                <button key={h.id} onClick={() => { setMethod(h.method as AnalysisMethod); openJob(h.id); }} className={cx("w-full flex justify-between text-[11.5px] px-1.5 py-1 rounded-[3px] hover:bg-panel2", job?.id === h.id && "bg-accent-soft")}>
                  <span>
                    #{h.id} {h.method}
                  </span>
                  <span className={h.status === "failed" ? "text-danger" : h.status === "succeeded" ? "text-ok" : "text-warn"}>{h.status}</span>
                </button>
              ))}
              {!history.length && <p className="text-[11px] text-faint">No jobs yet.</p>}
            </div>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col xl:flex-row min-h-0">
        <MapView onReady={onReady} basemap="minimal" className="flex-1 min-h-[300px]">
          <div className="absolute top-2 left-2 z-10 flex gap-2 items-center">
            <Badge color="#4fd1c5">{doc.title}</Badge>
            <label className="flex items-center gap-1.5 text-[11px] bg-panel/90 border border-line rounded-[3px] px-1.5 h-6">
              <input type="checkbox" checked={showPts} onChange={(e) => setShowPts(e.target.checked)} /> input points
            </label>
          </div>
          {result && <LabLegend method={rm} summary={result.summary} />}
          {picked && (
            <div className="absolute top-10 left-2 z-10 bg-panel/95 border border-line rounded-[4px] p-2 w-[240px] text-[11.5px]">
              <div className="flex justify-between mb-1">
                <span className="label">Feature</span>
                <button onClick={() => setPicked(null)} className="text-faint">×</button>
              </div>
              {Object.entries(picked)
                .filter(([k]) => k !== "ids")
                .slice(0, 12)
                .map(([k, v]) => (
                  <KV key={k} k={k} v={typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(4)) : String(v)} />
                ))}
              {picked.cls ? <div className="mt-1 text-muted">{giLabel(String(picked.cls))}</div> : null}
              {picked.ids ? <div className="mt-1 text-faint">{(typeof picked.ids === "string" ? JSON.parse(picked.ids) : (picked.ids as number[])).length} underlying incidents (see Explorer for details)</div> : null}
            </div>
          )}
        </MapView>
        <aside className="xl:w-[420px] shrink-0 border-l border-line bg-panel overflow-y-auto max-h-[50%] xl:max-h-none">
          <div className="p-3 space-y-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[14px] font-semibold">{doc.title}</h2>
                <Badge color={doc.kind === "inferential" ? "#4fd1c5" : doc.kind === "processing" ? "#60a5fa" : "#9aa3b2"}>{doc.kind}</Badge>
              </div>
              <p className="text-[12px] text-muted mt-1 leading-snug">{doc.summary}</p>
            </div>
            <Explain title="Methodology, assumptions & references">
              <p>
                <b className="text-fg">Input:</b> {doc.input}
              </p>
              <p>
                <b className="text-fg">Output:</b> {doc.output}
              </p>
              <ul className="list-disc pl-4 space-y-1">
                {doc.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
              <p className="text-fg font-medium pt-1">Limitations</p>
              <ul className="list-disc pl-4 space-y-1">
                {doc.assumptions.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
              <p className="text-fg font-medium pt-1">References</p>
              <ul className="space-y-1 text-[11px]">
                {doc.references.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </Explain>
            {err && <Notice tone="danger">{err}</Notice>}
            {!result && !running && !err && <Empty title="No result yet">Configure parameters and run the analysis. Jobs execute asynchronously on the server; results are persisted and downloadable.</Empty>}
            {result && s && (
              <>
                {Boolean(s.syntheticData) && <Notice tone="warn">Computed on synthetic data — results validate the method, not the real world.</Notice>}
                <div className="flex gap-1 flex-wrap">
                  {(["geojson", "csv", "json"] as const).map((f) => (
                    <a key={f} href={`/api/analysis/jobs/${job?.id}/download?format=${f}`}>
                      <Button size="xs">
                        <Download className="size-3" /> {f.toUpperCase()}
                      </Button>
                    </a>
                  ))}
                  <span className="text-[11px] text-faint self-center ml-1 num">
                    n={String(s.n)} · {String(s.runtimeMs ?? "?")} ms
                  </span>
                </div>
                <ResultView method={rm} s={s} table={result.table} t={t} theme={theme} />
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function LabLegend({ method, summary }: { method: AnalysisMethod; summary: Record<string, unknown> }) {
  const grad = (stops: [number, string][]) => `linear-gradient(90deg, ${stops.map(([v, c]) => `${c} ${v * 100}%`).join(", ")})`;
  return (
    <div className="absolute left-2 bottom-8 z-10 bg-panel/92 border border-line rounded-[4px] px-2.5 py-2 text-[11px] max-w-[240px]">
      {method === "kde" && (
        <>
          <div className="label mb-1">{String(summary.unit)}</div>
          <div className="h-2 w-44 rounded-sm" style={{ background: grad(L.KDE_RAMP) }} />
          <div className="flex justify-between num text-faint">
            <span>low</span>
            <span>{fmt.dec(Number(summary.max), 0)}</span>
          </div>
        </>
      )}
      {method === "gistar" &&
        ["hot99", "hot95", "hot90", "ns", "cold90", "cold95", "cold99"].map((c) => (
          <div key={c} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: L.GI_COLORS[c] }} />
            <span className="flex-1">{giLabel(c)}</span>
            <span className="num text-faint">{(summary.classes as Record<string, number> | undefined)?.[c] ?? 0}</span>
          </div>
        ))}
      {method === "dbscan" && <div>Convex hulls of DBSCAN clusters (colour = cluster id); points coloured by severity.</div>}
      {method === "nearest" && (
        <>
          <div className="label mb-1">Snap vector length</div>
          <div className="h-2 w-44 rounded-sm" style={{ background: "linear-gradient(90deg,#4fd1c5,#eab308,#f97316,#e11d48)" }} />
          <div className="flex justify-between num text-faint">
            <span>0 m</span>
            <span>60 m</span>
          </div>
          <div className="mt-1">red ring = unassigned (beyond tolerance)</div>
        </>
      )}
      {method === "segments" && <div>Quintiles of non-zero segments ({String((summary.params as Record<string, unknown>)?.metric)}) · grey = none</div>}
      {method === "pattern" && <div>Dashed circle: standard distance around mean centre</div>}
      {(method === "temporal" || method === "environment") && <div>Non-spatial output — see charts.</div>}
    </div>
  );
}

function ResultView({ method, s, table, t, theme }: { method: AnalysisMethod; s: Record<string, unknown>; table: Record<string, unknown>[] | null; t: ReturnType<typeof chartTheme>; theme: "dark" | "light" }) {
  const bar = (labels: string[], data: number[], color = t.accent): ChartOption => ({
    ...baseOption(theme),
    tooltip: { ...baseOption(theme).tooltip, trigger: "axis" },
    xAxis: { type: "category", data: labels, ...axisStyle(theme) },
    yAxis: { type: "value", ...axisStyle(theme) },
    series: [{ type: "bar", data, itemStyle: { color } }],
  });
  if (method === "kde")
    return (
      <div>
        <KV k="Bandwidth h" v={`${fmt.dec(Number(s.bandwidth), 0)} m`} />
        <KV k="Bandwidth rule" v={<span className="text-[11px]">{String(s.bandwidthRule)}</span>} />
        <KV k="Peak density" v={`${fmt.dec(Number(s.max), 1)} ${String(s.unit)}`} />
        <KV k="Integrated mass" v={fmt.dec(Number(s.totalMass), 1)} />
        <KV k="Rendered cells" v={fmt.int(Number(s.cells))} />
      </div>
    );
  if (method === "gistar") {
    const checks = (s.checks as { name: string; passed: boolean; detail: string; blocking: boolean }[]) ?? [];
    const moran = s.moran as { I: number; expected: number; zNormal: number; pNormal: number; pPermutation: number; permutations: number } | null;
    const classes = (s.classes as Record<string, number>) ?? {};
    return (
      <div className="space-y-3">
        {Boolean(s.skipped) && <Notice tone="danger">Refused: {String(s.reason)}. See checks below.</Notice>}
        <div>
          <div className="label mb-1">Pre-condition checks</div>
          {checks.map((c) => (
            <div key={c.name} className="flex gap-1.5 text-[11.5px] py-0.5">
              <span className={c.passed ? "text-ok" : c.blocking ? "text-danger" : "text-warn"}>{c.passed ? "✓" : c.blocking ? "✕" : "!"}</span>
              <span className="text-muted">
                {c.name} <span className="num text-faint">({c.detail})</span>
              </span>
            </div>
          ))}
        </div>
        {moran && (
          <div>
            <div className="label mb-1">Global Moran&apos;s I</div>
            <KV k="I / E[I]" v={`${moran.I.toFixed(4)} / ${moran.expected.toFixed(4)}`} />
            <KV k="z (normality)" v={`${moran.zNormal.toFixed(2)} (p ${fmt.p(moran.pNormal)})`} />
            <KV k={`pseudo-p (${moran.permutations} perm.)`} v={fmt.p(moran.pPermutation)} />
          </div>
        )}
        {!s.skipped && (
          <div>
            <div className="label mb-1">Classification ({String(s.correction)})</div>
            {["hot99", "hot95", "hot90", "cold90", "cold95", "cold99"].map((c) => (
              <KV key={c} k={giLabel(c)} v={classes[c] ?? 0} />
            ))}
            <KV k="Units analysed" v={String(s.units)} />
          </div>
        )}
        <DataTable rows={table} />
      </div>
    );
  }
  if (method === "dbscan") {
    const kd = (s.kDistance as number[]) ?? [];
    const eps = Number((s.params as Record<string, unknown>).eps);
    const opt: ChartOption = {
      ...baseOption(theme),
      tooltip: { ...baseOption(theme).tooltip, trigger: "axis" },
      xAxis: { type: "category", data: kd.map((_, i) => i), ...axisStyle(theme), name: "points (sorted)", nameLocation: "middle", nameGap: 18, nameTextStyle: { color: t.faint, fontSize: 10 } },
      yAxis: { type: "value", ...axisStyle(theme), name: "k-dist (m)", nameTextStyle: { color: t.faint, fontSize: 10 } },
      series: [{ type: "line", data: kd.map((v) => Math.round(v * 10) / 10), symbol: "none", lineStyle: { color: t.accent }, markLine: { symbol: "none", lineStyle: { color: "#f5a524", type: "dashed" }, data: [{ yAxis: eps, name: "ε" }], label: { color: "#f5a524", formatter: `ε = ${eps} m` } } }],
    };
    return (
      <div className="space-y-2">
        <KV k="Clusters" v={String(s.clusters)} />
        <KV k="Noise points" v={`${s.noise} (${fmt.pct(Number(s.noiseShare))})`} />
        <KV k="Core points" v={String(s.corePoints)} />
        <div className="label">k-distance curve (choose ε near the knee)</div>
        <EChart option={opt} height={170} />
        <DataTable rows={table?.map((r) => ({ cluster: r.cluster, size: r.size, dominant: r.dominantCategory, KSI: r.fatalSerious })) ?? null} />
      </div>
    );
  }
  if (method === "nearest") {
    const h = (s.histogram as { bin: string; count: number }[]) ?? [];
    return (
      <div className="space-y-2">
        <KV k="Assigned" v={`${s.assigned} (${fmt.pct(Number(s.assignedShare))})`} />
        <KV k="Unassigned (> tolerance)" v={String(s.unassigned)} />
        <KV k="Median snap distance" v={`${fmt.dec(Number(s.medianDistance), 1)} m`} />
        <KV k="95th percentile" v={`${fmt.dec(Number(s.p95Distance), 1)} m`} />
        <KV k="Segments receiving reports" v={String(s.segmentsWithAssignments)} />
        <EChart option={bar(h.map((x) => x.bin.replace(" m", "")), h.map((x) => x.count))} height={170} />
      </div>
    );
  }
  if (method === "segments")
    return (
      <div className="space-y-2">
        <KV k="Observation span" v={`${fmt.dec(Number(s.years), 2)} yr`} />
        <KV k="Segments with ≥1 event" v={`${s.segmentsWithEvents} / ${s.segments}`} />
        <KV k="Unassigned events" v={String(s.unassignedEvents)} />
        <DataTable rows={table?.slice(0, 40).map((r) => ({ id: r.id, name: r.name, class: r.roadClass, n: r.n, CI: `${r.ciLow}–${r.ciHigh}`, "/km/yr": r.densityKmYr, EPDO: r.epdo })) ?? null} />
      </div>
    );
  if (method === "temporal") {
    const tm = s as unknown as { hour: number[]; weekday: number[]; monthly: { month: string; count: number }[]; tests: { hourUniformity: { chi2: number; p: number }; weekdayUniformity: { chi2: number; p: number }; peakShare: number } };
    return (
      <div className="space-y-2">
        <KV k="Hour uniformity χ²" v={`${tm.tests.hourUniformity.chi2.toFixed(1)} (p ${fmt.p(tm.tests.hourUniformity.p)})`} />
        <KV k="Weekday uniformity χ²" v={`${tm.tests.weekdayUniformity.chi2.toFixed(1)} (p ${fmt.p(tm.tests.weekdayUniformity.p)})`} />
        <KV k="Peak-hour share" v={fmt.pct(tm.tests.peakShare)} />
        <div className="label">Hour of day</div>
        <EChart option={bar(tm.hour.map((_, i) => String(i)), tm.hour)} height={150} />
        <div className="label">Weekday</div>
        <EChart option={bar(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], tm.weekday, "#a78bfa")} height={150} />
        <div className="label">Monthly series</div>
        <EChart option={bar(tm.monthly.map((m) => m.month), tm.monthly.map((m) => m.count), "#f5a524")} height={150} />
      </div>
    );
  }
  if (method === "environment") {
    type Row = { level: string; events: number; exposure: number; rate: number; rateLow: number; rateHigh: number; rr: number; rrLow: number; rrHigh: number; p: number; reference: boolean };
    const env = s as unknown as { weather: Row[]; light: Row[]; lighting: Row[]; roadClass: Row[]; roadClassPerMVKm: Row[]; speed: Row[]; caveat: string; injectedEffects: Record<string, unknown> | null; weatherUnit: string; roadUnit: string };
    const forest = (rows: Row[]): ChartOption => {
      const valid = rows.filter((r) => Number.isFinite(r.rr));
      return {
        ...baseOption(theme),
        grid: { left: 70, right: 16, top: 8, bottom: 22 },
        tooltip: { ...baseOption(theme).tooltip, trigger: "item" },
        yAxis: { type: "category", data: valid.map((r) => r.level), ...axisStyle(theme), axisLabel: { color: t.text, fontSize: 10 } },
        xAxis: { type: "value", ...axisStyle(theme), min: 0 },
        series: [
          { type: "bar", stack: "ci", data: valid.map((r) => r.rrLow), itemStyle: { color: "transparent" }, barWidth: 4, tooltip: { show: false } },
          { type: "bar", stack: "ci", data: valid.map((r) => r.rrHigh - r.rrLow), itemStyle: { color: t.faint }, barWidth: 4, tooltip: { show: false } },
          { type: "scatter", data: valid.map((r) => r.rr), symbolSize: 9, itemStyle: { color: t.accent }, markLine: { symbol: "none", silent: true, lineStyle: { color: "#f5a524", type: "dashed" }, data: [{ xAxis: 1 }] } },
        ],
      };
    };
    const block = (title: string, rows: Row[], unit: string) => (
      <div>
        <div className="label mb-1">{title}</div>
        <EChart option={forest(rows)} height={Math.max(90, rows.length * 26 + 30)} />
        <table className="w-full text-[11px] num">
          <thead className="text-faint">
            <tr>
              <th className="text-left font-medium">level</th>
              <th className="text-right font-medium">n</th>
              <th className="text-right font-medium">rate</th>
              <th className="text-right font-medium">RR [95% CI]</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.level} className="border-t border-line/60">
                <td className="py-0.5 font-sans">{r.level}{r.reference ? " (ref)" : ""}</td>
                <td className="text-right">{r.events}</td>
                <td className="text-right">{r.rate.toFixed(2)}</td>
                <td className="text-right">{r.reference ? "1" : `${fmt.dec(r.rr, 2)} [${fmt.dec(r.rrLow, 2)}–${fmt.dec(r.rrHigh, 2)}]`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[10.5px] text-faint mt-0.5">rate: {unit}</p>
      </div>
    );
    const inj = env.injectedEffects?.weatherIncidenceMultiplier as Record<string, number> | undefined;
    return (
      <div className="space-y-3">
        <Notice tone="warn">{env.caveat}</Notice>
        {inj && (
          <Notice>
            <b>Synthetic ground truth</b> — injected weather incidence multipliers: {Object.entries(inj).map(([k, v]) => `${k} ×${v}`).join(", ")}. Compare with estimated weather RRs to validate the estimator.
          </Notice>
        )}
        {block("Weather (per 1,000 h of condition)", env.weather, env.weatherUnit)}
        {block("Light condition (solar elevation)", env.light, "events per 1,000 h")}
        {block("Street lighting", env.lighting, env.roadUnit)}
        {block("Road class — per km·yr", env.roadClass, env.roadUnit)}
        {block("Road class — per million vehicle-km", env.roadClassPerMVKm, "events / MVkm")}
        {block("Speed limit", env.speed, env.roadUnit)}
      </div>
    );
  }
  // pattern
  const ce = s.clarkEvans as { R: number; observed: number; expected: number; z: number; p: number; areaKm2: number } | null;
  const moran = s.moran as { I: number; pPermutation: number; zNormal: number } | null;
  const lor = (s.lorenz as [number, number][]) ?? [];
  const opt: ChartOption = {
    ...baseOption(theme),
    grid: { left: 36, right: 12, top: 10, bottom: 30 },
    xAxis: { type: "value", min: 0, max: 1, ...axisStyle(theme), name: "cum. network length", nameLocation: "middle", nameGap: 18, nameTextStyle: { color: t.faint, fontSize: 10 } },
    yAxis: { type: "value", min: 0, max: 1, ...axisStyle(theme) },
    series: [
      { type: "line", data: lor, symbol: "none", lineStyle: { color: t.accent }, areaStyle: { color: t.accent, opacity: 0.1 } },
      { type: "line", data: [[0, 0], [1, 1]], symbol: "none", lineStyle: { color: t.faint, type: "dashed" } },
    ],
  };
  return (
    <div className="space-y-2">
      {ce && (
        <div>
          <div className="label mb-1">Clark–Evans nearest-neighbour index</div>
          <KV k="R" v={ce.R.toFixed(3)} />
          <KV k="Observed / expected NN" v={`${ce.observed.toFixed(1)} / ${ce.expected.toFixed(1)} m`} />
          <KV k="z / p" v={`${ce.z.toFixed(2)} / ${fmt.p(ce.p)}`} />
          <KV k="Study area" v={`${ce.areaKm2.toFixed(2)} km²`} />
        </div>
      )}
      {moran && <KV k="Global Moran's I (pseudo-p)" v={`${moran.I.toFixed(3)} (${fmt.p(moran.pPermutation)})`} />}
      <KV k="Gini of segment densities" v={fmt.dec(Number(s.giniSegments), 3)} />
      <KV k="Share on top 5% of length" v={fmt.pct(Number(s.shareOnTop5PctLength))} />
      <KV k="Standard distance" v={`${fmt.dec(Number(s.standardDistanceM), 0)} m`} />
      <div className="label">Lorenz curve (incidents vs network length)</div>
      <EChart option={opt} height={180} />
    </div>
  );
}

function DataTable({ rows }: { rows: Record<string, unknown>[] | null }) {
  if (!rows?.length) return null;
  const cols = Object.keys(rows[0]).filter((c) => c !== "ids" && c !== "severity" && c !== "centroid").slice(0, 7);
  return (
    <div className="max-h-64 overflow-auto border border-line rounded-[4px]">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-panel2 text-faint">
          <tr>
            {cols.map((c) => (
              <th key={c} className="text-left font-medium px-1.5 py-1">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 60).map((r, i) => (
            <tr key={i} className="border-t border-line/60">
              {cols.map((c) => (
                <td key={c} className="px-1.5 py-0.5 num truncate max-w-[120px]">
                  {typeof r[c] === "number" ? (Number.isInteger(r[c]) ? String(r[c]) : (r[c] as number).toFixed(3)) : String(r[c] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
