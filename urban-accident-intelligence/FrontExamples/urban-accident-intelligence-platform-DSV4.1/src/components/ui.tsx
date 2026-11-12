import type { ReactNode } from "react";
import { AlertTriangle, Info, Loader2 } from "lucide-react";

export function Panel({
  title,
  icon,
  actions,
  children,
  className = "",
  bodyClassName = "panel-body",
  flush = false,
}: {
  title?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  flush?: boolean;
}) {
  return (
    <section className={`${flush ? "panel-flush" : "panel"} ${className}`}>
      {title && (
        <header className="panel-header">
          <div className="panel-title">
            {icon}
            <span>{title}</span>
          </div>
          {actions}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function Kpi({
  label,
  value,
  detail,
  tone = "default",
  icon,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "default" | "accent" | "warn" | "danger" | "ok";
  icon?: ReactNode;
}) {
  const color =
    tone === "accent" ? "text-accent" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : tone === "ok" ? "text-ok" : "text-ink";
  return (
    <div className="panel px-2.5 py-2">
      <div className="flex items-center justify-between gap-1">
        <span className="kpi-label">{label}</span>
        {icon}
      </div>
      <div className={`kpi-value mt-1 ${color}`}>{value}</div>
      {detail && <div className="mt-0.5 text-[10.5px] leading-tight text-faint">{detail}</div>}
    </div>
  );
}

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "accent" | "warn" | "danger" | "ok" }) {
  const cls = tone === "accent" ? "badge badge-accent" : tone === "warn" ? "badge badge-warn" : tone === "danger" ? "badge badge-danger" : tone === "ok" ? "badge badge-ok" : "badge";
  return <span className={cls}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone = status === "verified" ? "ok" : status === "reported" ? "warn" : status === "duplicate" ? "accent" : "default";
  return <Badge tone={tone as "ok" | "warn" | "accent" | "default"}>{status}</Badge>;
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="label-caps mb-1 block">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[10.5px] text-danger">{error}</span> : hint ? <span className="mt-1 block text-[10.5px] text-faint">{hint}</span> : null}
    </label>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <span className="label-caps">{children}</span>
      {right}
    </div>
  );
}

export function Callout({ tone = "info", title, children }: { tone?: "info" | "warn" | "danger"; title?: string; children: ReactNode }) {
  const border = tone === "warn" ? "border-l-warn" : tone === "danger" ? "border-l-danger" : "border-l-accent";
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <div className={`border border-line ${border} border-l-2 bg-panel2 px-2.5 py-2`}>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-ink">
        <Icon size={12} className={tone === "info" ? "text-accent" : tone === "warn" ? "text-warn" : "text-danger"} />
        {title}
      </div>
      <div className="text-[11px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

export function MetricGrid({ metrics, columns = 2 }: { metrics: { label: string; value: ReactNode; detail?: string }[]; columns?: number }) {
  return (
    <div className="grid gap-px overflow-hidden rounded border border-line bg-line" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {metrics.map((metric) => (
        <div key={metric.label} className="bg-panel px-2 py-1.5">
          <div className="text-[9.5px] uppercase tracking-wide text-faint">{metric.label}</div>
          <div className="mono mt-0.5 text-[12.5px] font-medium text-ink">{metric.value}</div>
          {metric.detail && <div className="text-[9.5px] text-faint">{metric.detail}</div>}
        </div>
      ))}
    </div>
  );
}

export function CoverageBar({ label, value, hint }: { label: string; value: number; hint?: string }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  const tone = pct >= 85 ? "var(--ok)" : pct >= 60 ? "var(--warn)" : "var(--danger)";
  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] text-muted">{label}</span>
        <span className="mono text-[10.5px] text-ink">{pct.toFixed(1)}%</span>
      </div>
      <div className="progress">
        <span style={{ width: `${pct}%`, background: tone }} />
      </div>
      {hint && <div className="mt-0.5 text-[9.5px] text-faint">{hint}</div>}
    </div>
  );
}

export function EmptyState({ title, message, icon }: { title: string; message: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-8 text-center">
      <div className="text-faint">{icon}</div>
      <div className="text-[12.5px] font-medium text-ink">{title}</div>
      <div className="max-w-[320px] text-[11px] leading-relaxed text-faint">{message}</div>
    </div>
  );
}

export function LoadingRows({ rows = 4, height = 26 }: { rows?: number; height?: number }) {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
      <Loader2 size={12} className="animate-spin text-accent" />
      {label}
    </span>
  );
}

export function SeverityDot({ severity }: { severity: number }) {
  const color = severity === 4 ? "#e5402a" : severity === 3 ? "#f2762e" : severity === 2 ? "#e3b341" : "#7d8fa3";
  return <span className="inline-block h-2 w-2 flex-none rounded-full" style={{ background: color }} />;
}

export function ToggleChip({
  active,
  onClick,
  children,
  disabled = false,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="chip focus-ring"
      data-active={active}
      data-disabled={disabled}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

export function Divider({ label }: { label?: string }) {
  if (!label) return <div className="my-2 border-t border-line" />;
  return (
    <div className="my-2 flex items-center gap-2">
      <div className="h-px flex-1 bg-line" />
      <span className="label-caps">{label}</span>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}
