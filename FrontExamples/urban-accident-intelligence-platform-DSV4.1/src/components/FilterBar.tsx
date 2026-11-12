"use client";

import { CalendarRange, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { FilterState, MetaPayload } from "@/lib/client/api";
import { DEFAULT_FILTERS } from "@/lib/client/api";
import { Field, ToggleChip } from "./ui";

const STATUS_OPTIONS = [
  { value: "verified", label: "Verified" },
  { value: "reported", label: "Pending" },
  { value: "rejected", label: "Rejected" },
] as const;

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function FilterBar({
  filters,
  onChange,
  meta,
  showStatus = true,
  showCategories = true,
  showDistricts = true,
  compact = false,
}: {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  meta?: MetaPayload | null;
  showStatus?: boolean;
  showCategories?: boolean;
  showDistricts?: boolean;
  compact?: boolean;
}) {
  const toggleIn = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <Field label="From (UTC)">
          <input
            type="date"
            className="input"
            value={filters.from}
            min="2024-01-01"
            max="2025-12-31"
            onChange={(event) => onChange({ ...filters, from: event.target.value })}
          />
        </Field>
        <Field label="To (UTC)">
          <input
            type="date"
            className="input"
            value={filters.to}
            min="2024-01-01"
            max="2025-12-31"
            onChange={(event) => onChange({ ...filters, to: event.target.value })}
          />
        </Field>
      </div>

      {showStatus && (
        <div>
          <div className="label-caps mb-1">Verification status</div>
          <div className="flex flex-wrap gap-1">
            {STATUS_OPTIONS.map((option) => (
              <ToggleChip
                key={option.value}
                active={filters.status.includes(option.value)}
                onClick={() => onChange({ ...filters, status: toggleIn(filters.status, option.value) })}
              >
                {option.label}
              </ToggleChip>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="label-caps mb-1">Severity</div>
        <div className="flex flex-wrap gap-1">
          {[
            { code: 4, label: "Fatal", color: "#e5402a" },
            { code: 3, label: "Serious", color: "#f2762e" },
            { code: 2, label: "Slight", color: "#e3b341" },
            { code: 1, label: "Damage", color: "#7d8fa3" },
          ].map((option) => (
            <ToggleChip
              key={option.code}
              active={filters.severities.includes(option.code)}
              onClick={() => onChange({ ...filters, severities: toggleIn(filters.severities, option.code) })}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: option.color }} />
              {option.label}
            </ToggleChip>
          ))}
        </div>
      </div>

      {showCategories && (
        <div>
          <div className="label-caps mb-1">Category</div>
          <div className={`flex flex-wrap gap-1 ${compact ? "max-h-[86px] overflow-y-auto scroll-thin pr-1" : ""}`}>
            {(meta?.categories ?? []).map((category) => (
              <ToggleChip
                key={category.code}
                active={filters.categories.includes(category.code)}
                onClick={() => onChange({ ...filters, categories: toggleIn(filters.categories, category.code) })}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: category.color ?? "#94a3b8" }} />
                {category.label}
              </ToggleChip>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label="Hours (UTC)">
          <div className="flex items-center gap-1">
            <input
              type="number"
              className="input"
              min={0}
              max={23}
              value={filters.hourFrom}
              onChange={(event) => onChange({ ...filters, hourFrom: Math.max(0, Math.min(23, Number(event.target.value))) })}
            />
            <span className="text-faint">–</span>
            <input
              type="number"
              className="input"
              min={0}
              max={23}
              value={filters.hourTo}
              onChange={(event) => onChange({ ...filters, hourTo: Math.max(0, Math.min(23, Number(event.target.value))) })}
            />
          </div>
        </Field>
        {showDistricts && (
          <Field label="District">
            <select
              className="select"
              value={filters.districts[0] ?? ""}
              onChange={(event) => onChange({ ...filters, districts: event.target.value ? [event.target.value] : [] })}
            >
              <option value="">All districts</option>
              {(meta?.districts ?? []).map((district) => (
                <option key={district.name} value={district.name}>
                  {district.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      <div>
        <div className="label-caps mb-1">Day of week</div>
        <div className="flex flex-wrap gap-1">
          {DOW.map((label, index) => (
            <ToggleChip key={label} active={filters.dows.includes(index)} onClick={() => onChange({ ...filters, dows: toggleIn(filters.dows, index) })}>
              {label}
            </ToggleChip>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <button type="button" className="btn btn-xs" onClick={() => onChange({ ...DEFAULT_FILTERS })}>
          <RotateCcw size={11} /> Reset filters
        </button>
        <span className="flex items-center gap-1 text-[10px] text-faint">
          <CalendarRange size={11} /> {filters.status.length} status · {filters.categories.length || "all"} cat.
          <SlidersHorizontal size={11} />
        </span>
      </div>
    </div>
  );
}
