"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { BarChart3, BookOpen, FlaskConical, Gauge, LogIn, LogOut, Map as MapIcon, Menu, Moon, Search, ShieldCheck, Sun, TriangleAlert, X } from "lucide-react";
import { useApp } from "./providers";
import { cx, SyntheticBadge } from "./ui";
import { api } from "@/lib/client/api";

const NAV = [
  { href: "/", label: "Explorer", icon: MapIcon },
  { href: "/report", label: "Report", icon: TriangleAlert },
  { href: "/dashboard", label: "Analytics", icon: BarChart3 },
  { href: "/lab", label: "Analysis Lab", icon: FlaskConical },
  { href: "/risk", label: "Risk", icon: Gauge },
  { href: "/admin", label: "Admin", icon: ShieldCheck, admin: true },
  { href: "/methods", label: "Methods & API", icon: BookOpen },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { meta, theme, toggleTheme, reloadMeta, metaError } = useApp();
  const [open, setOpen] = useState(false);
  const user = meta?.user ?? null;
  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    await reloadMeta();
    router.push("/");
  };
  return (
    <div className="flex flex-col h-dvh">
      <header className="h-11 shrink-0 border-b border-line bg-panel flex items-center px-3 gap-3 z-30">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <svg viewBox="0 0 24 24" className="size-5 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 17 9 11l4 4 8-8" />
            <circle cx="9" cy="11" r="1.8" fill="currentColor" />
            <circle cx="13" cy="15" r="1.8" fill="currentColor" />
            <path d="M3 21h18" opacity=".4" />
          </svg>
          <span className="text-[13px] font-semibold tracking-tight">
            Urban Accident <span className="text-accent">Intelligence</span>
          </span>
        </Link>
        <nav className="hidden lg:flex items-center gap-0.5 ml-2">
          {NAV.filter((n) => !n.admin || user?.role === "admin").map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={cx("flex items-center gap-1.5 h-7 px-2.5 rounded-[4px] text-[12.5px] transition-colors", active ? "bg-accent-soft text-accent" : "text-muted hover:text-fg")}>
                <n.icon className="size-3.5" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <SyntheticBadge />
          <Link href="/track" className="hidden sm:flex items-center gap-1 text-[12px] text-muted hover:text-fg" title="Track a report">
            <Search className="size-3.5" /> Track
          </Link>
          <button onClick={toggleTheme} className="size-7 grid place-items-center rounded-[4px] text-muted hover:text-fg hover:bg-panel2" title="Toggle theme" aria-label="Toggle theme">
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          {user ? (
            <div className="flex items-center gap-2">
              <span className="hidden md:block text-[12px] text-muted">
                {user.displayName} <span className="text-faint">· {user.role}</span>
              </span>
              <button onClick={logout} className="size-7 grid place-items-center rounded-[4px] text-muted hover:text-fg hover:bg-panel2" title="Sign out" aria-label="Sign out">
                <LogOut className="size-4" />
              </button>
            </div>
          ) : (
            <Link href={`/login?next=${encodeURIComponent(path)}`} className="flex items-center gap-1 text-[12px] text-muted hover:text-fg">
              <LogIn className="size-3.5" /> Sign in
            </Link>
          )}
          <button className="lg:hidden size-7 grid place-items-center text-muted" onClick={() => setOpen((o) => !o)} aria-label="Menu">
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </header>
      {open && (
        <nav className="lg:hidden border-b border-line bg-panel px-3 py-2 grid grid-cols-2 gap-1 z-30">
          {NAV.filter((n) => !n.admin || user?.role === "admin").map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="flex items-center gap-2 h-8 px-2 rounded-[4px] text-[13px] text-muted hover:text-fg hover:bg-panel2">
              <n.icon className="size-4" />
              {n.label}
            </Link>
          ))}
        </nav>
      )}
      {metaError && <div className="bg-danger/10 border-b border-danger/40 text-[12px] px-3 py-1.5 text-danger">Backend unavailable: {metaError}. The database may still be initialising — retrying on next navigation.</div>}
      <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
    </div>
  );
}
