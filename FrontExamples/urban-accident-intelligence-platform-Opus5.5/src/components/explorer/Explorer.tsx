"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MLMap, MapMouseEvent } from "maplibre-gl";
import { BoxSelect, Layers, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { api, cleanFilters, filtersToQuery, fmt } from "@/lib/client/api";
import { MapView, type BasemapKind } from "../map/MapView";
import { useApp } from "../providers";
import { FilterPanel } from "../FilterPanel";
import { AccidentDetail } from "../AccidentDetail";
import { EChart, axisStyle, baseOption, chartTheme, type ChartOption } from "../charts/EChart";
import { Badge, Button, KV, LoadingBar, Notice, Panel, Segmented, cx } from "../ui";
import * as L from "./layers";

type FC = GeoJSON.FeatureCollection<GeoJSON.Geometry, Record<string, unknown>>;
type Selection =
  | { kind: "accident"; id: number }
  | { kind: "segment"; id: number }
  | { kind: "risk"; id: number }
  | { kind: "cell"; props: Record<string, unknown> }
  | { kind: "kde"; props: Record<string, unknown> }
  | { kind: "area"; bbox: [number, number, number, number] };

interface SegmentStats {
  segment: { id: number; name: string; roadClass: string; speedLimit: number; lanes: number; lit: boolean; surface: string; lengthM: number; aadt: number | null };
  years: number;
  verified: number;
  pending: number;
  ci95: [number, number];
  densityKmYr: number;
  densityCi: [number, number];
  ratePerMVKm: number | null;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  hours: number[];
  incidents: { id: number; trackingCode: string; t: number; category: string; severity: string; status: string }[];
}
interface RiskResp {
  rows: { id: number; name: string; index: number; rankIndex: number; n: number; eb: number; expected: number; reliability: string; densityKmYr: number; ciLow: number; ciHigh: number; epdo: number; ratePerMVKm: number | null; components: Record<string, number | null> }[];
  geometry: Record<string, [number, number][]>;
  notes: string[];
}
interface AnalysisState {
  mode: L.Mode;
  data: FC;
  summary: Record<string, unknown>;
  extra?: unknown;
}

const MODES: { value: L.Mode; label: string }[] = [
  { value: "points", label: "Points" },
  { value: "clusters", label: "Clusters" },
  { value: "heatmap", label: "Heatmap" },
  { value: "kde", label: "KDE" },
  { value: "hotspot", label: "Gi*" },
  { value: "segments", label: "Segments" },
  { value: "risk", label: "Risk" },
];

const INTERACTIVE = ["acc-points", "acc-pending", "cl-circles", "cl-single", "overlay-points", "gi-fill", "gi-line", "seg-line", "seg-zero", "risk-line", "risk-low", "kde-fill"];

export function Explorer() {
  const { meta, filters, setFilters, theme } = useApp();
  const [map, setMap] = useState<MLMap | null>(null);
  const [mode, setMode] = useState<L.Mode>("points");
  const [basemap, setBasemap] = useState<BasemapKind>("synthetic");
  const [overlay, setOverlay] = useState(false);
  const [acc, setAcc] = useState<FC | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null);
  const [loading, setLoading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [view, setView] = useState<[number, number, number, number] | null>(null);
  const [boxTool, setBoxTool] = useState(false);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [segStats, setSegStats] = useState<SegmentStats | null>(null);
  const [timeline, setTimeline] = useState<{ month: string; count: number }[]>([]);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const displayStatuses = useMemo(() => (filters.statuses?.length ? filters.statuses : ["verified", "reported"]), [filters.statuses]);
  const analysisFilters = useMemo(() => cleanFilters({ ...filters, statuses: filters.statuses?.length ? filters.statuses : ["verified"] }), [filters]);
  const fkey = JSON.stringify(filters);
  const track = useCallback(async <T,>(p: Promise<T>) => {
    setLoading((n) => n + 1);
    try {
      return await p;
    } finally {
      setLoading((n) => n - 1);
    }
  }, []);

  // Accident layer
  useEffect(() => {
    let alive = true;
    track(api<FC>(`/api/accidents${filtersToQuery({ ...filters, statuses: displayStatuses }, { format: "geojson" })}`))
      .then((d) => alive && (setAcc(d), setError(null)))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fkey, displayStatuses, track]);

  // Timeline (time filter excluded so the brush context stays stable)
  const tkey = JSON.stringify({ ...filters, from: undefined, to: undefined });
  useEffect(() => {
    let alive = true;
    api<{ temporal: { monthly: { month: string; count: number }[] } }>(`/api/stats${filtersToQuery({ ...filters, from: undefined, to: undefined })}`)
      .then((d) => alive && setTimeline(d.temporal.monthly))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tkey]);

  // Analytical layer for the active mode
  useEffect(() => {
    if (!["kde", "hotspot", "segments", "risk"].includes(mode)) return;
    let alive = true;
    const run = async (): Promise<AnalysisState> => {
      if (mode === "kde" || mode === "hotspot") {
        const r = await api<{ geojson: FC; summary: Record<string, unknown> }>("/api/analysis/run", {
          method: "POST",
          json: { method: mode === "kde" ? "kde" : "gistar", params: mode === "kde" ? { cellSize: 100 } : { cellSize: 200, band: 500, fdr: true }, filters: analysisFilters },
        });
        return { mode, data: r.geojson, summary: r.summary };
      }
      if (mode === "segments") {
        const r = await api<FC>(`/api/roads${filtersToQuery(analysisFilters, { stats: 1 })}`);
        const breaks = L.quantileBreaks(r.features.map((f) => Number(f.properties.densityKmYr)));
        return { mode, data: r, summary: { breaks, withEvents: r.features.filter((f) => Number(f.properties.n) > 0).length, total: r.features.length } };
      }
      const r = await api<RiskResp>("/api/risk", { method: "POST", json: { filters: analysisFilters, config: { simulations: 0 } } });
      const data: FC = { type: "FeatureCollection", features: r.rows.map((row) => ({ type: "Feature", geometry: { type: "LineString", coordinates: r.geometry[row.id] }, properties: { id: row.id, name: row.name, index: row.index, reliability: row.reliability, n: row.n } })) };
      return { mode, data, summary: { notes: r.notes }, extra: r };
    };
    track(run())
      .then((a) => alive && (setAnalysis(a), setError(null)))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [mode, analysisFilters, track]);

  // Render layers
  useEffect(() => {
    if (!map) return;
    const draw = () => {
      L.clearModeLayers(map);
      const a = analysis?.mode === mode ? analysis : null;
      if (mode === "points" && acc) L.drawPoints(map, acc);
      if (mode === "clusters" && acc) L.drawClusters(map, acc);
      if (mode === "heatmap" && acc) L.drawHeatmap(map, acc);
      if (mode === "kde" && a) L.drawKde(map, a.data);
      if (mode === "hotspot" && a) L.drawHotspots(map, a.data);
      if (mode === "segments" && a) L.drawSegments(map, a.data, (a.summary.breaks as number[]) ?? []);
      if (mode === "risk" && a) L.drawRisk(map, a.data);
      if (overlay && acc && !["points", "clusters"].includes(mode)) L.drawOverlayPoints(map, acc);
      if (map.getLayer("sel-line")) ["sel-line", "sel-point"].forEach((l) => map.moveLayer(l));
    };
    if (map.isStyleLoaded()) draw();
    else map.once("idle", draw);
  }, [map, mode, acc, analysis, overlay]);

  // Map interactions
  const onReady = useCallback((m: MLMap) => {
    setMap(m);
    const b = m.getBounds();
    setView([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    m.on("moveend", () => {
      const bb = m.getBounds();
      setView([bb.getWest(), bb.getSouth(), bb.getEast(), bb.getNorth()]);
    });
    m.on("mousemove", (e: MapMouseEvent) => {
      const layers = INTERACTIVE.filter((l) => m.getLayer(l));
      const f = layers.length ? m.queryRenderedFeatures(e.point, { layers }) : [];
      m.getCanvas().style.cursor = f.length ? "pointer" : "";
    });
    m.on("click", (e: MapMouseEvent) => {
      const layers = INTERACTIVE.filter((l) => m.getLayer(l));
      const feats = layers.length ? m.queryRenderedFeatures(e.point, { layers }) : [];
      const f = feats[0];
      if (!f) return;
      const p = f.properties as Record<string, unknown>;
      const lid = f.layer.id;
      if (lid === "cl-circles") {
        const src = m.getSource("acc-cl") as GeoJSONSource;
        void src.getClusterExpansionZoom(Number(p.cluster_id)).then((z) => m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: z + 0.3 }));
        return;
      }
      if (["acc-points", "acc-pending", "cl-single", "overlay-points"].includes(lid)) setSelection({ kind: "accident", id: Number(p.id) });
      else if (lid.startsWith("gi-")) setSelection({ kind: "cell", props: p });
      else if (lid.startsWith("seg-")) setSelection({ kind: "segment", id: Number(p.id) });
      else if (lid.startsWith("risk-")) setSelection({ kind: "risk", id: Number(p.id) });
      else if (lid === "kde-fill") setSelection({ kind: "kde", props: p });
    });
  }, []);

  // Selection highlight + segment stats
  useEffect(() => {
    if (!map) return;
    const feats: GeoJSON.Feature[] = [];
    if (selection?.kind === "accident") {
      const f = acc?.features.find((x) => Number(x.properties.id) === selection.id || x.id === selection.id);
      if (f) feats.push({ type: "Feature", geometry: f.geometry, properties: {} });
    }
    if (selection?.kind === "area") {
      const [a, b, c, d] = selection.bbox;
      feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[a, b], [c, b], [c, d], [a, d], [a, b]] }, properties: {} });
    }
    const segId = selection?.kind === "segment" || selection?.kind === "risk" ? selection.id : null;
    if (segId !== null) {
      const src = analysis?.data.features.find((x) => Number(x.properties.id) === segId);
      if (src) feats.push({ type: "Feature", geometry: src.geometry, properties: {} });
    }
    const apply = () => L.drawSelection(map, { type: "FeatureCollection", features: feats });
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [map, selection, acc, analysis]);

  useEffect(() => {
    setSegStats(null);
    const id = selection?.kind === "segment" || selection?.kind === "risk" ? selection.id : null;
    if (id === null) return;
    let alive = true;
    api<SegmentStats>(`/api/roads/${id}${filtersToQuery(cleanFilters({ ...filters, statuses: undefined }))}`)
      .then((s) => alive && setSegStats(s))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, fkey]);

  const within = useCallback(
    (bb: [number, number, number, number] | null) => {
      if (!acc || !bb) return [];
      const [a, b, c, d] = bb;
      return acc.features.filter((f) => {
        const [x, y] = (f.geometry as GeoJSON.Point).coordinates;
        return x >= a && x <= c && y >= b && y <= d;
      });
    },
    [acc],
  );
  const inView = useMemo(() => within(view), [within, view]);
  const summarize = (fs: FC["features"]) => {
    const sev: Record<string, number> = {};
    const cat: Record<string, number> = {};
    const seg: Record<string, number> = {};
    let pending = 0;
    for (const f of fs) {
      const p = f.properties;
      if (p.status === "reported") pending++;
      sev[String(p.severity)] = (sev[String(p.severity)] ?? 0) + 1;
      cat[String(p.category)] = (cat[String(p.category)] ?? 0) + 1;
      if (p.segmentId) seg[String(p.segmentId)] = (seg[String(p.segmentId)] ?? 0) + 1;
    }
    return { n: fs.length, pending, sev, cat, seg };
  };
  const viewSum = useMemo(() => summarize(inView), [inView]);

  // Box selection
  const onBoxDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setBox({ x0: e.clientX - r.left, y0: e.clientY - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top });
  };
  const onBoxMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!box) return;
    const r = e.currentTarget.getBoundingClientRect();
    setBox({ ...box, x1: e.clientX - r.left, y1: e.clientY - r.top });
  };
  const onBoxUp = () => {
    if (box && map && Math.abs(box.x1 - box.x0) > 5 && Math.abs(box.y1 - box.y0) > 5) {
      const p0 = map.unproject([Math.min(box.x0, box.x1), Math.max(box.y0, box.y1)]);
      const p1 = map.unproject([Math.max(box.x0, box.x1), Math.min(box.y0, box.y1)]);
      setSelection({ kind: "area", bbox: [p0.lng, p0.lat, p1.lng, p1.lat] });
    }
    setBox(null);
    setBoxTool(false);
  };

  // Timeline brush
  const tl = chartTheme(theme);
  const fromIdx = filters.from ? Math.max(0, timeline.findIndex((m) => m.month >= filters.from!.slice(0, 7))) : 0;
  const toIdxRaw = filters.to ? timeline.findIndex((m) => m.month > filters.to!.slice(0, 7)) : -1;
  const toIdx = filters.to ? (toIdxRaw === -1 ? timeline.length - 1 : Math.max(0, toIdxRaw - 1)) : timeline.length - 1;
  const tlOption = useMemo<ChartOption>(
    () => ({
      ...baseOption(theme),
      grid: { left: 8, right: 8, top: 4, bottom: 22 },
      tooltip: { ...baseOption(theme).tooltip, trigger: "axis" },
      xAxis: { type: "category", data: timeline.map((m) => m.month), ...axisStyle(theme), axisLabel: { show: false } },
      yAxis: { type: "value", show: false },
      dataZoom: [{ type: "slider", startValue: fromIdx, endValue: toIdx, height: 16, bottom: 2, borderColor: tl.axis, fillerColor: "rgba(79,209,197,0.15)", handleStyle: { color: tl.accent }, textStyle: { color: tl.faint, fontSize: 9 }, dataBackground: { lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 } }, selectedDataBackground: { lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 } } }],
      series: [{ type: "bar", data: timeline.map((m) => m.count), itemStyle: { color: tl.accent, opacity: 0.7 }, barCategoryGap: "15%" }],
    }),
    [timeline, theme, fromIdx, toIdx, tl.axis, tl.accent, tl.faint],
  );
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onZoom = (e: { batch?: { startValue?: number; endValue?: number; start?: number; end?: number }[]; startValue?: number; endValue?: number; start?: number; end?: number }) => {
    const b = e.batch?.[0] ?? e;
    const n = timeline.length;
    if (!n) return;
    const s = b.startValue ?? Math.round(((b.start ?? 0) / 100) * (n - 1));
    const en = b.endValue ?? Math.round(((b.end ?? 100) / 100) * (n - 1));
    if (zoomTimer.current) clearTimeout(zoomTimer.current);
    zoomTimer.current = setTimeout(() => {
      const sm = timeline[Math.max(0, s)]?.month;
      const em = timeline[Math.min(n - 1, en)]?.month;
      if (!sm || !em) return;
      const [y, m] = em.split("-").map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const full = s <= 0 && en >= n - 1;
      setFilters((f) => ({ ...f, from: full ? undefined : `${sm}-01`, to: full ? undefined : `${em}-${String(last).padStart(2, "0")}` }));
    }, 450);
  };

  const info = L.MODE_INFO[mode];
  const a = analysis?.mode === mode ? analysis : null;
  const sevColor = (c: string) => meta?.severities.find((s) => s.code === c)?.color ?? "#999";
  const catLabel = (c: string) => meta?.categories.find((s) => s.code === c)?.label ?? c;

  return (
    <div className="h-full flex relative">
      {/* Left: layers + filters */}
      <aside className={cx("w-[290px] shrink-0 border-r border-line bg-panel flex-col overflow-y-auto z-20", leftOpen ? "flex absolute lg:static inset-y-0 left-0" : "hidden")}>
        <div className="p-3 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="label flex items-center gap-1">
                <Layers className="size-3" /> Analytical layer
              </span>
              <button className="lg:hidden text-muted" onClick={() => setLeftOpen(false)} aria-label="Close panel">
                <X className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {MODES.map((m) => (
                <button key={m.value} onClick={() => setMode(m.value)} className={cx("h-7 text-[11.5px] rounded-[3px] border transition-colors", mode === m.value ? "border-accent bg-accent-soft text-accent font-medium" : "border-line text-muted hover:text-fg")}>
                  {m.label}
                </button>
              ))}
            </div>
            <div className="mt-2 text-[11.5px] text-muted leading-snug">
              <span className="text-fg font-medium">{info.title}.</span> {info.short}
              {info.statistical ? <Badge color="#4fd1c5" className="ml-1">inferential</Badge> : <Badge color="#9aa3b2" className="ml-1">descriptive</Badge>}
            </div>
          </div>
          <div>
            <div className="label mb-1.5">Basemap (offline)</div>
            <Segmented<BasemapKind>
              size="xs"
              value={basemap}
              onChange={setBasemap}
              options={[
                { value: "synthetic", label: "City" },
                { value: "minimal", label: "Minimal" },
                { value: "blueprint", label: "Blueprint" },
                { value: "none", label: "None" },
              ]}
            />
            <label className="flex items-center gap-2 mt-2 text-[12px] text-muted cursor-pointer">
              <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} disabled={mode === "points" || mode === "clusters"} />
              Overlay incident points on analytical layers
            </label>
          </div>
          <FilterPanel statusDefault={["verified", "reported"]} statusNote="Map displays verified + unverified (hollow). Analytical layers (KDE, Gi*, segments, risk) use verified reports only unless statuses are selected explicitly." />
        </div>
      </aside>

      {/* Map */}
      <div className="flex-1 min-w-0 flex flex-col">
        <LoadingBar active={loading > 0} />
        <MapView onReady={onReady} basemap={basemap} className="flex-1 min-h-0">
          <div className="absolute top-2 left-2 z-10 flex gap-1">
            <Button size="xs" onClick={() => setLeftOpen((o) => !o)} title="Toggle panel">
              {leftOpen ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
            </Button>
            <Button size="xs" variant={boxTool ? "primary" : "outline"} onClick={() => setBoxTool((b) => !b)} title="Drag a rectangle to query incidents">
              <BoxSelect className="size-3.5" /> Select area
            </Button>
          </div>
          {boxTool && (
            <div className="absolute inset-0 z-[5] cursor-crosshair" onMouseDown={onBoxDown} onMouseMove={onBoxMove} onMouseUp={onBoxUp}>
              {box && <div className="absolute border-2 border-accent bg-accent-soft" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />}
            </div>
          )}
          {error && (
            <div className="absolute top-12 left-2 z-10 max-w-sm">
              <Notice tone="danger">{error}</Notice>
            </div>
          )}
          <Legend mode={mode} analysis={a} />
        </MapView>
        <div className="h-[58px] shrink-0 border-t border-line bg-panel px-2 flex items-center gap-2">
          <div className="w-[88px] shrink-0">
            <div className="label">Timeline</div>
            <div className="text-[10.5px] text-faint num leading-tight">{filters.from || filters.to ? `${filters.from ?? "…"} → ${filters.to ?? "…"}` : "all months"}</div>
          </div>
          <div className="flex-1 min-w-0">{timeline.length > 0 && <EChart option={tlOption} height={54} onEvents={{ datazoom: onZoom }} />}</div>
        </div>
      </div>

      {/* Right: inspector */}
      <aside className="hidden md:flex w-[330px] shrink-0 border-l border-line bg-panel flex-col overflow-y-auto">
        {selection && (
          <Panel
            className="border-0 border-b rounded-none"
            title={{ accident: "Incident", segment: "Road segment", risk: "Road segment · risk", cell: "Gi* analysis unit", kde: "Density cell", area: "Area query" }[selection.kind]}
            actions={
              <button onClick={() => setSelection(null)} className="text-muted hover:text-fg" aria-label="Clear selection">
                <X className="size-3.5" />
              </button>
            }
          >
            {selection.kind === "accident" && <AccidentDetail id={selection.id} />}
            {(selection.kind === "segment" || selection.kind === "risk") && (
              <div className="space-y-2">
                {selection.kind === "risk" && a?.extra
                  ? (() => {
                      const row = (a.extra as RiskResp).rows.find((r) => r.id === selection.id);
                      return row ? (
                        <div className="border border-line rounded-[4px] p-2 bg-panel2">
                          <div className="flex items-baseline justify-between">
                            <span className="label">Relative risk index</span>
                            <span className="num text-[18px] font-semibold">{row.index.toFixed(1)}</span>
                          </div>
                          <KV k="Rank (index)" v={`#${row.rankIndex}`} />
                          <KV k="EB expected / observed" v={`${row.eb.toFixed(2)} / ${row.n}`} />
                          <KV k="Reliability" v={row.reliability} />
                          {Object.entries(row.components).map(([k, v]) => (
                            <KV key={k} k={`· ${k} (pctl)`} v={v === null ? "n/a" : v.toFixed(2)} />
                          ))}
                          <p className="text-[10.5px] text-faint mt-1">Unitless ordinal index — not a probability.</p>
                        </div>
                      ) : null;
                    })()
                  : null}
                {segStats ? <SegmentPanel s={segStats} onPick={(id) => setSelection({ kind: "accident", id })} sevColor={sevColor} /> : <div className="text-muted text-[12px]">Loading segment statistics…</div>}
              </div>
            )}
            {selection.kind === "cell" && <CellPanel p={selection.props} acc={acc} onPick={(id) => setSelection({ kind: "accident", id })} />}
            {selection.kind === "kde" && (
              <div>
                <KV k="Density" v={`${fmt.dec(Number(selection.props.value), 1)} ${String(a?.summary.unit ?? "events/km²")}`} />
                <KV k="Relative to max" v={fmt.pct(Number(selection.props.rel))} />
                <p className="text-[11px] text-faint mt-2">KDE cells are a smoothed surface; they do not correspond to discrete incidents. Use Gi* or DBSCAN to inspect underlying incidents.</p>
              </div>
            )}
            {selection.kind === "area" && <AreaPanel fs={within(selection.bbox)} summarize={summarize} onPick={(id) => setSelection({ kind: "accident", id })} sevColor={sevColor} catLabel={catLabel} />}
          </Panel>
        )}
        <Panel className="border-0 border-b rounded-none" title="In current view" subtitle={`${displayStatuses.join(" + ")} reports`}>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div>
              <div className="label">Incidents</div>
              <div className="num text-[18px] font-semibold">{fmt.int(viewSum.n)}</div>
            </div>
            <div>
              <div className="label">Unverified</div>
              <div className="num text-[18px] font-semibold text-warn">{fmt.int(viewSum.pending)}</div>
            </div>
            <div>
              <div className="label">KSI</div>
              <div className="num text-[18px] font-semibold text-danger">{fmt.int((viewSum.sev.fatal ?? 0) + (viewSum.sev.serious ?? 0))}</div>
            </div>
          </div>
          <SevBars sev={viewSum.sev} total={viewSum.n} />
          <p className="text-[10.5px] text-faint mt-2">KSI = killed or seriously injured. Counts update with pan/zoom and filters.</p>
        </Panel>
        <Panel className="border-0 rounded-none" title={`About this layer · ${info.title}`}>
          <div className="space-y-1.5 text-[12px] text-muted leading-relaxed">
            {info.body.map((b, i) => (
              <p key={i}>{b}</p>
            ))}
          </div>
          {mode === "hotspot" && a && <GiSummary s={a.summary} />}
          {mode === "kde" && a && (
            <div className="mt-2">
              <KV k="Bandwidth" v={`${fmt.dec(Number(a.summary.bandwidth), 0)} m`} />
              <KV k="Rule" v={<span className="text-[11px]">{String(a.summary.bandwidthRule)}</span>} />
              <KV k="Peak density" v={`${fmt.dec(Number(a.summary.max), 1)} /km²`} />
              <KV k="Events (verified)" v={fmt.int(Number(a.summary.n))} />
            </div>
          )}
          {mode === "segments" && a && (
            <div className="mt-2">
              <KV k="Segments with ≥1 event" v={`${a.summary.withEvents} / ${a.summary.total}`} />
            </div>
          )}
          {mode === "risk" && a?.extra ? (
            <div className="mt-2">
              <div className="label mb-1">Top 8 segments (index)</div>
              {(a.extra as RiskResp).rows
                .slice()
                .sort((x, y) => x.rankIndex - y.rankIndex)
                .slice(0, 8)
                .map((r) => (
                  <button key={r.id} onClick={() => setSelection({ kind: "risk", id: r.id })} className="w-full flex justify-between text-[12px] py-0.5 hover:text-accent">
                    <span className="truncate">
                      #{r.rankIndex} {r.name}
                    </span>
                    <span className="num">{r.index.toFixed(1)}</span>
                  </button>
                ))}
              {(a.extra as RiskResp).notes.map((n) => (
                <p key={n} className="text-[10.5px] text-faint mt-1">
                  {n}
                </p>
              ))}
            </div>
          ) : null}
        </Panel>
      </aside>
    </div>
  );
}

