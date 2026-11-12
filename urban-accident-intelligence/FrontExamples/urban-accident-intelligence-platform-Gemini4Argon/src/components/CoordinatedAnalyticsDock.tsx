"use client";

import React, { useState, useMemo } from "react";
import type { AccidentItem, SpatialBBoxMetric } from "./VectorCartographicCanvas";
import type { SegmentRiskEvaluation } from "@/lib/geo/riskEngine";
import {
  Clock,
  Filter,
  BarChart3,
  ShieldAlert,
  TrendingUp,
  RotateCcw,
} from "lucide-react";

export type SafetyMetricDisplayMode =
  | "raw_frequency"
  | "linear_density"
  | "epdo_index"
  | "mvkt_rate";

interface CoordinatedAnalyticsDockProps {
  allAccidents: AccidentItem[];
  filteredAccidents: AccidentItem[];
  segmentRiskPortfolio: SegmentRiskEvaluation[];
  selectedHourRange: [number, number] | null;
  onChangeHourRange: (range: [number, number] | null) => void;
  selectedSeverity: string | null;
  onChangeSeverity: (sev: string | null) => void;
  selectedCategory: string | null;
  onChangeCategory: (cat: string | null) => void;
  selectedWeather: string | null;
  onChangeWeather: (weather: string | null) => void;
  selectedSegmentId: number | null;
  onSelectSegment: (segId: number | null) => void;
  spatialBBox: SpatialBBoxMetric | null;
  onResetAllFilters: () => void;
}

const SEVERITY_META: Record<
  string,
  { label: string; color: string; epdo: number }
> = {
  fatal: { label: "Fatal (K)", color: "#f43f5e", epdo: 9.5 },
  severe_injury: { label: "Severe Injury (A)", color: "#f97316", epdo: 5.5 },
  minor_injury: { label: "Minor Injury (B/C)", color: "#facc15", epdo: 2.5 },
  pdo: { label: "Property Damage (O)", color: "#38bdf8", epdo: 1.0 },
};

