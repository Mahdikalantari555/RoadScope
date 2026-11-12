"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { X } from "lucide-react";
import { EChart, axisStyle, baseOption, chartTheme, type ChartEvent, type ChartOption } from "@/components/charts/EChart";
import { FilterPanel } from "@/components/FilterPanel";
import { MapView } from "@/components/map/MapView";
import { drawPoints, clearModeLayers } from "@/components/explorer/layers";
import { useApp } from "@/components/providers";
import { Badge, LoadingBar, Notice, Panel, Stat } from "@/components/ui";
import { api, filtersToQuery, fmt } from "@/lib/client/api";

interface Stats {
  statusesUsed: string[];
  total: number;
  byStatus: Record<string, number>;
  analysed: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  byWeather: Record<string, number>;
  byLight: Record<string, number>;
  fatalSerious: number;
  temporal: {
    hour: number[];
    weekday: number[];
    matrix: number[][];
    monthOfYear: number[];
    seasons: Record<string, number>;
    monthly: { month: string; count: number }[];
    tests: { hourUniformity: { chi2: number; df: number; p: number }; weekdayUniformity: { chi2: number; df: number; p: number }; peakShare: number; peakShareExpectedUniform: number };
  };
  years: number;
  topSegments: { id: number; name: string; roadClass: string; lengthM: number; n: number; ciLow: number; ciHigh: number; densityKmYr: number; fatalSerious: number }[];
  concentration: { gini: number; shareTop5PctLength: number; segmentsWithEvents: number; segments: number };
  unassigned: number;
  syntheticShare: number;
}

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function DashboardPage() {
  const { meta, filters, setFilters, theme } = useApp();
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [map, setMap] = useState<MLMap | null>(null);
  const [pts, setPts] = useState<GeoJSON.FeatureCollection | null>(null);
  const t = chartTheme(theme);
  const fkey = JSON.stringify(filters);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([api<Stats>(`/api/stats${filtersToQuery(filters)}`), api<GeoJSON.FeatureCollection>(`/api/accidents${filtersToQuery({ ...filters, statuses: filters.statuses?.length ? filters.statuses : ["verified"] }, { format: "geojson" })}`)])
      .then(([st, p]) => {
        if (!alive) return;
        setS(st);
        setPts(p);
        setErr(null);
      })
      .catch((e) => alive && setErr(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fkey]);

  useEffect(() => {
    if (!map || !pts) return;
    const draw = () => {
      clearModeLayers(map);
      drawPoints(map, pts);
    };
    if (map.isStyleLoaded()) draw();
    else map.once("idle", draw);
  }, [map, pts]);

  const toggleIn = useCallback(
    (key: "categories" | "severities", code: string) =>
      setFilters((f) => {
        const cur = f[key] ?? [];
        const next = cur.length === 1 && cur[0] === code ? undefined : [code];
        return { ...f, [key]: next };
      }),
    [setFilters],
  );

  const sevOpt = useMemo<ChartOption | null>(() => {
    if (!s || !meta) return null;
    return {
      ...baseOption(theme),
      tooltip: { ...baseOption(theme).tooltip, trigger: "item", formatter: "{b}: {c} ({d}%)" },
      series: [
        {
          type: "pie",
          radius: ["52%", "78%"],
          center: ["50%", "52%"],
          label: { color: t.text, fontSize: 10, formatter: "{b}\n{d}%" },
          itemStyle: { borderColor: theme === "dark" ? "#11151c" : "#fff", borderWidth: 2 },
          data: meta.severities.map((x) => ({ name: x.label.replace("Property damage only", "PDO"), value: s.bySeverity[x.code] ?? 0, itemStyle: { color: x.color }, code: x.code })),
        },
      ],
    };
  }, [s, meta, theme, t.text]);

  const catOpt = useMemo<ChartOption | null>(() => {
    if (!s || !meta) return null;
    const cats = [...meta.categories].sort((a, b) => (s.byCategory[a.code] ?? 0) - (s.byCategory[b.code] ?? 0));
    return {
      ...baseOption(theme),
      grid: { left: 118, right: 30, top: 6, bottom: 18 },
      tooltip: { ...baseOption(theme).tooltip, trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "value", ...axisStyle(theme) },
      yAxis: { type: "category", data: cats.map((c) => c.label), ...axisStyle(theme), axisLabel: { color: t.text, fontSize: 10 } },
      series: [{ type: "bar", data: cats.map((c) => ({ value: s.byCategory[c.code] ?? 0, itemStyle: { color: c.color, opacity: !filters.categories?.length || filters.categories.includes(c.code) ? 0.9 : 0.25 } })), barWidth: "60%", label: { show: true, position: "right", color: t.faint, fontSize: 10 } }],
    };
  }, [s, meta, theme, t.text, t.faint, filters.categories]);

  const monthlyOpt = useMemo<ChartOption | null>(() => {
    if (!s) return null;
    return {
      ...baseOption(theme),
      grid: { left: 36, right: 12, top: 12, bottom: 44 },
      tooltip: { ...baseOption(theme).tooltip, trigger: "axis" },
      xAxis: { type: "category", data: s.temporal.monthly.map((m) => m.month), ...axisStyle(theme) },
      yAxis: { type: "value", ...axisStyle(theme) },
      dataZoom: [{ type: "slider", height: 14, bottom: 6, borderColor: t.axis, fillerColor: "rgba(79,209,197,0.15)", handleStyle: { color: t.accent }, textStyle: { color: t.faint, fontSize: 9 } }],
      series: [
        { type: "bar", name: "incidents", data: s.temporal.monthly.map((m) => m.count), itemStyle: { color: t.accent, opacity: 0.75 } },
        { type: "line", name: "3-mo moving avg", smooth: true, symbol: "none", lineStyle: { color: "#f5a524", width: 1.5 }, data: s.temporal.monthly.map((_, i, a) => (i < 2 ? null : Math.round(((a[i].count + a[i - 1].count + a[i - 2].count) / 3) * 10) / 10)) },
      ],
    };
  }, [s, theme, t.accent, t.axis, t.faint]);

  const hourOpt = useMemo<ChartOption | null>(() => {
    if (!s) return null;
    const sel = (h: number) => filters.hourFrom === undefined || filters.hourTo === undefined || (filters.hourFrom <= filters.hourTo ? h >= filters.hourFrom && h <= filters.hourTo : h >= filters.hourFrom || h <= filters.hourTo);
    return {
      ...baseOption(theme),
      tooltip: { ...baseOption(theme).tooltip, trigger: "axis" },
      xAxis: { type: "category", data: s.temporal.hour.map((_, h) => String(h).padStart(2, "0")), ...axisStyle(theme) },
      yAxis: { type: "value", ...axisStyle(theme) },
      series: [{ type: "bar", data: s.temporal.hour.map((v, h) => ({ value: v, itemStyle: { color: t.accent, opacity: sel(h) ? 0.85 : 0.2 } })) }],
    };
  }, [s, theme, t.accent, filters.hourFrom, filters.hourTo]);

  const wdOpt = useMemo<ChartOption | null>(() => {
    if (!s) return null;
    return {
      ...baseOption(theme),
      tooltip: { ...baseOption(theme).tooltip, trigger: "axis" },
      xAxis: { type: "category", data: WD, ...axisStyle(theme) },
      yAxis: { type: "value", ...axisStyle(theme) },
      series: [{ type: "bar", data: s.temporal.weekday.map((v, i) => ({ value: v, itemStyle: { color: i >= 5 ? "#a78bfa" : t.accent, opacity: !filters.weekdays?.length || filters.weekdays.includes(i) ? 0.85 : 0.2 } })) }],
    };
  }, [s, theme, t.accent, filters.weekdays]);

  const matrixOpt = useMemo<ChartOption | null>(() => {
    if (!s) return null;
    const data: [number, number, number][] = [];
    let max = 0;
    s.temporal.matrix.forEach((row, d) => row.forEach((v, h) => (data.push([h, d, v]), (max = Math.max(max, v)))));
    return {
      ...baseOption(theme),
      grid: { left: 36, right: 12, top: 6, bottom: 40 },
      tooltip: { ...baseOption(theme).tooltip, formatter: (p: unknown) => { const v = (p as { value: [number, number, number] }).value; return `${WD[v[1]]} ${String(v[0]).padStart(2, "0")}:00 — ${v[2]}`; } },
      xAxis: { type: "category", data: Array.from({ length: 24 }, (_, h) => h), ...axisStyle(theme), splitArea: { show: false } },
      yAxis: { type: "category", data: WD, ...axisStyle(theme) },
      visualMap: { min: 0, max: max || 1, calculable: false, orient: "horizontal", left: "center", bottom: 0, itemHeight: 120, itemWidth: 8, textStyle: { color: t.faint, fontSize: 9 }, inRange: { color: theme === "dark" ? ["#11151c", "#134e4a", "#4fd1c5", "#fde68a"] : ["#f7f8fa", "#99f6e4", "#0e7c74", "#7c2d12"] } },
      series: [{ type: "heatmap", data, itemStyle: { borderColor: theme === "dark" ? "#11151c" : "#fff", borderWidth: 1 } }],
    };
  }, [s, theme, t.faint]);

  const seasonOpt = useMemo<ChartOption | null>(() => {
    if (!s) return null;
    return {
      ...baseOption(theme),
      tooltip: { ...baseOption(theme).tooltip, trigger: "axis" },
      xAxis: { type: "category", data: MONTHS, ...axisStyle(theme) },
      yAxis: { type: "value", ...axisStyle(theme) },
      series: [{ type: "bar", data: s.temporal.monthOfYear.map((v, i) => ({ value: v, itemStyle: { color: [11, 0, 1].includes(i) ? "#60a5fa" : [2, 3, 4].includes(i) ? "#34d399" : [5, 6, 7].includes(i) ? "#f5a524" : "#f97316", opacity: 0.8 } })) }],
    };
  }, [s, theme]);

  const onSev = (e: ChartEvent) => {
    const code = (e.data as { code?: string } | undefined)?.code;
    if (code) toggleIn("severities", code);
  };
  const onCat = (e: ChartEvent) => {
    const c = meta?.categories.find((x) => x.label === e.name);
    if (c) toggleIn("categories", c.code);
  };
  const onHour = (e: ChartEvent) => {
    const h = Number(e.name);
    setFilters((f) => (f.hourFrom === h && f.hourTo === h ? { ...f, hourFrom: undefined, hourTo: undefined } : { ...f, hourFrom: h, hourTo: h }));
  };
  const onWd = (e: ChartEvent) => {
    const i = WD.indexOf(String(e.name));
    setFilters((f) => ({ ...f, weekdays: f.weekdays?.length === 1 && f.weekdays[0] === i ? undefined : [i] }));
  };
  const onMonthZoom = (e: ChartEvent) => {
    if (!s) return;
    const b = e.batch?.[0] ?? e;
    const n = s.temporal.monthly.length;
    const si = Math.round(((b.start ?? 0) / 100) * (n - 1));
    const ei = Math.round(((b.end ?? 100) / 100) * (n - 1));
    const sm = s.temporal.monthly[si]?.month;
    const em = s.temporal.monthly[ei]?.month;
    if (!sm || !em || (si === 0 && ei === n - 1)) return;
    const [y, m] = em.split("-").map(Number);
    setFilters((f) => ({ ...f, from: `${sm}-01`, to: `${em}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}` }));
  };

  const chips: { label: string; clear: () => void }[] = [];
  if (filters.from || filters.to) chips.push({ label: `${filters.from ?? "…"} → ${filters.to ?? "…"}`, clear: () => setFilters((f) => ({ ...f, from: undefined, to: undefined })) });
  if (filters.severities?.length) chips.push({ label: `severity: ${filters.severities.join(", ")}`, clear: () => setFilters((f) => ({ ...f, severities: undefined })) });
  if (filters.categories?.length) chips.push({ label: `type: ${filters.categories.join(", ")}`, clear: () => setFilters((f) => ({ ...f, categories: undefined })) });
  if (filters.hourFrom !== undefined && filters.hourTo !== undefined && !(filters.hourFrom === 0 && filters.hourTo === 23)) chips.push({ label: `hours ${filters.hourFrom}–${filters.hourTo}`, clear: () => setFilters((f) => ({ ...f, hourFrom: undefined, hourTo: undefined })) });
  if (filters.weekdays?.length) chips.push({ label: `days: ${filters.weekdays.map((w) => WD[w]).join(", ")}`, clear: () => setFilters((f) => ({ ...f, weekdays: undefined })) });

  return (
    <div className="h-full flex">
      <aside className="hidden lg:block w-[270px] shrink-0 border-r border-line bg-panel overflow-y-auto p-3">
        <FilterPanel statusDefault={["verified"]} statusNote="KPI counts always cover all statuses; charts use the selected statuses (default: verified only)." />
      </aside>
      <div className="flex-1 min-w-0 overflow-y-auto">
        <LoadingBar active={loading} />
        <div className="p-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[14px] font-semibold mr-2">Analytics</h1>
            <span className="text-[11.5px] text-muted">Click bars/slices to filter · brush the monthly slider to set the time window · all views stay linked (incl. Explorer)</span>
            <div className="flex gap-1 flex-wrap ml-auto">
              {chips.map((c) => (
                <button key={c.label} onClick={c.clear} className="flex items-center gap-1 h-6 px-2 rounded-[3px] border border-accent/60 bg-accent-soft text-[11px]">
                  {c.label} <X className="size-3" />
                </button>
              ))}
            </div>
          </div>
          {err && <Notice tone="danger">{err}</Notice>}
          {s && s.syntheticShare > 0 && <Notice tone="warn">{fmt.pct(s.syntheticShare, 0)} of records are <b>synthetic</b>. Patterns shown reflect the generator configuration, not real-world findings.</Notice>}
          {s && (
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-px bg-line border border-line rounded-[4px] overflow-hidden">
              {[
                <Stat key="t" label="Total reports" value={fmt.int(s.total)} sub="all statuses" />,
                <Stat key="v" label="Verified" value={fmt.int(s.byStatus.verified)} sub={fmt.pct(s.byStatus.verified / Math.max(1, s.total))} tone="ok" />,
                <Stat key="r" label="Unverified" value={fmt.int(s.byStatus.reported)} sub="awaiting review" tone="warn" />,
                <Stat key="x" label="Rejected" value={fmt.int(s.byStatus.rejected)} />,
                <Stat key="d" label="Duplicates" value={fmt.int(s.byStatus.duplicate)} />,
                <Stat key="a" label="Analysed" value={fmt.int(s.analysed)} sub={s.statusesUsed.join("+")} tone="accent" />,
                <Stat key="k" label="KSI" value={fmt.int(s.fatalSerious)} sub="fatal + serious" tone="danger" />,
                <Stat key="g" label="Gini (segments)" value={fmt.dec(s.concentration.gini, 2)} sub={`${fmt.pct(s.concentration.shareTop5PctLength, 0)} on top 5% length`} />,
              ].map((el, i) => (
                <div key={i} className="bg-panel p-2.5">
                  {el}
                </div>
              ))}
            </div>
          )}
          {s && (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
              <Panel title="Monthly trend" subtitle="bars: monthly count · line: 3-month moving average" className="xl:col-span-2">
                {monthlyOpt && <EChart option={monthlyOpt} height={220} onEvents={{ datazoom: onMonthZoom }} />}
              </Panel>
              <Panel title="Spatial distribution" subtitle="verified incidents under current filters" bodyClass="p-0">
                <MapView onReady={setMap} basemap="minimal" className="h-[236px]" />
              </Panel>
              <Panel title="Severity" subtitle="click a slice to filter">
                {sevOpt && <EChart option={sevOpt} height={210} onEvents={{ click: onSev }} />}
              </Panel>
              <Panel title="Collision type" subtitle="click a bar to filter">
                {catOpt && <EChart option={catOpt} height={210} onEvents={{ click: onCat }} />}
              </Panel>
              <Panel title="Top segments by density" subtitle="verified incidents / km / year, 95% Poisson CI">
                <div className="max-h-[210px] overflow-y-auto">
                  <table className="w-full text-[11.5px]">
                    <thead className="text-faint sticky top-0 bg-panel">
                      <tr>
                        <th className="text-left font-medium py-1">Segment</th>
                        <th className="text-right font-medium">n</th>
                        <th className="text-right font-medium">/km/yr</th>
                        <th className="text-right font-medium">CI(n)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.topSegments.map((g) => (
                        <tr key={g.id} className="border-t border-line/60">
                          <td className="py-1 truncate max-w-[140px]" title={`#${g.id} ${g.name}`}>
                            {g.name} <span className="text-faint">#{g.id}</span>
                          </td>
                          <td className="text-right num">{g.n}</td>
                          <td className="text-right num">{g.densityKmYr.toFixed(1)}</td>
                          <td className="text-right num text-faint">
                            {g.ciLow.toFixed(0)}–{g.ciHigh.toFixed(0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10.5px] text-faint mt-1">Short segments inflate densities; rank stability is assessed in the Risk workspace.</p>
              </Panel>
              <Panel title="Hour of day (local)" subtitle={`χ² uniformity = ${s.temporal.tests.hourUniformity.chi2.toFixed(0)}, df ${s.temporal.tests.hourUniformity.df}, p ${fmt.p(s.temporal.tests.hourUniformity.p)} · peak share ${fmt.pct(s.temporal.tests.peakShare, 0)} (uniform ${fmt.pct(s.temporal.tests.peakShareExpectedUniform, 0)})`}>
                {hourOpt && <EChart option={hourOpt} height={180} onEvents={{ click: onHour }} />}
              </Panel>
              <Panel title="Day of week" subtitle={`χ² = ${s.temporal.tests.weekdayUniformity.chi2.toFixed(0)}, p ${fmt.p(s.temporal.tests.weekdayUniformity.p)} · click to filter`}>
                {wdOpt && <EChart option={wdOpt} height={180} onEvents={{ click: onWd }} />}
              </Panel>
              <Panel title="Month of year / season" subtitle={Object.entries(s.temporal.seasons).map(([k, v]) => `${k} ${v}`).join(" · ")}>
                {seasonOpt && <EChart option={seasonOpt} height={180} />}
              </Panel>
              <Panel title="Hour × weekday" subtitle="temporal signature (counts)" className="xl:col-span-2">
                {matrixOpt && <EChart option={matrixOpt} height={230} />}
              </Panel>
              <Panel title="Conditions at time of incident" subtitle="raw counts — not exposure-normalised">
                <div className="space-y-3">
                  {[
                    ["Weather", s.byWeather],
                    ["Light", s.byLight],
                  ].map(([label, obj]) => (
                    <div key={label as string}>
                      <div className="label mb-1">{label as string}</div>
                      {Object.entries(obj as Record<string, number>)
                        .sort((a, b) => b[1] - a[1])
                        .map(([k, v]) => (
                          <div key={k} className="flex items-center gap-2 text-[11.5px] py-0.5">
                            <span className="w-16 text-muted">{k}</span>
                            <div className="flex-1 h-[6px] bg-panel2 rounded-sm overflow-hidden">
                              <div className="h-full bg-accent" style={{ width: `${(v / Math.max(1, s.analysed)) * 100}%` }} />
                            </div>
                            <span className="num w-10 text-right">{v}</span>
                          </div>
                        ))}
                    </div>
                  ))}
                  <p className="text-[10.5px] text-faint">
                    Most incidents occur in dry daylight simply because those conditions dominate exposure. Use <Badge>Environmental comparison</Badge> in the Analysis Lab for exposure-normalised rate ratios.
                  </p>
                </div>
              </Panel>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
