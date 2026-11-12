import { NextRequest, NextResponse } from "next/server";
import { getPlatformState } from "@/lib/geo/platformService";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const layer = req.nextUrl.searchParams.get("layer") || "lixels";
    const state = await getPlatformState();

    if (layer === "incidents") {
      const featureCollection = {
        type: "FeatureCollection",
        metadata: {
          title: "Urban Accident Intelligence — Network-Snapped & Raw VGI Incidents",
          canonicalProjectedSrid: "EPSG:32618",
          serializationGeographicSrid: "EPSG:4326",
          datasetSource: state.activeDataset?.code,
          isSynthetic: state.activeDataset?.isSynthetic,
          exportedAtUtc: new Date().toISOString(),
        },
        features: state.accidents.map((acc) => ({
          type: "Feature",
          id: acc.incidentCode,
          geometry: {
            type: "Point",
            coordinates: [acc.snappedLon, acc.snappedLat],
          },
          properties: {
            incidentCode: acc.incidentCode,
            verificationStatus: acc.verificationStatus,
            categoryCode: acc.categoryCode,
            severityCode: acc.severityCode,
            snappedSegmentId: acc.snappedSegmentId,
            snappedLixelId: acc.snappedLixelId,
            linearOffsetM: acc.linearOffsetM,
            snapDistanceM: acc.snapDistanceM,
            snapProbabilityScore: acc.snapProbabilityScore,
            rawMetricEPSG32618: [acc.rawXM, acc.rawYM],
            snappedMetricEPSG32618: [acc.snappedXM, acc.snappedYM],
            rawGeographicEPSG4326: [acc.rawLon, acc.rawLat],
            observationalRadiusM: acc.observationalRadiusM,
            credibilityScore: acc.credibilityScore,
            witnessCount: acc.witnessCount,
            incidentTimestampUtc: acc.incidentTimestampUtc,
            reportingLagMinutes: acc.reportingLagMinutes,
            weatherCondition: acc.weatherCondition,
            roadSurface: acc.roadSurface,
            lightingCondition: acc.lightingCondition,
            isSynthetic: acc.isSynthetic,
          },
        })),
      };
      return NextResponse.json(featureCollection);
    }

    if (layer === "segments") {
      const riskMap = new Map(
        state.segmentRiskPortfolio.map((r) => [r.segmentId, r])
      );
      const featureCollection = {
        type: "FeatureCollection",
        metadata: {
          title: "Urban Accident Intelligence — Empirical Bayes & Multi-Criteria Segment Portfolio",
          canonicalProjectedSrid: "EPSG:32618",
          serializationGeographicSrid: "EPSG:4326",
          datasetSource: state.activeDataset?.code,
          exportedAtUtc: new Date().toISOString(),
        },
        features: state.segments.map((seg) => {
          const risk = riskMap.get(seg.id);
          return {
            type: "Feature",
            id: seg.segmentCode,
            geometry: {
              type: "LineString",
              coordinates: seg.coordsGeoJson,
            },
            properties: {
              segmentCode: seg.segmentCode,
              name: seg.name,
              roadClass: seg.roadClass,
              isOverpass: seg.isOverpass,
              lengthM: seg.lengthM,
              aadt: seg.aadt,
              speedLimitKmh: seg.speedLimitKmh,
              sinuosity: seg.sinuosity,
              ...risk,
            },
          };
        }),
      };
      return NextResponse.json(featureCollection);
    }

    // Default: Lixel-level Geocomputation Surface (NKDE, Planar KDE, Gi*, N-DBSCAN, EB, Ground-Truth Lambda)
    const featureCollection = {
      type: "FeatureCollection",
      metadata: {
        title: "Urban Accident Intelligence — Lixel-Level Network Geocomputation Surface",
        canonicalProjectedSrid: "EPSG:32618",
        serializationGeographicSrid: "EPSG:4326",
        lixelResolutionM: state.activeDataset?.lixelSizeM ?? 50,
        latestJobCode: state.latestJob?.jobCode,
        parameters: state.latestJob?.parametersJson,
        exportedAtUtc: new Date().toISOString(),
      },
      features: state.lixels.map((lx) => ({
        type: "Feature",
        id: lx.lixelCode,
        geometry: {
          type: "LineString",
          coordinates: lx.coordsGeoJson,
        },
        properties: {
          lixelCode: lx.lixelCode,
          segmentId: lx.segmentId,
          mStartM: lx.mStartM,
          mEndM: lx.mEndM,
          lengthM: lx.lengthM,
          centerMetricEPSG32618: [lx.centerXM, lx.centerYM],
          distToNearestJunctionM: lx.distToNearestJunctionM,
          trueIntensityLambda: lx.trueIntensityLambda,
          nkdeValue: lx.nkdeValue,
          planarKdeValue: lx.planarKdeValue,
          kdeDiffValue: lx.kdeDiffValue,
          giStarZ: lx.giStarZ,
          giStarPValue: lx.giStarPValue,
          giStarFdrPValue: lx.giStarFdrPValue,
          giStarClusterType: lx.giStarClusterType,
          dbscanClusterId: lx.dbscanClusterId,
          ebExpectedRate: lx.ebExpectedRate,
          psiExcessRate: lx.psiExcessRate,
          vulnerabilityScore: lx.vulnerabilityScore,
          epistemicUncertainty: lx.epistemicUncertainty,
          bivariateClass: lx.bivariateClass,
        },
      })),
    };

    return NextResponse.json(featureCollection);
  } catch (error) {
    console.error("Error in GET /api/export/geojson:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to export GeoJSON" },
      { status: 500 }
    );
  }
}
