"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BarChart3, Database, FileJson, FlaskConical, LogIn, LogOut, Map as MapIcon, MapPin, Moon, ShieldAlert, ShieldCheck, Sun } from "lucide-react";
import { useApp } from "./AppProvider";

const NAV = [
  { href: "/explorer", label: "Explorer", icon: MapIcon },
  { href: "/report", label: "Report", icon: MapPin },
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/lab", label: "Spatial lab", icon: FlaskConical },
  { href: "/risk", label: "Risk", icon: ShieldAlert },
  { href: "/admin", label: "Review", icon: ShieldCheck },
  { href: "/data", label: "Datasets", icon: Database },
  { href: "/api-docs", label: "API", icon: FileJson },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, isAdmin, theme, toggleTheme, logout, meta } = useApp();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
        <Link href="/explorer" className="flex items-center gap-2 pr-2 text-[13px] font-semibold tracking-tight">
          <span className="grid size-6 place-items-center rounded-[5px] bg-accent text-accent-fg">
            <MapIcon size={14} strokeWidth={2.4} />
          </span>
          <span className="hidden sm:inline">Urban Accident Intelligence</span>
          <span className="sm:hidden">UAI</span>
        </Link>
        <nav className="scroll-thin flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors ${
                  active ? "bg-panel-2 text-fg shadow-[inset_0_-2px_0_var(--c-accent)]" : "text-muted hover:text-fg"
                }`}
              >
                <Icon size={13} strokeWidth={2} />
                <span className="hidden md:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <span
          className="hidden shrink-0 items-center gap-1.5 rounded border border-warn/50 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-warn lg:inline-flex"
          title={meta?.study.disclaimer ?? "Synthetic demonstration data"}
        >
          <span className="size-1.5 rounded-full bg-warn" />
          SYNTHETIC DATA
        </span>
        <button
          type="button"
          onClick={toggleTheme}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-panel-2 hover:text-fg"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        {user ? (
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden text-[12px] text-muted md:inline">
              {user.displayName}
              {isAdmin ? <span className="ml-1.5 rounded bg-accent/15 px-1 text-[10px] font-semibold uppercase text-accent">admin</span> : null}
            </span>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] text-muted hover:text-fg"
            >
              <LogOut size={12} /> <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-line px-2 text-[12px] text-muted hover:text-fg"
          >
            <LogIn size={12} /> Sign in
          </Link>
        )}
      </header>
      <main className="flex min-h-0 flex-1 flex-col overflow-auto scroll-thin">{children}</main>
    </div>
  );
}
