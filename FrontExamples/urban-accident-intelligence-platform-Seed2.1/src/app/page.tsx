"use client";
import dynamicNext from "next/dynamic";

export const dynamic = "force-dynamic";
import { useEffect } from "react";
import SidebarPanel from "@/components/SidebarPanel";
import Dashboard from "@/components/Dashboard";
import ReportModal from "@/components/ReportModal";
import MapCanvas, { MapLegend } from "@/components/MapCanvas";
import { useAppStore } from "@/lib/store";

// Dynamically import map (leaflet needs window)
const MapView = dynamicNext(() => import("@/components/MapCanvas"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center bg-[var(--bg-secondary)]">
      <div className="spinner" />
    </div>
  ),
});

export default function HomePage() {
  const runSimulation = useAppStore(s => s.runSimulation);
  const loadSummary = useAppStore(s => s.loadSummary);
  const simStats = useAppStore(s => s.simStats);
  const isSimulating = useAppStore(s => s.isSimulating);

  // Auto-run initial simulation on first load if no data exists
  useEffect(() => {
    if (!simStats) {
      runSimulation();
    } else {
      loadSummary();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
            </svg>
            <div>
              <div className="text-sm font-bold tracking-wide">URBAN ACCIDENT INTELLIGENCE</div>
              <div className="text-[9px] uppercase tracking-[0.2em] text-slate-500">
                Network-Constrained Spatiotemporal Geocomputation · VGI Conflation · EB Risk
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-slate-400">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isSimulating ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`} />
            <span>{isSimulating ? "SIMULATING..." : simStats ? "DATASET LOADED" : "INITIALIZING"}</span>
          </div>
          <div className="w-px h-4 bg-[var(--border)]" />
          <div className="text-slate-500">CRS: Local Metric Tangent Plane [m] · Display: WGS84</div>
        </div>
      </header>

      {/* Main 3-column layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: control panel */}
        <aside className="w-[340px] flex-shrink-0 overflow-hidden">
          <SidebarPanel />
        </aside>

        {/* Center: map */}
        <main className="flex-1 relative">
          <MapView />

          {/* Map legend overlay */}
          <div className="absolute bottom-8 right-2 z-[400] max-w-xs">
            <MapLegend />
          </div>

          {/* Coordinate readout */}
          <CoordinateReadout />

          {/* Loading overlay */}
          {isSimulating && (
            <div className="loading-overlay">
              <div className="text-center">
                <div className="spinner mx-auto mb-3" />
                <div className="text-cyan-400 text-sm font-semibold">Generating synthetic urban road network</div>
                <div className="text-slate-400 text-xs mt-1">
                  Perturbed grid topology · lixel segmentation · inhomogeneous Cox process realization<br />
                  VGI noise injection · dual-CRS persistence
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Right: analytics dashboard */}
        <aside className="w-[360px] flex-shrink-0 overflow-hidden">
          <Dashboard />
        </aside>
      </div>

      <ReportModal />
    </div>
  );
}

function CoordinateReadout() {
  // Show a simple static CRS badge; we skip live cursor tracking for brevity.
  return (
    <div className="absolute bottom-2 left-2 z-[400] panel px-2 py-1 text-[10px] font-mono text-slate-400">
      <span className="text-cyan-400">●</span> Local projected CRS · metric (meters) · WGS84 display
    </div>
  );
}
