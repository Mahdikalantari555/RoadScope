"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, BarChart3, CalendarClock, Car, CloudRain, Compass, MapPinned, Ruler, TriangleAlert } from "lucide-react";
import { MapView } from "@/components/map/MapView";
import { EChart } from "@/components/charts/EChart";
import { FilterBar } from "@/components/FilterBar";
import { Callout, Divider, EmptyState, Kpi, LoadingRows, MetricGrid, Panel, SectionLabel, Spinner } from "@/components/ui";
import {
  DEFAULT_FILTERS,
  filtersToQuery,
  formatNumber,
  formatPct,
  useApi,
  type AccidentsResponse,
  type FilterState,
  type MetaPayload,
  type NetworkResponse,
  type StatsResponse,
} from "@/lib/client/api";
import {
  categoryOption,
  dowOption,
  environmentOption,
  hourlyOption,
  monthlyOption,
  segmentDensityOption,
  severityOption,
  topSegmentsOption,
} from "@/lib/chartOptions";
import type { SegmentAggregate } from "@/lib/analytics";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function AnalyticsDashboard({ initialMeta }: { initialMeta: MetaPayload }) {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [focusSegment, setFocusSegment] = useState<SegmentAggregate | null>(null);
  const query = filtersToQuery(filters);
  const stats = useApi<StatsResponse>(`/api/stats?${query}`, [query], { keepPrevious: true });
  const accidents = useApi<AccidentsResponse>(`/api/accidents?format=geojson&${query}`, [query], { keepPrevious: true });
  const network = useApi<NetworkResponse>("/api/network");

  const data = stats.data?.stats;
  const statusCounts = stats.data?.statusCounts ?? {};

  const toggle = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const activeFilterChips = useMemo(() => {
    const chips: { label: string; clear: () => void }[] = [];
    if (filters.categories.length)
      chips.push({
        label: `${filters.categories.length} categories`,
        clear: () => setFilters({ ...filters, categories: [] }),
      });
    if (filters.severities.length)
      chips.push({ label: `severity ${filters.severities.join(", ")}`, clear: () => setFilters({ ...filters, severities: [] }) });
    if (filters.dows.length) chips.push({ label: `day ${filters.dows.join(",")}`, clear: () => setFilters({ ...filters, dows: [] }) });
    if (filters.hourFrom > 0 || filters.hourTo < 23)
      chips.push({ label: `${filters.hourFrom}:00–${filters.hourTo}:59`, clear: () => setFilters({ ...filters, hourFrom: 0, hourTo: 23 }) });
    if (filters.districts.length) chips.push({ label: filters.districts[0], clear: () => setFilters({ ...filters, districts: [] }) });
    if (filters.from !== DEFAULT_FILTERS.from || filters.to !== DEFAULT_FILTERS.to)
      chips.push({ label: `${filters.from} → ${filters.to}`, clear: () => setFilters({ ...filters, from: DEFAULT_FILTERS.from, to: DEFAULT_FILTERS.to }) });
    return chips;
  }, [filters]);

  if (stats.error) {
    return (
      <div className="p-4">
        <Callout tone="danger" title="Statistics unavailable">
          {stats.error}
        </Callout>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1680px] space-y-2.5 p-2.5">
      <header className="panel flex flex-wrap items-center justify-between gap-3 px-3 py-2">
        <div>
          <h1 className="flex items-center gap-2 text-[14px] font-semibold tracking-wide text-ink">
            <BarChart3 size={15} className="text-accent" /> Safety analytics dashboard
          </h1>
          <p className="mt-0.5 text-[11px] text-muted">
            Descriptive statistics from synthetic incidents. Charts and map share one filter state — selecting a chart element updates every
            visualisation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {stats.loading && <Spinner label="recomputing" />}
          <span className="badge badge-warn">Synthetic data</span>
          <Link href="/lab" className="btn btn-xs">
            Spatial lab
          </Link>
        </div>
      </header>

      <div className="grid gap-2.5 xl:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="space-y-2.5">
          <Panel title="Linked filters" icon={<Compass size={12} />}>
            <FilterBar filters={filters} onChange={setFilters} meta={initialMeta} compact />
          </Panel>
          <Panel title="Active selections" icon={<Activity size={12} />}>
            {activeFilterChips.length === 0 ? (
              <p className="text-[10.5px] leading-relaxed text-faint">No chart-driven filters. Click a bar or heatmap cell to interrogate a subset.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {activeFilterChips.map((chip) => (
                  <button key={chip.label} type="button" className="chip" data-active="true" onClick={chip.clear}>
                    {chip.label} ×
                  </button>
                ))}
              </div>
            )}
            <Divider label="verification" />
            <div className="space-y-1 text-[10.5px]">
              {Object.entries(statusCounts).map(([status, value]) => (
                <div key={status} className="flex justify-between">
                  <span className="capitalize text-muted">{status}</span>
                  <span className="mono text-ink">{formatNumber(value)}</span>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
              Charts include pending reports unless verification filters exclude them. Pending records are not confirmed accidents.
            </p>
          </Panel>
          <Panel title="Interpretation notes" icon={<TriangleAlert size={12} />}>
            <ul className="space-y-1.5 text-[10.5px] leading-relaxed text-muted">
              <li>Counts reflect reporting propensity as well as exposure; the two cannot be separated without traffic and population denominators.</li>
              <li>Hour-of-day and day-of-week use UTC because the synthetic study area has no civil timezone.</li>
              <li>Percentages are rounded to one decimal; small strata (n &lt; 30) are unstable and should not be reported as rates.</li>
            </ul>
          </Panel>
        </aside>

        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Records in window" value={formatNumber(data?.total ?? 0)} detail={`${formatNumber(stats.data?.statusCounts.verified ?? 0)} verified`} tone="accent" icon={<Activity size={12} className="text-accent" />} />
            <Kpi label="KSI incidents" value={formatNumber(data?.ksi ?? 0)} detail={data ? formatPct(data.total ? data.ksi / data.total : 0) : "—"} tone="danger" icon={<TriangleAlert size={12} className="text-danger" />} />
            <Kpi label="Casualties" value={formatNumber(data?.casualties ?? 0)} detail={`${formatNumber(data?.fatalities ?? 0)} fatalities`} />
            <Kpi label="Casualty-weighted index" value={formatNumber(data?.severityWeighted ?? 0)} detail="Σ severity weights" />
            <Kpi label="Median report delay" value={`${(data?.delay.medianH ?? 0).toFixed(1)} h`} detail={`P90 ${(data?.delay.p90H ?? 0).toFixed(0)} h`} />
            <Kpi label="Spatial concentration" value={(data?.concentration.gini ?? 0).toFixed(3)} detail="Gini across segments" />
          </div>

          <div className="grid gap-2.5 lg:grid-cols-3">
            <Panel title="Severity distribution" icon={<TriangleAlert size={12} />} actions={<span className="text-[9.5px] text-faint">click to filter</span>}>
              {!data ? <LoadingRows rows={4} /> : (
                <EChart
                  option={severityOption(data)}
                  height={158}
                  onChartClick={(event) => {
                    const index = data.bySeverity.map((s) => s.label).indexOf(String(event.name));
                    const item = [...data.bySeverity].reverse()[index] ?? data.bySeverity.find((s) => s.label === event.name);
                    if (item) setFilters({ ...filters, severities: toggle(filters.severities, Number(item.key)) });
                  }}
                />
              )}
            </Panel>
            <Panel title="Accident category" icon={<Car size={12} />} actions={<span className="text-[9.5px] text-faint">click to filter</span>}>
              {!data ? <LoadingRows rows={4} /> : (
                <EChart
                  option={categoryOption(data)}
                  height={158}
                  onChartClick={(event) => {
                    const item = data.byCategory.find((c) => c.label === event.name);
                    if (item) setFilters({ ...filters, categories: toggle(filters.categories, item.key) });
                  }}
                />
              )}
            </Panel>
            <Panel title="Road / weather context" icon={<CloudRain size={12} />}>
              {!data ? <LoadingRows rows={4} /> : <EChart option={environmentOption(data)} height={158} />}
              <p className="mt-1 text-[9.5px] leading-relaxed text-faint">
                {data ? `${formatPct(data.completeness.weather)} of records carry environmental context; missing values are excluded.` : ""}
              </p>
            </Panel>
          </div>

          <div className="grid gap-2.5 lg:grid-cols-2">
            <Panel title="Hour-of-day × severity" icon={<CalendarClock size={12} />} actions={<span className="text-[9.5px] text-faint">click bar to filter hour</span>}>
              {!data ? <LoadingRows rows={5} /> : (
                <EChart
                  option={hourlyOption(data)}
                  height={186}
                  onChartClick={(event) => {
                    if (!event.name) return;
                    const hour = Number(event.name);
                    setFilters({ ...filters, hourFrom: hour, hourTo: hour });
                  }}
                />
              )}
            </Panel>
            <Panel title="Day-of-week pattern" icon={<CalendarClock size={12} />}>
              {!data ? <LoadingRows rows={5} /> : (
                <EChart
                  option={dowOption(data)}
                  height={186}
                  onChartClick={(event) => {
                    const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                    const index = labels.indexOf(String(event.name));
                    if (index >= 0) setFilters({ ...filters, dows: toggle(filters.dows, index) });
                  }}
                />
              )}
            </Panel>
          </div>

          <Panel title="Monthly trend — incidents and KSI" icon={<Activity size={12} />} actions={<span className="text-[9.5px] text-faint">click a month to zoom the window</span>}>
            {!data ? <LoadingRows rows={6} /> : (
              <EChart
                option={monthlyOption(data)}
                height={210}
                onChartClick={(event) => {
                  const month = data.byMonth.find((m) => m.label === event.name);
                  if (!month) return;
                  const [year, monthNumber] = month.key.split("-").map(Number);
                  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
                  setFilters({
                    ...filters,
                    from: `${month.key}-01`,
                    to: `${month.key}-${String(lastDay).padStart(2, "0")}`,
                  });
                }}
              />
            )}
            <p className="mt-1 text-[9.5px] leading-relaxed text-faint">
              The synthetic generator applies winter and Friday peaks plus rush-hour weighting; the resulting shape is a property of the
              generator, not an empirical finding.
            </p>
          </Panel>

          <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <Panel title="Spatial context — filtered incidents" icon={<MapPinned size={12} />} actions={<Link className="link text-[10px]" href="/">Open explorer</Link>}>
              <div className="h-[320px] overflow-hidden rounded border border-line">
                <MapView
                  mode="heat"
                  accidents={accidents.data}
                  network={network.data ? { segments: network.data.segments, intersections: network.data.intersections, water: network.data.water, parks: network.data.parks, districts: network.data.districts } : null}
                  basemap="night"
                  toggles={{ roads: true, districts: true, water: true, parks: true, intersections: false }}
                  legend={[{ label: "Low density", color: "#0e7490" }, { label: "Moderate", color: "#22d3ee" }, { label: "High", color: "#e3b341" }, { label: "Peak", color: "#e5402a" }]}
                  onSelectAccident={() => undefined}
                />
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-2 text-[10px] text-faint md:grid-cols-4">
                <span>Payload: {formatNumber(accidents.data?.meta.returned ?? 0)} features</span>
                <span>Engine: MapLibre GL</span>
                <span>CRS: EPSG:4326</span>
                <span>Symbology: kernel-style heat</span>
              </div>
            </Panel>

            <Panel title="Accident-prone road segments" icon={<Ruler size={12} />} actions={<Link className="link text-[10px]" href="/risk">Risk workspace</Link>}>
              {!data ? (
                <LoadingRows rows={6} />
              ) : data.topSegments.length === 0 ? (
                <EmptyState title="No segment matches" message="Widen the date range or include pending reports." />
              ) : (
                <>
                  <EChart
                    option={topSegmentsOption(data)}
                    height={196}
                    onChartClick={(event) => {
                      const label = String(event.name ?? "");
                      const segment = data.topSegments.find((s) => `${s.segmentId.replace("SEG-", "")} · ${s.name}` === label);
                      if (segment) setFocusSegment(segment);
                    }}
                  />
                  <div className="mt-1.5 max-h-[122px] overflow-auto scroll-thin">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Segment</th>
                          <th>Name</th>
                          <th className="num">n</th>
                          <th className="num">KSI</th>
                          <th className="num">/km</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.topSegments.slice(0, 8).map((segment) => (
                          <tr key={segment.segmentId} onClick={() => setFocusSegment(segment)} className="cursor-pointer">
                            <td className="mono">{segment.segmentId.replace("SEG-", "")}</td>
                            <td>{segment.name}</td>
                            <td className="num">{segment.count}</td>
                            <td className="num">{segment.ksi}</td>
                            <td className="num">{segment.densityPerKm.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {focusSegment && (
                    <div className="mt-2 border border-line bg-panel2 p-2">
                      <SectionLabel right={<button type="button" className="btn btn-ghost btn-xs" onClick={() => setFocusSegment(null)}>close</button>}>
                        Segment detail
                      </SectionLabel>
                      <MetricGrid
                        metrics={[
                          { label: "Segment", value: focusSegment.segmentId },
                          { label: "Name", value: focusSegment.name },
                          { label: "Class", value: focusSegment.roadClass },
                          { label: "Events", value: focusSegment.count },
                          { label: "Severity-weighted", value: focusSegment.severityWeighted.toFixed(1) },
                          { label: "AADT", value: focusSegment.aadt ? formatNumber(focusSegment.aadt) : "n/a" },
                          { label: "Wet share", value: formatPct(focusSegment.wetShare, 0) },
                          { label: "Dark share", value: formatPct(focusSegment.darkShare, 0) },
                        ]}
                      />
                    </div>
                  )}
                </>
              )}
            </Panel>
          </div>

          <div className="grid gap-2.5 lg:grid-cols-3">
            <Panel title="Severity-weighted density by segment" icon={<Ruler size={12} />}>
              {!data ? <LoadingRows rows={4} /> : <EChart option={segmentDensityOption(data)} height={170} />}
            </Panel>
            <Panel title="District distribution" icon={<MapPinned size={12} />}>
              {!data ? (
                <LoadingRows rows={4} />
              ) : (
                <div className="space-y-1">
                  {data.byDistrict.slice(0, 10).map((district) => (
                    <button
                      key={district.key}
                      type="button"
                      onClick={() => setFilters({ ...filters, districts: filters.districts[0] === district.key ? [] : [district.key] })}
                      className="flex w-full items-center gap-2 text-left text-[10.5px]"
                    >
                      <span className={`min-w-0 flex-1 truncate ${filters.districts[0] === district.key ? "text-accent" : "text-muted"}`}>{district.label}</span>
                      <div className="h-1.5 w-20 overflow-hidden rounded bg-line">
                        <span className="block h-full bg-accent" style={{ width: `${(district.share * 100).toFixed(0)}%` }} />
                      </div>
                      <span className="mono w-10 text-right text-ink">{district.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </Panel>
            <Panel title="Data coverage & delay" icon={<Activity size={12} />}>
              {!data ? (
                <LoadingRows rows={4} />
              ) : (
                <div className="space-y-1.5">
                  <MetricGrid
                    metrics={[
                      { label: "Verified", value: formatPct(data.completeness.verified, 1) },
                      { label: "Weather known", value: formatPct(data.completeness.weather, 1) },
                      { label: "Segment matched", value: formatPct(data.completeness.segment, 1) },
                      { label: "Median position ±", value: `${data.uncertainty.medianM.toFixed(0)} m` },
                      { label: "Reported ≤ 24 h", value: formatPct(data.delay.within24h, 1) },
                      { label: "Top-5 segment share", value: formatPct(data.concentration.top5Share, 1) },
                    ]}
                  />
                  <p className="text-[9.5px] leading-relaxed text-faint">
                    Coverage gaps propagate into every derived indicator. Spatial concentration is descriptive; significant clusters are only
                    identified in the lab using Getis-Ord Gi*.
                  </p>
                </div>
              )}
            </Panel>
          </div>

          <Callout tone="warn" title="Scientific responsibility">
            These visualisations are generated from synthetic data. Do not cite any value on this page as a real-world road safety statistic.
            Methodological limitations for each indicator are documented in <Link className="link" href="/about">Methods</Link>.
          </Callout>
          <div className="pb-2 text-[9.5px] text-faint">
            Month reference: {MONTH_LABELS.join(" · ")} · aggregation UTC · severity weights PDO 1 / slight 3 / serious 7 / fatal 12.
          </div>
        </div>
      </div>
    </div>
  );
}
