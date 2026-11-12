/**
 * Input validation schemas (Zod). Shared by API handlers and client forms.
 */
import { z } from "zod";
import { ANALYSIS_TYPES, CATEGORY_CODES, SCENARIO_IDS, STUDY_AREA, type AnalysisType } from "./domain";
import { ANALYSIS_DEFS } from "./catalog";
import { isWithinStudyCoverage } from "./geo";
import { parseLocalDateTime } from "./time";

const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Expected a local date and time (YYYY-MM-DDTHH:mm)");

const lon = z.number().min(-180, "Longitude must be ≥ -180").max(180, "Longitude must be ≤ 180");
const lat = z.number().min(-90, "Latitude must be ≥ -90").max(90, "Latitude must be ≤ 90");

const MAX_AGE_MS = 15 * 365.25 * 24 * 3600 * 1000;

export const reportSchema = z
  .object({
    lon,
    lat,
    accuracyM: z.number().min(0).max(5000).nullable().optional(),
    occurredLocal: localDateTime,
    categoryCode: z.enum(CATEGORY_CODES, { message: "Select an accident category" }),
    severityId: z.number().int().min(1).max(4, "Select a severity level"),
    vehiclesInvolved: z.number().int().min(1, "At least one vehicle or road user").max(50, "Maximum 50 vehicles"),
    emergencyServices: z.boolean(),
    description: z
      .string()
      .trim()
      .min(10, "Describe the incident in at least 10 characters")
      .max(1000, "Keep the description under 1000 characters"),
    privacyConsent: z.literal(true, { message: "Consent to the privacy notice is required" }),
  })
  .superRefine((v, ctx) => {
    if (!isWithinStudyCoverage(v.lon, v.lat)) {
      ctx.addIssue({
        code: "custom",
        path: ["lat"],
        message: `Location lies outside the covered study area (${STUDY_AREA.name})`,
      });
    }
    const occurred = parseLocalDateTime(v.occurredLocal, STUDY_AREA.timeZone);
    if (!occurred) {
      ctx.addIssue({ code: "custom", path: ["occurredLocal"], message: "Invalid date or time" });
      return;
    }
    const now = Date.now();
    if (occurred.getTime() > now + 5 * 60 * 1000) {
      ctx.addIssue({ code: "custom", path: ["occurredLocal"], message: "Occurrence time cannot be in the future" });
    }
    if (occurred.getTime() < now - MAX_AGE_MS) {
      ctx.addIssue({ code: "custom", path: ["occurredLocal"], message: "Occurrence time is more than 15 years ago" });
    }
  });

export type ReportInput = z.infer<typeof reportSchema>;

export const accidentPatchSchema = z
  .object({
    categoryCode: z.enum(CATEGORY_CODES).optional(),
    severityId: z.number().int().min(1).max(4).optional(),
    occurredLocal: localDateTime.optional(),
    vehiclesInvolved: z.number().int().min(1).max(50).optional(),
    emergencyServices: z.boolean().optional(),
    description: z.string().trim().max(1000).optional(),
    lon: lon.optional(),
    lat: lat.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.lon === undefined) !== (v.lat === undefined)) {
      ctx.addIssue({ code: "custom", path: ["lat"], message: "lon and lat must be supplied together" });
    }
    if (v.lon !== undefined && v.lat !== undefined && !isWithinStudyCoverage(v.lon, v.lat)) {
      ctx.addIssue({ code: "custom", path: ["lat"], message: "Validated location lies outside the study area" });
    }
    const changed = Object.entries(v).some(([k, val]) => k !== "note" && val !== undefined);
    if (!changed) ctx.addIssue({ code: "custom", path: [], message: "No changes supplied" });
  });

export type AccidentPatchInput = z.infer<typeof accidentPatchSchema>;

export const reviewSchema = z
  .object({
    action: z.enum(["verify", "reject", "mark_duplicate", "reopen"]),
    duplicateOfId: z.number().int().positive().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.action !== "mark_duplicate" || v.duplicateOfId !== undefined, {
    message: "duplicateOfId is required when marking a duplicate",
    path: ["duplicateOfId"],
  });

export const syntheticDatasetSchema = z.object({
  name: z.string().trim().min(3).max(80).optional(),
  scenario: z.enum(SCENARIO_IDS),
  seed: z.number().int().min(0).max(2_147_483_647),
  accidentCount: z.number().int().min(200).max(20000),
  kind: z.enum(["synthetic", "citizen"]).default("synthetic"),
});

export const importDatasetSchema = z.object({
  name: z.string().trim().min(3).max(120),
  features: z.array(z.unknown()).min(1).max(50000),
});

export const datasetPatchSchema = z.object({
  isActive: z.boolean(),
});

export type SyntheticDatasetInput = z.infer<typeof syntheticDatasetSchema>;
export type ImportInput = z.infer<typeof importDatasetSchema>;

export const analysisJobSchema = z.object({
  type: z.enum(ANALYSIS_TYPES),
  params: z.record(z.string(), z.unknown()).default({}),
  filters: z.record(z.string(), z.unknown()).default({}),
});

/** Builds a strict Zod object from an analysis' parameter definitions. */
export function paramsSchemaFor(type: AnalysisType) {
  const shape: Record<string, z.ZodType> = {};
  for (const p of ANALYSIS_DEFS[type].params) {
    if (p.kind === "number") {
      shape[p.key] = z.coerce.number().min(p.min).max(p.max).default(p.default);
    } else {
      const values = p.options.map((o) => o.value) as [string, ...string[]];
      shape[p.key] = z.enum(values).default(p.default);
    }
  }
  return z.object(shape).strict();
}

export function validateRiskWeights(params: Record<string, unknown>): string | null {
  const keys = ["wCount", "wDensity", "wSeverity", "wExposure", "wDarkness", "wSpeed"];
  const total = keys.reduce((s, k) => s + Number(params[k] ?? 0), 0);
  return total > 0 ? null : "At least one risk weight must be greater than zero";
}
