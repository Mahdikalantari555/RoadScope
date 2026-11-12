import { jsonError, jsonOk } from "@/lib/api";
import { loadAccidentDetail } from "@/lib/data";

export const dynamic = "force-dynamic";

/** Public status tracking. Deliberately omits reporter identity and raw contact data. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const publicId = url.searchParams.get("publicId")?.trim();
  if (!publicId) return jsonError("Provide a tracking reference (publicId).", 400);
  const detail = await loadAccidentDetail(publicId);
  if (!detail) return jsonError("No report found with that reference.", 404);
  return jsonOk({
    publicId: detail.publicId,
    status: detail.status,
    categoryCode: detail.categoryCode,
    severityCode: detail.severityCode,
    occurredAt: detail.occurredAt,
    reportedAt: detail.reportedAt,
    district: detail.district,
    lat: detail.lat,
    lng: detail.lng,
    positionalUncertaintyM: detail.positionalUncertaintyM,
    locationMethod: detail.locationMethod,
    description: detail.description,
    duplicateOfId: detail.duplicateOfId,
    qualityFlags: detail.qualityFlags,
    attachments: detail.attachments.length,
    timeline: detail.verifications,
    privacyNotice:
      "Reporter identity and contact details are never returned by the tracking endpoint. Verified status means a moderator checked the record; it is not a legal determination.",
  });
}
