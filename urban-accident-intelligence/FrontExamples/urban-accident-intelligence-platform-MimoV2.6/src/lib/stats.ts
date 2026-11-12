/** Descriptive statistics over accident records. Pure functions — no I/O. */

import type { Accident, RoadSegment } from "./types";
import { CATEGORIES, SEVERITIES } from "./constants";

export interface DashboardStats {
  totals: {
    records: number;
    verified: number;
    pending: number;
    rejected: number;
    duplicate: number;
    casualties: number;
    fatal: number;
    emergencyCalls: number;
    meanDelayH: number;
    medianAccuracyM: number;
  };
  severity: { code: string; label: string; colour: string; count: number; share: number }[];
  categories: { code: string; label: string; group: string; count: number; share: number }[];
  hourly: { hour: number; count: number; verified: number }[];
  dayOfWeek: { day: number; label: string; count: number }[];
  monthly: { month: string; count: number; verified: number; serious: number }[];
  districts: { district: string; count: number; ratePerKm2: number }[];
  roadClass: { roadClass: string; count: number; segments: number; perSegment: number }[];
  topSegments: {
    segmentId: number;
    segmentCode: string;
    streetName: string;
    roadClass: string;
    lengthM: number;
    count: number;
    severityWeighted: number;
    densityPerKm: number;
  }[];
  environmental: { key: string; count: number; share: number }[];
  reportingLag: { bucket: string; count: number }[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function computeDashboard(accidents: Accident[], segments: RoadSegment[]): DashboardStats {
  const total = accidents.length;
  const severity = SEVERITIES.map((s) => {
    const count = accidents.filter((a) => a.severityCode === s.code).length;
    return {
      code: s.code,
      label: s.label,
      colour: s.colour,
      count,
      share: total ? count / total : 0,
    };
  });
  const categories = CATEGORIES.map((c) => {
    const count = accidents.filter((a) => a.categoryCode === c.code).length;
    return {
      code: c.code,
      label: c.label,
      group: c.group,
      count,
      share: total ? count / total : 0,
    };
  }).sort((a, b) => b.count - a.count);

  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const inHour = accidents.filter((a) => new Date(a.occurredAt).getUTCHours() === hour);
    return {
      hour,
      count: inHour.length,
      verified: inHour.filter((a) => a.status === "verified").length,
    };
  });

  const dayOfWeek = Array.from({ length: 7 }, (_, day) => ({
    day,
    label: DOW[day],
    count: accidents.filter((a) => new Date(a.occurredAt).getUTCDay() === day).length,
  }));

  const monthMap = new Map<string, { count: number; verified: number; serious: number }>();
  for (const a of accidents) {
    const d = new Date(a.occurredAt);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const rec = monthMap.get(key) ?? { count: 0, verified: 0, serious: 0 };
    rec.count += 1;
    if (a.status === "verified") rec.verified += 1;
    if (a.severityCode === "serious" || a.severityCode === "fatal") rec.serious += 1;
    monthMap.set(key, rec);
  }
  const monthly = [...monthMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, v]) => ({
      month: `${MONTHS[Number(key.slice(5)) - 1]} ${key.slice(2, 4)}`,
      ...v,
    }));

  // Spatial concentration by district (Gini-style concentration reported separately).
  const districtMap = new Map<string, number>();
  for (const a of accidents) districtMap.set(a.district, (districtMap.get(a.district) ?? 0) + 1);
  const districts = [...districtMap.entries()]
    .map(([district, count]) => ({ district, count, ratePerKm2: 0 }))
    .sort((a, b) => b.count - a.count);

  const segById = new Map(segments.map((s) => [s.id, s]));
  const segAgg = new Map<number, { count: number; sw: number }>();
  for (const a of accidents) {
    if (a.roadSegmentId == null) continue;
    const rec = segAgg.get(a.roadSegmentId) ?? { count: 0, sw: 0 };
    rec.count += 1;
    rec.sw += a.severityWeight;
    segAgg.set(a.roadSegmentId, rec);
  }
  const topSegments = [...segAgg.entries()]
    .map(([id, v]) => {
      const seg = segById.get(id);
      return {
        segmentId: id,
        segmentCode: seg?.segmentCode ?? `RD-${id}`,
        streetName: seg?.streetName ?? "unassigned",
        roadClass: seg?.roadClass ?? "local",
        lengthM: seg?.lengthM ?? 100,
        count: v.count,
        severityWeighted: Math.round(v.sw * 10) / 10,
        densityPerKm: seg ? Math.round((v.count / (seg.lengthM / 1000)) * 100) / 100 : v.count,
      };
    })
    .sort((a, b) => b.severityWeighted - a.severityWeighted || b.count - a.count)
    .slice(0, 12);

  const roadClassAgg = ["arterial", "collector", "local"].map((rc) => {
    const segs = segments.filter((s) => s.roadClass === rc);
    const ids = new Set(segs.map((s) => s.id));
    const count = accidents.filter((a) => a.roadSegmentId != null && ids.has(a.roadSegmentId)).length;
    return {
      roadClass: rc,
      count,
      segments: segs.length,
      perSegment: segs.length ? Math.round((count / segs.length) * 100) / 100 : 0,
    };
  });

  const envMap = new Map<string, number>();
  for (const a of accidents) envMap.set(a.weather, (envMap.get(a.weather) ?? 0) + 1);
  const environmental = [...envMap.entries()]
    .map(([key, count]) => ({ key, count, share: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count);

  const lagBuckets = [
    { bucket: "< 1 h", min: 0, max: 1 },
    { bucket: "1–6 h", min: 1, max: 6 },
    { bucket: "6–24 h", min: 6, max: 24 },
    { bucket: "1–3 d", min: 24, max: 72 },
    { bucket: "> 3 d", min: 72, max: Infinity },
  ];
  const reportingLag = lagBuckets.map((b) => ({
    bucket: b.bucket,
    count: accidents.filter((a) => a.reportDelayH >= b.min && a.reportDelayH < b.max).length,
  }));

  const accuracies = accidents.map((a) => a.positionalAccuracyM).sort((x, y) => x - y);
  const delays = accidents.map((a) => a.reportDelayH);

  return {
    totals: {
      records: total,
      verified: accidents.filter((a) => a.status === "verified").length,
      pending: accidents.filter((a) => a.status === "pending").length,
      rejected: accidents.filter((a) => a.status === "rejected").length,
      duplicate: accidents.filter((a) => a.status === "duplicate").length,
      casualties: accidents.reduce((s, a) => s + a.casualties, 0),
      fatal: accidents.filter((a) => a.severityCode === "fatal").length,
      emergencyCalls: accidents.filter((a) => a.emergencyServices).length,
      meanDelayH: delays.length ? delays.reduce((s, v) => s + v, 0) / delays.length : 0,
      medianAccuracyM: accuracies.length ? accuracies[Math.floor(accuracies.length / 2)] : 0,
    },
    severity,
    categories,
    hourly,
    dayOfWeek,
    monthly,
    districts,
    roadClass: roadClassAgg,
    topSegments,
    environmental,
    reportingLag,
  };
}

/** Relative spatial concentration (Gini) over district counts. */
export function gini(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  if (!n) return 0;
  const sum = v.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += (2 * (i + 1) - n - 1) * v[i];
  return acc / (n * sum);
}
