"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/clientApi";

export interface DatasetSummary {
  id: string;
  slug: string;
  name: string;
  kind: string;
  scenario: string;
  scenarioLabel: string;
  synthetic: boolean;
  seed: number;
  srid: number;
  crsName: string;
  utmZone: number;
  originLon: number;
  originLat: number;
  lixelLengthM: number;
  networkStats: any;
  recordCounts: any;
  groundTruthAvailable: boolean;
  generatedAt: string | null;
  generatorVersion: string;
}

interface AppCtxValue {
  role: string;
  setRole: (r: string) => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
  datasets: DatasetSummary[];
  datasetId: string | null;
  setDatasetId: (id: string) => void;
  dataset: DatasetSummary | null;
  refreshDatasets: () => Promise<void>;
  bootstrapState: "unknown" | "checking" | "ready" | "generating" | "error";
  bootstrapMessage: string;
  runBootstrap: (opts?: { scenario?: string; seed?: number; lixelLengthM?: number }) => Promise<void>;
}

const AppCtx = createContext<AppCtxValue | null>(null);

export function useApp(): AppCtxValue {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp must be used inside AppShell");
  return ctx;
}

const ROLES = [
  { value: "mobility_analyst", label: "Urban Mobility Analyst" },
  { value: "researcher", label: "GIScience Researcher" },
  { value: "safety_engineer", label: "Transportation Safety Engineer" },
  { value: "data_steward", label: "Geospatial Data Steward" },
  { value: "simulation_scientist", label: "Simulation Scientist" },
  { value: "citizen_reporter", label: "Citizen Reporter (VGI)" },
  { value: "administrator", label: "Administrator" },
];

