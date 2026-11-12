"use client";

/** Console shell: 56 px icon rail + persistent status strip. */

import React, { useEffect, useState } from "react";
import {
  BarChart3,
  FilePlus2,
  FlaskConical,
  Gauge,
  Map as MapIcon,
  Moon,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { useApp, AppStateProvider, type TrafficEntry, type ViewKey } from "@/lib/appState";
import type { Accident, RoadSegment } from "@/lib/types";
import ExplorerView from "@/components/views/ExplorerView";
import ReportView from "@/components/views/ReportView";
import AnalyticsView from "@/components/views/AnalyticsView";
import LabView from "@/components/views/LabView";
import RiskView from "@/components/views/RiskView";
import AdminView from "@/components/views/AdminView";
import { METRIC_CRS, TARGET_CRS, STUDY_AREA } from "@/lib/constants";

const NAV: { key: ViewKey; label: string; icon: React.ReactNode; index: string }[] = [
  { key: "explorer", label: "Geospatial Explorer", icon: <MapIcon className="h-[17px] w-[17px]" />, index: "A" },
  { key: "report", label: "Report an accident", icon: <FilePlus2 className="h-[17px] w-[17px]" />, index: "B" },
  { key: "analytics", label: "Analytics dashboard", icon: <BarChart3 className="h-[17px] w-[17px]" />, index: "C" },
  { key: "lab", label: "Spatial analysis laboratory", icon: <FlaskConical className="h-[17px] w-[17px]" />, index: "D" },
  { key: "risk", label: "Risk assessment workspace", icon: <Gauge className="h-[17px] w-[17px]" />, index: "E" },
  { key: "admin", label: "Administration & data quality", icon: <ShieldCheck className="h-[17px] w-[17px]" />, index: "F" },
];

function Monogram() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-label="Urban Accident Intelligence">
      <rect x="1.5" y="1.5" width="29" height="29" stroke="var(--rule-strong)" strokeWidth="1" />
      <path d="M7 8.5V18.2c0 3.4 2.6 5.8 5.9 5.8s5.9-2.4 5.9-5.8V8.5" stroke="var(--amber)" strokeWidth="2.1" strokeLinecap="square" />
      <path d="M23.4 8.5v15.5" stroke="var(--text-2)" strokeWidth="2.1" strokeLinecap="square" />
      <path d="M2 26.5h28" stroke="var(--rule-strong)" strokeWidth="1" />
      <circle cx="16" cy="16" r="2.4" fill="var(--cyan)" />
    </svg>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="tnum text-[10px] text-[var(--text-2)]">
      {now.toISOString().slice(11, 19)} UTC
    </span>
  );
}

