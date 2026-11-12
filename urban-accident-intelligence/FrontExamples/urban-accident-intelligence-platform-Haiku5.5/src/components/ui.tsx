"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export const inputCls =
  "h-8 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-fg placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-50";
export const textareaCls =
  "w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-[13px] text-fg placeholder:text-faint focus:border-accent focus:outline-none";
export const labelCls = "text-[11px] font-medium uppercase tracking-[0.08em] text-muted";

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("flex min-w-0 flex-col rounded-lg border border-line bg-panel", className)}>
      {title || actions ? (
        <header className="flex min-h-10 items-center justify-between gap-2 border-b border-line px-3 py-2">
          <div className="min-w-0">
            {title ? <h2 className="truncate text-[13px] font-semibold tracking-tight">{title}</h2> : null}
            {subtitle ? <p className="truncate text-[11px] text-muted">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cx("min-w-0 p-3", bodyClassName)}>{children}</div>
    </section>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  busy,
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; busy?: boolean; icon?: ReactNode }) {
  const variantCls: Record<Variant, string> = {
    primary: "bg-accent text-accent-fg hover:brightness-110",
    secondary: "border border-line bg-panel-2 text-fg hover:border-faint",
    ghost: "text-muted hover:bg-panel-2 hover:text-fg",
    danger: "border border-danger/50 text-danger hover:bg-danger/10",
  };
  const sizeCls = size === "sm" ? "h-7 px-2 text-[12px]" : "h-8 px-3 text-[13px]";
  return (
    <button
      type="button"
      disabled={rest.disabled || busy}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variantCls[variant],
        sizeCls,
        className,
      )}
      {...rest}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

type Tone = "neutral" | "accent" | "warn" | "danger" | "ok" | "synthetic" | "muted";

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const map: Record<Tone, string> = {
    neutral: "border-line text-muted",
    accent: "border-accent/40 text-accent",
    warn: "border-warn/50 text-warn",
    danger: "border-danger/50 text-danger",
    ok: "border-ok/50 text-ok",
    synthetic: "border-warn/50 text-warn",
    muted: "border-transparent bg-panel-2 text-muted",
  };
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-px text-[10.5px] font-medium", map[tone], className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone: Tone = status === "verified" ? "ok" : status === "rejected" ? "danger" : status === "duplicate" ? "muted" : "warn";
  const label = status === "reported" ? "Pending review" : status.charAt(0).toUpperCase() + status.slice(1);
  return <Badge tone={tone}>{label}</Badge>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "accent" | "warn" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-panel px-3 py-2.5">
      <span className="truncate text-[11px] uppercase tracking-[0.08em] text-muted">{label}</span>
      <span
        className={cx(
          "font-mono text-xl font-semibold tabular-nums leading-none",
          tone === "accent" && "text-accent",
          tone === "warn" && "text-warn",
        )}
      >
        {value}
      </span>
      {hint ? <span className="truncate text-[11px] text-faint">{hint}</span> : null}
    </div>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1", className)}>
      <span className={labelCls}>{label}</span>
      {children}
      {error ? <span className="text-[11px] text-danger">{error}</span> : hint ? <span className="text-[11px] text-faint">{hint}</span> : null}
    </label>
  );
}

export function Chip({
  active,
  onClick,
  children,
  color,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  color?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cx(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11.5px] transition-colors",
        active ? "border-accent/60 bg-accent/10 text-fg" : "border-line text-muted hover:border-faint hover:text-fg",
      )}
    >
      {color ? <span className="size-2 rounded-full" style={{ background: color }} /> : null}
      {children}
    </button>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex max-w-full flex-wrap rounded-md border border-line bg-canvas p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className={cx(
            "rounded px-2 font-medium transition-colors",
            size === "sm" ? "h-6 text-[11.5px]" : "h-7 text-[12px]",
            o.value === value ? "bg-panel-2 text-fg shadow-sm" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Alert({ tone = "info", title, children }: { tone?: "info" | "warn" | "error" | "ok"; title?: ReactNode; children?: ReactNode }) {
  const map = {
    info: { cls: "border-line bg-panel-2 text-fg", icon: <Info size={14} className="text-accent" /> },
    warn: { cls: "border-warn/40 bg-warn/5 text-fg", icon: <AlertTriangle size={14} className="text-warn" /> },
    error: { cls: "border-danger/40 bg-danger/5 text-fg", icon: <XCircle size={14} className="text-danger" /> },
    ok: { cls: "border-ok/40 bg-ok/5 text-fg", icon: <CheckCircle2 size={14} className="text-ok" /> },
  }[tone];
  return (
    <div className={cx("flex gap-2 rounded-md border px-3 py-2 text-[12.5px]", map.cls)} role={tone === "error" ? "alert" : undefined}>
      <span className="mt-0.5 shrink-0">{map.icon}</span>
      <div className="min-w-0">
        {title ? <div className="font-semibold">{title}</div> : null}
        {children ? <div className="text-muted">{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      {icon ? <div className="text-faint">{icon}</div> : null}
      <p className="text-[13px] font-medium">{title}</p>
      {children ? <div className="max-w-sm text-[12px] text-muted">{children}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12px] text-muted">
      <Loader2 size={13} className="animate-spin" /> {label ?? "Loading…"}
    </span>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${Math.max(3, Math.round(value * 100))}%` }} />
    </div>
  );
}

export function KeyValue({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 truncate text-right font-mono tabular-nums text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className={labelCls}>{children}</h3>
      {right}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 pb-3 pt-4">
      <div className="min-w-0">
        <h1 className="text-[17px] font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-0.5 max-w-3xl text-[12px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
