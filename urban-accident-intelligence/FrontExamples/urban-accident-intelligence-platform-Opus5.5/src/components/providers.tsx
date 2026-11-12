"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Filters } from "@/lib/domain";
import { api } from "@/lib/client/api";

export interface MetaCategory {
  id: number;
  code: string;
  label: string;
  color: string;
  description: string;
}
export interface MetaSeverity {
  id: number;
  code: string;
  label: string;
  rank: number;
  epdoWeight: number;
  color: string;
}
export interface MetaDataset {
  id: number;
  code: string;
  name: string;
  kind: "synthetic" | "official" | "citizen";
  isActive: boolean;
  scenario: string | null;
  seed: number | null;
  records: number;
}
export interface SessionUser {
  id: number;
  email: string;
  displayName: string;
  role: "citizen" | "admin";
}
export interface Meta {
  categories: MetaCategory[];
  severities: MetaSeverity[];
  statuses: { code: string; label: string; color: string }[];
  datasets: MetaDataset[];
  timeRange: { min: string | null; max: string | null };
  bounds: [number, number, number, number] | null;
  user: SessionUser | null;
}

interface AppCtx {
  meta: Meta | null;
  metaError: string | null;
  reloadMeta: () => Promise<void>;
  theme: "dark" | "light";
  toggleTheme: () => void;
  filters: Filters;
  setFilters: (f: Filters | ((prev: Filters) => Filters)) => void;
  resetFilters: () => void;
}

const Ctx = createContext<AppCtx | null>(null);
const FILTER_KEY = "uai.filters.v1";

export function AppProviders({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [filters, setFiltersState] = useState<Filters>({});

  const reloadMeta = useCallback(async () => {
    try {
      setMeta(await api<Meta>("/api/meta"));
      setMetaError(null);
    } catch (e) {
      setMetaError(e instanceof Error ? e.message : "Failed to load metadata");
    }
  }, []);

  useEffect(() => {
    void reloadMeta();
    const t = (localStorage.getItem("uai.theme") as "dark" | "light" | null) ?? "dark";
    setTheme(t);
    try {
      const f = sessionStorage.getItem(FILTER_KEY);
      if (f) setFiltersState(JSON.parse(f));
    } catch {
      /* ignore corrupt storage */
    }
  }, [reloadMeta]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("uai.theme", theme);
  }, [theme]);

  const setFilters = useCallback((f: Filters | ((prev: Filters) => Filters)) => {
    setFiltersState((prev) => {
      const next = typeof f === "function" ? f(prev) : f;
      sessionStorage.setItem(FILTER_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo<AppCtx>(
    () => ({
      meta,
      metaError,
      reloadMeta,
      theme,
      toggleTheme: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
      filters,
      setFilters,
      resetFilters: () => setFilters({}),
    }),
    [meta, metaError, reloadMeta, theme, filters, setFilters],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp must be used within AppProviders");
  return c;
}