function Shell({
  accidents,
  segments,
  traffic,
}: {
  accidents: Accident[];
  segments: RoadSegment[];
  traffic: TrafficEntry[];
}) {
  const app = useApp();
  const cursor = app.cursor;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg)]">
      {/* ---- rail ------------------------------------------------------- */}
      <nav className="relative flex w-[56px] shrink-0 flex-col items-center border-r border-[var(--rule)] bg-[var(--panel)] py-2">
        <div className="plate-texture absolute inset-0" />
        <div className="relative">
          <Monogram />
        </div>
        <div className="relative mt-3 flex flex-1 flex-col items-center gap-px">
          {NAV.map((n) => {
            const active = app.activeView === n.key;
            return (
              <button
                key={n.key}
                type="button"
                title={n.label}
                onClick={() => app.setActiveView(n.key)}
                className="group relative flex h-[46px] w-[46px] flex-col items-center justify-center gap-[3px] transition-colors duration-150"
                style={{
                  background: active ? "var(--panel-3)" : "transparent",
                  borderLeft: `2px solid ${active ? "var(--amber)" : "transparent"}`,
                  color: active ? "var(--amber)" : "var(--text-3)",
                }}
              >
                {n.icon}
                <span className="text-[8px] font-semibold tracking-[0.12em]">{n.index}</span>
                <span className="pointer-events-none absolute left-[52px] z-50 hidden whitespace-nowrap border border-[var(--rule-strong)] bg-[var(--panel-2)] px-2 py-1 text-[10px] text-[var(--text)] group-hover:block">
                  {n.label}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          title="Toggle theme"
          onClick={app.toggleTheme}
          className="relative flex h-[38px] w-[38px] items-center justify-center border border-[var(--rule)] text-[var(--text-3)] transition-colors hover:border-[var(--amber)] hover:text-[var(--amber)]"
        >
          {app.theme === "dark" ? <Sun className="h-[15px] w-[15px]" /> : <Moon className="h-[15px] w-[15px]" />}
        </button>
      </nav>

      {/* ---- content ---------------------------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          {app.activeView === "explorer" && <ExplorerView />}
          {app.activeView === "report" && <ReportView />}
          {app.activeView === "analytics" && <AnalyticsView />}
          {app.activeView === "lab" && <LabView />}
          {app.activeView === "risk" && <RiskView />}
          {app.activeView === "admin" && <AdminView />}
        </div>

        {/* ---- status strip ------------------------------------------- */}
        <footer className="flex h-[30px] shrink-0 items-center gap-4 border-t border-[var(--rule)] bg-[var(--panel-2)] px-3">
          <span className="micro text-[var(--amber)]">UAI · {STUDY_AREA}</span>
          <span className="h-3 w-px bg-[var(--rule)]" />
          <Clock />
          <span className="h-3 w-px bg-[var(--rule)]" />
          <span className="tnum text-[10px] text-[var(--text-2)]">
            {cursor ? `${cursor.lon.toFixed(5)}° E ${cursor.lat.toFixed(5)}° N` : "cursor — —"}
          </span>
          <span className="tnum hidden text-[10px] text-[var(--text-3)] sm:inline">
            z {cursor?.zoom.toFixed(2) ?? "—"}
          </span>
          <span className="h-3 w-px bg-[var(--rule)]" />
          <span className="tnum text-[10px] text-[var(--text-2)]">
            {app.filtered.length.toLocaleString()} / {accidents.length.toLocaleString()} reports in scope
          </span>
          <span className="h-3 w-px bg-[var(--rule)]" />
          <span className="tnum text-[10px] text-[var(--text-3)]">{segments.length} segments</span>
          <span className="h-3 w-px bg-[var(--rule)]" />
          <span className="tnum hidden text-[10px] text-[var(--text-3)] lg:inline">
            {TARGET_CRS} · {METRIC_CRS}
          </span>
          <span className="ml-auto flex items-center gap-3">
            <span className="tnum text-[10px] text-[var(--text-3)]">
              layer {app.layer?.kind ?? app.mapMode} · {app.layer?.statistics ? Object.keys(app.layer.statistics).length + " stats" : "raw"}
            </span>
            <a
              href="/docs"
              target="_blank"
              rel="noreferrer"
              className="border border-[var(--rule-strong)] px-1.5 py-[1px] text-[9px] uppercase tracking-[0.12em] text-[var(--text-2)] transition-colors hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
            >
              api docs
            </a>
            <span className="border border-[var(--warn)] px-1.5 py-[1px] text-[9px] uppercase tracking-[0.12em] text-[var(--warn)]">
              synthetic data
            </span>
          </span>
        </footer>
      </div>
    </div>
  );
}

export default function ConsoleShell(props: {
  accidents: Accident[];
  segments: RoadSegment[];
  traffic: TrafficEntry[];
}) {
  return (
    <AppStateProvider accidents={props.accidents} segments={props.segments} traffic={props.traffic}>
      <ShellWithCursor {...props} />
    </AppStateProvider>
  );
}

function ShellWithCursor(props: {
  accidents: Accident[];
  segments: RoadSegment[];
  traffic: TrafficEntry[];
}) {
  return <Shell {...props} />;
}
