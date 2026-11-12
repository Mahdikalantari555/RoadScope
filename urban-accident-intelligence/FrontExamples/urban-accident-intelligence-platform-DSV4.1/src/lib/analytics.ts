/**
 * Descriptive analytics and segment aggregation.
 *
 * These functions are pure: they take accident records (already filtered) plus
 * reference metadata and return deterministic summaries. Descriptive
 * concentration is deliberately kept separate from inferential hotspot tests.
 */
import type { AccidentRecord, SegmentRecord } from "./data";
import { gini, mean, minMax, quantile, stdev } from "./stats";

export type CountItem = { key: string; label: string; count: number; share: number; color?: string | null };

export type SegmentAggregate = {
  segmentId: string;
  name: string;
  roadClass: string;
  district: string | null;
  lengthM: number;
  count: number;
  ksi: number;
  fatal: number;
  severityWeighted: number;
  densityPerKm: number;
  severityDensityPerKm: number;
  wetCount: number;
  darkCount: number;
  wetShare: number;
  darkShare: number;
  unknownContextShare: number;
  aadt: number | null;
  heavyVehiclePct: number | null;
  exposureVehKmPerDay: number | null;
  speedLimitKmh: number;
  lanes: number;
  isLit: boolean;
  surface: string;
  geometry: { type: "LineString"; coordinates: [number, number][] };
};

export type Statistics = {
  total: number;
  casualties: number;
  fatalities: number;
  ksi: number;
  severityWeighted: number;
  byStatus: Record<string, number>;
  bySeverity: CountItem[];
  byCategory: CountItem[];
  byHour: number[];
  bySeverityAndHour: { hour: number; pdo: number; slight: number; serious: number; fatal: number }[];
  byDow: number[];
  byMonth: { key: string; label: string; total: number; ksi: number }[];
  byDistrict: CountItem[];
  environment: { condition: string; label: string; count: number; share: number; ksiShare: number }[];
  delay: { medianH: number; p90H: number; meanH: number; within24h: number };
  uncertainty: { medianM: number; p90M: number; shareOver30m: number };
  completeness: { weather: number; lighting: number; segment: number; description: number; verified: number };
  concentration: { gini: number; top5Share: number; segmentsWithEvents: number; segments: number; meanPerSegment: number };
  topSegments: SegmentAggregate[];
  timeSpan: { from: string | null; to: string | null };
  reportingWindowDays: number;
};

export function severityWeight(code: number): number {
  switch (code) {
    case 4:
      return 12;
    case 3:
      return 7;
    case 2:
      return 3;
    default:
      return 1;
  }
}

export function aggregateBySegment(
  accidents: AccidentRecord[],
  segments: SegmentRecord[],
): SegmentAggregate[] {
  const bySegment = new Map<string, AccidentRecord[]>();
  for (const accident of accidents) {
    if (!accident.roadSegmentId) continue;
    const list = bySegment.get(accident.roadSegmentId);
    if (list) list.push(accident);
    else bySegment.set(accident.roadSegmentId, [accident]);
  }
  return segments.map((segment) => {
    const records = bySegment.get(segment.id) ?? [];
    const count = records.length;
    const ksi = records.filter((r) => r.severityCode >= 3).length;
    const fatal = records.filter((r) => r.severityCode === 4).length;
    const severityWeighted = records.reduce((s, r) => s + severityWeight(r.severityCode), 0);
    const known = records.filter((r) => r.roadSurface !== null && r.lighting !== null);
    const wetCount = known.filter((r) => r.roadSurface && r.roadSurface !== "dry").length;
    const darkCount = known.filter((r) => r.lighting === "dark").length;
    const km = Math.max(segment.lengthM / 1000, 0.05);
    const aadt = segment.aadt;
    return {
      segmentId: segment.id,
      name: segment.name ?? segment.id,
      roadClass: segment.roadClass,
      district: segment.district,
      lengthM: segment.lengthM,
      count,
      ksi,
      fatal,
      severityWeighted,
      densityPerKm: count / km,
      severityDensityPerKm: severityWeighted / km,
      wetCount,
      darkCount,
      wetShare: known.length > 0 ? wetCount / known.length : 0,
      darkShare: known.length > 0 ? darkCount / known.length : 0,
      unknownContextShare: count > 0 ? 1 - known.length / count : 0,
      aadt,
      heavyVehiclePct: segment.heavyVehiclePct,
      exposureVehKmPerDay: aadt ? aadt * km : null,
      speedLimitKmh: segment.speedLimitKmh,
      lanes: segment.lanes,
      isLit: segment.isLit,
      surface: segment.surface,
      geometry: segment.geometry,
    };
  });
}

