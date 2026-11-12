"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisType } from "@/lib/domain";
import type { JobView } from "@/lib/api-types";
import type { FilterSpec } from "@/lib/filters";
import { apiGet, apiPost, errorMessage } from "@/lib/client-api";

export interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Declarative GET with cancellation: the request is aborted when the path changes. */
export function useApi<T>(path: string | null): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiGet<T>(path, controller.signal)
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(err));
        setLoading(false);
      });
    return () => controller.abort();
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

export type AnalysisStatus = "idle" | "queued" | "running" | "completed" | "failed";

export interface AnalysisRun {
  status: AnalysisStatus;
  job: JobView | null;
  error: string | null;
  run: (type: AnalysisType, params: Record<string, number | string>, filters: FilterSpec) => Promise<JobView | null>;
  show: (job: JobView) => void;
  reset: () => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Submits an analysis job and polls until completion; newer runs supersede older ones. */
export function useAnalysis(): AnalysisRun {
  const [status, setStatus] = useState<AnalysisStatus>("idle");
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runId = useRef(0);

  const run = useCallback(async (type: AnalysisType, params: Record<string, number | string>, filters: FilterSpec) => {
    const id = ++runId.current;
    setStatus("queued");
    setError(null);
    try {
      let current = await apiPost<JobView>("/analysis/jobs", { type, params, filters });
      while (id === runId.current) {
        setJob(current);
        if (current.status === "completed") {
          setStatus("completed");
          return current;
        }
        if (current.status === "failed") {
          setStatus("failed");
          setError(current.errorMessage ?? "Analysis failed");
          return null;
        }
        setStatus(current.status);
        await sleep(current.status === "queued" ? 250 : 450);
        current = await apiGet<JobView>(`/analysis/jobs/${current.id}`);
      }
      return null;
    } catch (err) {
      if (id === runId.current) {
        setStatus("failed");
        setError(errorMessage(err));
      }
      return null;
    }
  }, []);

  const show = useCallback((j: JobView) => {
    runId.current++;
    setJob(j);
    setStatus(j.status === "completed" ? "completed" : j.status === "failed" ? "failed" : j.status);
    setError(j.errorMessage);
  }, []);

  const reset = useCallback(() => {
    runId.current++;
    setJob(null);
    setStatus("idle");
    setError(null);
  }, []);

  return { status, job, error, run, show, reset };
}

/** Debounces a value; used to avoid firing requests on every keystroke or slider movement. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
