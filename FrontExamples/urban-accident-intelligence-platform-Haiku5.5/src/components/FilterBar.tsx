"use client";

import { RotateCcw } from "lucide-react";
import { CATEGORY_META, CATEGORY_CODES, DOW_LABELS, MONTH_LABELS, SEVERITY_IDS, SEVERITY_META, STUDY_AREA, type AccidentStatus } from "@/lib/domain";
import { activeFilterCount, type FilterSpec } from "@/lib/filters";
import { addDaysIso } from "@/lib/time";
import { useApp } from "./AppProvider";
import { Button, Chip, cx, Segmented, inputCls, labelCls } from "./ui";

const YEAR_PRESETS = ["all", "2022", "2023", "2024"] as const;
const HOUR_PRESETS: { id: string; label: string; range: [number, number] | null }[] = [
  { id: "all", label: "All hours", range: null },
  { id: "night", label: "Night 00–05", range: [0, 5] },
  { id: "am", label: "AM peak 07–09", range: [7, 9] },
  { id: "pm", label: "PM peak 16–18", range: [16, 18] },
  { id: "day", label: "Daytime 06–21", range: [6, 21] },
];

/** Shared analytical filter controls. Every analytical view reads the same filter state. */
export function FilterBar({ variant = "full", showStatus = true }: { variant?: "full" | "compact"; showStatus?: boolean }) {
  const { meta, filters, setFilters, toggleArrayValue, resetFilters, isAdmin } = useApp();
  const compact = variant === "compact";
  const activeCount = activeFilterCount(filters);
  const yearPreset = (() => {
    if (!filters.from || !filters.to) return "all";
    const y = filters.from.slice(0, 4);
    return filters.from === `${y}-01-01` && filters.to === `${y}-12-31` ? y : "custom";
  })();
  const hourPreset = HOUR_PRESETS.find((h) => JSON.stringify(h.range) === JSON.stringify(filters.hours))?.id ?? (filters.hours ? "custom" : "all");
  const statuses: AccidentStatus[] = ["reported", "verified", "rejected", "duplicate"];
  const pending = filters.statuses.includes("reported");

  const setYear = (preset: (typeof YEAR_PRESETS)[number]) => {
    if (preset === "all") setFilters({ from: null, to: null });
    else setFilters({ from: `${preset}-01-01`, to: `${preset}-12-31` });
  };

  return (
    <div className={cx("flex flex-col", compact ? "gap-2.5" : "gap-3")}>
      <div className="flex items-center justify-between gap-2">
        <span className={labelCls}>
          Filters{activeCount > 0 ? <span className="ml-1.5 rounded bg-accent/15 px-1 text-accent">{activeCount}</span> : null}
        </span>
        <Button size="sm" variant="ghost" icon={<RotateCcw size={12} />} onClick={resetFilters} disabled={activeCount === 0 && filters.statuses.length === 1}>
          Reset
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={labelCls}>Period (local time)</span>
        <Segmented
          size="sm"
          value={yearPreset}
          options={[
            ...YEAR_PRESETS.map((y) => ({ value: y as string, label: y === "all" ? "All" : y })),
            ...(yearPreset === "custom" ? [{ value: "custom", label: "Custom" }] : []),
          ]}
          onChange={(v) => setYear(v as (typeof YEAR_PRESETS)[number])}
        />
        <div className="grid grid-cols-2 gap-1.5">
          <input
            type="date"
            aria-label="From date"
            className={inputCls}
            value={filters.from ?? ""}
            min={`${2022}-01-01`}
            max={filters.to ?? `${2024}-12-31`}
            onChange={(e) => setFilters({ from: e.target.value || null })}
          />
          <input
            type="date"
            aria-label="To date"
            className={inputCls}
            value={filters.to ?? ""}
            min={filters.from ?? `${2022}-01-01`}
            max={`${2024}-12-31`}
            onChange={(e) => setFilters({ to: e.target.value || null })}
          />
        </div>
        {filters.from && filters.to ? (
          <span className="text-[10.5px] text-faint">
            {filters.from} → {filters.to} · {STUDY_AREA.timeZone}
            {filters.to && addDaysIso(filters.to, 0) ? "" : ""}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={labelCls}>Time of day</span>
        <Segmented
          size="sm"
          value={hourPreset}
          options={[
            ...HOUR_PRESETS.map((h) => ({ value: h.id, label: h.label })),
          ]}
          onChange={(v) => setFilters({ hours: HOUR_PRESETS.find((h) => h.id === v)?.range ?? null })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={labelCls}>Months</span>
        <div className="grid grid-cols-6 gap-1">
          {MONTH_LABELS.map((label, i) => {
            const m = i + 1;
            const on = filters.months.includes(m);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => toggleArrayValue("months", m)}
                className={cx("h-6 rounded border text-[11px]", on ? "border-accent/60 bg-accent/10 text-fg" : "border-line text-muted hover:text-fg")}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={labelCls}>Weekday</span>
        <div className="grid grid-cols-7 gap-1">
          {DOW_LABELS.map((label, dow) => {
            const on = filters.daysOfWeek.includes(dow);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => toggleArrayValue("daysOfWeek", dow)}
                className={cx("h-6 rounded border text-[10.5px]", on ? "border-accent/60 bg-accent/10 text-fg" : "border-line text-muted hover:text-fg")}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={labelCls}>Category</span>
        <div className="flex flex-wrap gap-1">
          {CATEGORY_CODES.map((code) => (
            <Chip
              key={code}
              active={filters.categories.includes(code)}
              color={CATEGORY_META[code].colorHex}
              onClick={() => toggleArrayValue("categories", code)}
              title={CATEGORY_META[code].description}
            >
              {CATEGORY_META[code].label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={labelCls}>Severity</span>
        <div className="flex flex-wrap gap-1">
          {SEVERITY_IDS.map((id) => (
            <Chip key={id} active={filters.severities.includes(id)} color={SEVERITY_META[id].colorHex} onClick={() => toggleArrayValue("severities", id)} title={SEVERITY_META[id].description}>
              {SEVERITY_META[id].label}
            </Chip>
          ))}
        </div>
      </div>

      {showStatus ? (
        <div className="flex flex-col gap-1.5">
          <span className={labelCls}>Review status</span>
          {isAdmin ? (
            <div className="flex flex-wrap gap-1">
              {statuses.map((s) => (
                <Chip
                  key={s}
                  active={filters.statuses.includes(s)}
                  onClick={() => {
                    const next = filters.statuses.includes(s) ? filters.statuses.filter((x) => x !== s) : [...filters.statuses, s];
                    setFilters({ statuses: next.length ? next : ["verified"] });
                  }}
                >
                  {s === "reported" ? "Pending" : s.charAt(0).toUpperCase() + s.slice(1)}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-faint">Showing verified records only. Pending citizen reports are not treated as confirmed incidents.</p>
          )}
          {isAdmin && pending ? <p className="text-[10.5px] text-warn">Pending records are included in this view.</p> : null}
        </div>
      ) : null}

      {!compact && meta ? (
        <p className="border-t border-line pt-2 text-[10.5px] leading-snug text-faint">
          Dataset selection is managed on the Datasets page. Currently: {filters.datasetIds ? `${filters.datasetIds.length} selected` : "all active datasets"}.
        </p>
      ) : null}
    </div>
  );
}

export { type FilterSpec };
