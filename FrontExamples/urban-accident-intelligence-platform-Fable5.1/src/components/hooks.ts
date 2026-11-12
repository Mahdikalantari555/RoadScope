"use client";
import { useCallback, useEffect, useState } from "react";
import type { FC } from "./MapCanvas";

export interface NetworkData { source: { id: number; name: string; kind: string; scenario?: string; params?: Record<string, unknown> } | null; categories: { id: number; code: string; label: string }[]; severities: { id: number; code: string; label: string; rank: number; epdoWeight: number }[]; segments: FC; nodes: FC; bbox?: [number, number, number, number]; crs?: { canonical: string; metric: string } }

export function useNetwork() {
  const [data, setData] = useState<NetworkData | null>(null);
  const reload = useCallback(() => { fetch("/api/network").then((r) => r.json()).then(setData).catch(() => {}); }, []);
  useEffect(() => { reload(); }, [reload]);
  return { net: data, reload };
}

export function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const read = () => setTheme(document.documentElement.classList.contains("light") ? "light" : "dark");
    read(); window.addEventListener("uai-theme", read); return () => window.removeEventListener("uai-theme", read);
  }, []);
  return theme;
}

export function useJson<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return; let alive = true; setLoading(true);
    fetch(url).then((r) => r.json()).then((d) => { if (alive) setData(d); }).finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick, ...deps]);
  return { data, loading, refresh: () => setTick((t) => t + 1) };
}

export const sevColor = (code?: string) => ({ pdo: "#7d8795", minor: "#fbbf24", serious: "#f97316", fatal: "#ef4444" } as Record<string, string>)[code ?? ""] ?? "#7d8795";
export const fmtDate = (d: string | Date) => new Date(d).toISOString().replace("T", " ").slice(0, 16) + "Z";
