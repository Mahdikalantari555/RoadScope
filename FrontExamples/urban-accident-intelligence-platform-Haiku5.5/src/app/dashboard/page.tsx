"use client";

import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { useApp } from "@/components/AppProvider";
import { FilterBar } from "@/components/FilterBar";
import EChart, { CHART_AXIS, CHART_TOOLTIP, type ChartClick } from "@/components/EChart";
import { Alert, Badge, KeyValue, PageHeader, Panel, Spinner, Stat, cx, labelCls } from "@/components/ui";
import { useApi } from "@/components/hooks";
import { CATEGORY_CODES, CATEGORY_META, SEVERITY_IDS, SEVERITY_META, STUDY_AREA } from "@/lib/domain";
import { filtersToParams } from "@/lib/filters";
import { withQuery } from "@/lib/client-api";
import { formatInt, formatPct } from "@/lib/format";
import type { DashboardStats, SegmentDetail } from "@/lib/api-types";

const SEASON_MONTHS: Record<string, number[]> = { DJF: [12, 1, 2], MAM: [3, 4, 5], JJA: [6, 7, 8], SON: [9, 10, 11] };

function barOption(labels: string[], values: number[], colors: string | string[], horizontal = false, interval = 0): EChartsOption {
  const cat = { type: "category" as const, data: labels, ...CHART_AXIS, axisLabel: { color: "#8a96a8", fontSize: 10, interval, hideOverlap: true } };
  const val = { type: "value" as const, ...CHART_AXIS, splitNumber: 3 };
  return {
    grid: { left: 6, right: 12, top: 10, bottom: 6, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...CHART_TOOLTIP },
    xAxis: horizontal ? val : cat,
    yAxis: horizontal ? cat : val,
    series: [
      {
        type: "bar",
        barMaxWidth: 20,
        data: values.map((v, i) => ({
          value: v,
          itemStyle: { color: Array.isArray(colors) ? colors[i] : colors, borderRadius: horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0] },
        })),
      },
    ],
  };
}

