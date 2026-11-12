"use client";
import { useRef, useState } from "react";
import { ramp } from "@/lib/colors";

/** Brushable daily time series: drag to select a date range. */
export function TimeSeries({ data, range, onBrush, height = 90 }: { data: { day: string; n: number; verified: number }[]; range: [string, string] | null; onBrush: (r: [string, string] | null) => void; height?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const W = 600, H = height, pad = 18;
  if (!data.length) return <div className="text-[11px] p-2" style={{ color: "var(--fg-2)" }}>No observations in subset.</div>;
  const max = Math.max(1, ...data.map((d) => d.n));
  const x = (i: number) => pad + (i / Math.max(1, data.length - 1)) * (W - 2 * pad);
  const y = (v: number) => H - 14 - (v / max) * (H - 24);
  const path = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.n).toFixed(1)}`).join(" ");
  const pathV = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.verified).toFixed(1)}`).join(" ");
  const toIdx = (clientX: number) => { const r = ref.current!.getBoundingClientRect(); const px = ((clientX - r.left) / r.width) * W; return Math.max(0, Math.min(data.length - 1, Math.round(((px - pad) / (W - 2 * pad)) * (data.length - 1)))); };
  const sel = drag ?? (range ? [data.findIndex((d) => d.day >= range[0]), data.length - 1 - [...data].reverse().findIndex((d) => d.day <= range[1])] : null);
  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full select-none" style={{ height }} onMouseDown={(e) => setDrag([toIdx(e.clientX), toIdx(e.clientX)])}
      onMouseMove={(e) => drag && setDrag([drag[0], toIdx(e.clientX)])}
      onMouseUp={() => { if (!drag) return; const [a, b] = [Math.min(...drag), Math.max(...drag)]; setDrag(null); if (a === b) onBrush(null); else onBrush([data[a].day, data[b].day]); }}
      onMouseLeave={() => drag && setDrag(null)}>
      {[0, 0.5, 1].map((t) => <g key={t}><line x1={pad} x2={W - pad} y1={y(t * max)} y2={y(t * max)} stroke="var(--line)" strokeWidth={0.5} /><text x={2} y={y(t * max) + 3} fontSize={8} fill="var(--fg-2)" className="mono">{Math.round(t * max)}</text></g>)}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={1.2} />
      <path d={pathV} fill="none" stroke="var(--ok)" strokeWidth={1} strokeDasharray="2 2" />
      {sel && sel[0] >= 0 && <rect x={x(Math.min(sel[0], sel[1]))} width={Math.max(1, x(Math.max(sel[0], sel[1])) - x(Math.min(sel[0], sel[1])))} y={4} height={H - 16} fill="var(--accent)" opacity={0.15} stroke="var(--accent)" strokeWidth={0.5} />}
      <text x={pad} y={H - 3} fontSize={8} fill="var(--fg-2)" className="mono">{data[0].day}</text>
      <text x={W - pad} y={H - 3} fontSize={8} fill="var(--fg-2)" textAnchor="end" className="mono">{data[data.length - 1].day}</text>
      <text x={W / 2} y={H - 3} fontSize={8} fill="var(--fg-2)" textAnchor="middle">— all reports · ┈ verified · drag to brush</text>
    </svg>
  );
}

const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
/** Hour × weekday matrix heatmap; click cells to toggle hour/dow filters. */
export function HourDowMatrix({ data, hours, dows, onToggleHour, onToggleDow }: { data: { hour: number; dow: number; n: number }[]; hours: number[]; dows: number[]; onToggleHour: (h: number) => void; onToggleDow: (d: number) => void }) {
  const grid = new Map(data.map((d) => [`${d.dow}-${d.hour}`, d.n]));
  const max = Math.max(1, ...data.map((d) => d.n));
  const cw = 18, ch = 12, ox = 20, oy = 12;
  return (
    <svg viewBox={`0 0 ${ox + 24 * cw + 2} ${oy + 7 * ch + 2}`} className="w-full" style={{ maxHeight: 120 }}>
      {Array.from({ length: 24 }, (_, h) => <text key={h} x={ox + h * cw + cw / 2} y={8} fontSize={7} textAnchor="middle" fill={hours.includes(h) ? "var(--accent)" : "var(--fg-2)"} className="mono cursor-pointer" onClick={() => onToggleHour(h)}>{h}</text>)}
      {DOW.map((d, i) => <text key={d} x={2} y={oy + i * ch + 9} fontSize={7} fill={dows.includes(i) ? "var(--accent)" : "var(--fg-2)"} className="cursor-pointer" onClick={() => onToggleDow(i)}>{d}</text>)}
      {Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => { const n = grid.get(`${d}-${h}`) ?? 0; const dim = (hours.length && !hours.includes(h)) || (dows.length && !dows.includes(d)); return <rect key={`${d}-${h}`} x={ox + h * cw} y={oy + d * ch} width={cw - 1} height={ch - 1} fill={n ? ramp("viridis", n / max) : "var(--bg-3)"} opacity={dim ? 0.25 : 1} className="cursor-pointer" onClick={() => onToggleHour(h)}><title>{`${DOW[d]} ${h}:00 — ${n}`}</title></rect>; }))}
    </svg>
  );
}

