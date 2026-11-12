"use client";

/** Client-side job driver: submit → poll progress → hydrate result payload. */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/clientApi";

export interface JobInfo {
  id: string;
  method: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  stage: string;
  error: string | null;
  params: Record<string, unknown>;
  durationMs: number | null;
  resultId: string | null;
  createdAt: string;
}

export interface ResultPayload {
  id: string;
  method: string;
  params: Record<string, unknown>;
  srid: number;
  crsName: string | null;
  sampleSize: number;
  unitCount: number;
  runtimeMs: number | null;
  stats: any;
  benchmark: any;
  formulation: { title: string; latex: string; notes: string[] } | null;
  features?: any;
  createdAt: string;
}

export function useAnalysisJob(datasetId: string | null, role: string) {
  const [job, setJob] = useState<JobInfo | null>(null);
  const [result, setResult] = useState<ResultPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<JobInfo[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshHistory = useCallback(async () => {
    if (!datasetId) return;
    try {
      const data = await apiGet<{ jobs: JobInfo[] }>(`/api/analysis/jobs?datasetId=${datasetId}&limit=25`, role);
      setHistory(data.jobs);
    } catch {
      /* non-fatal */
    }
  }, [datasetId, role]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const poll = useCallback(
    async (jobId: string, attempt = 0) => {
      try {
        const data = await apiGet<{ job: JobInfo; result: ResultPayload | null }>(`/api/analysis/jobs/${jobId}?features=0`, role);
        setJob(data.job);
        if (data.job.status === "succeeded") {
          const full = await apiGet<{ job: JobInfo; result: ResultPayload | null }>(`/api/analysis/jobs/${jobId}?features=1`, role);
          setResult(full.result);
          setJob(full.job);
          setBusy(false);
          setError(null);
          void refreshHistory();
          return;
        }
        if (data.job.status === "failed") {
          setBusy(false);
          setError(data.job.error ?? "job failed");
          void refreshHistory();
          return;
        }
        if (attempt > 400) {
          setBusy(false);
          setError("job timed out");
          return;
        }
        timer.current = setTimeout(() => void poll(jobId, attempt + 1), 650);
      } catch (err) {
        setBusy(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [role, refreshHistory],
  );

  const run = useCallback(
    async (method: string, params: Record<string, unknown>) => {
      if (!datasetId) {
        setError("no dataset selected");
        return null;
      }
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        const submitted = await apiPost<{ jobId: string; cached: boolean; status: string }>("/api/analysis/jobs", { datasetId, method, params }, role);
        await poll(submitted.jobId);
        return submitted.jobId;
      } catch (err) {
        setBusy(false);
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [datasetId, poll, role],
  );

  return { run, job, result, busy, error, history, refreshHistory };
}

/** Convenience: fetch with query parameters built from a filter object. */
export function buildQuery(base: string, filters: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      p.set(k, v.join(","));
    } else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}
