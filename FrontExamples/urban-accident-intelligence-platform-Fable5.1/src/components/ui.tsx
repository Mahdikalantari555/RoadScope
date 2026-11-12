"use client";
import type { ReactNode } from "react";
import { rampStops, type RampName } from "@/lib/colors";

export function Panel({ title, right, children, className = "", bodyClass = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`panel flex flex-col min-h-0 ${className}`}>
      {title !== undefined && <header className="panel-h"><span>{title}</span>{right}</header>}
      <div className={`p-2 min-h-0 ${bodyClass}`}>{children}</div>
    </section>
  );
}
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : tone === "bad" ? "var(--bad)" : "var(--fg)";
  return (<div className="px-2 py-1"><div className="lbl">{label}</div><div className="mono text-base leading-tight" style={{ color }}>{value}</div>{sub && <div className="text-[10px]" style={{ color: "var(--fg-2)" }}>{sub}</div>}</div>);
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (<label className="block"><div className="lbl mb-0.5">{label}</div>{children}{hint && <div className="text-[10px] mt-0.5" style={{ color: "var(--fg-2)" }}>{hint}</div>}</label>);
}
export function Slider({ label, value, min, max, step, onChange, unit = "" }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; unit?: string }) {
  return (<div><div className="flex justify-between"><span className="lbl">{label}</span><span className="mono text-[11px]">{value}{unit}</span></div><input type="range" className="w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /></div>);
}
export function RampLegend({ name, min, max, label, unit = "", mid }: { name: RampName; min: number; max: number; label: string; unit?: string; mid?: string }) {
  const stops = rampStops(name, 10);
  return (
    <div className="text-[10px]" style={{ color: "var(--fg-1)" }}>
      <div className="mb-0.5">{label}</div>
      <div className="h-2 rounded-sm" style={{ background: `linear-gradient(90deg, ${stops.join(",")})` }} />
      <div className="flex justify-between mono"><span>{fmt(min)}{unit}</span>{mid && <span>{mid}</span>}<span>{fmt(max)}{unit}</span></div>
    </div>
  );
}
export function Swatches({ items }: { items: { color: string; label: string; shape?: "line" | "dot" | "box" }[] }) {
  return (<div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]" style={{ color: "var(--fg-1)" }}>{items.map((i) => (<span key={i.label} className="flex items-center gap-1">{i.shape === "dot" ? <span className="inline-block w-2 h-2 rounded-full" style={{ background: i.color }} /> : i.shape === "box" ? <span className="inline-block w-3 h-2" style={{ background: i.color }} /> : <span className="inline-block w-4 h-[3px]" style={{ background: i.color }} />}{i.label}</span>))}</div>);
}
export function fmt(v: number | null | undefined, d = 2) { if (v === null || v === undefined || !isFinite(v)) return "—"; if (Math.abs(v) >= 1000) return v.toFixed(0); if (Math.abs(v) >= 100) return v.toFixed(1); return v.toFixed(d); }
export function SyntheticTag({ kind }: { kind?: string }) { return kind === "synthetic" ? <span className="tag tag-syn">SYNTHETIC DATA</span> : kind ? <span className="tag">EMPIRICAL</span> : null; }
export function Spinner({ label = "computing…" }: { label?: string }) { return <span className="text-[11px] animate-pulse" style={{ color: "var(--accent)" }}>{label}</span>; }
export function Math_({ children }: { children: ReactNode }) { return <div className="mono text-[11px] px-2 py-1 my-1 rounded" style={{ background: "var(--bg-2)", color: "var(--fg-1)", overflowX: "auto" }}>{children}</div>; }
