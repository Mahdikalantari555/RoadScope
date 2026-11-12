import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  accidents,
  reportVerifications,
  auditLogs,
  users,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  executeAndPersistSpatialLabJob,
  DEFAULT_LAB_PARAMS,
  getPlatformState,
} from "@/lib/geo/platformService";
import { computeVgiCredibilityScore } from "@/lib/geo/mapMatching";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const accidentId = Number(body.accidentId);

    const existingList = await db
      .select()
      .from(accidents)
      .where(eq(accidents.id, accidentId));

    if (existingList.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Incident record not found." },
        { status: 404 }
      );
    }

    const target = existingList[0];
    const allUsers = await db.select().from(users);
    const steward =
      allUsers.find((u) => u.role === "data_steward") ?? allUsers[0];

    // Action 1: Override Topological Map-Matching Snap Candidate (US-3.1)
    if (body.action === "override_snap_candidate") {
      const candidateIndex = Number(body.candidateIndex ?? 0);
      const candidate = target.snapCandidatesJson[candidateIndex];
      if (!candidate) {
        return NextResponse.json(
          { ok: false, error: "Selected snap candidate index is invalid." },
          { status: 400 }
        );
      }

      await db
        .update(accidents)
        .set({
          snappedSegmentId: candidate.segmentId,
          snappedLixelId: candidate.lixelId,
          snappedXM: candidate.snappedXM,
          snappedYM: candidate.snappedYM,
          snappedLon: candidate.snappedLon,
          snappedLat: candidate.snappedLat,
          linearOffsetM: candidate.linearOffsetM,
          snapDistanceM: candidate.orthogonalDistM,
          snapProbabilityScore: candidate.probabilityScore,
        })
        .where(eq(accidents.id, target.id));

      await db.insert(reportVerifications).values({
        accidentId: target.id,
        stewardUserId: steward?.id ?? null,
        previousStatus: target.verificationStatus,
        newStatus: target.verificationStatus,
        verificationNotes: `Topological snap reassigned to ${candidate.segmentCode} (${candidate.segmentName}) at LRS m=${candidate.linearOffsetM}m.`,
        overriddenSegmentId: candidate.segmentId,
        overriddenOffsetM: candidate.linearOffsetM,
      });

      await db.insert(auditLogs).values({
        actorRole: "data_steward",
        actorName: steward?.name || "Marta Lindqvist",
        actionType: "TOPOLOGICAL_SNAP_OVERRIDDEN",
        entityType: "accidents",
        entityId: target.incidentCode,
        detailsJson: {
          newSegmentCode: candidate.segmentCode,
          newLixelCode: candidate.lixelCode,
          newOffsetM: candidate.linearOffsetM,
          orthogonalDistM: candidate.orthogonalDistM,
        },
      });
    }
    // Action 2: Merge Duplicate Report into Canonical Incident (US-3.2)
    else if (body.action === "merge_duplicate" && body.canonicalIncidentId) {
      const canonicalId = Number(body.canonicalIncidentId);
      const canonicalList = await db
        .select()
        .from(accidents)
        .where(eq(accidents.id, canonicalId));

      if (canonicalList.length === 0) {
        return NextResponse.json(
          { ok: false, error: "Canonical parent incident not found." },
          { status: 404 }
        );
      }

      const canonical = canonicalList[0];
      const mergedWitnesses = canonical.witnessCount + target.witnessCount;
      const updatedCredibility = computeVgiCredibilityScore({
        witnessCount: mergedWitnesses,
        snapProbabilityScore: canonical.snapProbabilityScore,
        observationalRadiusM: canonical.observationalRadiusM,
        reportingLagMinutes: canonical.reportingLagMinutes,
        isVerifiedBySteward: true,
      });

      await db
        .update(accidents)
        .set({
          parentCanonicalId: canonical.id,
          verificationStatus: "conflated_witness_child",
        })
        .where(eq(accidents.id, target.id));

      await db
        .update(accidents)
        .set({
          witnessCount: mergedWitnesses,
          credibilityScore: updatedCredibility,
          verificationStatus: "verified_canonical",
        })
        .where(eq(accidents.id, canonical.id));

      await db.insert(reportVerifications).values({
        accidentId: target.id,
        stewardUserId: steward?.id ?? null,
        previousStatus: target.verificationStatus,
        newStatus: "conflated_witness_child",
        verificationNotes: `Merged into canonical incident ${canonical.incidentCode} via spatiotemporal network kernel conflation.`,
        overriddenSegmentId: canonical.snappedSegmentId,
        overriddenOffsetM: canonical.linearOffsetM,
      });

      await db.insert(auditLogs).values({
        actorRole: "data_steward",
        actorName: steward?.name || "Marta Lindqvist",
        actionType: "VGI_DUPLICATE_CONFLATED",
        entityType: "accidents",
        entityId: `${target.incidentCode} -> ${canonical.incidentCode}`,
        detailsJson: {
          childIncidentCode: target.incidentCode,
          canonicalIncidentCode: canonical.incidentCode,
          mergedWitnessCount: mergedWitnesses,
          updatedCredibility,
        },
      });
    }
    // Action 3: Standard Steward Status Transition (Verify / Reject / Flag) (US-3.3)
    else {
      const validStatuses = [
        "verified_canonical",
        "unverified_raw_vgi",
        "flagged",
        "rejected",
      ];
      const newStatus = validStatuses.includes(body.newStatus)
        ? body.newStatus
        : "verified_canonical";

      const newCredibility =
        newStatus === "verified_canonical"
          ? 0.98
          : newStatus === "rejected"
          ? 0.05
          : newStatus === "flagged"
          ? 0.22
          : target.credibilityScore;

      await db
        .update(accidents)
        .set({
          verificationStatus: newStatus,
          credibilityScore: newCredibility,
          severityCode: body.severityCode || target.severityCode,
          categoryCode: body.categoryCode || target.categoryCode,
        })
        .where(eq(accidents.id, target.id));

      await db.insert(reportVerifications).values({
        accidentId: target.id,
        stewardUserId: steward?.id ?? null,
        previousStatus: target.verificationStatus,
        newStatus,
        verificationNotes:
          body.verificationNotes ||
          `Steward transition ${target.verificationStatus} -> ${newStatus}.`,
        overriddenSegmentId: null,
        overriddenOffsetM: null,
      });

      await db.insert(auditLogs).values({
        actorRole: "data_steward",
        actorName: steward?.name || "Marta Lindqvist",
        actionType: `STEWARD_STATUS_${newStatus.toUpperCase()}`,
        entityType: "accidents",
        entityId: target.incidentCode,
        detailsJson: {
          previousStatus: target.verificationStatus,
          newStatus,
          notes: body.verificationNotes || "Verified topological alignment",
        },
      });
    }

    await executeAndPersistSpatialLabJob(DEFAULT_LAB_PARAMS);
    const state = await getPlatformState();
    return NextResponse.json({ ok: true, data: state });
  } catch (error) {
    console.error("Error in POST /api/steward:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to execute steward action",
      },
      { status: 400 }
    );
  }
}
