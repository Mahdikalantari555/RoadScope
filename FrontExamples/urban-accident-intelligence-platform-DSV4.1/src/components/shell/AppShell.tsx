"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  ClipboardCheck,
  FlaskConical,
  Layers,
  LogIn,
  LogOut,
  Menu,
  PlusCircle,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import type { Session } from "@/lib/auth";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/", label: "Explorer", icon: Layers, description: "Map & layers" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, description: "Dashboard" },
  { href: "/report", label: "Report", icon: PlusCircle, description: "Citizen submission" },
  { href: "/lab", label: "Spatial Lab", icon: FlaskConical, description: "Statistics" },
  { href: "/risk", label: "Risk", icon: ShieldAlert, description: "Segment index" },
  { href: "/admin", label: "Moderation", icon: ClipboardCheck, description: "Data quality" },
  { href: "/track", label: "Track", icon: Search, description: "Report status" },
  { href: "/about", label: "Methods", icon: BookOpen, description: "Documentation" },
];

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-3 py-3.5 focus-ring">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="1" y="1" width="30" height="30" rx="3" fill="var(--panel-2)" stroke="var(--line-strong)" />
        <path d="M6 24 L14 8 L18 16 L26 6" stroke="var(--accent)" strokeWidth="2" fill="none" strokeLinecap="square" />
        <circle cx="18" cy="16" r="2.6" fill="var(--accent)" />
        <path d="M4 27 H28" stroke="var(--line-strong)" strokeWidth="1" />
      </svg>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold tracking-[0.14em] uppercase leading-tight text-ink">
          Urban Accident
        </div>
        <div className="text-[10px] tracking-[0.24em] uppercase text-faint leading-tight">Intelligence</div>
      </div>
    </Link>
  );
}

export function AppShell({ session, children }: { session: Session | null; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  };

  const nav = (
    <nav className="flex flex-col gap-0.5 px-2">
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={`group flex items-center gap-2.5 rounded-[3px] px-2.5 py-2 transition-colors focus-ring ${
              active
                ? "bg-[var(--accent-soft)] text-accent"
                : "text-muted hover:bg-panel2 hover:text-ink"
            }`}
          >
            <Icon size={15} strokeWidth={1.8} className={active ? "text-accent" : "text-faint group-hover:text-muted"} />
            <span className="flex-1">
              <span className="block text-[12.5px] font-medium leading-tight">{item.label}</span>
              <span className="block text-[10px] leading-tight text-faint">{item.description}</span>
            </span>
            {active && <span className="h-4 w-[2px] rounded bg-accent" />}
          </Link>
        );
      })}
    </nav>
  );

  const sessionBlock = (
    <div className="border-t border-line p-2.5">
      {session ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[11.5px] font-medium text-ink">{session.name}</div>
              <div className="truncate text-[10px] text-faint">{session.email}</div>
            </div>
            <span className={`badge ${session.role === "admin" ? "badge-warn" : session.role === "analyst" ? "badge-accent" : ""}`}>
              {session.role}
            </span>
          </div>
          <button type="button" onClick={signOut} className="btn btn-xs w-full">
            <LogOut size={11} /> Sign out
          </button>
        </div>
      ) : (
        <Link href="/login" className="btn btn-xs w-full" onClick={() => setOpen(false)}>
          <LogIn size={11} /> Sign in (demo roles)
        </Link>
      )}
      <div className="mt-2 flex items-center justify-between gap-1 rounded border border-line bg-panel2 px-2 py-1.5">
        <div>
          <div className="label-caps">Dataset</div>
          <div className="mono text-[10.5px] text-warn">SYNTHETIC · seed 20260117</div>
        </div>
        <ThemeToggle compact />
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[212px] flex-none flex-col justify-between border-r border-line bg-panel md:flex">
        <div className="flex flex-1 flex-col overflow-y-auto scroll-thin">
          <Brand />
          <div className="mb-2 border-y border-line px-3 py-1.5">
            <span className="label-caps">Workspace</span>
          </div>
          {nav}
        </div>
        {sessionBlock}
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 flex-none items-center justify-between gap-3 border-b border-line bg-[color-mix(in_oklab,var(--surface)_92%,transparent)] px-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost md:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-label="Toggle navigation"
            >
              {open ? <X size={16} /> : <Menu size={16} />}
            </button>
            <div className="md:hidden">
              <Brand />
            </div>
            <div className="hidden items-center gap-2 md:flex">
              <span className="badge badge-accent">Web-GIS</span>
              <span className="badge">Vantia · synthetic study area</span>
              <span className="text-[10.5px] text-faint">Spatial statistics · crowdsourced reporting · risk screening</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Link href="/report" className="btn btn-primary btn-xs hidden sm:inline-flex">
              <PlusCircle size={12} /> Report incident
            </Link>
            <Link href="/track" className="btn btn-xs hidden lg:inline-flex">
              <Search size={12} /> Track
            </Link>
            <div className="md:hidden">
              <ThemeToggle compact />
            </div>
            <Link href="/about" className="btn btn-ghost btn-xs" aria-label="Methods and limitations">
              <BookOpen size={14} />
            </Link>
          </div>
        </header>

        {open && (
          <div className="border-b border-line bg-panel p-2 md:hidden">
            {nav}
            <div className="mt-2">{sessionBlock}</div>
          </div>
        )}

        <main className="min-h-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
