"use client";

/**
 * C. Analytics Dashboard — linked descriptive analytics over the report corpus.
 * Every chart filters the shared console state, which in turn filters the map.
 */

import React, { useMemo } from "react";
import { Activity, AlertTriangle, ArrowUpDown, ShieldCheck } from "lucide-react";
import { useApp } from "@/lib/appState";
import { computeDashboard, gini } from "@/lib/stats";
import {
  Chart,
  categoryBars,
  chartTheme,
  dayOfWeekBars,
  hourlyBars,
  monthlyTrend,
  severityDonut,
  simpleBars,
} from "@/components/charts";
import { MicroLabel, Panel, Stat, DataTable, Badge, Btn } from "@/components/ui";
import { SEVERITIES, CATEGORIES } from "@/lib/constants";

export default function AnalyticsView() {
  const app = useApp();
  const t = chartTheme(app.theme === "dark");

  const stats = useMemo(
    () => computeDashboard(app.filtered, app.segments),
    [app.filtered, app.segments],
  );
  const full = useMemo(() => computeDashboard(app.accidents, app.segments), [app.accidents, app.segments]);

  const categoryData = stats.categories.map((c) => ({ ...c }));
  const districtGini = useMemo(() => gini(stats.districts.map((d) => d.count)), [stats.districts]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="relative border-b border-[var(--rule)]">
        <div className="plate-texture absolute inset-0" />
        <div className="relative flex flex-wrap items-end justify-between gap-4 px-5 py-4">
          <div>
            <MicroLabel rule={false}>Module C</MicroLabel>
            <h1 className="mt-1.5 text-[27px] leading-[1.05] font-bold tracking-[-0.02em] text-[var(--text)]">
              Analytics Dashboard
            </h1>
            <p className="mt-1.5 max-w-[620px] text-[11px] leading-[1.7] text-[var(--text-3)]">
              Descriptive statistics over the synthetic Meridian corpus. Selecting any chart element
              filters the shared console state — the map and every other chart follow. Statistics are
              properties of the generated dataset, not findings about real cities.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="warn">
              <AlertTriangle className="h-2.5 w-2.5" /> synthetic dataset
            </Badge>
            <Badge tone="cyan">{app.filtered.length} of {app.accidents.length} records in scope</Badge>
            <Btn
              variant="ghost"
              icon={<ArrowUpDown className="h-3 w-3" />}
              onClick={app.resetFilters}
            >
              Clear cross-filters
            </Btn>
          </div>
        </div>
      </div>

      {/* KPI bay */}
      <div className="grid grid-cols-2 border-b border-[var(--rule)] md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Reports in scope" value={stats.totals.records.toLocaleString()} sub={`of ${full.totals.records.toLocaleString()} total`} />
        <Stat label="Verified" value={stats.totals.verified.toLocaleString()} tone="cyan" sub={`${pct(stats.totals.verified, stats.totals.records)} of scope`} />
        <Stat label="Pending review" value={stats.totals.pending.toLocaleString()} tone="warn" sub="not confirmed events" />
        <Stat label="Killed or seriously injured" value={(stats.totals.fatal + stats.severity[1].count).toLocaleString()} tone="fatal" sub={`${stats.totals.fatal} fatal`} />
        <Stat label="Casualties recorded" value={stats.totals.casualties.toLocaleString()} sub="synthetic severity model" />
        <Stat label="Emergency responses" value={stats.totals.emergencyCalls.toLocaleString()} sub={`${pct(stats.totals.emergencyCalls, stats.totals.records)} of scope`} />
        <Stat label="Median positional accuracy" value={stats.totals.medianAccuracyM.toFixed(1)} unit="m" sub="geocoding precision" />
        <Stat label="Mean reporting delay" value={stats.totals.meanDelayH.toFixed(1)} unit="h" sub="occurrence → submission" />
      </div>

      {/* charts */}
      <div className="grid grid-cols-1 gap-px bg-[var(--rule)] lg:grid-cols-3">
        <Panel title="Severity distribution" meta={<span className="micro">{stats.totals.records} records</span>}>
          <div className="p-2">
            <Chart
              option={severityDonut(
                stats.severity.map((s) => ({ name: s.label, value: s.count, colour: s.colour })),
                t,
              )}
              height={196}
              onEvents={{
                click: (p) => {
                  const name = (p as { name: string }).name;
                  const sev = SEVERITIES.find((s) => s.label === name);
                  if (sev) app.setFilters({ severities: [sev.code] });
                },
              }}
            />
          </div>
        </Panel>

        <Panel title="Hour-of-day distribution" meta={<span className="micro">UTC</span>} className="lg:col-span-2">
          <div className="p-2">
            <Chart
              option={hourlyBars(stats.hourly, t)}
              height={196}
              onEvents={{
                click: (p) => {
                  const h = Number((p as { name: string }).name);
                  if (Number.isFinite(h)) app.setFilters({ hours: [h, h] });
                },
              }}
            />
          </div>
        </Panel>

        <Panel title="Day-of-week pattern" className="lg:col-span-1">
          <div className="p-2">
            <Chart
              option={dayOfWeekBars(stats.dayOfWeek, t)}
              height={172}
              onEvents={{
                click: (p) => {
                  const label = (p as { name: string }).name;
                  const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
                  if (idx >= 0) app.setFilters({ days: [idx] });
                },
              }}
            />
          </div>
        </Panel>

        <Panel
          title="Monthly trend"
          meta={<span className="micro">total · verified · KSI</span>}
          className="lg:col-span-2"
        >
          <div className="p-2">
            <Chart option={monthlyTrend(stats.monthly, t)} height={172} />
          </div>
        </Panel>

        <Panel title="Accident category distribution" className="lg:col-span-2">
          <div className="p-2">
            <Chart
              option={categoryBars(categoryData, t)}
              height={218}
              onEvents={{
                click: (p) => {
                  const label = (p as { name: string }).name;
                  const cat = CATEGORIES.find((c) => c.label === label);
                  if (cat) app.setFilters({ categories: [cat.code] });
                },
              }}
            />
          </div>
        </Panel>

        <Panel title="Reporting lag" meta={<span className="micro">occurrence → submission</span>}>
          <div className="p-2">
            <Chart
              option={simpleBars(stats.reportingLag.map((l) => ({ label: l.bucket, value: l.count })), t, t.amber)}
              height={218}
            />
          </div>
        </Panel>

        <Panel title="Environmental conditions" meta={<span className="micro">at time of event</span>}>
          <div className="p-2">
            <Chart
              option={simpleBars(
                stats.environmental.map((e) => ({ label: e.key.replace("_", " "), value: e.count })),
                t,
                t.cyan,
              )}
              height={218}
            />
          </div>
        </Panel>

        <Panel title="Road class exposure" meta={<span className="micro">events per segment</span>}>
          <div className="p-2">
            <Chart
              option={simpleBars(
                stats.roadClass.map((r) => ({ label: r.roadClass, value: r.perSegment })),
                t,
                t.amber,
              )}
              height={218}
            />
          </div>
        </Panel>
      </div>

      {/* spatial concentration + top segments */}
      <div className="grid grid-cols-1 gap-px bg-[var(--rule)] lg:grid-cols-[1fr_1.4fr]">
        <Panel title="Spatial concentration by district">
          <div className="p-3">
            <div className="flex items-baseline gap-3">
              <div>
                <div className="micro">District Gini coefficient</div>
                <div className="tnum text-[25px] leading-none text-[var(--amber)]">
                  {districtGini.toFixed(3)}
                </div>
              </div>
              <div>
                <div className="micro">Largest district share</div>
                <div className="tnum text-[25px] leading-none text-[var(--text)]">
                  {pct(stats.districts[0]?.count ?? 0, stats.totals.records)}
                </div>
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-[1.65] text-[var(--text-3)]">
              The Gini coefficient describes how unevenly reports are distributed across administrative
              districts. It is a descriptive concentration measure — it does not test whether the
              observed pattern differs from a random one. Use the Gi* layer in the Laboratory for
              inference.
            </p>
            <div className="mt-3">
              {stats.districts.map((d) => (
                <div key={d.district} className="flex items-center gap-2 border-b border-[var(--rule)] py-1">
                  <span className="w-[122px] truncate text-[10.5px] text-[var(--text-2)]">{d.district}</span>
                  <div className="h-[7px] flex-1 bg-[var(--panel-2)]">
                    <div
                      className="h-full"
                      style={{
                        width: `${(d.count / (stats.districts[0]?.count || 1)) * 100}%`,
                        background: "var(--amber)",
                        opacity: 0.85,
                      }}
                    />
                  </div>
                  <span className="tnum w-[52px] text-right text-[10px] text-[var(--text-3)]">
                    {d.count}
                  </span>
                  <span className="tnum w-[42px] text-right text-[10px] text-[var(--amber)]">
                    {pct(d.count, stats.totals.records)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel
          title="Top accident-prone road segments"
          meta={<span className="micro">ranked by severity-weighted index</span>}
          actions={<Activity className="h-3.5 w-3.5 text-[var(--text-3)]" />}
        >
          <DataTable
            maxHeight={362}
            columns={[
              { key: "rank", label: "#", width: "32px" },
              { key: "code", label: "Segment", width: "86px" },
              { key: "name", label: "Street" },
              { key: "class", label: "Class", width: "72px" },
              { key: "count", label: "Events", align: "right", width: "62px" },
              { key: "sw", label: "Severity idx", align: "right", width: "78px" },
              { key: "density", label: "Per km", align: "right", width: "62px" },
            ]}
            rows={stats.topSegments.map((s, i) => ({
              __key: s.segmentId,
              rank: <span className="text-[var(--text-3)]">{String(i + 1).padStart(2, "0")}</span>,
              code: <span className="text-[var(--amber)]">{s.segmentCode}</span>,
              name: <span className="text-[var(--text)]">{s.streetName}</span>,
              class: s.roadClass,
              count: s.count,
              sw: <span className="text-[var(--amber)]">{s.severityWeighted}</span>,
              density: s.densityPerKm.toFixed(2),
            }))}
            onRowClick={(row) => app.setSelection({ kind: "segment", id: row.__key as number })}
          />
        </Panel>
      </div>

      <div className="flex items-start gap-2 border-t border-[var(--rule)] bg-[var(--panel-2)] px-5 py-3">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-3)]" />
        <p className="text-[9.5px] leading-[1.7] text-[var(--text-3)]">
          All figures are computed from the deterministic synthetic corpus (seed 20240917) generated by
          this platform. They describe the generated dataset only. No statement on this page is a
          finding about real-world road safety, and no predictive performance is claimed. The full
          corpus is reproducible from the documented seed and generator version.
        </p>
      </div>
    </div>
  );
}

function pct(n: number, total: number): string {
  if (!total) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}