/** Horizontal bars; click to toggle selection. */
export function Bars({ items, selected, onToggle, color }: { items: { key: number | string; label: string; n: number; color?: string }[]; selected?: (number | string)[]; onToggle?: (k: number | string) => void; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.n));
  const total = items.reduce((a, i) => a + i.n, 0) || 1;
  return (
    <div className="space-y-[2px]">
      {items.map((i) => { const on = !selected?.length || selected.includes(i.key); return (
        <div key={String(i.key)} className="flex items-center gap-1 text-[10.5px] cursor-pointer" style={{ opacity: on ? 1 : 0.4 }} onClick={() => onToggle?.(i.key)}>
          <span className="w-24 truncate" style={{ color: "var(--fg-1)" }}>{i.label}</span>
          <div className="flex-1 h-[9px] rounded-sm" style={{ background: "var(--bg-3)" }}><div className="h-full rounded-sm" style={{ width: `${(i.n / max) * 100}%`, background: i.color ?? color ?? "var(--accent)" }} /></div>
          <span className="mono w-14 text-right" style={{ color: "var(--fg-2)" }}>{i.n} <span style={{ opacity: 0.6 }}>{((i.n / total) * 100).toFixed(0)}%</span></span>
        </div>); })}
    </div>
  );
}

/** Simple histogram bars */
export function Hist({ bins, color = "var(--accent)" }: { bins: { bin: string; n: number }[]; color?: string }) {
  const max = Math.max(1, ...bins.map((b) => b.n));
  return (<div className="flex items-end gap-[2px] h-14">{bins.map((b) => <div key={b.bin} className="flex-1 flex flex-col items-center justify-end h-full" title={`${b.bin}: ${b.n}`}><div className="w-full rounded-t-sm" style={{ height: `${(b.n / max) * 100}%`, background: color, minHeight: b.n ? 1 : 0 }} /><span className="text-[8px] mono truncate w-full text-center" style={{ color: "var(--fg-2)" }}>{b.bin}</span></div>)}</div>);
}

/** Scatter plot with optional y=x line */
export function Scatter({ pts, xl, yl, identity = false }: { pts: { x: number; y: number; c?: string }[]; xl: string; yl: string; identity?: boolean }) {
  const W = 220, H = 160, pad = 24;
  const mx = Math.max(1e-9, ...pts.map((p) => p.x)), my = Math.max(1e-9, ...pts.map((p) => p.y));
  const m = identity ? Math.max(mx, my) : null;
  const X = (v: number) => pad + (v / (m ?? mx)) * (W - pad - 6), Y = (v: number) => H - pad - (v / (m ?? my)) * (H - pad - 6);
  return (<svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 200 }}>
    <line x1={pad} y1={H - pad} x2={W - 4} y2={H - pad} stroke="var(--line)" /><line x1={pad} y1={4} x2={pad} y2={H - pad} stroke="var(--line)" />
    {identity && <line x1={X(0)} y1={Y(0)} x2={X(m!)} y2={Y(m!)} stroke="var(--fg-2)" strokeDasharray="3 3" strokeWidth={0.7} />}
    {pts.map((p, i) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={2} fill={p.c ?? "var(--accent)"} opacity={0.7} />)}
    <text x={W / 2} y={H - 6} fontSize={8} textAnchor="middle" fill="var(--fg-2)">{xl}</text>
    <text x={8} y={H / 2} fontSize={8} textAnchor="middle" fill="var(--fg-2)" transform={`rotate(-90 8 ${H / 2})`}>{yl}</text>
  </svg>);
}
