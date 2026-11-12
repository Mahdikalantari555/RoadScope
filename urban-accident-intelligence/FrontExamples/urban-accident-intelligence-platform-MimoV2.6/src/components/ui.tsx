"use client";

/** Console UI primitives — square-cornered plates, hairline rules, mono figures. */

import React from "react";

export function MicroLabel({
  children,
  rule = true,
  className = "",
}: {
  children: React.ReactNode;
  rule?: boolean;
  className?: string;
}) {
  return <div className={`micro ${rule ? "micro-rule" : ""} ${className}`}>{children}</div>;
}

export function Panel({
  title,
  meta,
  children,
  className = "",
  bodyClass = "",
  actions,
}: {
  title?: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClass?: string;
  actions?: React.ReactNode;
}) {
  return (
    <section className={`panel flex min-h-0 flex-col ${className}`}>
      {title && (
        <header className="flex items-center gap-3 border-b border-[var(--rule)] px-3 py-2">
          <span className="micro text-[var(--text-2)]">{title}</span>
          <span className="h-px flex-1 bg-[var(--rule)]" />
          {meta}
          {actions}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "danger" | "cyan";
  active?: boolean;
  icon?: React.ReactNode;
};

export function Btn({
  variant = "outline",
  active = false,
  icon,
  children,
  className = "",
  ...rest
}: BtnProps) {
  const base =
    "inline-flex items-center justify-center gap-2 px-3 h-8 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed select-none";
  const styles: Record<string, string> = {
    primary: "bg-[var(--amber)] text-[#12171c] hover:bg-[var(--amber-light)]",
    cyan: "bg-[var(--cyan)] text-[#0b0e11] hover:opacity-85",
    outline:
      "border border-[var(--rule-strong)] text-[var(--text-2)] hover:text-[var(--text)] hover:border-[var(--amber)]",
    ghost: "text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--panel-3)]",
    danger: "border border-[var(--fatal)] text-[var(--fatal)] hover:bg-[var(--fatal)] hover:text-white",
  };
  return (
    <button
      className={`${base} ${styles[variant]} ${active ? "!text-[var(--amber)] !border-[var(--amber)]" : ""} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function Chip({
  active,
  onClick,
  children,
  colour,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  colour?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 border px-2 py-1 text-[10px] uppercase tracking-[0.09em] transition-colors duration-150"
      style={{
        borderColor: active ? (colour ?? "var(--amber)") : "var(--rule)",
        color: active ? (colour ?? "var(--amber)") : "var(--text-3)",
        background: active ? `color-mix(in srgb, ${colour ?? "var(--amber)"} 12%, transparent)` : "transparent",
      }}
    >
      {colour && (
        <span
          className="inline-block h-2 w-2"
          style={{ background: active ? (colour ?? "var(--amber)") : "var(--text-3)" }}
        />
      )}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
  error,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <label className="block">
      <span className="micro mb-1.5 block">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[10px] text-[var(--fatal)]">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[10px] text-[var(--text-3)]">{hint}</span>
      ) : null}
    </label>
  );
}

const inputClass =
  "w-full h-8 bg-[var(--panel-2)] border border-[var(--rule-strong)] px-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--amber)] transition-colors font-[IBM_Plex_Mono,monospace]";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full bg-[var(--panel-2)] border border-[var(--rule-strong)] p-2 text-[12px] leading-relaxed text-[var(--text)] outline-none focus:border-[var(--amber)] transition-colors ${props.className ?? ""}`}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputClass} appearance-none cursor-pointer ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between py-1.5 text-left"
    >
      <span className="text-[11px] text-[var(--text-2)]">{label}</span>
      <span
        className="relative h-4 w-8 border transition-colors duration-150"
        style={{
          borderColor: checked ? "var(--amber)" : "var(--rule-strong)",
          background: checked ? "color-mix(in srgb, var(--amber) 22%, transparent)" : "transparent",
        }}
      >
        <span
          className="absolute top-[1px] h-[12px] w-[12px] transition-all duration-150"
          style={{
            left: checked ? "17px" : "1px",
            background: checked ? "var(--amber)" : "var(--text-3)",
          }}
        />
      </span>
    </button>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="py-1.5">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="micro">{label}</span>
        <span className="tnum text-[11px] text-[var(--amber)]">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  compact = false,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint?: string }[];
  compact?: boolean;
}) {
  return (
    <div className="flex flex-col gap-px bg-[var(--rule)]">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`flex items-center gap-2 px-2.5 text-left transition-colors duration-150 ${
              compact ? "h-7" : "h-9"
            }`}
            style={{
              background: active ? "var(--panel-3)" : "var(--panel)",
              borderLeft: `2px solid ${active ? "var(--amber)" : "transparent"}`,
            }}
          >
            <span
              className="text-[11px] font-semibold"
              style={{ color: active ? "var(--amber)" : "var(--text-2)" }}
            >
              {o.label}
            </span>
            {o.hint && (
              <span className="ml-auto truncate text-[9px] uppercase tracking-[0.1em] text-[var(--text-3)]">
                {o.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Stat({
  label,
  value,
  unit,
  tone = "default",
  sub,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  tone?: "default" | "amber" | "cyan" | "fatal" | "warn";
  sub?: string;
}) {
  const colours: Record<string, string> = {
    default: "var(--text)",
    amber: "var(--amber)",
    cyan: "var(--cyan)",
    fatal: "var(--fatal)",
    warn: "var(--warn)",
  };
  return (
    <div className="border-b border-r border-[var(--rule)] px-3 py-2.5">
      <div className="micro mb-1.5">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="tnum text-[21px] leading-none" style={{ color: colours[tone] }}>
          {value}
        </span>
        {unit && <span className="text-[10px] text-[var(--text-3)]">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-[10px] text-[var(--text-3)]">{sub}</div>}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "amber" | "cyan" | "fatal" | "warn" | "ok";
}) {
  const map: Record<string, string> = {
    neutral: "var(--text-3)",
    amber: "var(--amber)",
    cyan: "var(--cyan)",
    fatal: "var(--fatal)",
    warn: "var(--warn)",
    ok: "var(--ok)",
  };
  return (
    <span
      className="inline-flex items-center gap-1 border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em]"
      style={{ borderColor: map[tone], color: map[tone] }}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  detail,
  icon,
}: {
  title: string;
  detail?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[140px] flex-col items-center justify-center gap-2 px-6 text-center">
      {icon && <div className="text-[var(--text-3)]">{icon}</div>}
      <div className="micro text-[var(--text-2)]">{title}</div>
      {detail && <p className="max-w-[320px] text-[11px] leading-relaxed text-[var(--text-3)]">{detail}</p>}
    </div>
  );
}

export function LoadingBar({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <div className="sweep relative h-[3px] w-24 overflow-hidden bg-[var(--rule)]" />
      <span className="micro">{label}</span>
    </div>
  );
}

/** Ruled data table — the Bloomberg-density treatment used across LAB / RISK. */
export function DataTable({
  columns,
  rows,
  onRowClick,
  activeKey,
  maxHeight = 320,
}: {
  columns: { key: string; label: string; align?: "left" | "right"; width?: string }[];
  rows: Record<string, React.ReactNode>[];
  onRowClick?: (row: Record<string, React.ReactNode>, index: number) => void;
  activeKey?: string | number | null;
  maxHeight?: number;
}) {
  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-[var(--panel-2)]">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className="micro border-b border-[var(--rule-strong)] px-2 py-1.5 text-left font-normal"
                style={{ width: c.width, textAlign: c.align ?? "left" }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const key = (row.__key as string | number) ?? i;
            const active = activeKey != null && activeKey === key;
            return (
              <tr
                key={i}
                onClick={() => onRowClick?.(row, i)}
                className={`border-b border-[var(--rule)] transition-colors duration-100 ${
                  onRowClick ? "cursor-pointer" : ""
                }`}
                style={{ background: active ? "var(--panel-3)" : "transparent" }}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className="tnum px-2 py-1.5 text-[11px] text-[var(--text-2)]"
                    style={{ textAlign: c.align ?? "left" }}
                  >
                    {row[c.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
