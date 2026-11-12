import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { findDuplicateCandidates } from "@/lib/data";

export const dynamic = "force-dynamic";

const schema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  occurredAt: z.string(),
  categoryCode: z.string().default("rear_end"),
});

export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return jsonError("Invalid duplicate-check payload.", 422, parsed.error.flatten());
    const occurredAt = new Date(parsed.data.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) return jsonError("Invalid occurredAt.", 422);
    const candidates = await findDuplicateCandidates(parsed.data.lat, parsed.data.lng, occurredAt, parsed.data.categoryCode);
    return jsonOk({
      candidates,
      thresholdHigh: 0.85,
      thresholdMedium: 0.6,
      method:
        "Weighted similarity: 60 % inverse distance (≤250 m), 30 % temporal proximity (≤24 h), 10 % category match. Scores ≥ 0.85 are provisionally flagged duplicates; ≥ 0.60 are flagged for moderator attention.",
    });
  } catch (error) {
    console.error("duplicate check failed", error);
    return jsonError("Unable to run duplicate detection.", 500);
  }
}
