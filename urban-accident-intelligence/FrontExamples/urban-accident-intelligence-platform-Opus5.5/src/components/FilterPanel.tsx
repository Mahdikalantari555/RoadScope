"use client";
import { RotateCcw } from "lucide-react";
import type { Filters } from "@/lib/domain";
import { useApp } from "./providers";
import { Badge, Chip, cx } from "./ui";

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toggle<T>(arr: T[] | undefined, v: T, all: T[]): T[] | undefined {
  const cur = arr?.length ? arr : [];
  const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
  return next.length === 0 || next.length === all.length ? undefined : next;
}

export function FilterPanel({ statusDefault, statusNote, compact, hide = [] }: { statusDefault: string[]; statusNote?: string; compact?: boolean; hide?: ("status" | "dataset" | "time")[] }) {
  const { meta, filters, setFilters, resetFilters } = useApp();
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const statuses = filters.statuses?.length ? filters.statuses : statusDefault;
  const min = meta?.timeRange.min?.slice(0, 10);
  const max = meta?.timeRange.max?.slice(0, 10);
  const years = min && max ? Array.from({ length: Number(max.slice(0, 4)) - Number(min.slice(0, 4)) + 1 }, (_, i) => Number(min.slice(0, 4)) + i) : [];
  const active = Object.values(filters).some((v) => v !== undefined && !(Array.isArray(v) && v.length === 0));
  return (
    <div className={cx("space-y-3", compact && "space-y-2.5")}>
      <div className="flex items-center justify-between">
        <span className="label">Filters</span>
        <button onClick={resetFilters} disabled={!active} className="flex items-center gap-1 text-[11px] text-muted hover:text-accent disabled:opacity-40">
          <RotateCcw className="size-3" /> Reset
        </button>
      </div>
      {!hide.includes("time") && (
        <div>
          <div className="label mb-1">Time window (UTC dates)</div>
          <div className="grid grid-cols-2 gap-1.5">
            <input type="date" className="field num" value={filters.from ?? ""} min={min} max={max} onChange={(e) => set({ from: e.target.value || undefined })} aria-label="From date" />
            <input type="date" className="field num" value={filters.to ?? ""} min={min} max={max} onChange={(e) => set({ to: e.target.value || undefined })} aria-label="To date" />
          </div>
          <div className="flex flex-wrap gap-1 mt-1.5">
            <Chip active={!filters.from && !filters.to} onClick={() => set({ from: undefined, to: undefined })}>
              All
            </Chip>
            {years.map((y) => (
              <Chip key={y} active={filters.from === `${y}-01-01` && filters.to === `${y}-12-31`} onClick={() => set({ from: `${y}-01-01`, to: `${y}-12-31` })}>
                {y}
              </Chip>
            ))}
          </div>
          <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-1.5 mt-2">
            <span className="text-[11px] text-muted">Hours</span>
            <select className="field num" value={filters.hourFrom ?? 0} onChange={(e) => set({ hourFrom: Number(e.target.value), hourTo: filters.hourTo ?? 23 })} aria-label="Hour from">
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
            <span className="text-[11px] text-muted">to</span>
            <select className="field num" value={filters.hourTo ?? 23} onChange={(e) => set({ hourTo: Number(e.target.value), hourFrom: filters.hourFrom ?? 0 })} aria-label="Hour to">
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:59
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {WD.map((d, i) => (
              <Chip key={d} active={!filters.weekdays?.length || filters.weekdays.includes(i)} onClick={() => set({ weekdays: toggle(filters.weekdays?.length ? filters.weekdays : [0, 1, 2, 3, 4, 5, 6], i, [0, 1, 2, 3, 4, 5, 6]) })}>
                {d}
              </Chip>
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="label mb-1">Severity</div>
        <div className="flex flex-wrap gap-1">
          {meta?.severities
            .slice()
            .reverse()
            .map((s) => (
              <Chip key={s.code} color={s.color} active={!filters.severities?.length || filters.severities.includes(s.code)} onClick={() => set({ severities: toggle(filters.severities?.length ? filters.severities : meta.severities.map((x) => x.code), s.code, meta.severities.map((x) => x.code)) })}>
                {s.label.replace(" injury", "").replace("Property damage only", "PDO")}
              </Chip>
            ))}
        </div>
      </div>
      <div>
        <div className="label mb-1">Collision type</div>
        <div className="flex flex-wrap gap-1">
          {meta?.categories.map((c) => (
            <Chip key={c.code} color={c.color} title={c.description} active={!filters.categories?.length || filters.categories.includes(c.code)} onClick={() => set({ categories: toggle(filters.categories?.length ? filters.categories : meta.categories.map((x) => x.code), c.code, meta.categories.map((x) => x.code)) })}>
              {c.label.split(" /")[0].replace(" collision", "").replace(" involved", "")}
            </Chip>
          ))}
        </div>
      </div>
      {!hide.includes("status") && (
        <div>
          <div className="label mb-1">Report status</div>
          <div className="flex flex-wrap gap-1">
            {meta?.statuses.map((s) => (
              <Chip key={s.code} color={s.color} active={statuses.includes(s.code)} onClick={() => {
                const next = statuses.includes(s.code) ? statuses.filter((x) => x !== s.code) : [...statuses, s.code];
                set({ statuses: next.length ? next : undefined });
              }}>
                {s.code}
              </Chip>
            ))}
          </div>
          {statusNote && <p className="text-[11px] text-faint mt-1 leading-snug">{statusNote}</p>}
        </div>
      )}
      {!hide.includes("dataset") && meta && (
        <div>
          <div className="label mb-1">Datasets</div>
          <div className="space-y-1">
            {meta.datasets
              .filter((d) => d.isActive)
              .map((d) => {
                const on = !filters.datasets?.length || filters.datasets.includes(d.id);
                return (
                  <label key={d.id} className="flex items-center gap-2 text-[12px] cursor-pointer">
                    <input type="checkbox" checked={on} onChange={() => set({ datasets: toggle(filters.datasets?.length ? filters.datasets : meta.datasets.filter((x) => x.isActive).map((x) => x.id), d.id, meta.datasets.filter((x) => x.isActive).map((x) => x.id)) })} />
                    <span className="truncate flex-1">{d.name}</span>
                    <Badge color={d.kind === "synthetic" ? "#f5a524" : "#4fd1c5"}>{d.kind}</Badge>
                  </label>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