export function computeStatistics(
  accidents: AccidentRecord[],
  segments: SegmentRecord[],
  categoryLabels: Record<string, { label: string; color?: string | null }>,
  severityLabels: Record<number, { label: string; color: string }>,
): Statistics {
  const total = accidents.length;
  const casualties = accidents.reduce((s, a) => s + a.casualties, 0);
  const fatalities = accidents.reduce((s, a) => s + a.fatalities, 0);
  const ksi = accidents.filter((a) => a.severityCode >= 3).length;
  const severityWeighted = accidents.reduce((s, a) => s + severityWeight(a.severityCode), 0);

  const byStatus: Record<string, number> = {};
  accidents.forEach((a) => {
    byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
  });

  const countBy = (fn: (a: AccidentRecord) => string): Map<string, number> => {
    const map = new Map<string, number>();
    accidents.forEach((a) => map.set(fn(a), (map.get(fn(a)) ?? 0) + 1));
    return map;
  };

  const severityCounts = countBy((a) => String(a.severityCode));
  const bySeverity: CountItem[] = [4, 3, 2, 1].map((code) => ({
    key: String(code),
    label: severityLabels[code]?.label ?? `Severity ${code}`,
    count: severityCounts.get(String(code)) ?? 0,
    share: total ? (severityCounts.get(String(code)) ?? 0) / total : 0,
    color: severityLabels[code]?.color ?? null,
  }));

  const categoryCounts = countBy((a) => a.categoryCode);
  const byCategory: CountItem[] = Array.from(categoryCounts.entries())
    .map(([key, count]) => ({
      key,
      label: categoryLabels[key]?.label ?? key,
      count,
      share: total ? count / total : 0,
      color: categoryLabels[key]?.color ?? null,
    }))
    .sort((a, b) => b.count - a.count);

  const byHour = Array.from({ length: 24 }, (_, h) => accidents.filter((a) => a.hour === h).length);
  const bySeverityAndHour = Array.from({ length: 24 }, (_, hour) => {
    const records = accidents.filter((a) => a.hour === hour);
    return {
      hour,
      pdo: records.filter((r) => r.severityCode === 1).length,
      slight: records.filter((r) => r.severityCode === 2).length,
      serious: records.filter((r) => r.severityCode === 3).length,
      fatal: records.filter((r) => r.severityCode === 4).length,
    };
  });
  const byDow = Array.from({ length: 7 }, (_, d) => accidents.filter((a) => a.dow === d).length);

  const monthlyMap = new Map<string, { total: number; ksi: number }>();
  accidents.forEach((a) => {
    const key = a.occurredAt.slice(0, 7);
    const entry = monthlyMap.get(key) ?? { total: 0, ksi: 0 };
    entry.total += 1;
    if (a.severityCode >= 3) entry.ksi += 1;
    monthlyMap.set(key, entry);
  });
  const sortedKeys = Array.from(monthlyMap.keys()).sort();
  const byMonth: Statistics["byMonth"] = [];
  if (sortedKeys.length > 0) {
    const [startYear, startMonth] = sortedKeys[0].split("-").map(Number);
    const [endYear, endMonth] = sortedKeys[sortedKeys.length - 1].split("-").map(Number);
    let year = startYear;
    let month = startMonth;
    for (let guard = 0; guard < 48; guard += 1) {
      const key = `${year}-${String(month).padStart(2, "0")}`;
      const entry = monthlyMap.get(key) ?? { total: 0, ksi: 0 };
      const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
      byMonth.push({ key, label, total: entry.total, ksi: entry.ksi });
      if (year === endYear && month === endMonth) break;
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
  }

  const districtCounts = countBy((a) => a.district ?? "Unassigned");
  const byDistrict: CountItem[] = Array.from(districtCounts.entries())
    .map(([name, count]) => ({ key: name, label: name, count, share: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count);

  const conditions = new Map<string, { count: number; ksi: number }>();
  accidents.forEach((a) => {
    const key = a.weather ?? "unknown";
    const entry = conditions.get(key) ?? { count: 0, ksi: 0 };
    entry.count += 1;
    if (a.severityCode >= 3) entry.ksi += 1;
    conditions.set(key, entry);
  });
  const validConditionCount = accidents.filter((a) => a.weather && a.weather !== "unknown").length;
  const environment = Array.from(conditions.entries())
    .map(([condition, v]) => ({
      condition,
      label: condition.replace(/_/g, " "),
      count: v.count,
      share: validConditionCount ? v.count / validConditionCount : 0,
      ksiShare: v.count ? v.ksi / v.count : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const delays = accidents.map((a) => Math.max(0, (new Date(a.reportedAt).getTime() - new Date(a.occurredAt).getTime()) / 3_600_000));
  const uncertaintyValues = accidents.map((a) => a.positionalUncertaintyM);
  const withWeather = accidents.filter((a) => a.weather !== null).length;
  const withLighting = accidents.filter((a) => a.lighting !== null).length;
  const withSegment = accidents.filter((a) => a.roadSegmentId !== null).length;
  const withDescription = accidents.filter((a) => !!a.description).length;
  const verified = accidents.filter((a) => a.status === "verified").length;

  const aggregates = aggregateBySegment(accidents, segments);
  const eventSegments = aggregates.filter((a) => a.count > 0);
  const sortedByCount = [...eventSegments].sort((a, b) => b.severityWeighted - a.severityWeighted);
  const top5 = sortedByCount.slice(0, 5).reduce((s, a) => s + a.severityWeighted, 0);
  const concentration = {
    gini: gini(aggregates.map((a) => a.count)),
    top5Share: severityWeighted > 0 ? top5 / severityWeighted : 0,
    segmentsWithEvents: eventSegments.length,
    segments: aggregates.length,
    meanPerSegment: eventSegments.length ? total / eventSegments.length : 0,
  };

  const timestamps = accidents.map((a) => new Date(a.occurredAt).getTime()).sort((a, b) => a - b);
  const from = timestamps.length ? new Date(timestamps[0]).toISOString() : null;
  const to = timestamps.length ? new Date(timestamps[timestamps.length - 1]).toISOString() : null;

  return {
    total,
    casualties,
    fatalities,
    ksi,
    severityWeighted,
    byStatus,
    bySeverity,
    byCategory,
    byHour,
    bySeverityAndHour,
    byDow,
    byMonth,
    byDistrict,
    environment,
    delay: {
      medianH: delays.length ? quantile(delays, 0.5) : 0,
      p90H: delays.length ? quantile(delays, 0.9) : 0,
      meanH: delays.length ? mean(delays) : 0,
      within24h: delays.length ? delays.filter((d) => d <= 24).length / delays.length : 0,
    },
    uncertainty: {
      medianM: uncertaintyValues.length ? quantile(uncertaintyValues, 0.5) : 0,
      p90M: uncertaintyValues.length ? quantile(uncertaintyValues, 0.9) : 0,
      shareOver30m: uncertaintyValues.length ? uncertaintyValues.filter((u) => u > 30).length / uncertaintyValues.length : 0,
    },
    completeness: {
      weather: total ? withWeather / total : 0,
      lighting: total ? withLighting / total : 0,
      segment: total ? withSegment / total : 0,
      description: total ? withDescription / total : 0,
      verified: total ? verified / total : 0,
    },
    concentration,
    topSegments: sortedByCount.slice(0, 12),
    timeSpan: { from, to },
    reportingWindowDays: from && to ? Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000)) : 0,
  };
}

/** Normalise accident counts to a 0–100 relative scale for symbology only. */
export function scaled(values: number[]): number[] {
  const { min, max } = minMax(values);
  if (max === min) return values.map(() => 0);
  return values.map((v) => ((v - min) / (max - min)) * 100);
}

export function segmentSummary(aggregates: SegmentAggregate[]) {
  const counts = aggregates.map((a) => a.count);
  return {
    mean: mean(counts),
    sd: stdev(counts),
    p90: quantile(counts, 0.9),
    max: counts.length ? Math.max(...counts) : 0,
  };
}
