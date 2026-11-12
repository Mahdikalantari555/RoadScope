import { describe, expect, it } from "vitest";
import { computeQualityFlags, duplicateScore, findDuplicateCandidates } from "@/lib/quality";
import { generateAccidents, generateNetwork } from "@/lib/synthetic";
import { parseFilterParams, normalizeFilterObject } from "@/lib/filters";
import { localParts, parseLocalDateTime, zonedToUtc } from "@/lib/time";
import { reportSchema } from "@/lib/validation";
import { ANALYSIS_DEFS } from "@/lib/catalog";
import { STUDY_AREA } from "@/lib/domain";

describe("duplicate detection", () => {
  const base = { x: 1000, y: 1000, tMs: Date.UTC(2024, 0, 1, 12), categoryCode: "rear_end" };

  it("scores close, same-category, near-in-time incidents above the threshold", () => {
    const near = { ...base, x: 1030, tMs: base.tMs + 10 * 60000 };
    expect(duplicateScore(base, near)).toBeGreaterThan(0.5);
  });

  it("never matches different categories or distant incidents", () => {
    expect(duplicateScore(base, { ...base, categoryCode: "pedestrian" })).toBe(0);
    expect(duplicateScore(base, { ...base, x: 1500 })).toBe(0);
  });

  it("returns ranked candidates above the threshold only", () => {
    const pool = [
      { id: 1, ...base, x: 1020, tMs: base.tMs + 5 * 60000 },
      { id: 2, ...base, x: 1090, tMs: base.tMs + 80 * 60000 },
    ];
    const hits = findDuplicateCandidates(base, pool);
    expect(hits.map((h) => h.id)).toEqual([1]);
  });
});

describe("quality flags", () => {
  it("flags off-network, duplicate, and delayed reports", () => {
    const flags = computeQualityFlags({ snapDistanceM: 90, reportingDelayMin: 3000, hasDuplicateCandidate: true, coordinateMoved: false });
    expect(flags).toEqual(["off_network", "possible_duplicate", "delayed_report"]);
  });
});

describe("synthetic generator", () => {
  it("is deterministic for a fixed seed and differs across seeds", () => {
    const a = generateNetwork(42);
    const b = generateNetwork(42);
    const c = generateNetwork(43);
    expect(a.segments.length).toBe(b.segments.length);
    expect(a.nodes[10]!.lon).toBe(b.nodes[10]!.lon);
    expect(c.nodes[10]!.lon).not.toBe(a.nodes[10]!.lon);
  });

  it("produces the requested number of records, with injected duplicates", () => {
    const net = generateNetwork(7);
    const opts = { seed: 99, scenario: "mixed" as const, count: 400, kind: "synthetic" as const, startLocal: "2023-01-01", endLocal: "2023-12-31" };
    const first = generateAccidents(net, opts);
    const second = generateAccidents(net, opts);
    expect(first.accidents.length).toBe(400);
    expect(first.injected.duplicates).toBeGreaterThan(0);
    expect(first.accidents[7]!.lon).toBe(second.accidents[7]!.lon);
    expect(first.accidents.every((a) => a.description.includes("[synthetic record]") || a.description.startsWith("Second report"))).toBe(true);
  });

  it("concentrates intersection-dominated incidents near junctions more than uniform ones", () => {
    const net = generateNetwork(11);
    const near = (scenario: "uniform" | "intersection") => {
      const r = generateAccidents(net, { seed: 5, scenario, count: 600, kind: "synthetic", startLocal: "2023-01-01", endLocal: "2023-12-31" });
      const junctions = net.nodes.filter((n) => n.degree >= 3);
      const close = r.accidents.filter((a) => junctions.some((j) => Math.hypot(j.x - a.x, j.y - a.y) < 60)).length;
      return close / r.accidents.length;
    };
    expect(near("intersection")).toBeGreaterThan(near("uniform"));
  });
});

describe("time handling", () => {
  it("converts Europe/Berlin wall-clock time to UTC including DST offsets", () => {
    expect(zonedToUtc(2024, 7, 1, 12, 0, "Europe/Berlin").toISOString()).toBe("2024-07-01T10:00:00.000Z");
    expect(zonedToUtc(2024, 1, 15, 12, 0, "Europe/Berlin").toISOString()).toBe("2024-01-15T11:00:00.000Z");
  });

  it("derives Monday-based weekday indices", () => {
    const p = localParts(new Date("2024-01-01T12:00:00Z"), "Europe/Berlin");
    expect(p.dow).toBe(0);
    expect(p.hour).toBe(13);
  });

  it("parses local date-time strings and rejects malformed ones", () => {
    expect(parseLocalDateTime("2024-03-10T08:30", STUDY_AREA.timeZone)?.toISOString()).toBe("2024-03-10T07:30:00.000Z");
    expect(parseLocalDateTime("2024-13-10T08:30", STUDY_AREA.timeZone)).toBeNull();
  });
});

describe("filters", () => {
  it("restricts non-administrators to verified records", () => {
    const f = parseFilterParams(new URLSearchParams("statuses=reported,verified"), { canSeePending: false });
    expect(f.statuses).toEqual(["verified"]);
    const admin = parseFilterParams(new URLSearchParams("statuses=reported,verified"), { canSeePending: true });
    expect(admin.statuses.sort()).toEqual(["reported", "verified"]);
  });

  it("validates ranges and categories", () => {
    expect(() => parseFilterParams(new URLSearchParams("hours=9-7"), { canSeePending: false })).toThrow();
    expect(() => parseFilterParams(new URLSearchParams("categories=hovercraft"), { canSeePending: false })).toThrow();
    expect(() => parseFilterParams(new URLSearchParams("from=2024/01/01"), { canSeePending: false })).toThrow();
  });

  it("normalises JSON filter objects (hours arrays, dataset ids) identically to query strings", () => {
    const f = normalizeFilterObject({ hours: [7, 9], categories: ["pedestrian"], datasetIds: [3, 4], statuses: ["verified"] }, { canSeePending: false });
    expect(f.hours).toEqual([7, 9]);
    expect(f.datasetIds).toEqual([3, 4]);
    expect(f.categories).toEqual(["pedestrian"]);
  });
});

describe("report validation", () => {
  const valid = {
    lon: STUDY_AREA.center.lon,
    lat: STUDY_AREA.center.lat,
    occurredLocal: "2024-05-01T08:15",
    categoryCode: "cyclist" as const,
    severityId: 2,
    vehiclesInvolved: 1,
    emergencyServices: false,
    description: "Cyclist struck by a car door opening.",
    privacyConsent: true as const,
  };

  it("accepts a well-formed report inside the study area", () => {
    expect(reportSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects locations outside coverage, missing consent, and future timestamps", () => {
    expect(reportSchema.safeParse({ ...valid, lon: 14.9 }).success).toBe(false);
    expect(reportSchema.safeParse({ ...valid, privacyConsent: false as unknown as true }).success).toBe(false);
    expect(reportSchema.safeParse({ ...valid, occurredLocal: "2999-01-01T10:00" }).success).toBe(false);
  });

  it("keeps catalogue parameters within their declared bounds", () => {
    for (const def of ANALYSIS_DEFS.kde.params) {
      if (def.kind === "number") expect(def.min).toBeLessThan(def.max);
    }
  });
});
