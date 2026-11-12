"use client";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, Info, Loader2 } from "lucide-react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Panel({ title, actions, children, className, bodyClass, subtitle }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cx("border border-line bg-panel rounded-[4px] flex flex-col min-w-0", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 min-h-[36px]">
          <div className="min-w-0">
            <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted truncate">{title}</h3>
            {subtitle && <p className="text-[11px] text-faint truncate">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cx("p-3 min-h-0", bodyClass)}>{children}</div>
    </section>
  );
}

type Variant = "primary" | "ghost" | "outline" | "danger" | "ok";
export function Button({ variant = "outline", size = "sm", loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "xs" | "sm" | "md"; loading?: boolean }) {
  const v: Record<Variant, string> = {
    primary: "bg-accent text-[#04201d] dark:text-[#04201d] border-accent hover:brightness-110 font-semibold",
    ghost: "border-transparent text-muted hover:text-fg hover:bg-panel2",
    outline: "border-line-strong text-fg hover:border-accent hover:text-accent bg-panel",
    danger: "border-danger/60 text-danger hover:bg-danger/10",
    ok: "border-ok/60 text-ok hover:bg-ok/10",
  };
  const s = { xs: "h-6 px-2 text-[11px]", sm: "h-7 px-2.5 text-[12px]", md: "h-9 px-4 text-[13px]" }[size];
  return (
    <button {...rest} disabled={rest.disabled || loading} className={cx("inline-flex items-center justify-center gap-1.5 rounded-[4px] border transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap", v[variant], s, className)}>
      {loading && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function Chip({ active, onClick, color, children, title }: { active: boolean; onClick: () => void; color?: string; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1.5 h-6 px-2 rounded-[3px] border text-[11px] transition-colors",
        active ? "border-accent/70 bg-accent-soft text-fg" : "border-line text-muted hover:text-fg hover:border-line-strong",
      )}
    >
      {color && <span className="size-2 rounded-full shrink-0" style={{ background: color }} />}
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = "sm" }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: "xs" | "sm" }) {
  return (
    <div className="inline-flex border border-line rounded-[4px] overflow-hidden bg-panel2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(size === "xs" ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-[12px]", "border-r border-line last:border-r-0 transition-colors", value === o.value ? "bg-accent-soft text-accent font-medium" : "text-muted hover:text-fg")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "accent" | "warn" | "danger" | "ok" }) {
  const t = tone ? { accent: "text-accent", warn: "text-warn", danger: "text-danger", ok: "text-ok" }[tone] : "text-fg";
  return (
    <div className="min-w-0">
      <div className="label truncate">{label}</div>
      <div className={cx("num text-[20px] leading-7 font-semibold", t)}>{value}</div>
      {sub && <div className="text-[11px] text-faint truncate">{sub}</div>}
    </div>
  );
}

export function Badge({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-[3px] border px-1.5 h-[18px] text-[10.5px] font-medium whitespace-nowrap", className)} style={color ? { borderColor: `${color}66`, color, background: `${color}14` } : undefined}>
      {children}
    </span>
  );
}

export function SyntheticBadge() {
  return (
    <Badge color="#f5a524" className="uppercase tracking-wider">
      Synthetic data
    </Badge>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="label block mb-1">{label}</span>
      {children}
      {error ? <span className="block text-[11px] text-danger mt-1">{error}</span> : hint ? <span className="block text-[11px] text-faint mt-1">{hint}</span> : null}
    </label>
  );
}

export function Notice({ tone = "info", children, className }: { tone?: "info" | "warn" | "danger"; children: ReactNode; className?: string }) {
  const c = { info: "border-accent/30 bg-accent-soft text-fg", warn: "border-warn/40 bg-warn/10 text-fg", danger: "border-danger/40 bg-danger/10 text-fg" }[tone];
  const Icon = tone === "info" ? Info : AlertTriangle;
  const ic = { info: "text-accent", warn: "text-warn", danger: "text-danger" }[tone];
  return (
    <div className={cx("flex gap-2 rounded-[4px] border px-2.5 py-2 text-[12px] leading-snug", c, className)}>
      <Icon className={cx("size-3.5 mt-0.5 shrink-0", ic)} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-muted">
      <Loader2 className="size-4 animate-spin text-accent" />
      {label}
    </div>
  );
}

export function LoadingBar({ active }: { active: boolean }) {
  if (!active) return null;
  return <div className="loading-bar relative h-[2px] w-full overflow-hidden bg-accent-soft" />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-8 px-4 text-muted">
      <div className="text-[13px] font-medium text-fg">{title}</div>
      {children && <div className="text-[12px] mt-1 max-w-sm">{children}</div>}
    </div>
  );
}

export function Explain({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-line rounded-[4px] bg-panel2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-2.5 py-1.5 text-[11.5px] text-muted hover:text-fg">
        <span className="flex items-center gap-1.5">
          <Info className="size-3.5 text-accent" />
          {title}
        </span>
        <span className="text-faint">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="px-2.5 pb-2.5 text-[12px] leading-relaxed text-muted space-y-1.5">{children}</div>}
    </div>
  );
}

export function KV({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px] border-b border-line/60 last:border-0 text-[12px]">
      <span className="text-muted">{k}</span>
      <span className="num text-fg text-right">{v}</span>
    </div>
  );
}