function SevBars({ sev, total }: { sev: Record<string, number>; total: number }) {
  const { meta } = useApp();
  return (
    <div className="space-y-1">
      {meta?.severities
        .slice()
        .reverse()
        .map((s) => {
          const v = sev[s.code] ?? 0;
          return (
            <div key={s.code} className="flex items-center gap-2 text-[11px]">
              <span className="w-[82px] text-muted truncate">{s.label.replace("Property damage only", "PDO")}</span>
              <div className="flex-1 h-[6px] bg-panel2 rounded-sm overflow-hidden">
                <div className="h-full" style={{ width: `${total ? (v / total) * 100 : 0}%`, background: s.color }} />
              </div>
              <span className="num w-10 text-right">{v}</span>
            </div>
          );
        })}
    </div>
  );
}

function SegmentPanel({ s, onPick, sevColor }: { s: SegmentStats; onPick: (id: number) => void; sevColor: (c: string) => string }) {
  const { theme } = useApp();
  const t = chartTheme(theme);
  const option = useMemo<ChartOption>(
    () => ({ ...baseOption(theme), grid: { left: 4, right: 4, top: 4, bottom: 16 }, xAxis: { type: "category", data: s.hours.map((_, h) => h), ...axisStyle(theme), axisLabel: { color: t.faint, fontSize: 9, interval: 5 } }, yAxis: { type: "value", show: false }, series: [{ type: "bar", data: s.hours, itemStyle: { color: t.accent } }] }),
    [s, theme, t.accent, t.faint],
  );
  return (
    <div className="space-y-2">
      <div>
        <div className="text-[13px] font-semibold">{s.segment.name}</div>
        <div className="text-[11px] text-muted">
          #{s.segment.id} · {s.segment.roadClass} · {s.segment.speedLimit} km/h · {s.segment.lanes} lanes · {s.segment.lit ? "lit" : "unlit"} · {Math.round(s.segment.lengthM)} m
        </div>
      </div>
      <div>
        <KV k="Verified incidents" v={`${s.verified} (95% CI ${s.ci95[0].toFixed(1)}–${s.ci95[1].toFixed(1)})`} />
        <KV k="Unverified (excluded)" v={s.pending} />
        <KV k="Density" v={`${s.densityKmYr.toFixed(2)} /km/yr`} />
        <KV k="Density 95% CI" v={`${s.densityCi[0].toFixed(2)}–${s.densityCi[1].toFixed(2)}`} />
        <KV k="Rate (exposure)" v={s.ratePerMVKm === null ? "no AADT" : `${s.ratePerMVKm.toFixed(3)} /MVkm`} />
        <KV k="AADT (synthetic)" v={fmt.int(s.segment.aadt)} />
        <KV k="Observation span" v={`${s.years.toFixed(2)} yr`} />
      </div>
      {s.verified < 3 && <Notice tone="warn">Fewer than 3 events: density estimate is highly uncertain.</Notice>}
      <div>
        <div className="label">Hour of day (verified)</div>
        <EChart option={option} height={70} />
      </div>
      {s.incidents.length > 0 && (
        <div>
          <div className="label mb-1">Recent incidents</div>
          <div className="max-h-40 overflow-y-auto">
            {s.incidents.map((i) => (
              <button key={i.id} onClick={() => onPick(i.id)} className="w-full flex items-center gap-2 text-[11.5px] py-0.5 hover:text-accent">
                <span className="size-2 rounded-full" style={{ background: sevColor(i.severity) }} />
                <span className="num">{fmt.date(i.t)}</span>
                <span className="truncate text-muted">{i.category.replace("_", " ")}</span>
                {i.status === "reported" && <span className="text-warn text-[10px]">unverified</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CellPanel({ p, acc, onPick }: { p: Record<string, unknown>; acc: FC | null; onPick: (id: number) => void }) {
  const ids: number[] = typeof p.ids === "string" ? JSON.parse(p.ids) : ((p.ids as number[]) ?? []);
  const set = new Set(ids);
  const items = acc?.features.filter((f) => set.has(Number(f.properties.id))) ?? [];
  const cls = String(p.cls);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="size-3 rounded-sm" style={{ background: L.GI_COLORS[cls] }} />
        <span className="font-semibold text-[13px]">{giLabel(cls)}</span>
      </div>
      <KV k="Gi* z-score" v={fmt.dec(Number(p.z), 3)} />
      <KV k="p (raw)" v={fmt.p(Number(p.p))} />
      <KV k="q (FDR-adjusted)" v={fmt.p(Number(p.q))} />
      <KV k="Events in unit" v={String(p.events)} />
      {p.name ? <KV k="Segment" v={String(p.name)} /> : null}
      <div className="label">Underlying incidents ({items.length})</div>
      <div className="max-h-56 overflow-y-auto">
        {items.map((f) => (
          <button key={String(f.properties.id)} onClick={() => onPick(Number(f.properties.id))} className="w-full flex items-center gap-2 text-[11.5px] py-0.5 hover:text-accent">
            <span className="num">{fmt.date(String(f.properties.occurredAt))}</span>
            <span className="text-muted truncate">
              {String(f.properties.category).replace("_", " ")} · {String(f.properties.severity)}
            </span>
          </button>
        ))}
        {!items.length && <p className="text-[11px] text-faint">No incidents in this unit under current filters (cell is part of a significant neighbourhood).</p>}
      </div>
    </div>
  );
}

function AreaPanel({ fs, summarize, onPick, sevColor, catLabel }: { fs: FC["features"]; summarize: (f: FC["features"]) => { n: number; pending: number; sev: Record<string, number>; cat: Record<string, number>; seg: Record<string, number> }; onPick: (id: number) => void; sevColor: (c: string) => string; catLabel: (c: string) => string }) {
  const s = summarize(fs);
  return (
    <div className="space-y-2">
      <KV k="Incidents" v={s.n} />
      <KV k="Unverified" v={s.pending} />
      <SevBars sev={s.sev} total={s.n} />
      <div className="label">Top collision types</div>
      {Object.entries(s.cat)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([k, v]) => (
          <KV key={k} k={catLabel(k)} v={`${v} (${fmt.pct(v / Math.max(1, s.n), 0)})`} />
        ))}
      <div className="label">Incidents</div>
      <div className="max-h-48 overflow-y-auto">
        {fs.slice(0, 80).map((f) => (
          <button key={String(f.properties.id)} onClick={() => onPick(Number(f.properties.id))} className="w-full flex items-center gap-2 text-[11.5px] py-0.5 hover:text-accent">
            <span className="size-2 rounded-full" style={{ background: sevColor(String(f.properties.severity)) }} />
            <span className="num">{fmt.date(String(f.properties.occurredAt))}</span>
            <span className="text-muted truncate">{String(f.properties.trackingCode)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function giLabel(cls: string) {
  return { hot99: "Hot spot · 99% confidence", hot95: "Hot spot · 95%", hot90: "Hot spot · 90%", ns: "Not significant", cold90: "Cold spot · 90%", cold95: "Cold spot · 95%", cold99: "Cold spot · 99%" }[cls] ?? cls;
}

function GiSummary({ s }: { s: Record<string, unknown> }) {
  const checks = (s.checks as { name: string; passed: boolean; detail: string; blocking: boolean }[]) ?? [];
  const moran = s.moran as { I: number; pPermutation: number } | null;
  return (
    <div className="mt-2 space-y-2">
      {Boolean(s.skipped) && <Notice tone="danger">Gi* not computed: {String(s.reason)}.</Notice>}
      <div>
        <div className="label mb-1">Assumption checks</div>
        {checks.map((c) => (
          <div key={c.name} className="flex gap-1.5 text-[11.5px] py-0.5">
            <span className={c.passed ? "text-ok" : c.blocking ? "text-danger" : "text-warn"}>{c.passed ? "✓" : c.blocking ? "✕" : "!"}</span>
            <span className="text-muted">
              {c.name} <span className="text-faint num">({c.detail})</span>
            </span>
          </div>
        ))}
      </div>
      {moran && <KV k="Global Moran's I" v={`${moran.I.toFixed(3)} (pseudo-p ${fmt.p(moran.pPermutation)})`} />}
      {s.correction ? <KV k="Multiple testing" v={String(s.correction)} /> : null}
    </div>
  );
}

function Legend({ mode, analysis }: { mode: L.Mode; analysis: AnalysisState | null }) {
  const { meta } = useApp();
  const grad = (stops: [number, string][], max: number) => `linear-gradient(90deg, ${stops.map(([v, c]) => `${c} ${(v / max) * 100}%`).join(", ")})`;
  return (
    <div className="absolute left-2 bottom-8 z-10 bg-panel/92 border border-line rounded-[4px] px-2.5 py-2 text-[11px] backdrop-blur-sm max-w-[250px]">
      <div className="label mb-1">{L.MODE_INFO[mode].title}</div>
      {(mode === "points" || mode === "clusters") && (
        <div className="space-y-0.5">
          {meta?.severities
            .slice()
            .reverse()
            .map((s) => (
              <div key={s.code} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full" style={{ background: s.color }} />
                {s.label}
              </div>
            ))}
          {mode === "points" ? (
            <div className="flex items-center gap-1.5 text-muted pt-0.5">
              <span className="size-2.5 rounded-full border-[1.5px] border-[#8b9bb0]" /> unverified report (hollow)
            </div>
          ) : (
            <div className="text-muted pt-0.5">Cluster ring: share of fatal + serious (teal → red)</div>
          )}
        </div>
      )}
      {mode === "heatmap" && (
        <>
          <div className="h-2 w-44 rounded-sm" style={{ background: grad(L.KDE_RAMP, 1) }} />
          <div className="flex justify-between text-faint">
            <span>low</span>
            <span>high (unitless)</span>
          </div>
        </>
      )}
      {mode === "kde" && analysis && (
        <>
          <div className="h-2 w-44 rounded-sm" style={{ background: grad(L.KDE_RAMP, 1) }} />
          <div className="flex justify-between text-faint num">
            <span>{fmt.dec(Number(analysis.summary.max) * 0.01, 1)}</span>
            <span>{fmt.dec(Number(analysis.summary.max), 0)} events/km²</span>
          </div>
        </>
      )}
      {mode === "hotspot" && analysis && (
        <div className="space-y-0.5">
          {["hot99", "hot95", "hot90", "ns", "cold90", "cold95", "cold99"].map((c) => (
            <div key={c} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: L.GI_COLORS[c], opacity: c === "ns" ? 0.4 : 1 }} />
              <span className="flex-1">{giLabel(c)}</span>
              <span className="num text-faint">{(analysis.summary.classes as Record<string, number> | undefined)?.[c] ?? 0}</span>
            </div>
          ))}
          <div className="text-faint pt-0.5">FDR-adjusted q-values</div>
        </div>
      )}
      {mode === "segments" && analysis && (
        <div className="space-y-0.5">
          {(() => {
            const br = (analysis.summary.breaks as number[]) ?? [];
            const edges = [0, ...br];
            return edges.map((e, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="w-4 h-[3px]" style={{ background: L.SEG_COLORS[Math.min(L.SEG_COLORS.length - 1, i)] }} />
                <span className="num">{i < edges.length - 1 ? `${e.toFixed(1)} – ${edges[i + 1].toFixed(1)}` : `≥ ${e.toFixed(1)}`}</span>
              </div>
            ));
          })()}
          <div className="flex items-center gap-1.5 text-muted">
            <span className="w-4 h-[2px] bg-[#6b7483]" /> no verified incidents
          </div>
          <div className="text-faint">incidents / km / year (quintiles)</div>
        </div>
      )}
      {mode === "risk" && (
        <>
          <div className="h-2 w-44 rounded-sm" style={{ background: grad(L.RISK_RAMP, 100) }} />
          <div className="flex justify-between text-faint num">
            <span>0</span>
            <span>100 (relative, unitless)</span>
          </div>
          <div className="text-muted mt-1">dashed = low reliability</div>
        </>
      )}
      {!analysis && ["kde", "hotspot", "segments", "risk"].includes(mode) && <div className="text-faint">Computing…</div>}
    </div>
  );
}
