"use client";

import type { ReactNode } from "react";

export function Panel({
  title,
  subtitle,
  right,
  children,
  className = "",
  bodyClass = "",
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`panel flex min-h-0 flex-col ${className}`}>
      {(title || right) && (
        <header className="panel-head">
          <div className="min-w-0">
            <h2 className="panel-title truncate">{title}</h2>
            {subtitle && <p className="truncate text-[10px] text-[var(--text-mute)]">{subtitle}</p>}
          </div>
          {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, unit, hint, tone = "default" }: { label: string; value: string | number; unit?: string; hint?: string; tone?: "default" | "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "var(--accent-2)" : tone === "warn" ? "var(--warn)" : tone === "bad" ? "var(--danger)" : "var(--text)";
  return (
    <div className="panel px-2.5 py-2">
      <div className="text-[9.5px] uppercase tracking-[0.09em] text-[var(--text-mute)]">{label}</div>
      <div className="kpi-value" style={{ color }}>
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-[var(--text-mute)]">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-[10px] leading-tight text-[var(--text-mute)]">{hint}</div>}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  unit,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  unit?: string;
  format?: (v: number) => string;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.07em] text-[var(--text-mute)]">{label}</span>
        <span className="mono text-[11px] text-[var(--text)]">
          {format ? format(value) : value}
          {unit && <span className="ml-0.5 text-[9.5px] text-[var(--text-mute)]">{unit}</span>}
        </span>
      </div>
      <input type="range" className="mt-1 w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.07em] text-[var(--text-mute)]">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <div className="mt-0.5 text-[9.5px] leading-tight text-[var(--text-mute)]">{hint}</div>}
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-2 py-1 text-left" title={hint}>
      <span className="text-[11px] text-[var(--text-dim)]">{label}</span>
      <span
        className="relative inline-block h-3.5 w-7 shrink-0 rounded-full border transition-colors"
        style={{ background: checked ? "var(--accent)" : "var(--panel-2)", borderColor: checked ? "var(--accent)" : "var(--border-strong)" }}
      >
        <span
          className="absolute top-[1px] h-2.5 w-2.5 rounded-full transition-all"
          style={{ left: checked ? 14 : 2, background: checked ? "#04121a" : "var(--text-mute)" }}
        />
      </span>
    </button>
  );
}

export function Select<T extends string>({ label, value, options, onChange, hint }: { label?: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; hint?: string }) {
  const control = (
    <select className="w-full" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  return label ? <Field label={label} hint={hint}>{control}</Field> : control;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "info" }) {
  const map: Record<string, string> = {
    neutral: "var(--text-mute)",
    good: "var(--accent-2)",
    warn: "var(--warn)",
    bad: "var(--danger)",
    info: "var(--accent)",
  };
  return (
    <span className="badge" style={{ borderColor: map[tone], color: map[tone] }}>
      {children}
    </span>
  );
}

export function ProgressBar({ value, label, stage }: { value: number; label?: string; stage?: string }) {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-[10px] text-[var(--text-mute)]">
        <span className="mono uppercase tracking-[0.06em]">{stage ?? label ?? ""}</span>
        <span className="mono">{Math.round(value * 100)}%</span>
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-sm" style={{ background: "var(--border)" }}>
        <div className="h-full transition-all duration-200" style={{ width: `${Math.min(100, value * 100)}%`, background: "var(--accent)" }} />
      </div>
    </div>
  );
}

export function FormulaBlock({ title, latex, notes }: { title: string; latex: string; notes: string[] }) {
  return (
    <div className="border-l-2 pl-3" style={{ borderColor: "var(--accent)" }}>
      <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-mute)]">{title}</div>
      <div className="latex mt-1 overflow-x-auto text-[13px] text-[var(--text)]">{latex}</div>
      <ul className="mt-2 space-y-1">
        {notes.map((n, i) => (
          <li key={i} className="text-[11px] leading-snug text-[var(--text-dim)]">
            <span className="mr-1 text-[var(--text-mute)]">▸</span>
            {n}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AssumptionList({ items }: { items: Array<{ name: string; passed: boolean; detail: string; value: number }> }) {
  return (
    <ul className="space-y-1.5">
      {items.map((a) => (
        <li key={a.name} className="flex gap-2 text-[11px]">
          <span className="mono mt-[1px] shrink-0" style={{ color: a.passed ? "var(--accent-2)" : "var(--danger)" }}>
            {a.passed ? "PASS" : "FAIL"}
          </span>
          <span className="min-w-0">
            <span className="mono text-[var(--text)]">{a.name}</span>
            <span className="block leading-snug text-[var(--text-mute)]">{a.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Empty({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-1 p-6 text-center">
      <div className="text-[12px] text-[var(--text-dim)]">{message}</div>
      {hint && <div className="max-w-md text-[10.5px] leading-snug text-[var(--text-mute)]">{hint}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, active, onChange }: { tabs: Array<{ value: T; label: string }>; active: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-0 border-b" style={{ borderColor: "var(--border)" }}>
      {tabs.map((t) => (
        <button key={t.value} type="button" className={`tab ${active === t.value ? "active" : ""}`} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