const NAV = [
  { href: "/", label: "Overview", code: "00" },
  { href: "/simulation", label: "Ground-Truth Simulator", code: "01" },
  { href: "/report", label: "Citizen Report (VGI)", code: "02" },
  { href: "/stewardship", label: "Stewardship & QA", code: "03" },
  { href: "/laboratory", label: "Spatial Analysis Lab", code: "04" },
  { href: "/risk", label: "Exposure & Empirical Bayes", code: "05" },
  { href: "/explorer", label: "Geovisual Analytics", code: "06" },
  { href: "/methodology", label: "Methodology & API", code: "07" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [role, setRoleState] = useState<string>("mobility_analyst");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [datasetId, setDatasetIdState] = useState<string | null>(null);
  const [bootstrapState, setBootstrapState] = useState<AppCtxValue["bootstrapState"]>("unknown");
  const [bootstrapMessage, setBootstrapMessage] = useState("");
  const [navOpen, setNavOpen] = useState(true);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("uai.theme") : null;
    const t = stored === "light" ? "light" : "dark";
    setTheme(t);
    document.documentElement.classList.toggle("light", t === "light");
    const storedRole = typeof window !== "undefined" ? window.localStorage.getItem("uai.role") : null;
    if (storedRole) setRoleState(storedRole);
    const storedDs = typeof window !== "undefined" ? window.localStorage.getItem("uai.dataset") : null;
    if (storedDs) setDatasetIdState(storedDs);
  }, []);

  const refreshDatasets = useCallback(async () => {
    try {
      const data = await apiGet<{ datasets: DatasetSummary[] }>("/api/datasets", role);
      setDatasets(data.datasets);
      setDatasetIdState((cur) => {
        if (cur && data.datasets.some((d) => d.id === cur)) return cur;
        const preferred = data.datasets.find((d) => d.synthetic) ?? data.datasets[0];
        if (preferred && typeof window !== "undefined") window.localStorage.setItem("uai.dataset", preferred.id);
        return preferred?.id ?? null;
      });
      setBootstrapState(data.datasets.length > 0 ? "ready" : "checking");
    } catch {
      setBootstrapState("error");
    }
  }, [role]);

  useEffect(() => {
    void refreshDatasets();
  }, [refreshDatasets]);

  const runBootstrap = useCallback(
    async (opts?: { scenario?: string; seed?: number; lixelLengthM?: number }) => {
      setBootstrapState("generating");
      setBootstrapMessage("Materialising topology, lixel lattice and inhomogeneous network point process…");
      try {
        const res = await apiPost<{ ok: boolean; durationMs: number; dataset: DatasetSummary }>("/api/bootstrap", { force: true, ...opts }, role);
        setBootstrapMessage(`Synthetic dataset generated in ${(res.durationMs / 1000).toFixed(1)} s.`);
        setBootstrapState("ready");
        await refreshDatasets();
        if (res.dataset?.id) setDatasetIdState(res.dataset.id);
        router.refresh();
      } catch (err) {
        setBootstrapState("error");
        setBootstrapMessage(err instanceof Error ? err.message : "bootstrap failed");
      }
    },
    [refreshDatasets, role, router],
  );

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("light", next === "light");
      window.localStorage.setItem("uai.theme", next);
      return next;
    });
  }, []);

  const setRole = useCallback((r: string) => {
    setRoleState(r);
    window.localStorage.setItem("uai.role", r);
  }, []);

  const setDatasetId = useCallback((id: string) => {
    setDatasetIdState(id);
    window.localStorage.setItem("uai.dataset", id);
    router.refresh();
  }, [router]);

  const value = useMemo<AppCtxValue>(
    () => ({
      role,
      setRole,
      theme,
      toggleTheme,
      datasets,
      datasetId,
      setDatasetId,
      dataset: datasets.find((d) => d.id === datasetId) ?? null,
      refreshDatasets,
      bootstrapState,
      bootstrapMessage,
      runBootstrap,
    }),
    [role, setRole, theme, toggleTheme, datasets, datasetId, setDatasetId, refreshDatasets, bootstrapState, bootstrapMessage, runBootstrap],
  );

  const active = datasets.find((d) => d.id === datasetId);

  return (
    <AppCtx.Provider value={value}>
      <div className="flex h-screen w-screen overflow-hidden" style={{ background: "var(--bg)" }}>
        <aside
          className="flex shrink-0 flex-col border-r transition-all"
          style={{ width: navOpen ? 216 : 46, borderColor: "var(--border)", background: "var(--bg-elev)" }}
        >
          <div className="flex items-center gap-2 border-b px-2.5 py-2.5" style={{ borderColor: "var(--border)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M2 18L8 6l4 7 3-4 7 9H2z" stroke="var(--accent)" strokeWidth="1.4" strokeLinejoin="round" />
              <circle cx="8" cy="6" r="1.7" fill="var(--danger)" />
              <circle cx="15" cy="9" r="1.4" fill="var(--warn)" />
            </svg>
            {navOpen && (
              <div className="min-w-0 leading-tight">
                <div className="truncate text-[11.5px] font-semibold tracking-[0.02em]">Urban Accident</div>
                <div className="truncate text-[11.5px] font-semibold tracking-[0.02em]" style={{ color: "var(--accent)" }}>
                  Intelligence
                </div>
              </div>
            )}
            <button type="button" className="ml-auto text-[var(--text-mute)] hover:text-[var(--text)]" onClick={() => setNavOpen((v) => !v)} title="Toggle navigation">
              {navOpen ? "⟨" : "⟩"}
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto py-1.5 scroll-thin">
            {NAV.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-2 px-2.5 py-[6px] text-[11.5px] transition-colors"
                  style={{
                    color: isActive ? "var(--text)" : "var(--text-mute)",
                    background: isActive ? "var(--panel-2)" : "transparent",
                    borderLeft: `2px solid ${isActive ? "var(--accent)" : "transparent"}`,
                  }}
                  title={item.label}
                >
                  <span className="mono text-[9.5px] opacity-60">{item.code}</span>
                  {navOpen && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </nav>
          {navOpen && (
            <div className="border-t p-2.5 text-[9.5px] leading-relaxed" style={{ borderColor: "var(--border)", color: "var(--text-mute)" }}>
              <div>Network-constrained geocomputation</div>
              <div className="mono mt-1">EPSG:{active?.srid ?? "—"} · lixel {active?.lixelLengthM ?? "—"} m</div>
              <div className="mono">generator v{active?.generatorVersion ?? "—"}</div>
            </div>
          )}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center gap-3 border-b px-3 py-1.5" style={{ borderColor: "var(--border)", background: "var(--bg-elev)" }}>
            <div className="flex items-center gap-2">
              <span className="text-[9.5px] uppercase tracking-[0.1em]" style={{ color: "var(--text-mute)" }}>
                Dataset
              </span>
              <select className="max-w-[330px]" value={datasetId ?? ""} onChange={(e) => setDatasetId(e.target.value)}>
                {datasets.length === 0 && <option value="">— no dataset —</option>}
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            {active?.synthetic && (
              <span className="badge synthetic-flag" title="Generated by the seeded inhomogeneous network point process. Oracle λ available for benchmarking.">
                SYNTHETIC · {active.scenario.replace(/_/g, " ")} · seed {active.seed}
              </span>
            )}
            {active && !active.synthetic && <span className="badge">EMPIRICAL</span>}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[9.5px] uppercase tracking-[0.1em]" style={{ color: "var(--text-mute)" }}>
                Persona
              </span>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <button type="button" className="btn" onClick={toggleTheme} title="Toggle publication / terminal theme">
                {theme === "dark" ? "☀ Light" : "☾ Dark"}
              </button>
            </div>
          </header>

          {bootstrapState !== "ready" && datasets.length === 0 ? (
            <ColdStart
              state={bootstrapState}
              message={bootstrapMessage}
              onGenerate={(opts) => runBootstrap(opts)}
            />
          ) : (
            <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
          )}
        </div>
      </div>
    </AppCtx.Provider>
  );
}

function ColdStart({
  state,
  message,
  onGenerate,
}: {
  state: AppCtxValue["bootstrapState"];
  message: string;
  onGenerate: (opts: { scenario: string; seed: number; lixelLengthM: number }) => void;
}) {
  const [scenario, setScenario] = useState("multi_covariate_complex_urban");
  const [seed, setSeed] = useState(20260117);
  const [lixel, setLixel] = useState(25);
  const busy = state === "generating";

  return (
    <main className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
      <div className="panel w-full max-w-2xl">
        <div className="panel-head">
          <div>
            <h1 className="panel-title">Spatial foundation cold start</h1>
            <p className="text-[10px]" style={{ color: "var(--text-mute)" }}>
              No dataset is present. The platform generates its own ground truth so that every algorithm can be benchmarked.
            </p>
          </div>
          {busy && <span className="badge pulse">RUNNING</span>}
        </div>
        <div className="space-y-3 p-4">
          <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
            The generator builds a topologically valid urban road graph, subdivides every edge into uniform <em>lixels</em> through a linear
            referencing system, then realises an inhomogeneous spatiotemporal Poisson/Cox point process on that network with a known intensity
            λ(s,t). Citizen observations are then derived from the oracle realisations with injected positional drift, reporting lag, multi-witness
            bursts and false alarms, and probabilistically map-matched back onto the network.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="text-[10px] uppercase tracking-[0.07em]" style={{ color: "var(--text-mute)" }}>
                Scenario
              </span>
              <select className="mt-1 w-full" value={scenario} onChange={(e) => setScenario(e.target.value)} disabled={busy}>
                <option value="uniform_baseline">Uniform Baseline</option>
                <option value="intersection_clustered">Intersection-Clustered</option>
                <option value="diurnal_rush_hour_shock">Diurnal Rush-Hour Shock</option>
                <option value="multi_covariate_complex_urban">Multi-Covariate Complex Urban</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-[0.07em]" style={{ color: "var(--text-mute)" }}>
                Seed
              </span>
              <input type="number" className="mono mt-1 w-full" value={seed} min={1} max={2147483647} onChange={(e) => setSeed(Number(e.target.value))} disabled={busy} />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-[0.07em]" style={{ color: "var(--text-mute)" }}>
                Lixel length (m)
              </span>
              <select className="mt-1 w-full" value={lixel} onChange={(e) => setLixel(Number(e.target.value))} disabled={busy}>
                <option value={10}>10 m</option>
                <option value={25}>25 m</option>
                <option value={50}>50 m</option>
                <option value={100}>100 m</option>
              </select>
            </label>
          </div>
          {message && (
            <p className="mono text-[11px]" style={{ color: state === "error" ? "var(--danger)" : "var(--accent)" }}>
              {message}
            </p>
          )}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onGenerate({ scenario, seed, lixelLengthM: lixel })}>
            {busy ? "Generating…" : "Generate synthetic ground-truth dataset"}
          </button>
        </div>
      </div>
    </main>
  );
}