export default function CoordinatedAnalyticsDock({
  allAccidents,
  filteredAccidents,
  segmentRiskPortfolio,
  selectedHourRange,
  onChangeHourRange,
  selectedSeverity,
  onChangeSeverity,
  selectedCategory,
  onChangeCategory,
  selectedWeather,
  onChangeWeather,
  selectedSegmentId,
  onSelectSegment,
  spatialBBox,
  onResetAllFilters,
}: CoordinatedAnalyticsDockProps) {
  const [safetyMetricMode, setSafetyMetricMode] =
    useState<SafetyMetricDisplayMode>("linear_density");

  // 24-hour diurnal distribution
  const hourlyCounts = useMemo(() => {
    const counts = new Array<number>(24).fill(0);
    for (const acc of filteredAccidents) {
      const hr = new Date(acc.incidentTimestampUtc).getUTCHours();
      if (hr >= 0 && hr < 24) counts[hr]++;
    }
    return counts;
  }, [filteredAccidents]);

  const maxHourCount = Math.max(...hourlyCounts, 1);

  // Severity distribution
  const severityBreakdown = useMemo(() => {
    const map: Record<string, number> = {
      fatal: 0,
      severe_injury: 0,
      minor_injury: 0,
      pdo: 0,
    };
    for (const acc of filteredAccidents) {
      map[acc.severityCode] = (map[acc.severityCode] ?? 0) + 1;
    }
    return map;
  }, [filteredAccidents]);

  // Taxonomy category distribution
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const acc of filteredAccidents) {
      map.set(acc.categoryCode, (map.get(acc.categoryCode) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [filteredAccidents]);

  // Weather x Lighting covariate matrix
  const weatherBreakdown = useMemo(() => {
    const weathers = ["Clear", "Rain", "Overcast", "Fog"];
    return weathers.map((w) => {
      const subset = filteredAccidents.filter((a) => a.weatherCondition === w);
      const wetCount = subset.filter((a) => a.roadSurface !== "Dry").length;
      const severeCount = subset.filter(
        (a) => a.severityCode === "fatal" || a.severityCode === "severe_injury"
      ).length;
      return {
        weather: w,
        total: subset.length,
        wetCount,
        severeCount,
      };
    });
  }, [filteredAccidents]);

  const hasActiveFilter =
    Boolean(selectedHourRange) ||
    Boolean(selectedSeverity) ||
    Boolean(selectedCategory) ||
    Boolean(selectedWeather) ||
    Boolean(selectedSegmentId) ||
    Boolean(spatialBBox);

  const topSegments = useMemo(() => {
    const copy = [...segmentRiskPortfolio];
    copy.sort((a, b) => {
      if (safetyMetricMode === "raw_frequency")
        return b.rawCrashCount - a.rawCrashCount;
      if (safetyMetricMode === "linear_density")
        return b.linearCrashDensityPerKm - a.linearCrashDensityPerKm;
      if (safetyMetricMode === "epdo_index")
        return b.epdoDensityPerKm - a.epdoDensityPerKm;
      return b.mvktCrashRate - a.mvktCrashRate;
    });
    return copy.slice(0, 8);
  }, [segmentRiskPortfolio, safetyMetricMode]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 rounded-lg border border-slate-800 bg-slate-900/95 p-3 text-xs text-slate-200">
      {/* Header Strip inside CMV Dock */}
      <div className="lg:col-span-12 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-teal-400" />
          <span className="font-semibold uppercase tracking-wider text-slate-200">
            Coordinated Multiple Views (CMV) — Bidirectional Linked Brushing
          </span>
          <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-teal-300">
            Showing {filteredAccidents.length} of {allAccidents.length} Active Incidents
          </span>
        </div>

        {hasActiveFilter && (
          <button
            onClick={onResetAllFilters}
            className="flex items-center gap-1 rounded bg-rose-500/20 border border-rose-500/40 px-2.5 py-1 text-[11px] font-medium text-rose-200 hover:bg-rose-500/30"
          >
            <RotateCcw className="h-3 w-3" /> Reset Linked Brushes
          </button>
        )}
      </div>

      {/* Column 1: Diurnal 24-Hour Temporal Wave & Time-Window Brush (4 cols) */}
      <div className="lg:col-span-4 flex flex-col justify-between rounded border border-slate-800/90 bg-slate-950/70 p-2.5">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-semibold text-slate-200">
              <Clock className="h-3.5 w-3.5 text-teal-400" /> Diurnal Temporal Intensity (UTC)
            </span>
            <span className="font-mono text-[10px] text-slate-400">
              {selectedHourRange
                ? `${String(selectedHourRange[0]).padStart(2, "0")}:00–${String(
                    selectedHourRange[1]
                  ).padStart(2, "0")}:59`
                : "24h Window"}
            </span>
          </div>

          {/* Preset Temporal Brush Buttons */}
          <div className="mb-2.5 flex flex-wrap gap-1 text-[10px]">
            {[
              { label: "All 24h", range: null },
              { label: "AM Peak (07–10)", range: [7, 10] as [number, number] },
              { label: "Midday (11–15)", range: [11, 15] as [number, number] },
              { label: "PM Peak (16–20)", range: [16, 20] as [number, number] },
              { label: "Night (21–06)", range: [21, 6] as [number, number] },
            ].map((preset) => {
              const isActive =
                preset.range === null
                  ? selectedHourRange === null
                  : selectedHourRange?.[0] === preset.range[0] &&
                    selectedHourRange?.[1] === preset.range[1];
              return (
                <button
                  key={preset.label}
                  onClick={() => onChangeHourRange(preset.range)}
                  className={`rounded px-1.5 py-0.5 font-medium transition ${
                    isActive
                      ? "bg-teal-500/25 text-teal-300 border border-teal-500/50"
                      : "bg-slate-900 text-slate-400 hover:bg-slate-800 border border-slate-800"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          {/* 24-Hour Interactive Bar Histogram */}
          <div className="flex h-24 items-end gap-1 pt-2 px-1 border-b border-slate-800">
            {hourlyCounts.map((cnt, hr) => {
              const hPct = Math.max(8, Math.round((cnt / maxHourCount) * 100));
              const isBrushed =
                !selectedHourRange ||
                (selectedHourRange[0] <= selectedHourRange[1]
                  ? hr >= selectedHourRange[0] && hr <= selectedHourRange[1]
                  : hr >= selectedHourRange[0] || hr <= selectedHourRange[1]);

              return (
                <button
                  key={hr}
                  onClick={() =>
                    onChangeHourRange(
                      selectedHourRange &&
                        selectedHourRange[0] === hr &&
                        selectedHourRange[1] === hr
                        ? null
                        : [hr, hr]
                    )
                  }
                  title={`Hour ${String(hr).padStart(2, "0")}:00 UTC — ${cnt} incidents (Click to isolate hour)`}
                  className="group relative flex-1 flex flex-col items-center h-full justify-end"
                >
                  <div
                    style={{ height: `${hPct}%` }}
                    className={`w-full rounded-t transition-all ${
                      isBrushed
                        ? hr >= 7 && hr <= 9
                          ? "bg-amber-400 hover:bg-amber-300"
                          : hr >= 16 && hr <= 19
                          ? "bg-rose-500 hover:bg-rose-400"
                          : "bg-teal-400 hover:bg-teal-300"
                        : "bg-slate-800 opacity-40"
                    }`}
                  />
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between font-mono text-[9px] text-slate-400">
            <span>00:00</span>
            <span>06:00</span>
            <span className="text-amber-300">08:00 AM</span>
            <span>12:00</span>
            <span className="text-rose-400">17:00 PM</span>
            <span>23:00</span>
          </div>
        </div>

        {/* Weather Covariate Cross-Filter Strip */}
        <div className="mt-2 pt-2 border-t border-slate-800/80">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Environmental Weather Cross-Filter (US-4.4):
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {weatherBreakdown.map((wb) => {
              const active = selectedWeather === wb.weather;
              return (
                <button
                  key={wb.weather}
                  onClick={() =>
                    onChangeWeather(active ? null : wb.weather)
                  }
                  className={`rounded p-1.5 text-left border transition ${
                    active
                      ? "bg-sky-500/20 border-sky-400 text-sky-200"
                      : "bg-slate-900/90 border-slate-800 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  <div className="font-semibold text-[10px]">{wb.weather}</div>
                  <div className="font-mono text-[11px] text-teal-300">
                    N={wb.total}{" "}
                    <span className="text-[9px] text-rose-400">
                      ({wb.severeCount} K/A)
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Column 2: Severity & Taxonomy Interactive Distribution (3 cols) */}
      <div className="lg:col-span-3 flex flex-col justify-between rounded border border-slate-800/90 bg-slate-950/70 p-2.5">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-semibold text-slate-200">
              <ShieldAlert className="h-3.5 w-3.5 text-rose-400" /> KABCO Severity & EPDO
            </span>
            <span className="text-[10px] text-slate-400">Click to filter</span>
          </div>

          <div className="space-y-1.5">
            {(["fatal", "severe_injury", "minor_injury", "pdo"] as const).map(
              (sevKey) => {
                const meta = SEVERITY_META[sevKey];
                const count = severityBreakdown[sevKey] ?? 0;
                const pct =
                  filteredAccidents.length > 0
                    ? Math.round((count / filteredAccidents.length) * 100)
                    : 0;
                const isSelected = selectedSeverity === sevKey;

                return (
                  <button
                    key={sevKey}
                    onClick={() =>
                      onChangeSeverity(isSelected ? null : sevKey)
                    }
                    className={`w-full rounded px-2 py-1 text-left border transition ${
                      isSelected
                        ? "bg-slate-800 border-teal-400"
                        : "bg-slate-900/70 border-slate-800/80 hover:bg-slate-800/60"
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1.5 font-medium">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: meta.color }}
                        />
                        {meta.label}
                      </span>
                      <span className="font-mono text-[10px] text-slate-300">
                        <strong>{count}</strong> ({pct}%) · w={meta.epdo}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded bg-slate-800 overflow-hidden">
                      <div
                        style={{
                          width: `${Math.max(3, pct)}%`,
                          backgroundColor: meta.color,
                        }}
                        className="h-full rounded"
                      />
                    </div>
                  </button>
                );
              }
            )}
          </div>
        </div>

        {/* Accident Taxonomy Breakdown */}
        <div className="mt-2.5 pt-2 border-t border-slate-800/80">
          <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <span>Crash Taxonomy Filter</span>
            <BarChart3 className="h-3 w-3 text-teal-400" />
          </div>
          <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
            {categoryBreakdown.map(([catCode, count]) => {
              const active = selectedCategory === catCode;
              return (
                <button
                  key={catCode}
                  onClick={() => onChangeCategory(active ? null : catCode)}
                  className={`w-full flex items-center justify-between rounded px-2 py-1 text-[10px] border transition ${
                    active
                      ? "bg-teal-500/20 border-teal-400 text-teal-200"
                      : "bg-slate-900/60 border-slate-800/70 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  <span className="truncate capitalize">
                    {catCode.replace(/_/g, " ")}
                  </span>
                  <span className="font-mono font-semibold text-teal-300">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Column 3: Multi-Tiered Safety Metrics & Empirical Bayes RTM Ranking Table (5 cols) */}
      <div className="lg:col-span-5 flex flex-col justify-between rounded border border-slate-800/90 bg-slate-950/70 p-2.5">
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
            <span className="flex items-center gap-1.5 font-semibold text-slate-200">
              <TrendingUp className="h-3.5 w-3.5 text-amber-400" /> Corridor Safety Metrics & EB RTM Smoothing (US-5.1/5.2)
            </span>

            {/* 4-Metric Switcher */}
            <div className="flex items-center gap-1 text-[10px]">
              {[
                { id: "raw_frequency", label: "N (Raw)" },
                { id: "linear_density", label: "N/km" },
                { id: "epdo_index", label: "EPDO/km" },
                { id: "mvkt_rate", label: "MVKT Rate" },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() =>
                    setSafetyMetricMode(m.id as SafetyMetricDisplayMode)
                  }
                  className={`rounded px-1.5 py-0.5 font-mono transition ${
                    safetyMetricMode === m.id
                      ? "bg-amber-500/25 text-amber-300 border border-amber-500/50"
                      : "bg-slate-900 text-slate-400 hover:bg-slate-800 border border-slate-800"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto max-h-52">
            <table className="w-full text-left border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] text-slate-400 font-mono">
                  <th className="py-1 pr-2">Segment</th>
                  <th className="py-1 px-1.5 text-right">
                    {safetyMetricMode === "raw_frequency"
                      ? "Obs N"
                      : safetyMetricMode === "linear_density"
                      ? "N/km"
                      : safetyMetricMode === "epdo_index"
                      ? "EPDO/km"
                      : "MVKT"}
                  </th>
                  <th className="py-1 px-1.5 text-right" title="Safety Performance Function Prior">
                    SPF Prior
                  </th>
                  <th className="py-1 px-1.5 text-right text-teal-300" title="Empirical Bayes Expected Crash Count">
                    EB Est.
                  </th>
                  <th className="py-1 px-1.5 text-right text-amber-300" title="Potential for Safety Improvement (Excess Frequency)">
                    PSI
                  </th>
                  <th className="py-1 pl-1.5 text-right" title="3x3 Bivariate Risk-Uncertainty Class">
                    Biv.
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {topSegments.map((seg) => {
                  const isSel = selectedSegmentId === seg.segmentId;
                  const metricVal =
                    safetyMetricMode === "raw_frequency"
                      ? seg.rawCrashCount
                      : safetyMetricMode === "linear_density"
                      ? seg.linearCrashDensityPerKm
                      : safetyMetricMode === "epdo_index"
                      ? seg.epdoDensityPerKm
                      : seg.mvktCrashRate;

                  return (
                    <tr
                      key={seg.segmentId}
                      onClick={() =>
                        onSelectSegment(isSel ? null : seg.segmentId)
                      }
                      className={`cursor-pointer transition ${
                        isSel
                          ? "bg-teal-500/20 text-white"
                          : "hover:bg-slate-900/90 text-slate-300"
                      }`}
                    >
                      <td className="py-1.5 pr-2 font-sans">
                        <div className="font-medium truncate max-w-[145px]">
                          <span className="font-mono text-teal-400">
                            {seg.segmentCode}
                          </span>{" "}
                          {seg.name}
                        </div>
                      </td>
                      <td className="py-1.5 px-1.5 text-right font-semibold">
                        {metricVal.toFixed(1)}
                      </td>
                      <td className="py-1.5 px-1.5 text-right text-slate-400">
                        {seg.spfPriorExpected.toFixed(2)}
                      </td>
                      <td className="py-1.5 px-1.5 text-right font-semibold text-teal-300">
                        {seg.ebExpectedCount.toFixed(2)}
                      </td>
                      <td
                        className={`py-1.5 px-1.5 text-right font-semibold ${
                          seg.psiExcessCrashFrequency > 0
                            ? "text-rose-400"
                            : "text-emerald-400"
                        }`}
                      >
                        {seg.psiExcessCrashFrequency > 0 ? "+" : ""}
                        {seg.psiExcessCrashFrequency.toFixed(2)}
                      </td>
                      <td className="py-1.5 pl-1.5 text-right">
                        <span
                          className="rounded px-1.5 py-0.5 text-[9px] text-white"
                          style={{ backgroundColor: seg.bivariateColorHex }}
                        >
                          {seg.bivariateClass}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-2 pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
          <span>
            RTM Shrinkage: <strong className="text-teal-300">E_EB = w·μ_SPF + (1-w)·N_obs</strong>
          </span>
          <span>Click any row to highlight corridor on map</span>
        </div>
      </div>
    </div>
  );
}
