"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Statistics, SegmentAggregate } from "@/lib/analytics";
import type { AnalysisKind, AnalysisParams, AnalysisResult } from "@/lib/analysis";
import type { RiskOptions, RiskSegment } from "@/lib/risk";
import type { NetworkPayload } from "@/components/map/MapView";
import type { StatusFilter } from "@/lib/filters";

export type FilterState = {
  from: string;
  to: string;
  status: StatusFilter[];
  categories: string[];
  severities: number[];
  districts: string[];
  hourFrom: number;
  hourTo: number;
  dows: number[];
};

export const DEFAULT_FILTERS: FilterState = {
  from: "2024-01-01",
  to: "2025-12-31",
  status: ["verified", "reported"],
  categories: [],
  severities: [],
  districts: [],
  hourFrom: 0,
  hourTo: 23,
  dows: [],
};

export function filtersToQuery(filters: FilterState, extra?: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  params.set("from", filters.from);
  params.set("to", `${filters.to}T23:59:59Z`);
  if (filters.status.length) params.set("status", filters.status.join(","));
  if (filters.categories.length) params.set("category", filters.categories.join(","));
  if (filters.severities.length) params.set("severity", filters.severities.join(","));
  if (filters.districts.length) params.set("district", filters.districts.join(","));
  if (filters.hourFrom > 0) params.set("hourFrom", String(filters.hourFrom));
  if (filters.hourTo < 23) params.set("hourTo", String(filters.hourTo));
  if (filters.dows.length) params.set("dow", filters.dows.join(","));
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.toString();
}

export function useApi<T>(url: string | null, deps: unknown[] = [], options?: { keepPrevious?: boolean }) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const previous = useRef<T | null>(null);

  useEffect(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    if (!options?.keepPrevious) setData(null);
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: "Request failed" }));
          throw new Error(body.error ?? `Request failed (${response.status})`);
        }
        return (await response.json()) as T;
      })
      .then((payload) => {
        previous.current = payload;
        setData(payload);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setError(err.message);
        setLoading(false);
        if (previous.current) setData(previous.current);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, nonce, ...deps]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, refetch };
}

export type MetaPayload = {
  categories: { code: string; label: string; color: string | null; description: string | null }[];
  severities: { code: number; label: string; weight: number; color: string; description: string | null }[];
  districts: { name: string; code: string; centroid: { lat: number; lng: number } | null }[];
  datasets: { id: number; slug: string; name: string; kind: string; scenario: string | null; seed: number | null; description: string | null; citation: string | null; isActive: boolean }[];
  segments: number;
  intersections: number;
};

export type StatsResponse = {
  stats: Statistics;
  statusCounts: Record<string, number>;
  meta: MetaPayload;
  syntheticNotice: string;
  filters: unknown;
};

export type AccidentsResponse = {
  type: "FeatureCollection";
  features: GeoJSON.Feature[];
  meta: { total: number; returned: number; truncated: boolean; note: string };
};

export type AnalysisResponse = AnalysisResult & { jobId: number; sampleSize: number; storedFeatures: number; truncated: boolean };

export type RiskResponse = {
  options: RiskOptions;
  segments: (Omit<RiskSegment, "geometry"> & { hasGeometry: string })[];
  features: GeoJSON.FeatureCollection;
  summary: {
    analysedSegments: number;
    segmentsWithEvents: number;
    highRiskSegments: number;
    networkKm: number;
    eventsAnalysed: number;
    exposureCoverage: number;
    environmentalCoverage: number;
    medianRiskIndex: number;
    p90RiskIndex: number;
    meanSeverityDensity: number;
    stabilityK: number;
  };
  methodology: { title: string; detail: string }[];
  limitations: string[];
  recordCount: number;
  disclaimer: string;
};

export type NetworkResponse = NetworkPayload & {
  categories: MetaPayload["categories"];
  severities: MetaPayload["severities"];
  districtsMeta: MetaPayload["districts"];
  datasets: MetaPayload["datasets"];
  note: string;
};

export type AccidentDetailResponse = {
  accident: {
    id: number;
    publicId: string;
    status: string;
    categoryCode: string;
    severityCode: number;
    occurredAt: string;
    reportedAt: string;
    lat: number;
    lng: number;
    district: string | null;
    roadSegmentId: string | null;
    vehicles: number;
    casualties: number;
    fatalities: number;
    emergencyServices: boolean;
    description: string | null;
    weather: string | null;
    roadSurface: string | null;
    lighting: string | null;
    positionalUncertaintyM: number;
    locationMethod: string;
    qualityFlags: string[];
    duplicateOfId: number | null;
    duplicateScore: number | null;
    datasetName: string | null;
    reporterName: string | null;
    attachments: { id: number; filename: string; mimeType: string; sizeBytes: number }[];
    verifications: { id: number; action: string; notes: string | null; createdAt: string; verifier: string | null }[];
  };
  neighbours: { publicId: string; status: string; distanceM: number }[];
};

export type AnalysisKindOption = { kind: AnalysisKind; label: string; description: string; params: (keyof AnalysisParams)[] };

export const ANALYSIS_KINDS: AnalysisKindOption[] = [
  { kind: "kde", label: "Kernel density", description: "Gaussian KDE surface (descriptive concentration)", params: ["bandwidthM", "cellSizeM", "weightBy"] },
  { kind: "hotspot", label: "Getis-Ord Gi*", description: "Statistically significant hot/cold locations", params: ["bandwidthM"] },
  { kind: "dbscan", label: "DBSCAN clusters", description: "Density-based clusters with noise separation", params: ["epsM", "minPts"] },
  { kind: "segment", label: "Segment aggregation", description: "Nearest-segment counts, KSI and density", params: ["metric"] },
  { kind: "environment", label: "Environment compare", description: "Accidents vs observed road/weather context", params: [] },
  { kind: "temporal", label: "Temporal profile", description: "Hour × day-of-week aggregation", params: [] },
];

export const SEGMENT_BAR_COLORS = ["#2dd4bf", "#22d3ee", "#38bdf8", "#a78bfa", "#f472b6"];

export type SegmentTableRow = SegmentAggregate;

export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function formatPct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
