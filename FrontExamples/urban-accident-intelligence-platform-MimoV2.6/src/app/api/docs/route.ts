import { NextResponse } from "next/server";
import { API_ENDPOINTS, API_VERSION } from "@/lib/apiCatalog";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    name: "Urban Accident Intelligence API",
    version: API_VERSION,
    description:
      "REST API for crowdsourced road accident reporting, spatiotemporal querying, spatial analysis, risk assessment and dataset stewardship. All data served by this build is synthetic.",
    conventions: {
      crs: "EPSG:4326 (WGS 84)",
      timestamps: "ISO-8601, UTC",
      spatialFormat: "GeoJSON FeatureCollection",
      errors: "{ error, issues?: [{ path, message }] } with an appropriate HTTP status",
      pagination: "{ data, total, limit, offset }",
    },
    endpoints: API_ENDPOINTS,
  });
}
