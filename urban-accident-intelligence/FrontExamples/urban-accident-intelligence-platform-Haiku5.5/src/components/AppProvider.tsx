"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { MetaResponse, SessionUser } from "@/lib/api-types";
import { DEFAULT_FILTERS, type FilterSpec } from "@/lib/filters";
import { apiGet, apiPost, errorMessage } from "@/lib/client-api";

type Theme = "dark" | "light";
type ArrayKey = "categories" | "severities" | "months" | "daysOfWeek";

interface AppContextValue {
  meta: MetaResponse | null;
  metaError: string | null;
  user: SessionUser | null;
  isAdmin: boolean;
  refreshMeta: () => Promise<void>;
  logout: () => Promise<void>;
  filters: FilterSpec;
  setFilters: (patch: Partial<FilterSpec>) => void;
  toggleArrayValue: <K extends ArrayKey>(key: K, value: FilterSpec[K][number]) => void;
  resetFilters: () => void;
  theme: Theme;
  toggleTheme: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

/** Global client state: study metadata, session user, shared analytical filters and theme. */
export function AppProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [filters, setFiltersState] = useState<FilterSpec>(DEFAULT_FILTERS);
  const [theme, setTheme] = useState<Theme>("dark");

  const refreshMeta = useCallback(async () => {
    try {
      setMeta(await apiGet<MetaResponse>("/meta"));
      setMetaError(null);
    } catch (err) {
      setMetaError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void refreshMeta();
  }, [refreshMeta]);

  useEffect(() => {
    setTheme(localStorage.getItem("uai-theme") === "light" ? "light" : "dark");
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === "dark" ? "light" : "dark";
      localStorage.setItem("uai-theme", next);
      return next;
    });
  }, []);

  const logout = useCallback(async () => {
    await apiPost("/auth/logout");
    await refreshMeta();
  }, [refreshMeta]);

  const setFilters = useCallback((patch: Partial<FilterSpec>) => {
    setFiltersState((prev) => ({ ...prev, ...patch }));
  }, []);

  const toggleArrayValue = useCallback(<K extends ArrayKey>(key: K, value: FilterSpec[K][number]) => {
    setFiltersState((prev) => {
      const current = prev[key] as unknown[];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...prev, [key]: next } as FilterSpec;
    });
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState((prev) => ({ ...DEFAULT_FILTERS, statuses: prev.statuses }));
  }, []);

  const user = meta?.user ?? null;
  const value = useMemo<AppContextValue>(
    () => ({
      meta,
      metaError,
      user,
      isAdmin: user?.role === "admin",
      refreshMeta,
      logout,
      filters,
      setFilters,
      toggleArrayValue,
      resetFilters,
      theme,
      toggleTheme,
    }),
    [meta, metaError, user, refreshMeta, logout, filters, setFilters, toggleArrayValue, resetFilters, theme, toggleTheme],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
