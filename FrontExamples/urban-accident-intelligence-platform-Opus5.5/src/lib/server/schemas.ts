import { z } from "zod";
import { ANALYSIS_METHODS, CATEGORIES, SEVERITIES, STATUSES } from "@/lib/domain";

const catCodes = CATEGORIES.map((c) => c.code) as [string, ...string[]];
const sevCodes = SEVERITIES.map((s) => s.code) as [string, ...string[]];
const statusCodes = STATUSES.map((s) => s.code) as [string, ...string[]];

export const filtersSchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    categories: z.array(z.enum(catCodes)).optional(),
    severities: z.array(z.enum(sevCodes)).optional(),
    statuses: z.array(z.enum(statusCodes)).optional(),
    datasets: z.array(z.number().int()).optional(),
    hourFrom: z.number().int().min(0).max(23).optional(),
    hourTo: z.number().int().min(0).max(23).optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).optional(),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  })
  .default({});

export const analysisRequestSchema = z.object({
  method: z.enum(ANALYSIS_METHODS.map((m) => m.code) as [string, ...string[]]),
  params: z.record(z.string(), z.unknown()).default({}),
  filters: filtersSchema,
});

const MAX_ATTACHMENT_B64 = 2_000_000; // ≈1.5 MB binary

export const reportSchema = z.object({
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  occurredAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date/time"),
  category: z.enum(catCodes),
  severity: z.enum(sevCodes),
  vehicles: z.number().int().min(0).max(60),
  description: z.string().trim().min(10, "Please describe the incident (≥ 10 characters)").max(2000),
  emergencyServices: z.boolean(),
  contact: z.string().trim().max(120).optional().or(z.literal("")),
  consent: z.literal(true, { message: "Consent to the privacy terms is required" }),
  attachments: z
    .array(
      z.object({
        fileName: z.string().max(200),
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        dataBase64: z.string().max(MAX_ATTACHMENT_B64, "Attachment too large (max ≈1.5 MB)"),
      }),
    )
    .max(3)
    .default([]),
});

export const duplicateCheckSchema = z.object({
  lon: z.number(),
  lat: z.number(),
  occurredAt: z.string(),
  category: z.enum(catCodes),
  severity: z.enum(sevCodes),
});

export const reviewSchema = z.object({
  action: z.enum(["verify", "reject", "mark_duplicate", "reopen"]),
  duplicateOfId: z.number().int().optional(),
  note: z.string().max(1000).default(""),
});

export const editSchema = z.object({
  occurredAt: z.string().optional(),
  category: z.enum(catCodes).optional(),
  severity: z.enum(sevCodes).optional(),
  vehicles: z.number().int().min(0).max(60).optional(),
  description: z.string().max(2000).optional(),
  emergencyServices: z.boolean().optional(),
  lon: z.number().optional(),
  lat: z.number().optional(),
  note: z.string().max(1000).default(""),
});
