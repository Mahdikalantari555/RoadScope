"use client";

/**
 * Statistical graphics for the coordinated multiple views. Every chart is
 * brushable/clickable and emits selections that the map consumes, satisfying the
 * bidirectional linked-brushing requirement (US-6.2).
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { colorFor } from "@/lib/util/colors";

const AXIS = "var(--text-mute)";
const GRID = "var(--border)";
const TXT = "var(--text-dim)";

export interface SeriesPoint {
  label: string;
  start?: string;
  count: number;
  epdo?: number;
}

/* ------------------------------------------------------------------ */
/* Brushable temporal series                                           */
/* ------------------------------------------------------------------ */

export function TimeSeriesChart({
  series,
  height = 108,
  ramp = "viridis",
  range,
  onRangeChange,
  valueKey = "count",
  label,
}: {
  series: SeriesPoint[];
  height?: number;
  ramp?: string;
  range?: [number, number] | null;
  onRangeChange?: (r: [number, number] | null) => void;
  valueKey?: "count" | "epdo";
  label?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const w = 100;
  const h = 40;
  const values = series.map((s) => (valueKey === "epdo" ? (s.epdo ?? s.count) : s.count));
  const max = Math.max(1, ...values);
  const idxFromEvent = useCallback(
    (clientX: number) => {
      const el = ref.current;
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      return Math.min(series.length - 1, Math.floor(t * series.length));
    },
    [series.length],
  );

  const sel = drag ?? range ?? null;
  const x0 = sel ? (sel[0] / Math.max(1, series.length)) * 100 : 0;
  const x1 = sel ? ((sel[1] + 1) / Math.max(1, series.length)) * 100 : 0;

  const path = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i / Math.max(1, series.length - 1)) * w},${h - (v / max) * (h - 4)}`)
    .join(" ");
  const area = `${path} L${w},${h} L0,${h} Z`;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[9.5px] uppercase tracking-[0.08em]" style={{ color: AXIS }}>
          {label ?? `Temporal distribution · ${valueKey}`}
        </span>
        <span className="mono text-[9.5px]" style={{ color: AXIS }}>
          {sel ? `${series[sel[0]]?.label ?? ""} → ${series[sel[1]]?.label ?? ""}` : "drag to brush"}
          {sel && onRangeChange && (
            <button type="button" className="ml-2 underline" onClick={() => onRangeChange(null)}>
              clear
            </button>
          )}
        </span>
      </div>
      <div
        ref={ref}
        className="relative w-full select-none"
        style={{ height, cursor: "crosshair" }}
        onMouseDown={(e) => {
          const i = idxFromEvent(e.clientX);
          setDrag([i, i]);
        }}
        onMouseMove={(e) => {
          if (!drag) return;
          const i = idxFromEvent(e.clientX);
          setDrag([Math.min(drag[0], i), Math.max(drag[0], i)]);
        }}
        onMouseUp={() => {
          if (drag) {
            onRangeChange?.(drag[0] === drag[1] && series.length > 1 ? null : drag);
            setDrag(null);
          }
        }}
        onMouseLeave={() => {
          if (drag) {
            onRangeChange?.(drag);
            setDrag(null);
          }
        }}
      >
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-full w-full">
          <defs>
            <linearGradient id="tsgrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colorFor(ramp, 0.85)} stopOpacity="0.85" />
              <stop offset="100%" stopColor={colorFor(ramp, 0.35)} stopOpacity="0.18" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((g) => (
            <line key={g} x1={0} x2={w} y1={h * g} y2={h * g} stroke={GRID} strokeWidth={0.2} />
          ))}
          <path d={area} fill="url(#tsgrad)" />
          <path d={path} fill="none" stroke={colorFor(ramp, 0.9)} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
          {sel && <rect x={x0} y={0} width={Math.max(0.4, x1 - x0)} height={h} fill={colorFor(ramp, 0.7)} opacity={0.18} stroke={colorFor(ramp, 0.9)} strokeWidth={0.25} />}
        </svg>
      </div>
      <div className="mono mt-0.5 flex justify-between text-[9px]" style={{ color: AXIS }}>
        <span>{series[0]?.label ?? ""}</span>
        <span>peak {max.toFixed(valueKey === "epdo" ? 1 : 0)}</span>
        <span>{series[series.length - 1]?.label ?? ""}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 7 × 24 diurnal matrix                                               */
/* ------------------------------------------------------------------ */

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function DiurnalMatrix({
  matrix,
  ramp = "inferno",
  onCell,
  selected,
}: {
  matrix: number[][];
  ramp?: string;
  onCell?: (dow: number, hour: number) => void;
  selected?: { dow: number; hour: number } | null;
}) {
  const max = Math.max(1e-9, ...matrix.flat());
  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: `26px repeat(24, 1fr)`, gap: 1 }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="mono text-center text-[8px]" style={{ color: AXIS }}>
            {h % 3 === 0 ? h : ""}
          </div>
        ))}
        {matrix.map((row, d) => (
          <Row key={d} row={row} d={d} max={max} ramp={ramp} onCell={onCell} selected={selected} />
        ))}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="mono text-[9px]" style={{ color: AXIS }}>
          0
        </span>
        <div className="h-2 flex-1" style={{ background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => colorFor(ramp, t)).join(",")})` }} />
        <span className="mono text-[9px]" style={{ color: AXIS }}>
          {max.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

function Row({
  row,
  d,
  max,
  ramp,
  onCell,
  selected,
}: {
  row: number[];
  d: number;
  max: number;
  ramp: string;
  onCell?: (dow: number, hour: number) => void;
  selected?: { dow: number; hour: number } | null;
}) {
  return (
    <>
      <div className="mono text-[8.5px] leading-[13px]" style={{ color: AXIS }}>
        {DOW[d]}
      </div>
      {row.map((v, h) => {
        const t = Math.min(1, v / max);
        const isSel = selected?.dow === d && selected?.hour === h;
        return (
          <button
            key={h}
            type="button"
            title={`${DOW[d]} ${String(h).padStart(2, "0")}:00 UTC — ${v.toFixed(2)}`}
            onClick={() => onCell?.(d, h)}
            style={{
              height: 13,
              background: colorFor(ramp, t),
              opacity: v === 0 ? 0.25 : 1,
              outline: isSel ? "1.5px solid var(--text)" : "none",
              cursor: onCell ? "pointer" : "default",
            }}
          />
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Ranked bar list (cross-filter source)                               */
/* ------------------------------------------------------------------ */

export function BarList({
  items,
  ramp = "plasma",
  onSelect,
  selectedKey,
  valueFormat = (v: number) => v.toFixed(1),
  height = 15,
  title,
}: {
  items: Array<{ key: string; label: string; value: number; sub?: string; color?: string }>;
  ramp?: string;
  onSelect?: (key: string | null) => void;
  selectedKey?: string | null;
  valueFormat?: (v: number) => string;
  height?: number;
  title?: string;
}) {
  const max = Math.max(1e-9, ...items.map((i) => i.value));
  return (
    <div>
      {title && (
        <div className="mb-1 text-[9.5px] uppercase tracking-[0.08em]" style={{ color: AXIS }}>
          {title}
        </div>
      )}
      <div className="space-y-[3px]">
        {items.map((it, i) => {
          const t = it.value / max;
          const isSel = selectedKey === it.key;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => onSelect?.(isSel ? null : it.key)}
              className="flex w-full items-center gap-2 text-left"
              style={{ opacity: selectedKey && !isSel ? 0.45 : 1 }}
              title={`${it.label}: ${valueFormat(it.value)}${it.sub ? ` · ${it.sub}` : ""}`}
            >
              <span className="w-[38%] shrink-0 truncate text-[10.5px]" style={{ color: isSel ? "var(--text)" : TXT }}>
                {it.label}
              </span>
              <span className="relative h-[10px] flex-1 overflow-hidden rounded-[1px]" style={{ background: "var(--panel-2)", height }}>
                <span
                  className="absolute left-0 top-0 h-full"
                  style={{ width: `${Math.max(0.6, t * 100)}%`, background: it.color ?? colorFor(ramp, 0.15 + t * 0.8) }}
                />
              </span>
              <span className="mono w-14 shrink-0 text-right text-[10px]" style={{ color: isSel ? "var(--text)" : TXT }}>
                {valueFormat(it.value)}
              </span>
              <span className="mono w-6 shrink-0 text-right text-[9px]" style={{ color: AXIS }}>
                {i + 1}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Histogram                                                           */
/* ------------------------------------------------------------------ */

export function Histogram({ bins, ramp = "cividis", title, height = 78 }: { bins: Array<{ bucket: string; count: number }>; ramp?: string; title?: string; height?: number }) {
  const max = Math.max(1, ...bins.map((b) => b.count));
  return (
    <div>
      {title && (
        <div className="mb-1 text-[9.5px] uppercase tracking-[0.08em]" style={{ color: AXIS }}>
          {title}
        </div>
      )}
      <div className="flex items-end gap-[2px]" style={{ height }}>
        {bins.map((b, i) => (
          <div key={b.bucket} className="group relative flex-1" style={{ height: `${Math.max(2, (b.count / max) * 100)}%` }} title={`${b.bucket}: ${b.count}`}>
            <div className="h-full w-full" style={{ background: colorFor(ramp, 0.2 + (b.count / max) * 0.75) }} />
          </div>
        ))}
      </div>
      <div className="mono mt-0.5 flex justify-between text-[8.5px]" style={{ color: AXIS }}>
        <span>{bins[0]?.bucket}</span>
        <span>{bins[Math.floor(bins.length / 2)]?.bucket}</span>
        <span>{bins[bins.length - 1]?.bucket}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scatter (for observed-vs-expected calibration plots)                */
/* ------------------------------------------------------------------ */

export function ScatterPlot({
  points,
  xLabel,
  yLabel,
  ramp = "viridis",
  size = 132,
  diagonal = true,
  colorBy,
}: {
  points: Array<{ x: number; y: number; c?: number; label?: string }>;
  xLabel: string;
  yLabel: string;
  ramp?: string;
  size?: number;
  diagonal?: boolean;
  colorBy?: { min: number; max: number };
}) {
  const [hover, setHover] = useState<string | null>(null);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const maxX = Math.max(1e-9, ...xs);
  const maxY = Math.max(1e-9, ...ys);
  const scale = 100;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${scale} ${scale}`} style={{ width: "100%", height: size }} className="overflow-visible">
        <rect x={0} y={0} width={scale} height={scale} fill="var(--panel-2)" opacity={0.35} />
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g}>
            <line x1={g * scale} x2={g * scale} y1={0} y2={scale} stroke={GRID} strokeWidth={0.2} />
            <line x1={0} x2={scale} y1={g * scale} y2={g * scale} stroke={GRID} strokeWidth={0.2} />
          </g>
        ))}
        {diagonal && <line x1={0} y1={scale} x2={scale} y2={0} stroke={AXIS} strokeWidth={0.35} strokeDasharray="1.5 1.5" />}
        {points.map((p, i) => {
          const cx = (p.x / maxX) * scale;
          const cy = scale - (p.y / maxY) * scale;
          const t = colorBy ? Math.min(1, Math.max(0, ((p.c ?? 0) - colorBy.min) / Math.max(1e-9, colorBy.max - colorBy.min))) : 0.7;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={1.15}
              fill={colorFor(ramp, t)}
              opacity={0.78}
              onMouseEnter={() => setHover(p.label ?? `${p.x.toFixed(2)}, ${p.y.toFixed(2)}`)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </svg>
      <div className="mono mt-0.5 flex justify-between text-[9px]" style={{ color: AXIS }}>
        <span>{xLabel} → {maxX.toFixed(2)}</span>
        <span>
          {yLabel} → {maxY.toFixed(2)}
        </span>
      </div>
      {hover && <div className="mono pointer-events-none absolute right-1 top-1 rounded-[2px] px-1 text-[9px]" style={{ background: "var(--panel)", color: TXT }}>{hover}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Legends                                                             */
/* ------------------------------------------------------------------ */

export function RampLegend({ ramp, min, max, unit, ticks = 5, invert = false }: { ramp: string; min: number; max: number; unit?: string; ticks?: number; invert?: boolean }) {
  const stops = Array.from({ length: 12 }, (_, i) => colorFor(ramp, i / 11)).join(",");
  return (
    <div className="rounded-[3px] border px-2 py-1.5" style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--panel) 92%, transparent)" }}>
      {unit && <div className="mb-1 text-[9px] uppercase tracking-[0.07em]" style={{ color: AXIS }}>{unit}</div>}
      <div className="h-2.5 w-44" style={{ background: invert ? `linear-gradient(270deg, ${stops})` : `linear-gradient(90deg, ${stops})` }} />
      <div className="mono mt-0.5 flex w-44 justify-between text-[9px]" style={{ color: AXIS }}>
        {Array.from({ length: ticks }, (_, i) => (
          <span key={i}>{fmtCompact(min + ((max - min) * i) / (ticks - 1))}</span>
        ))}
      </div>
    </div>
  );
}

export function CategoricalLegend({ items }: { items: Array<{ label: string; color: string; count?: number }> }) {
  return (
    <div className="rounded-[3px] border px-2 py-1.5" style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--panel) 92%, transparent)" }}>
      <div className="space-y-[3px]">
        {items.map((i) => (
          <div key={i.label} className="flex items-center gap-1.5 text-[10px]" style={{ color: TXT }}>
            <span className="inline-block h-2 w-2 rounded-[1px]" style={{ background: i.color }} />
            <span className="truncate">{i.label}</span>
            {i.count !== undefined && <span className="mono ml-auto pl-2" style={{ color: AXIS }}>{i.count}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function BivariateLegend({ title = "Risk × Uncertainty", xLabel = "risk", yLabel = "uncertainty", size = 74 }: { title?: string; xLabel?: string; yLabel?: string; size?: number }) {
  const cells = useMemo(() => {
    const out: Array<{ x: number; y: number; color: string }> = [];
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        out.push({ x: i, y: j, color: bivariate(i / 4, j / 4) });
      }
    }
    return out;
  }, []);
  return (
    <div className="rounded-[3px] border px-2 py-1.5" style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--panel) 92%, transparent)" }}>
      <div className="mb-1 text-[9px] uppercase tracking-[0.07em]" style={{ color: AXIS }}>{title}</div>
      <div className="flex items-end gap-1.5">
        <div className="mono text-[8.5px]" style={{ color: AXIS, writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
          {yLabel} →
        </div>
        <div className="grid gap-[1px]" style={{ gridTemplateColumns: `repeat(5, ${size / 5}px)` }}>
          {cells
            .slice()
            .reverse()
            .map((c, i) => (
              <div key={i} style={{ width: size / 5, height: size / 5, background: c.color }} />
            ))}
        </div>
      </div>
      <div className="mono mt-0.5 flex justify-between text-[8.5px]" style={{ color: AXIS, width: size + 16 }}>
        <span />
        <span>{xLabel} →</span>
      </div>
    </div>
  );
}

export function SignificanceLegend({ items }: { items: Array<{ label: string; color: string; count: number }> }) {
  return (
    <div className="rounded-[3px] border px-2 py-1.5" style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--panel) 92%, transparent)" }}>
      <div className="mb-1 text-[9px] uppercase tracking-[0.07em]" style={{ color: AXIS }}>Statistical significance (FDR-corrected)</div>
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-1.5 text-[10px]" style={{ color: TXT }}>
          <span className="inline-block h-2.5 w-4 rounded-[1px]" style={{ background: i.color }} />
          <span>{i.label}</span>
          <span className="mono ml-auto pl-3" style={{ color: AXIS }}>{i.count}</span>
        </div>
      ))}
    </div>
  );
}

function bivariate(risk: number, unc: number): string {
  const r = Math.round(24 + risk * 195 + unc * 18);
  const g = Math.round(28 + (1 - risk) * 55 + unc * 128);
  const b = Math.round(58 + (1 - risk) * 148 + unc * 42);
  return `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)})`;
}

export function fmtCompact(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (a >= 10) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  if (a >= 0.01) return v.toFixed(3);
  if (a === 0) return "0";
  return v.toExponential(1);
}

/* ------------------------------------------------------------------ */
/* Data table                                                          */
/* ------------------------------------------------------------------ */

export function DataTable<T extends Record<string, any>>({
  rows,
  columns,
  onRowClick,
  selectedKey,
  rowKey,
  maxHeight = 260,
}: {
  rows: T[];
  columns: Array<{ key: keyof T | string; label: string; align?: "left" | "right"; format?: (v: any, row: T) => string; tone?: (v: any, row: T) => string | undefined }>;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  rowKey: (row: T) => string;
  maxHeight?: number;
}) {
  return (
    <div className="scroll-thin overflow-auto" style={{ maxHeight }}>
      <table className="data numeric">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={String(c.key)} style={{ textAlign: c.align ?? "left" }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={selectedKey === rowKey(row) ? "selected" : undefined}
              onClick={() => onRowClick?.(row)}
              style={{ cursor: onRowClick ? "pointer" : "default" }}
            >
              {columns.map((c) => {
                const v = (row as any)[c.key as string];
                return (
                  <td key={String(c.key)} style={{ textAlign: c.align ?? "left", color: c.tone?.(v, row) ?? undefined }}>
                    {c.format ? c.format(v, row) : v === null || v === undefined ? "—" : String(v)}
                  </td>
                );
              })}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} style={{ textAlign: "center", color: AXIS, padding: 14 }}>
                no rows for the current filter
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