export default function DashboardPage() {
  const { filters, setFilters, toggleArrayValue, isAdmin } = useApp();
  const qs = useMemo(() => filtersToParams(filters).toString(), [filters]);
  const stats = useApi<DashboardStats>(withQuery("/dashboard", qs));
  const [segmentId, setSegmentId] = useState<number | null>(null);
  const segment = useApi<SegmentDetail>(segmentId ? withQuery(`/segments/${segmentId}`, qs) : null);

  const d = stats.data;
  const pendingOrRejected = (status: "reported" | "rejected" | "duplicate") => (isAdmin && d ? formatInt(d.scope.byStatus[status]) : "—");

  const monthlyOption = useMemo<EChartsOption>(() => {
    const months = d?.monthly ?? [];
    return {
      grid: { left: 6, right: 8, top: 10, bottom: 18, containLabel: true },
      tooltip: { trigger: "axis", ...CHART_TOOLTIP },
      xAxis: { type: "category", data: months.map((m) => m.key), ...CHART_AXIS, axisLabel: { color: "#8a96a8", fontSize: 10, interval: Math.max(0, Math.floor(months.length / 12)) } },
      yAxis: { type: "value", ...CHART_AXIS, splitNumber: 3 },
      series: [
        {
          name: "Incidents",
          type: "bar",
          barMaxWidth: 16,
          data: months.map((m) => m.count),
          itemStyle: { color: "#2dd4bf", borderRadius: [2, 2, 0, 0], opacity: 0.85 },
        },
        {
          name: "Severity-weighted",
          type: "line",
          smooth: true,
          showSymbol: false,
          data: months.map((m) => m.severityWeight),
          lineStyle: { color: "#fb923c", width: 1.5 },
        },
      ],
      legend: { top: 0, right: 0, textStyle: { color: "#8a96a8", fontSize: 10 }, itemWidth: 10, itemHeight: 6 },
    };
  }, [d]);

  const lorenzOption = useMemo<EChartsOption>(
    () => ({
      grid: { left: 6, right: 10, top: 10, bottom: 18, containLabel: true },
      tooltip: { trigger: "item", ...CHART_TOOLTIP, formatter: (p: unknown) => {
        const v = (p as { value: [number, number] }).value;
        return `${(v[0] * 100).toFixed(0)}% of cells hold ${(v[1] * 100).toFixed(0)}% of incidents`;
      } },
      xAxis: { type: "value", min: 0, max: 1, name: "Cumulative share of grid cells", nameLocation: "middle", nameGap: 22, nameTextStyle: { color: "#8a96a8", fontSize: 10 }, ...CHART_AXIS, splitNumber: 4 },
      yAxis: { type: "value", min: 0, max: 1, name: "Share of incidents", nameTextStyle: { color: "#8a96a8", fontSize: 10 }, ...CHART_AXIS, splitNumber: 4 },
      series: [
        { type: "line", data: d?.concentration.lorenz ?? [], smooth: 0.2, showSymbol: true, symbolSize: 4, lineStyle: { color: "#2dd4bf", width: 2 }, areaStyle: { color: "rgba(45,212,191,0.12)" }, itemStyle: { color: "#2dd4bf" } },
        { type: "line", data: [[0, 0], [1, 1]], showSymbol: false, silent: true, lineStyle: { color: "#56627a", type: "dashed", width: 1 } },
      ],
    }),
    [d],
  );

  const hourlyOption = useMemo(() => barOption((d?.hourly ?? []).map((h) => String(h.hour)), (d?.hourly ?? []).map((h) => h.count), "#2dd4bf", false, 2), [d]);
  const dowOption = useMemo(() => barOption((d?.dayOfWeek ?? []).map((x) => x.label), (d?.dayOfWeek ?? []).map((x) => x.count), "#60a5fa"), [d]);
  const moyOption = useMemo(() => barOption((d?.monthOfYear ?? []).map((x) => x.label), (d?.monthOfYear ?? []).map((x) => x.count), "#a78bfa"), [d]);
  const severityOption = useMemo(() => barOption((d?.severity ?? []).map((s) => s.label), (d?.severity ?? []).map((s) => s.count), (d?.severity ?? []).map((s) => s.colorHex), true), [d]);
  const categoryOption = useMemo(() => barOption((d?.categories ?? []).map((c) => c.label), (d?.categories ?? []).map((c) => c.count), (d?.categories ?? []).map((c) => c.colorHex), true), [d]);
  const seasonOption = useMemo(() => barOption((d?.seasonal ?? []).map((s) => s.label.split(" (")[0]!), (d?.seasonal ?? []).map((s) => s.count), ["#60a5fa", "#4ade80", "#fbbf24", "#fb923c"]), [d]);

  const segmentHourOption = useMemo<EChartsOption>(() => {
    const hours = segment.data?.stats.byHour ?? [];
    return barOption(hours.map((h) => String(h.hour)), hours.map((h) => h.count), "#2dd4bf", false, 2);
  }, [segment.data]);

  const onSeverity = (p: ChartClick) => {
    const id = SEVERITY_IDS[p.dataIndex ?? -1];
    if (id !== undefined) toggleArrayValue("severities", id);
  };
  const onCategory = (p: ChartClick) => {
    const code = CATEGORY_CODES[p.dataIndex ?? -1];
    if (code) toggleArrayValue("categories", code);
  };
  const onDow = (p: ChartClick) => {
    if (p.dataIndex !== undefined) toggleArrayValue("daysOfWeek", p.dataIndex);
  };
  const onHour = (p: ChartClick) => {
    if (p.dataIndex !== undefined) setFilters({ hours: [p.dataIndex, p.dataIndex] });
  };
  const onMonthOfYear = (p: ChartClick) => {
    if (p.dataIndex !== undefined) toggleArrayValue("months", p.dataIndex + 1);
  };
  const onSeason = (p: ChartClick) => {
    const key = (d?.seasonal ?? [])[p.dataIndex ?? -1]?.season;
    if (key) setFilters({ months: SEASON_MONTHS[key]! });
  };
  const onMonth = (p: ChartClick) => {
    if (!p.name) return;
    const [y, m] = p.name.split("-").map(Number) as [number, number];
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    setFilters({ from: `${y}-${String(m).padStart(2, "0")}-01`, to: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}` });
  };

  const activeTags: { label: string; onRemove: () => void }[] = [];
  if (filters.from || filters.to) activeTags.push({ label: `${filters.from ?? "…"} → ${filters.to ?? "…"}`, onRemove: () => setFilters({ from: null, to: null }) });
  if (filters.hours) activeTags.push({ label: `${filters.hours[0]}:00–${filters.hours[1]}:59`, onRemove: () => setFilters({ hours: null }) });
  for (const c of filters.categories) activeTags.push({ label: CATEGORY_META[c].label, onRemove: () => toggleArrayValue("categories", c) });
  for (const s of filters.severities) activeTags.push({ label: SEVERITY_META[s as 1 | 2 | 3 | 4].label, onRemove: () => toggleArrayValue("severities", s as 1 | 2 | 3 | 4) });
  for (const m of filters.months) activeTags.push({ label: `Month ${m}`, onRemove: () => toggleArrayValue("months", m) });
  for (const w of filters.daysOfWeek) activeTags.push({ label: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][w]!, onRemove: () => toggleArrayValue("daysOfWeek", w) });

  return (
    <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
      <aside className="scroll-thin w-full shrink-0 overflow-y-auto border-line bg-panel p-4 xl:w-[270px] xl:border-r">
        <FilterBar variant="compact" />
      </aside>
      <div className="scroll-thin flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <PageHeader
          title="Accident analytics"
          description={
            <>
              Descriptive statistics of recorded incidents in {STUDY_AREA.name}. Click any chart element to link it to the filters, the map and the other charts. Counts are
              not normalised by traffic exposure and must not be read as risk.
            </>
          }
        />
        <Alert tone="warn" title="Synthetic demonstration data">
          Figures are generated from a fixed-seed simulation of a fictional city. They illustrate the analytics; they are not real-world findings.
        </Alert>

        {activeTags.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={labelCls}>Active</span>
            {activeTags.map((t) => (
              <button key={t.label} type="button" onClick={t.onRemove} className="rounded-full border border-accent/50 bg-accent/10 px-2 py-0.5 text-[11.5px] hover:border-danger/60">
                {t.label} ×
              </button>
            ))}
          </div>
        ) : null}

        {stats.error ? <Alert tone="error">{stats.error}</Alert> : null}
        {stats.loading && !d ? <Spinner label="Computing statistics" /> : null}

        {d ? (
          <>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 2xl:grid-cols-6">
              <Stat label="Incidents in scope" value={formatInt(d.scope.records)} hint={`${d.scope.datasets} dataset(s)`} />
              <Stat label="Verified" value={formatInt(d.scope.byStatus.verified)} tone="accent" hint="Confirmed records" />
              <Stat label="Pending review" value={pendingOrRejected("reported")} tone="warn" hint={isAdmin ? "Citizen reports" : "Admin view only"} />
              <Stat label="Rejected" value={pendingOrRejected("rejected")} hint={isAdmin ? "Not analysed" : "Admin view only"} />
              <Stat label="Median report delay" value={d.reportingDelay.medianMin === null ? "—" : `${d.reportingDelay.medianMin} min`} hint={d.reportingDelay.p90Min === null ? "" : `90th pct ${d.reportingDelay.p90Min} min`} />
              <Stat label="Top-decile cells" value={formatPct(d.concentration.top10PctShare, 0)} hint={`${d.concentration.cellSizeM} m grid · ${d.concentration.occupiedCells} occupied`} />
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              <Panel title="Monthly trend" subtitle="Incidents per local calendar month" className="xl:col-span-2" actions={<Badge tone="muted">click a month to focus</Badge>}>
                <EChart option={monthlyOption} height={210} onClick={onMonth} />
              </Panel>
              <Panel title="Severity distribution" subtitle="Click a bar to filter by severity">
                <EChart option={severityOption} height={190} onClick={onSeverity} />
              </Panel>
              <Panel title="Accident category" subtitle="Click a bar to filter by category">
                <EChart option={categoryOption} height={190} onClick={onCategory} />
              </Panel>
              <Panel title="Hour of day" subtitle="Local hour; click to restrict to that hour">
                <EChart option={hourlyOption} height={180} onClick={onHour} />
              </Panel>
              <Panel title="Day of week" subtitle="Click to toggle weekday">
                <EChart option={dowOption} height={180} onClick={onDow} />
              </Panel>
              <Panel title="Month of year" subtitle="Seasonal pattern pooled over years; click to toggle">
                <EChart option={moyOption} height={180} onClick={onMonthOfYear} />
              </Panel>
              <Panel title="Seasonal pattern" subtitle="Click a season to filter its months">
                <EChart option={seasonOption} height={180} onClick={onSeason} />
              </Panel>
              <Panel title="Spatial concentration" subtitle={`Lorenz curve over ${d.concentration.cellSizeM} m grid cells (all cells, including empty)`}>
                <EChart option={lorenzOption} height={200} />
                <p className="mt-2 text-[11px] leading-relaxed text-faint">
                  A curve far above the diagonal indicates that incidents concentrate in a small share of cells. This is descriptive; it does not account for where people travel.
                </p>
              </Panel>
            </div>

            <div className="grid gap-3 xl:grid-cols-[1.4fr_1fr]">
              <Panel title="Most affected road segments" subtitle="Ranked by incident count in scope; click a row to inspect">
                {d.topSegments.length === 0 ? (
                  <p className="text-[12px] text-muted">No incidents on the road network for the current filters.</p>
                ) : (
                  <div className="scroll-thin max-h-[360px] overflow-auto">
                    <table className="w-full text-[12px]">
                      <thead className="sticky top-0 bg-panel text-left text-[10.5px] uppercase tracking-[0.08em] text-muted">
                        <tr>
                          <th className="py-1.5 pr-2 font-medium">#</th>
                          <th className="py-1.5 pr-2 font-medium">Segment</th>
                          <th className="py-1.5 pr-2 text-right font-medium">Count</th>
                          <th className="py-1.5 pr-2 text-right font-medium">Per km</th>
                          <th className="py-1.5 text-right font-medium">AADT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.topSegments.map((s, i) => (
                          <tr
                            key={s.segmentId}
                            onClick={() => setSegmentId(s.segmentId)}
                            className={cx("cursor-pointer border-t border-line hover:bg-panel-2", segmentId === s.segmentId && "bg-accent/10")}
                          >
                            <td className="py-1.5 pr-2 font-mono text-faint">{i + 1}</td>
                            <td className="max-w-[220px] truncate py-1.5 pr-2">{s.name}</td>
                            <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{s.count}</td>
                            <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{s.perKm.toFixed(1)}</td>
                            <td className="py-1.5 text-right font-mono tabular-nums text-muted">{s.aadt === null ? "—" : formatInt(s.aadt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
              <Panel title="Segment statistics" subtitle={segmentId ? "Responds to the current filters" : "Select a segment in the table"}>
                {!segmentId ? (
                  <p className="text-[12px] text-muted">Select a road segment to see its statistics and hourly profile.</p>
                ) : segment.loading && !segment.data ? (
                  <Spinner />
                ) : segment.data ? (
                  <div className="flex flex-col gap-3">
                    <div>
                      <div className="font-medium">{segment.data.segment.name}</div>
                      <div className="text-[11.5px] text-muted">
                        {segment.data.segment.roadClass} · {segment.data.segment.speedLimitKmh} km/h · {segment.data.segment.lengthM} m
                      </div>
                    </div>
                    <KeyValue
                      rows={[
                        ["Incidents", formatInt(segment.data.stats.count)],
                        ["Per km", segment.data.stats.perKm.toFixed(2)],
                        ["Severity per km", segment.data.stats.severityPerKm.toFixed(2)],
                        ["Mean severity (1–4)", segment.data.stats.meanSeverity === null ? "—" : segment.data.stats.meanSeverity.toFixed(2)],
                        ["Traffic (AADT)", segment.data.segment.aadt === null ? "not observed" : formatInt(segment.data.segment.aadt)],
                      ]}
                    />
                    <EChart option={segmentHourOption} height={140} />
                  </div>
                ) : null}
              </Panel>
            </div>

            <p className="pb-4 text-[11px] leading-relaxed text-faint">
              Statuses included: {d.scope.statusesIncluded.join(", ")} · Synthetic share {formatPct(d.scope.syntheticShare, 0)} · Timestamps UTC, calendar fields {STUDY_AREA.timeZone}.
              {isAdmin ? "" : " Pending citizen reports are excluded by design."}
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}


